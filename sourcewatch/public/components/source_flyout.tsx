import React, { useEffect, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTable,
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiDescriptionList,
  EuiFieldNumber,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiFormRow,
  EuiHorizontalRule,
  EuiLoadingSpinner,
  EuiSpacer,
  EuiStat,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { CoreStart } from '../../../../src/core/public';
import { API_BASE } from '../../common';
import { ago, errMsg, secs, sourceLabel, stateCell } from './shared';

interface Props {
  source: any;
  http: CoreStart['http'];
  notifications: CoreStart['notifications'];
  onClose: () => void;
  onChanged: () => void;
}

const basisText = (c: any) => {
  if (c.basis === 'own')
    return `Detection coverage this source provided on this agent over the last ${c.days} days. If it stops, these rules go blind here.`;
  if (c.basis === 'peers')
    return `No history on this agent. Coverage shown from the same source on other agents over the last ${c.days} days: this is what is missing.`;
  return `No alerts from this source in the last ${c.days} days, on this agent or any other.`;
};

export const SourceFlyout = ({ source, http, notifications, onClose, onChanged }: Props) => {
  const [coverage, setCoverage] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [override, setOverride] = useState<string>(
    source.min_gap_seconds ? String(source.min_gap_seconds) : ''
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      http.get(`${API_BASE}/sources/${source.id}/coverage`),
      http.get(`${API_BASE}/sources/${source.id}/history`),
    ])
      .then(([cov, hist]: any[]) => {
        if (cancelled) return;
        setCoverage(cov);
        setHistory(hist.events);
      })
      .catch((e) => notifications.toasts.addDanger(errMsg(e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source.id, http, notifications]);

  const saveOverride = async (value: number | null) => {
    setSaving(true);
    try {
      await http.put(`${API_BASE}/sources/${source.id}/settings`, {
        body: JSON.stringify({ min_gap_seconds: value }),
      });
      notifications.toasts.addSuccess(
        value ? `Gap override set to ${secs(value)}` : 'Gap override cleared'
      );
      if (!value) setOverride('');
      onChanged();
    } catch (e) {
      notifications.toasts.addDanger(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const overrideNumber = Number(override);
  const overrideValid = override !== '' && overrideNumber > 0;

  const details = [
    { title: 'Last seen', description: ago(source.last_seen) },
    { title: 'First seen', description: ago(source.first_seen) },
    { title: 'In state since', description: ago(source.state_since) },
    { title: 'Normal gap (p95)', description: secs(source.max_gap_seconds) },
    { title: 'Gap samples learned', description: String(source.gap_history?.length ?? 0) },
    { title: 'Normal events per window', description: (source.ewma_count ?? 0).toFixed(1) },
  ];

  const historyColumns = [
    { field: '@timestamp', name: 'When', render: ago },
    { field: 'previous_state', name: 'From', render: stateCell },
    { field: 'state', name: 'To', render: stateCell },
    { field: 'gap_seconds', name: 'Gap', render: (v: number) => secs(v) },
    {
      field: 'lost_rule_count',
      name: 'Rules affected',
      render: (v: number | undefined) => (v === undefined || v === null ? '-' : v),
    },
  ];

  const ruleColumns = [
    { field: 'id', name: 'Rule', width: '80px' },
    { field: 'description', name: 'Description' },
    { field: 'level', name: 'Level', width: '60px' },
    { field: 'count', name: 'Alerts', width: '70px' },
    { field: 'mitre', name: 'MITRE', render: (m: string[]) => (m?.length ? m.join(', ') : '-') },
  ];

  return (
    <EuiFlyout onClose={onClose} size="m" ownFocus>
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="m">
          <h2>{sourceLabel(source.location, source.channel)}</h2>
        </EuiTitle>
        <EuiSpacer size="xs" />
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>{stateCell(source.state)}</EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s" color="subdued">
              {source.agent?.name} ({source.agent?.id})
              {source.contract ? ` · contract ${source.contract}` : ''}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutHeader>

      <EuiFlyoutBody>
        <EuiDescriptionList type="column" compressed listItems={details} />

        <EuiHorizontalRule />
        <EuiTitle size="xs">
          <h3>Gap override</h3>
        </EuiTitle>
        <EuiText size="xs" color="subdued">
          <p>
            Never flag this source before this gap, in seconds. Use it for sources that legitimately
            sleep, such as weekly jobs.
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        <EuiFlexGroup gutterSize="s" alignItems="flexEnd" responsive={false}>
          <EuiFlexItem grow={false} style={{ width: 200 }}>
            <EuiFormRow
              label="Minimum gap (seconds)"
              helpText={overrideValid ? `= ${secs(overrideNumber)}` : ' '}
            >
              <EuiFieldNumber
                min={1}
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                placeholder="e.g. 3600"
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              size="s"
              isDisabled={!overrideValid}
              isLoading={saving}
              onClick={() => saveOverride(overrideNumber)}
            >
              Save
            </EuiButton>
          </EuiFlexItem>
          {source.min_gap_seconds ? (
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty size="s" color="danger" onClick={() => saveOverride(null)}>
                Clear
              </EuiButtonEmpty>
            </EuiFlexItem>
          ) : null}
        </EuiFlexGroup>

        <EuiHorizontalRule />
        <EuiTitle size="xs">
          <h3>State history</h3>
        </EuiTitle>
        <EuiSpacer size="s" />
        {loading ? (
          <EuiLoadingSpinner />
        ) : (
          <EuiBasicTable
            items={history.slice(0, 20)}
            columns={historyColumns as any}
            noItemsMessage="No state changes yet"
          />
        )}

        <EuiHorizontalRule />
        <EuiTitle size="xs">
          <h3>Detection coverage</h3>
        </EuiTitle>
        <EuiSpacer size="s" />
        {loading && <EuiLoadingSpinner size="l" />}
        {coverage && (
          <>
            <EuiCallOut
              size="s"
              title={basisText(coverage)}
              color={coverage.basis === 'own' ? 'primary' : 'warning'}
              iconType="iInCircle"
            />
            <EuiSpacer />
            <EuiFlexGroup>
              <EuiFlexItem>
                <EuiStat title={coverage.rules.length} description="Detection rules" titleSize="m" />
              </EuiFlexItem>
              <EuiFlexItem>
                <EuiStat title={coverage.techniques.length} description="MITRE techniques" titleSize="m" />
              </EuiFlexItem>
              <EuiFlexItem>
                <EuiStat title={coverage.total_alerts} description="Alerts" titleSize="m" />
              </EuiFlexItem>
            </EuiFlexGroup>

            {coverage.tactics.length > 0 && (
              <>
                <EuiSpacer />
                <EuiFlexGroup wrap gutterSize="s" responsive={false}>
                  {coverage.tactics.map((t: any) => (
                    <EuiFlexItem grow={false} key={t.name}>
                      <EuiBadge color="hollow">
                        {t.name} ({t.count})
                      </EuiBadge>
                    </EuiFlexItem>
                  ))}
                </EuiFlexGroup>
              </>
            )}
            {coverage.techniques.length > 0 && (
              <>
                <EuiSpacer size="s" />
                <EuiFlexGroup wrap gutterSize="s" responsive={false}>
                  {coverage.techniques.map((t: any) => (
                    <EuiFlexItem grow={false} key={t.id}>
                      <EuiBadge color="primary">
                        {t.id} ({t.count})
                      </EuiBadge>
                    </EuiFlexItem>
                  ))}
                </EuiFlexGroup>
              </>
            )}

            <EuiSpacer />
            <EuiBasicTable
              items={coverage.rules}
              columns={ruleColumns as any}
              noItemsMessage="No rules fired from this source"
            />
          </>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};
