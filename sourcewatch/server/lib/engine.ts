import { createHash } from 'crypto';
import { Logger, OpenSearchClient } from '../../../../src/core/server';
import {
  INDEX_CONFIG,
  INDEX_INVENTORY,
  INDEX_STATE_PREFIX,
  SourceState,
} from '../../common';
import { SourcewatchConfig } from '../config';
import { WazuhApiAgent, WazuhForwarder } from './wazuh_forwarder';
import { getCoverage } from './coverage';

interface Observation {
  agentId: string;
  agentName: string;
  location: string;
  channel: string | null;
  count: number;
  first: number;
  last: number;
}

interface Contract {
  name: string;
  group: string;
  enabled?: boolean;
  required: Array<{ location: string; channel?: string | null }>;
}

interface Requirement {
  agentId: string;
  agentName: string;
  location: string;
  channel: string | null;
  contract: string;
}

export interface InventoryDoc {
  source_key: string;
  agent: { id: string; name: string };
  location: string;
  channel: string | null;
  state: SourceState;
  previous_state: SourceState | null;
  state_since: string;
  first_seen: string | null;
  last_seen: string | null;
  last_count: number;
  ewma_count: number; // normal events per active window
  gap_history: number[]; // recent normal gaps between appearances (seconds)
  max_gap_seconds: number; // percentile of gap_history = the "normal gap"
  drop_cycles: number;
  min_gap_seconds?: number | null;
  contract?: string | null;
  gap_seconds: number;
  updated_at: string;
}

export interface CycleResult {
  ran: boolean;
  reason?: string;
  sources?: number;
  changes?: number;
  window_from?: string;
  window_to?: string;
}

const LOCK_ID = 'scheduler-lock';
const PAGE_SIZE = 1000;
const DAY_MS = 86400000;
const ALERTING: SourceState[] = ['delayed', 'silent', 'volume_drop', 'missing'];

const docId = (key: string) => createHash('sha1').update(key).digest('hex');
const iso = (ms: number) => new Date(ms).toISOString();
const sourceKey = (agentId: string, location: string | null, channel: string | null) =>
  [agentId, location || '-', channel || '-'].join('|');

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
};

export class SourceWatchEngine {
  private running = false;
  private readonly ignored: Set<string>;

  constructor(
    private readonly client: OpenSearchClient,
    private readonly config: SourcewatchConfig,
    private readonly logger: Logger,
    private readonly nodeId: string,
    private readonly wazuh?: WazuhForwarder
  ) {
    this.ignored = new Set(config.ignoreLocations);
  }

