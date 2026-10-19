import { PluginConfigDescriptor, PluginInitializerContext } from '../../../src/core/server';
import { configSchema, SourcewatchConfig } from './config';
import { SourcewatchPlugin } from './plugin';

export const config: PluginConfigDescriptor<SourcewatchConfig> = {
  schema: configSchema,
};

export function plugin(initializerContext: PluginInitializerContext) {
  return new SourcewatchPlugin(initializerContext);
}

export { SourcewatchPluginSetup, SourcewatchPluginStart } from './types';
