import { hostname } from 'os';
import { first } from 'rxjs/operators';
import {
  CoreSetup,
  CoreStart,
  Logger,
  Plugin,
  PluginInitializerContext,
} from '../../../src/core/server';
import { SourcewatchConfig } from './config';
import { SourcewatchPluginSetup, SourcewatchPluginStart } from './types';
import { defineRoutes } from './routes';
import { ensureIndices } from './lib/indices';
import { SourceWatchEngine } from './lib/engine';
import { WazuhForwarder } from './lib/wazuh_forwarder';

export class SourcewatchPlugin
  implements Plugin<SourcewatchPluginSetup, SourcewatchPluginStart> {
  private readonly logger: Logger;
  private engine?: SourceWatchEngine;
  private config?: SourcewatchConfig;
  private timer?: NodeJS.Timeout;
  private startupTimer?: NodeJS.Timeout;

  constructor(private readonly initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(core: CoreSetup) {
    const router = core.http.createRouter();
    defineRoutes(router, () => this.engine, () => this.config);
    return {};
  }

  public start(core: CoreStart) {
    const client = core.opensearch.client.asInternalUser;

    this.initializerContext.config
      .create<SourcewatchConfig>()
      .pipe(first())
      .toPromise()
      .then(async (config) => {
        if (!config.enabled) {
          this.logger.info('SourceWatch is disabled');
          return;
        }
        this.config = config;
        await ensureIndices(client, this.logger);
        this.engine = new SourceWatchEngine(
          client,
          config,
          this.logger,
          hostname(),
          config.wazuhApi.enabled
            ? new WazuhForwarder(config.wazuhApi, this.logger)
            : undefined
        );
        const tick = () =>
          this.engine!.runCycle().catch((e) =>
            this.logger.error(`SourceWatch cycle failed: ${e.message}`)
          );
        this.startupTimer = setTimeout(tick, 15000);
        this.timer = setInterval(tick, config.intervalSeconds * 1000);
        this.logger.info(
          `SourceWatch started: index=${config.sourceIndex}, interval=${config.intervalSeconds}s`
        );
      })
      .catch((e) => this.logger.error(`SourceWatch init failed: ${e.message}`));

    return {};
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
  }
}