  async runCycle(opts: { manual?: boolean } = {}): Promise<CycleResult> {
    const manual = !!opts.manual;
    if (this.running) return { ran: false, reason: 'cycle already running' };
    this.running = true;
    try {
      if (!(await this.acquireLock())) {
        return { ran: false, reason: 'another dashboard node holds the scheduler lock' };
      }

      const now = Date.now();
      const nowIso = iso(now);
      const to = now - this.config.ingestLagSeconds * 1000;
      const from = to - this.config.intervalSeconds * 1000;

      const observations = await this.collect(from, to);
      const inventory = await this.loadInventory();
      const required = await this.loadRequirements(); // null = unknown (API down)
      const overrides = await this.loadOverrides();
      const keys = new Set<string>([...inventory.keys(), ...observations.keys()]);

      const ops: any[] = [];
      const events: any[] = [];
      let removed = 0;
      const indexOp = (key: string) => ({ index: { _index: INDEX_INVENTORY, _id: docId(key) } });
      const deleteOp = (key: string) => {
        removed += 1;
        ops.push({ delete: { _index: INDEX_INVENTORY, _id: docId(key) } });
      };
      const record = (previous: string, doc: InventoryDoc) =>
        events.push({
          '@timestamp': nowIso,
          source_key: doc.source_key,
          agent: doc.agent,
          location: doc.location,
          channel: doc.channel,
          contract: doc.contract ?? null,
          previous_state: previous,
          state: doc.state,
          gap_seconds: doc.gap_seconds,
          last_count: doc.last_count,
          ewma_count: doc.ewma_count,
          max_gap_seconds: doc.max_gap_seconds,
        });

      keys.forEach((key) => {
        const prev = inventory.get(key);
        const obs = observations.get(key);
        const req = required?.get(key);
        if (prev) prev.min_gap_seconds = overrides.get(key) ?? null;

        // Required source that has never reported
        if (prev && prev.state === 'missing') {
          if (obs) {
            const next = this.evaluate(key, undefined, obs, now, manual);
            next.contract = req?.contract ?? prev.contract ?? null;
            next.min_gap_seconds = prev.min_gap_seconds ?? null;
            next.previous_state = 'missing';
            ops.push(indexOp(key), next);
            record('missing', next);
          } else if (required && !req) {
            deleteOp(key);
          }
          return;
        }

        // Housekeeping: ignored locations and long-gone sources
        if (prev && !obs && !req) {
          if (this.ignored.has(prev.location)) {
            deleteOp(key);
            return;
          }
          const lastSeen = Date.parse(prev.last_seen ?? '');
          if (lastSeen && now - lastSeen > this.config.forgetAfterDays * DAY_MS) {
            deleteOp(key);
            return;
          }
        }

        const next = this.evaluate(key, prev, obs, now, manual);
        if (required) next.contract = req?.contract ?? null;
        ops.push(indexOp(key), next);

        if (
          prev &&
          prev.state !== next.state &&
          (ALERTING.includes(prev.state) || ALERTING.includes(next.state))
        ) {
          record(prev.state, next);
        }
      });

      required?.forEach((req, key) => {
        if (keys.has(key)) return;
        const doc = this.missingDoc(key, req, nowIso);
        ops.push(indexOp(key), doc);
        record('none', doc);
      });

      // Attach what goes blind (capped to keep cycles fast)
      const toEnrich = events
        .filter((e) => ['silent', 'delayed', 'missing'].includes(e.state))
        .slice(0, 50);
      for (const ev of toEnrich) {
        try {
          const cov = await getCoverage(this.client, this.config, {
            agentId: ev.agent.id,
            location: ev.location,
            channel: ev.channel,
          });
          ev.coverage_basis = cov.basis;
          ev.lost_rule_count = cov.rules.length;
          ev.lost_mitre = cov.techniques.map((t) => t.id).slice(0, 10);
        } catch (e: any) {
          this.logger.warn(`SourceWatch coverage lookup failed for ${ev.source_key}: ${e.message}`);
        }
      }

      const stateIndex = INDEX_STATE_PREFIX + nowIso.slice(0, 7).replace('-', '.');
      events.forEach((ev) => ops.push({ index: { _index: stateIndex } }, ev));

      if (ops.length) await this.bulk(ops);

      if (this.wazuh && events.length) {
        try {
          await this.wazuh.send(events);
        } catch (e: any) {
          this.logger.warn(`SourceWatch could not forward to the Wazuh manager: ${e.message}`);
        }
      }

      const added = required ? [...required.keys()].filter((k) => !keys.has(k)).length : 0;
      const total = keys.size + added - removed;
      this.logger.info(
        `SourceWatch cycle${manual ? ' (manual)' : ''}: ${total} sources, ${events.length} state changes` +
          (removed ? `, ${removed} removed` : '')
      );
      return {
        ran: true,
        sources: total,
        changes: events.length,
        window_from: iso(from),
        window_to: iso(to),
      };
    } finally {
      this.running = false;
    }
  }

  private async loadOverrides(): Promise<Map<string, number>> {
    const { body } = await this.client.search({
      index: INDEX_CONFIG,
      size: 10000,
      ignore_unavailable: true,
      body: { query: { match: { type: 'override' } } },
    });
    const map = new Map<string, number>();
    (body.hits?.hits ?? []).forEach((h: any) => {
      const o = h._source;
      if (o?.source_key && o.min_gap_seconds > 0) map.set(o.source_key, o.min_gap_seconds);
    });
    return map;
  }

  private missingDoc(key: string, r: Requirement, nowIso: string): InventoryDoc {
    return {
      source_key: key,
      agent: { id: r.agentId, name: r.agentName },
      location: r.location,
      channel: r.channel,
      state: 'missing',
      previous_state: null,
      state_since: nowIso,
      first_seen: null,
      last_seen: null,
      last_count: 0,
      ewma_count: 0,
      gap_history: [],
      max_gap_seconds: 0,
      drop_cycles: 0,
      min_gap_seconds: null,
      contract: r.contract,
      gap_seconds: 0,
      updated_at: nowIso,
    };
  }

