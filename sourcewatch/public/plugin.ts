import { AppMountParameters, CoreSetup, CoreStart, Plugin } from '../../../src/core/public';
import {
  AppPluginStartDependencies,
  SourcewatchPluginSetup,
  SourcewatchPluginStart,
} from './types';
import { PLUGIN_ID, PLUGIN_NAME } from '../common';

export class SourcewatchPlugin implements Plugin<SourcewatchPluginSetup, SourcewatchPluginStart> {
  public setup(core: CoreSetup): SourcewatchPluginSetup {
    core.application.register({
      id: PLUGIN_ID,
      title: PLUGIN_NAME,
      async mount(params: AppMountParameters) {
        const { renderApp } = await import('./application');
        const [coreStart, depsStart] = await core.getStartServices();
        return renderApp(coreStart, depsStart as AppPluginStartDependencies, params);
      },
    });
    return {};
  }

  public start(core: CoreStart): SourcewatchPluginStart {
    return {};
  }

  public stop() {}
}
