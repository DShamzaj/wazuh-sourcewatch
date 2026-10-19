import { NavigationPublicPluginStart } from '../../../src/plugins/navigation/public';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SourcewatchPluginSetup {}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SourcewatchPluginStart {}

export interface AppPluginStartDependencies {
  navigation: NavigationPublicPluginStart;
}
