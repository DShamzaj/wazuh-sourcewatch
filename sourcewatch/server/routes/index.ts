import { schema } from '@osd/config-schema';
import { IRouter } from '../../../../src/core/server';
import { API_BASE, INDEX_CONFIG, INDEX_INVENTORY, INDEX_STATE_PREFIX } from '../../common';
import { SourceWatchEngine } from '../lib/engine';
import { getCoverage } from '../lib/coverage';
import { SourcewatchConfig } from '../config';

const fail = (response: any, e: any) =>
  response.customError({
    statusCode: e?.meta?.statusCode >= 400 ? e.meta.statusCode : 500,
    body: { message: e?.message ?? 'Unknown error' },
  });

const notReady = (response: any) =>
  response.customError({ statusCode: 503, body: { message: 'SourceWatch has not started yet' } });

export function defineRoutes(
  router: IRouter,
  getEngine: () => SourceWatchEngine | undefined,
  getConfig: () => SourcewatchConfig | undefined
) {
  const idParam = schema.object({ id: schema.string() });
  const contractName = schema.string({
    validate: (v) => (/^[A-Za-z0-9_-]{1,64}$/.test(v) ? undefined : 'use letters, digits, _ or -'),
  });

  // ---------- Sources ----------

  router.get({ path: `${API_BASE}/sources`, validate: false }, async (context, request, response) => {
    try {
      const { body } = await context.core.opensearch.client.asCurrentUser.search({
        index: INDEX_INVENTORY,
        size: 5000,
        ignore_unavailable: true,
        body: { query: { match_all: {} }, sort: [{ last_seen: { order: 'asc', missing: '_first' } }] },
      });
      const sources = (body.hits?.hits ?? []).map((h: any) => ({ id: h._id, ...h._source }));
      return response.ok({ body: { sources } });
    } catch (e) {
      return fail(response, e);
    }
  });

  router.get({ path: `${API_BASE}/summary`, validate: false }, async (context, request, response) => {
    try {
      const { body } = await context.core.opensearch.client.asCurrentUser.search({
        index: INDEX_INVENTORY,
        size: 0,
        ignore_unavailable: true,
        body: { aggs: { states: { terms: { field: 'state', size: 10 } } } },
      });
      const states: Record<string, number> = {};
      (body.aggregations?.states?.buckets ?? []).forEach((b: any) => {
        states[b.key] = b.doc_count;
      });
      return response.ok({ body: { states } });
    } catch (e) {
      return fail(response, e);
    }
  });

  router.get({ path: `${API_BASE}/events`, validate: false }, async (context, request, response) => {
    try {
      const { body } = await context.core.opensearch.client.asCurrentUser.search({
        index: `${INDEX_STATE_PREFIX}*`,
        size: 50,
        ignore_unavailable: true,
        allow_no_indices: true,
        body: { query: { match_all: {} }, sort: [{ '@timestamp': 'desc' }] },
      });
      const events = (body.hits?.hits ?? []).map((h: any) => ({ id: h._id, ...h._source }));
      return response.ok({ body: { events } });
    } catch (e) {
      return fail(response, e);
    }
  });

  router.post({ path: `${API_BASE}/run`, validate: false }, async (context, request, response) => {
    const engine = getEngine();
    if (!engine) return notReady(response);
    try {
      return response.ok({ body: await engine.runCycle({ manual: true }) });
    } catch (e) {
      return fail(response, e);
    }
  });

  // Gap override: stored in the config index so a running cycle can never overwrite it
  router.put(
    {
      path: `${API_BASE}/sources/{id}/settings`,
      validate: {
        params: idParam,
        body: schema.object({ min_gap_seconds: schema.nullable(schema.number({ min: 0 })) }),
      },
    },
    async (context, request, response) => {
      try {
        const client = context.core.opensearch.client.asCurrentUser;
        const { id } = request.params;
        const value = request.body.min_gap_seconds;
        const { body: doc } = await client.get({ index: INDEX_INVENTORY, id });
        const sourceKey = doc._source.source_key;

        if (value && value > 0) {
          await client.index({
            index: INDEX_CONFIG,
            id: `override-${id}`,
            body: { type: 'override', source_key: sourceKey, min_gap_seconds: value },
            refresh: 'wait_for',
          });
        } else {
          await client.delete(
            { index: INDEX_CONFIG, id: `override-${id}`, refresh: 'wait_for' },
            { ignore: [404] }
          );
        }
        await client.update({
          index: INDEX_INVENTORY,
          id,
          body: { doc: { min_gap_seconds: value && value > 0 ? value : null } },
          refresh: 'wait_for',
        });
        return response.ok({ body: { updated: true } });
      } catch (e) {
        return fail(response, e);
      }
    }
  );

  router.get(
    { path: `${API_BASE}/sources/{id}/history`, validate: { params: idParam } },
    async (context, request, response) => {
      try {
        const client = context.core.opensearch.client.asCurrentUser;
        const { body: doc } = await client.get({ index: INDEX_INVENTORY, id: request.params.id });
        const { body } = await client.search({
          index: `${INDEX_STATE_PREFIX}*`,
          size: 100,
          ignore_unavailable: true,
          allow_no_indices: true,
          body: {
            query: { term: { source_key: doc._source.source_key } },
            sort: [{ '@timestamp': 'desc' }],
          },
        });
        const events = (body.hits?.hits ?? []).map((h: any) => ({ id: h._id, ...h._source }));
        return response.ok({ body: { events } });
      } catch (e) {
        return fail(response, e);
      }
    }
  );

  router.get(
    { path: `${API_BASE}/sources/{id}/coverage`, validate: { params: idParam } },
    async (context, request, response) => {
      const config = getConfig();
      if (!config) return notReady(response);
      try {
        const client = context.core.opensearch.client.asCurrentUser;
        const { body: doc } = await client.get({ index: INDEX_INVENTORY, id: request.params.id });
        const src = doc._source;
        const coverage = await getCoverage(client, config, {
          agentId: src.agent.id,
          location: src.location,
          channel: src.channel ?? null,
        });
        return response.ok({ body: coverage });
      } catch (e) {
        return fail(response, e);
      }
    }
  );

  // ---------- Contracts ----------

  router.get({ path: `${API_BASE}/contracts`, validate: false }, async (context, request, response) => {
    try {
      const { body } = await context.core.opensearch.client.asCurrentUser.search({
        index: INDEX_CONFIG,
        size: 1000,
        ignore_unavailable: true,
        body: { query: { match: { type: 'contract' } } },
      });
      const contracts = (body.hits?.hits ?? [])
        .map((h: any) => h._source)
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      return response.ok({ body: { contracts } });
    } catch (e) {
      return fail(response, e);
    }
  });

  router.put(
    {
      path: `${API_BASE}/contracts/{name}`,
      validate: {
        params: schema.object({ name: contractName }),
        body: schema.object({
          group: schema.string({ minLength: 1 }),
          enabled: schema.boolean({ defaultValue: true }),
          required: schema.arrayOf(
            schema.object({
              location: schema.string({ minLength: 1 }),
              channel: schema.nullable(schema.string()),
            }),
            { minSize: 1 }
          ),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const doc = { type: 'contract', name: request.params.name, ...request.body };
        await context.core.opensearch.client.asCurrentUser.index({
          index: INDEX_CONFIG,
          id: `contract-${request.params.name}`,
          body: doc,
          refresh: 'wait_for',
        });
        return response.ok({ body: { saved: true, contract: doc } });
      } catch (e) {
        return fail(response, e);
      }
    }
  );

  router.delete(
    {
      path: `${API_BASE}/contracts/{name}`,
      validate: { params: schema.object({ name: contractName }) },
    },
    async (context, request, response) => {
      try {
        await context.core.opensearch.client.asCurrentUser.delete({
          index: INDEX_CONFIG,
          id: `contract-${request.params.name}`,
          refresh: 'wait_for',
        });
        return response.ok({ body: { deleted: true } });
      } catch (e) {
        return fail(response, e);
      }
    }
  );
}
