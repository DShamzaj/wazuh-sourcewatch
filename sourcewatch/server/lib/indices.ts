import { Logger, OpenSearchClient } from '../../../../src/core/server';
import { INDEX_CONFIG, INDEX_INVENTORY, TEMPLATE_NAME } from '../../common';

const TEMPLATE = {
  index_patterns: ['sourcewatch-*'],
  priority: 100,
  template: {
    settings: {
      number_of_shards: 1,
      'index.auto_expand_replicas': '0-1',
    },
    mappings: {
      dynamic: true,
      properties: {
        '@timestamp': { type: 'date' },
        source_key: { type: 'keyword' },
        agent: {
          properties: {
            id: { type: 'keyword' },
            name: { type: 'keyword' },
          },
        },
        location: { type: 'keyword' },
        channel: { type: 'keyword' },
        state: { type: 'keyword' },
        previous_state: { type: 'keyword' },
        state_since: { type: 'date' },
        first_seen: { type: 'date' },
        last_seen: { type: 'date' },
        last_count: { type: 'long' },
        ewma_count: { type: 'double' },
        max_gap_seconds: { type: 'double' },
        gap_history: { type: 'double' },
        contract: { type: 'keyword' },
        coverage_basis: { type: 'keyword' },
        lost_rule_count: { type: 'integer' },
        lost_mitre: { type: 'keyword' },
        drop_cycles: { type: 'integer' },
        min_gap_seconds: { type: 'double' },
        gap_seconds: { type: 'long' },
        updated_at: { type: 'date' },
      },
    },
  },
};

export async function ensureIndices(client: OpenSearchClient, logger: Logger) {
  await client.indices.putIndexTemplate({ name: TEMPLATE_NAME, body: TEMPLATE as any });

  for (const index of [INDEX_INVENTORY, INDEX_CONFIG]) {
    const { body: exists } = await client.indices.exists({ index });
    if (!exists) {
      try {
        await client.indices.create({ index });
        logger.info(`SourceWatch created index ${index}`);
      } catch (e: any) {
        if (e?.body?.error?.type !== 'resource_already_exists_exception') throw e;
      }
    }
  }
}
