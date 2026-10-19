import { SourcewatchPlugin } from './plugin';

export function plugin() {
  return new SourcewatchPlugin();
}

export { SourcewatchPluginSetup, SourcewatchPluginStart } from './types';
