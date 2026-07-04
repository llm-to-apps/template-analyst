import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildKnownSettingsDefaults, buildKnownSettingsUpdates } from '../scripts/enable-mcp.mjs';

test('buildKnownSettingsUpdates only writes settings columns that exist', () => {
  const columns = new Set(['project_owner', 'product_updates']);
  const result = buildKnownSettingsUpdates(columns, [
    ['project_owner', 'admin@example.com'],
    ['project_usage', 'commercial'],
    ['product_updates', 0]
  ]);

  assert.deepEqual(result, {
    updates: ['`project_owner` = ?', '`product_updates` = ?'],
    params: ['admin@example.com', 0]
  });
});

test('buildKnownSettingsDefaults preserves settings that are already set', () => {
  const columns = new Set(['project_owner', 'project_usage']);
  const result = buildKnownSettingsDefaults(columns, [
    ['project_owner', 'admin@example.com'],
    ['project_usage', 'commercial'],
    ['org_name', 'OS7']
  ]);

  assert.deepEqual(result, {
    updates: ['`project_owner` = COALESCE(`project_owner`, ?)', '`project_usage` = COALESCE(`project_usage`, ?)'],
    params: ['admin@example.com', 'commercial']
  });
});