  private async loadRequirements(): Promise<Map<string, Requirement> | null> {
    const out = new Map<string, Requirement>();
    const { body } = await this.client.search({
      index: INDEX_CONFIG,
      size: 1000,
      ignore_unavailable: true,
      body: { query: { match: { type: 'contract' } } },
    });
    const contracts: Contract[] = (body.hits?.hits ?? [])
      .map((h: any) => h._source)
      .filter((c: Contract) => c.enabled !== false);
    if (!contracts.length) return out;

    if (!this.wazuh) {
      this.logger.warn('SourceWatch contracts need sourcewatch.wazuhApi.enabled: true');
      return null;
    }

    let agents: WazuhApiAgent[];
    try {
      agents = await this.wazuh.getAgents();
    } catch (e: any) {
      this.logger.warn(`SourceWatch could not load agents from the Wazuh API: ${e.message}`);
      return null;
    }

    contracts.forEach((c) =>
      agents
        .filter((a) => a.groups.includes(c.group))
        .forEach((a) =>
          (c.required ?? []).forEach((r) => {
            const channel = r.channel || null;
            const key = sourceKey(a.id, r.location, channel);
            if (!out.has(key)) {
              out.set(key, {
                agentId: a.id,
                agentName: a.name,
                location: r.location,
                channel,
                contract: c.name,
              });
            }
          })
        )
    );
    return out;
  }

  private evaluate(
    key: string,
    prev: InventoryDoc | undefined,
    obs: Observation | undefined,
    now: number,
    manual: boolean
  ): InventoryDoc {
    const c = this.config;
    const nowIso = iso(now);
    const count = obs ? obs.count : 0;

    const doc: InventoryDoc = prev
      ? { ...prev }
      : {
          source_key: key,
          agent: { id: obs!.agentId, name: obs!.agentName },
          location: obs!.location,
          channel: obs!.channel,
          state: 'learning',
          previous_state: null,
          state_since: nowIso,
          first_seen: iso(obs!.first),
          last_seen: iso(obs!.last),
          last_count: 0,
          ewma_count: 0,
          gap_history: [],
          max_gap_seconds: 0,
          drop_cycles: 0,
          min_gap_seconds: null,
          contract: null,
          gap_seconds: 0,
          updated_at: nowIso,
        };

    doc.ewma_count = doc.ewma_count ?? 0;
    doc.gap_history = Array.isArray(doc.gap_history) ? [...doc.gap_history] : [];
    doc.drop_cycles = doc.drop_cycles ?? 0;

    if (obs) doc.agent = { id: obs.agentId, name: obs.agentName };

    const prevLastSeen = Date.parse(doc.last_seen ?? '') || 0;
    const wasAlerting = prev ? ALERTING.includes(prev.state) : false;

    // 1. Learn the gap between appearances. Never learn from an outage or a manual run.
    if (obs && prev && !wasAlerting && !manual) {
      const gapSec = (obs.first - prevLastSeen) / 1000;
      if (gapSec > 0) {
        doc.gap_history.push(Math.round(gapSec * 10) / 10);
        if (doc.gap_history.length > c.gapHistory) {
          doc.gap_history = doc.gap_history.slice(-c.gapHistory);
        }
      }
    }
    doc.max_gap_seconds = percentile(doc.gap_history, c.gapPercentile);

    const lastSeenMs = Math.max(prevLastSeen, obs ? obs.last : 0);
    doc.last_seen = iso(lastSeenMs);
    doc.last_count = count;

    const gap = Math.max(0, (now - lastSeenMs) / 1000);
    doc.gap_seconds = Math.round(gap);

    // 2. Decide the state
    const firstSeenMs = Date.parse(doc.first_seen ?? '') || now;
    const inWarmup =
      now - firstSeenMs < c.warmupSeconds * 1000 || doc.gap_history.length < c.minGapSamples;
    const normalGap = Math.max(doc.max_gap_seconds, doc.min_gap_seconds ?? 0);
    const continuous = normalGap < c.intervalSeconds;

    let next: SourceState;
    if (inWarmup) {
      next = 'learning';
    } else {
      const delayedAfter = Math.max(2 * c.intervalSeconds, 1.5 * normalGap);
      const silentAfter = Math.max(4 * c.intervalSeconds, 3 * normalGap);

      if (gap >= silentAfter) next = 'silent';
      else if (gap >= delayedAfter) next = 'delayed';
      else if (
        continuous &&
        count > 0 &&
        doc.ewma_count >= 5 &&
        count < doc.ewma_count * c.volumeDropRatio
      )
        next = 'volume_drop';
      else next = 'healthy';
    }

    // 3. Learn normal volume from active windows; manual runs never teach the model
    if (!manual && count > 0) {
      if (next === 'volume_drop') {
        doc.drop_cycles += 1;
        if (doc.drop_cycles >= c.rebaselineAfterCycles) {
          doc.ewma_count = count;
          doc.drop_cycles = 0;
          next = 'healthy';
        }
      } else {
        doc.drop_cycles = 0;
        doc.ewma_count =
          doc.ewma_count === 0
            ? count
            : c.ewmaAlpha * count + (1 - c.ewmaAlpha) * doc.ewma_count;
      }
    }

    if (next !== doc.state) {
      doc.previous_state = doc.state;
      doc.state = next;
      doc.state_since = nowIso;
    }
    doc.updated_at = nowIso;
    return doc;
  }

