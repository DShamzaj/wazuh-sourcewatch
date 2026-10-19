export const PLUGIN_ID = 'sourcewatch';
export const PLUGIN_NAME = 'SourceWatch';
export const API_BASE = '/api/sourcewatch';

export const INDEX_INVENTORY = 'sourcewatch-inventory';
export const INDEX_CONFIG = 'sourcewatch-config';
export const INDEX_STATE_PREFIX = 'sourcewatch-state-';
export const TEMPLATE_NAME = 'sourcewatch';

export type SourceState =
  | 'learning'
  | 'healthy'
  | 'delayed'
  | 'silent'
  | 'volume_drop'
  | 'missing';
