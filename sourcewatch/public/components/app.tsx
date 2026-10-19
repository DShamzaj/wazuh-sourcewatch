import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiBasicTable,
  EuiButton,
  EuiCallOut,
  EuiFieldSearch,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiPage,
  EuiPageBody,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiStat,
  EuiTab,
  EuiTabs,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { CoreStart } from '../../../../src/core/public';
import { NavigationPublicPluginStart } from '../../../../src/plugins/navigation/public';
import { API_BASE, SourceState } from '../../common';
import { ago, errMsg, secs, sourceLabel, stateCell, STATE_COLOR, STATE_LABEL, STATE_ORDER } from './shared';
import { SourceFlyout } from './source_flyout';
import { ContractsTab } from './contracts_tab';

interface Props {
  basename: string;
  notifications: CoreStart['notifications'];
  http: CoreStart['http'];
  navigation: NavigationPublicPluginStart;
}

type Tab = 'sources' | 'contracts';

export const SourcewatchApp = ({ notifications, http }: Props) => {
  const [tab, setTab] = useState<Tab>('sources');
  const [sources, setSources] = useState<any[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [contractFilter, setContractFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, sum, ev] = await Promise.all([
        http.get(`${API_BASE}/sources`),
        http.get(`${API_BASE}/summary`),
        http.get(`${API_BASE}/events`),
      ]);
      setSources((s as any).sources);
      setSummary((sum as any).states);
      setEvents((ev as any).events);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [http]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const runNow = async () => {
    try {
      const r: any = await http.post(`${API_BASE}/run`);
      if (r.ran) {
        notifications.toasts.addSuccess(`Cycle done: ${r.sources} sources, ${r.changes} state changes`);
      } else {
        notifications.toasts.addWarning(`Skipped: ${r.reason}`);
      }
      load();
    } catch (e) {
      notifications.toasts.addDanger(errMsg(e));
    }
  };

  const contractNames = useMemo(
    () => [...new Set(sources.map((s) => s.contract).filter(Boolean))].sort() as string[],
    [sources]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sources.filter((s) => {
      if (stateFilter !== 'all' && s.state !== stateFilter) return false;
      if (contractFilter === 'none' && s.contract) return false;
      if (contractFilter !== 'all' && contractFilter !== 'none' && s.contract !== contractFilter) {
        return false;
      }
      if (!q) return true;
      return `${s.agent?.name} ${s.agent?.id} ${s.location} ${s.channel ?? ''} ${s.contract ?? ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [sources, query, stateFilter, contractFilter]);

  const selected = selectedId ? sources.find((s) => s.id === selectedId) : null;

  const sourceColumns = [
    { field: 'state', name: 'State', render: stateCell, width: '120px', sortable: true },
    {
      field: 'agent.name',
      name: 'Agent',
      sortable: true,
      render: (_: any, r: any) => `${r.agent?.name} (${r.agent?.id})`,
    },
    {
      field: 'location',
      name: 'Source',
      sortable: true,
      render: (_: any, r: any) => sourceLabel(r.location, r.channel),
    },
    { field: 'contract', name: 'Contract', sortable: true, render: (c: string | null) => c ?? '-' },
    { field: 'last_seen', name: 'Last seen', sortable: true, render: ago },
    { field: 'last_count', name: 'Events (last window)', sortable: true },
    { field: 'max_gap_seconds', name: 'Normal gap (p95)', sortable: true, render: (v: number) => secs(v) },
    { field: 'min_gap_seconds', name: 'Override', render: (v: number) => secs(v) },
    { field: 'state_since', name: 'In state since', sortable: true, render: ago },
  ];

  const eventColumns = [
    { field: '@timestamp', name: 'When', render: ago },
    { field: 'agent.name', name: 'Agent', render: (_: any, r: any) => r.agent?.name },
    {
      field: 'location',
      name: 'Source',
      render: (_: any, r: any) => sourceLabel(r.location, r.channel),
    },
    { field: 'previous_state', name: 'From', render: stateCell },
    { field: 'state', name: 'To', render: stateCell },
    { field: 'gap_seconds', name: 'Gap', render: (v: number) => secs(v) },
    {
      field: 'lost_rule_count',
      name: 'Rules affected',
      render: (v: number | undefined) => (v === undefined || v === null ? '-' : v),
    },
  ];

  const stateOptions = [
    { value: 'all', text: 'All states' },
    ...STATE_ORDER.map((s) => ({ value: s, text: STATE_LABEL[s] })),
  ];
  const contractOptions = [
    { value: 'all', text: 'All contracts' },
    { value: 'none', text: 'No contract' },
    ...contractNames.map((c) => ({ value: c, text: c })),
  ];

  return (
    <EuiPage>
      <EuiPageBody>
        <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
          <EuiFlexItem grow={false}>
            <EuiTitle size="l">
              <h1>SourceWatch</h1>
            </EuiTitle>
            <EuiText size="s" color="subdued">
              <p>Log source health and silence detection for Wazuh</p>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton onClick={runNow} isLoading={loading} iconType="refresh">
              Run check now
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer />
        {error && (
          <>
            <EuiCallOut title="Could not load data" color="danger" iconType="alert">
              {error}
            </EuiCallOut>
            <EuiSpacer />
          </>
        )}

        <EuiFlexGroup>
          {STATE_ORDER.map((s: SourceState) => (
            <EuiFlexItem key={s}>
              <EuiPanel
                hasBorder={stateFilter === s}
                onClick={() => {
                  setTab('sources');
                  setStateFilter(stateFilter === s ? 'all' : s);
                }}
              >
                <EuiStat
                  title={summary[s] ?? 0}
                  description={STATE_LABEL[s]}
                  titleColor={STATE_COLOR[s] === 'subdued' ? 'subdued' : (STATE_COLOR[s] as any)}
                />
              </EuiPanel>
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>

        <EuiSpacer />
        <EuiTabs>
          <EuiTab isSelected={tab === 'sources'} onClick={() => setTab('sources')}>
            Sources ({sources.length})
          </EuiTab>
          <EuiTab isSelected={tab === 'contracts'} onClick={() => setTab('contracts')}>
            Contracts
          </EuiTab>
        </EuiTabs>
        <EuiSpacer />

        {tab === 'sources' && (
          <>
            <EuiPanel>
              <EuiFlexGroup gutterSize="s">
                <EuiFlexItem>
                  <EuiFieldSearch
                    fullWidth
                    placeholder="Search agent, source, channel or contract"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </EuiFlexItem>
                <EuiFlexItem grow={false} style={{ minWidth: 170 }}>
                  <EuiSelect
                    options={stateOptions}
                    value={stateFilter}
                    onChange={(e) => setStateFilter(e.target.value)}
                  />
                </EuiFlexItem>
                <EuiFlexItem grow={false} style={{ minWidth: 170 }}>
                  <EuiSelect
                    options={contractOptions}
                    value={contractFilter}
                    onChange={(e) => setContractFilter(e.target.value)}
                  />
                </EuiFlexItem>
              </EuiFlexGroup>
              <EuiSpacer size="s" />
              <EuiText size="xs" color="subdued">
                <p>
                  Showing {filtered.length} of {sources.length}. Click a source for details,
                  history, coverage and its gap override.
                </p>
              </EuiText>
              <EuiSpacer size="s" />
              <EuiInMemoryTable
                items={filtered}
                columns={sourceColumns as any}
                loading={loading}
                pagination={{ initialPageSize: 25, pageSizeOptions: [25, 50, 100] }}
                sorting={true}
                rowProps={(item: any) => ({
                  onClick: () => setSelectedId(item.id),
                  style: { cursor: 'pointer' },
                })}
              />
            </EuiPanel>

            <EuiSpacer />
            <EuiPanel>
              <EuiTitle size="s">
                <h2>Recent state changes</h2>
              </EuiTitle>
              <EuiSpacer size="s" />
              <EuiBasicTable items={events} columns={eventColumns as any} loading={loading} />
            </EuiPanel>
          </>
        )}

        {tab === 'contracts' && (
          <EuiPanel>
            <ContractsTab
              http={http}
              notifications={notifications}
              sources={sources}
              onChanged={load}
            />
          </EuiPanel>
        )}

        {selected && (
          <SourceFlyout
            key={selected.id}
            source={selected}
            http={http}
            notifications={notifications}
            onClose={() => setSelectedId(null)}
            onChanged={load}
          />
        )}
      </EuiPageBody>
    </EuiPage>
  );
};
