import React from 'react';
import { EuiHealth } from '@elastic/eui';
import { SourceState } from '../../common';

export const STATE_COLOR: Record<SourceState, string> = {
  healthy: 'success',
  learning: 'subdued',
  delayed: 'warning',
  volume_drop: 'warning',
  silent: 'danger',
  missing: 'danger',
};

export const STATE_LABEL: Record<SourceState, string> = {
  healthy: 'Healthy',
  learning: 'Learning',
  delayed: 'Delayed',
  volume_drop: 'Volume drop',
  silent: 'Silent',
  missing: 'Missing',
};

export const STATE_ORDER: SourceState[] = [
  'healthy',
  'delayed',
  'volume_drop',
  'silent',
  'missing',
  'learning',
];

export const ago = (iso?: string | null) => {
  if (!iso) return '-';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export const secs = (v?: number | null) => {
  if (!v) return '-';
  if (v < 120) return `${Math.round(v)}s`;
  if (v < 7200) return `${Math.round(v / 60)}m`;
  if (v < 172800) return `${Math.round(v / 3600)}h`;
  return `${Math.round(v / 86400)}d`;
};

export const stateCell = (s: SourceState | string) => (
  <EuiHealth color={STATE_COLOR[s as SourceState] ?? 'subdued'}>
    {STATE_LABEL[s as SourceState] ?? s}
  </EuiHealth>
);

export const sourceLabel = (location: string, channel?: string | null) =>
  channel ? `${location} | ${channel}` : location;

export const errMsg = (e: any) => e?.body?.message ?? e?.message ?? String(e);
