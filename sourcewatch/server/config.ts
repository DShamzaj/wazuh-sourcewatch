import { schema, TypeOf } from '@osd/config-schema';

export const configSchema = schema.object({
  enabled: schema.boolean({ defaultValue: true }),
  // Index pattern the engine scans to discover log sources
  sourceIndex: schema.string({ defaultValue: 'wazuh-alerts-*' }),
  intervalSeconds: schema.number({ defaultValue: 900, min: 30 }),
  ingestLagSeconds: schema.number({ defaultValue: 60, min: 0 }),
  // How long a new source is only observed before it can raise alerts
  warmupSeconds: schema.number({ defaultValue: 86400, min: 0 }),
  // Gap baseline: percentile of the last N gaps between appearances
  gapHistory: schema.number({ defaultValue: 50, min: 5, max: 500 }),
  gapPercentile: schema.number({ defaultValue: 0.95, min: 0.5, max: 1 }),
  minGapSamples: schema.number({ defaultValue: 5, min: 1 }),
  // Smoothing for "normal events per active window" (used for volume drop)
  ewmaAlpha: schema.number({ defaultValue: 0.3, min: 0.01, max: 1 }),
  // Volume drop when a window has less than this share of the normal count
  volumeDropRatio: schema.number({ defaultValue: 0.2, min: 0, max: 1 }),
  // Accept a lower volume as the new normal after this many dropped cycles
  rebaselineAfterCycles: schema.number({ defaultValue: 12, min: 1 }),
  // Event-driven Wazuh internals with no steady rhythm
  ignoreLocations: schema.arrayOf(schema.string(), {
    defaultValue: ['API-Webhook', 'wazuh-remoted', 'wazuh-agent', 'wazuh-monitord'],
  }),
  // Remove sources not seen for this long (contract-required sources are kept)
  forgetAfterDays: schema.number({ defaultValue: 30, min: 1 }),
  // Coverage mapper: where to look for alerts each source produced, and how far back
  alertsIndex: schema.string({ defaultValue: 'wazuh-alerts-*' }),
  coverageDays: schema.number({ defaultValue: 30, min: 1, max: 365 }),
  // Wazuh server API: forwards state changes as events and resolves agent groups
  wazuhApi: schema.object({
    enabled: schema.boolean({ defaultValue: false }),
    url: schema.string({ defaultValue: 'https://localhost:55000' }),
    username: schema.string({ defaultValue: 'wazuh-wui' }),
    password: schema.string({ defaultValue: '' }),
    verifyTls: schema.boolean({ defaultValue: false }),
  }),
});

export type SourcewatchConfig = TypeOf<typeof configSchema>;