  private async collect(from: number, to: number): Promise<Map<string, Observation>> {
    const out = new Map<string, Observation>();
    let after: Record<string, unknown> | undefined;
    const mustNot: any[] = [{ exists: { field: 'data.sourcewatch' } }];
    if (this.config.ignoreLocations.length) {
      mustNot.push({ terms: { location: this.config.ignoreLocations } });
    }

    for (let page = 0; page < 100; page++) {
      const { body } = await this.client.search({
        index: this.config.sourceIndex,
        size: 0,
        ignore_unavailable: true,
        allow_no_indices: true,
        body: {
          query: {
            bool: {
              filter: [
                { range: { '@timestamp': { gte: from, lt: to, format: 'epoch_millis' } } },
              ],
              must_not: mustNot,
            },
          },
          aggs: {
            src: {
              composite: {
                size: PAGE_SIZE,
                ...(after ? { after } : {}),
                sources: [
                  { agent_id: { terms: { field: 'agent.id' } } },
                  { agent_name: { terms: { field: 'agent.name', missing_bucket: true } } },
                  { location: { terms: { field: 'location', missing_bucket: true } } },
                  {
                    channel: {
                      terms: { field: 'data.win.system.channel', missing_bucket: true },
                    },
                  },
                ],
              },
              aggs: {
                first: { min: { field: '@timestamp' } },
                last: { max: { field: '@timestamp' } },
              },
            },
          },
        },
      });

      const agg = body.aggregations?.src;
      const buckets: any[] = agg?.buckets ?? [];

      buckets.forEach((b) => {
        const k = b.key;
        const key = sourceKey(k.agent_id, k.location ?? null, k.channel ?? null);
        out.set(key, {
          agentId: k.agent_id,
          agentName: k.agent_name ?? '',
          location: k.location ?? '-',
          channel: k.channel ?? null,
          count: b.doc_count,
          first: b.first.value,
          last: b.last.value,
        });
      });

      if (buckets.length < PAGE_SIZE || !agg?.after_key) break;
      after = agg.after_key;
    }
    return out;
  }

  private async loadInventory(): Promise<Map<string, InventoryDoc>> {
    const { body } = await this.client.search({
      index: INDEX_INVENTORY,
      size: 10000,
      ignore_unavailable: true,
      body: { query: { match_all: {} } },
    });
    const map = new Map<string, InventoryDoc>();
    (body.hits?.hits ?? []).forEach((h: any) => map.set(h._source.source_key, h._source));
    return map;
  }

  private async bulk(ops: any[]) {
    const { body } = await this.client.bulk({ body: ops, refresh: 'wait_for' });
    if (body.errors) {
      const firstError = body.items.find((i: any) => (Object.values(i)[0] as any).error);
      this.logger.warn(`SourceWatch bulk errors, first: ${JSON.stringify(firstError)}`);
    }
  }

  private async acquireLock(): Promise<boolean> {
    const now = Date.now();
    const lock = {
      owner: this.nodeId,
      expires_at: now + this.config.intervalSeconds * 2000,
    };
    const { body } = await this.client.get(
      { index: INDEX_CONFIG, id: LOCK_ID },
      { ignore: [404] }
    );
    try {
      if (!body.found) {
        await this.client.create({
          index: INDEX_CONFIG,
          id: LOCK_ID,
          body: lock,
          refresh: 'wait_for',
        });
        return true;
      }
      const cur = body._source;
      if (cur.owner !== this.nodeId && cur.expires_at > now) return false;
      await this.client.index({
        index: INDEX_CONFIG,
        id: LOCK_ID,
        body: lock,
        if_seq_no: body._seq_no,
        if_primary_term: body._primary_term,
        refresh: 'wait_for',
      });
      return true;
    } catch (e: any) {
      if (e?.meta?.statusCode === 409) return false;
      throw e;
    }
  }
}
