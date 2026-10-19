import * as https from 'https';
import { URL } from 'url';
import { Logger } from '../../../../src/core/server';
import { SourcewatchConfig } from '../config';

type ApiConfig = SourcewatchConfig['wazuhApi'];

interface ApiResponse {
  status: number;
  body: any;
}

export interface WazuhApiAgent {
  id: string;
  name: string;
  groups: string[];
}

const MAX_EVENTS_PER_REQUEST = 100;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const AGENT_PAGE = 10000;

export class WazuhForwarder {
  private token?: string;
  private tokenExpires = 0;

  constructor(private readonly cfg: ApiConfig, private readonly logger: Logger) {}

  /** Sends state changes to analysisd through the Wazuh server API (POST /events). */
  async send(changes: any[]): Promise<void> {
    if (!changes.length) return;

    const lines = changes.map((ev) =>
      JSON.stringify({
        sourcewatch: {
          event: 'state_change',
          state: ev.state,
          previous_state: ev.previous_state,
          agent_id: ev.agent?.id,
          agent_name: ev.agent?.name,
          location: ev.location,
          channel: ev.channel ?? '-',
          contract: ev.contract ?? '-',
          gap_seconds: ev.gap_seconds,
          normal_max_gap_seconds: Math.round(ev.max_gap_seconds ?? 0),
          lost_rule_count: ev.lost_rule_count ?? 0,
          lost_mitre: (ev.lost_mitre ?? []).join(',') || '-',
          coverage_basis: ev.coverage_basis ?? 'none',
        },
      })
    );

    for (let i = 0; i < lines.length; i += MAX_EVENTS_PER_REQUEST) {
      const body = JSON.stringify({ events: lines.slice(i, i + MAX_EVENTS_PER_REQUEST) });
      const res = await this.authed('POST', '/events', body);
      if (res.status !== 200) {
        throw new Error(
          `Wazuh API /events returned HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`
        );
      }
    }
    this.logger.info(`SourceWatch forwarded ${lines.length} state change(s) to the Wazuh manager`);
  }

  /** Active agents with their groups (paged). */
  async getAgents(): Promise<WazuhApiAgent[]> {
    const out: WazuhApiAgent[] = [];
    let offset = 0;
    for (;;) {
      const res = await this.authed(
        'GET',
        `/agents?select=name,group&status=active&limit=${AGENT_PAGE}&offset=${offset}`
      );
      if (res.status !== 200) {
        throw new Error(`Wazuh API /agents returned HTTP ${res.status}`);
      }
      const items: any[] = res.body?.data?.affected_items ?? [];
      items.forEach((a) => out.push({ id: a.id, name: a.name, groups: a.group ?? [] }));
      offset += items.length;
      const total = res.body?.data?.total_affected_items ?? 0;
      if (!items.length || offset >= total) break;
    }
    return out;
  }

  private async authed(method: string, path: string, body?: string): Promise<ApiResponse> {
    let res = await this.request(method, path, { Authorization: `Bearer ${await this.getToken()}` }, body);
    if (res.status === 401) {
      res = await this.request(method, path, { Authorization: `Bearer ${await this.getToken(true)}` }, body);
    }
    return res;
  }

  private async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.tokenExpires) return this.token;

    const basic = Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64');
    const res = await this.request('POST', '/security/user/authenticate', {
      Authorization: `Basic ${basic}`,
    });
    const token = res.body?.data?.token;
    if (res.status !== 200 || !token) {
      throw new Error(`Wazuh API authentication failed (HTTP ${res.status})`);
    }
    this.token = token;
    this.tokenExpires = Date.now() + TOKEN_TTL_MS;
    return token;
  }

  private request(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<ApiResponse> {
    const url = new URL(path, this.cfg.url);
    const allHeaders: Record<string, string> = { ...headers };
    if (body) {
      allHeaders['Content-Type'] = 'application/json';
      allHeaders['Content-Length'] = String(Buffer.byteLength(body));
    }

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          method,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          headers: allHeaders,
          rejectUnauthorized: this.cfg.verifyTls,
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            let parsed: any = data;
            try {
              parsed = JSON.parse(data);
            } catch {
              // keep raw text
            }
            resolve({ status: res.statusCode || 0, body: parsed });
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('Wazuh API request timed out')));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}
