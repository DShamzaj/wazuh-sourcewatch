import { OpenSearchClient } from '../../../../src/core/server';
import { SourcewatchConfig } from '../config';

export interface CoverageTarget {
  agentId: string;
  location: string;
  channel: string | null;
}

export interface Coverage {
  basis: 'own' | 'peers' | 'none';
  days: number;
  total_alerts: number;
  rules: Array<{ id: string; description: string; level: number; count: number; mitre: string[] }>;
  techniques: Array<{ id: string; count: number }>;
  tactics: Array<{ name: string; count: number }>;
}

/**
 * Detection coverage a source provides: the rules and MITRE techniques it fed
 * over the last N days. Falls back to the same source on other agents when
 * this agent has no history (e.g. a required source that was never seen).
 */
export async function getCoverage(
  client: OpenSearchClient,
  config: SourcewatchConfig,
  target: CoverageTarget
): Promise<Coverage> {
  const own = await query(client, config, target, 'own');
  if (own.total_alerts > 0) return own;
  const peers = await query(client, config, target, 'peers');
  return peers.total_alerts > 0 ? peers : { ...peers, basis: 'none' };
}

async function query(
  client: OpenSearchClient,
  config: SourcewatchConfig,
  t: CoverageTarget,
  basis: 'own' | 'peers'
): Promise<Coverage> {
  const filter: any[] = [
    { range: { '@timestamp': { gte: `now-${config.coverageDays}d` } } },
    { term: { location: t.location } },
  ];
  const mustNot: any[] = [{ exists: { field: 'data.sourcewatch' } }];

  if (t.channel) filter.push({ term: { 'data.win.system.channel': t.channel } });
  else mustNot.push({ exists: { field: 'data.win.system.channel' } });

  if (basis === 'own') filter.push({ term: { 'agent.id': t.agentId } });
  else mustNot.push({ term: { 'agent.id': t.agentId } });

  const { body } = await client.search({
    index: config.alertsIndex,
    size: 0,
    ignore_unavailable: true,
    allow_no_indices: true,
    body: {
      track_total_hits: true,
      query: { bool: { filter, must_not: mustNot } },
      aggs: {
        rules: {
          terms: { field: 'rule.id', size: 100 },
          aggs: {
            sample: {
              top_hits: {
                size: 1,
                _source: { includes: ['rule.description', 'rule.level', 'rule.mitre.id'] },
              },
            },
          },
        },
        techniques: { terms: { field: 'rule.mitre.id', size: 100 } },
        tactics: { terms: { field: 'rule.mitre.tactic', size: 20 } },
      },
    },
  });

  const aggs = body.aggregations ?? {};
  const rules = (aggs.rules?.buckets ?? []).map((b: any) => {
    const r = b.sample?.hits?.hits?.[0]?._source?.rule ?? {};
    const mitre = r.mitre?.id;
    return {
      id: String(b.key),
      description: r.description ?? '',
      level: Number(r.level ?? 0),
      count: b.doc_count,
      mitre: Array.isArray(mitre) ? mitre : mitre ? [mitre] : [],
    };
  });

  return {
    basis,
    days: config.coverageDays,
    total_alerts: body.hits?.total?.value ?? 0,
    rules,
    techniques: (aggs.techniques?.buckets ?? []).map((b: any) => ({ id: b.key, count: b.doc_count })),
    tactics: (aggs.tactics?.buckets ?? []).map((b: any) => ({ name: b.key, count: b.doc_count })),
  };
}
