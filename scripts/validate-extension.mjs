import assert from 'node:assert/strict';

const extension = await import('../extensions/hooks/directus-extension-analyst-sql/dist/index.js');
const os7AuthEndpoint = await import(
  '../extensions/endpoints/directus-extension-os7-auth/dist/index.js'
);
const tools = await import('../extensions/hooks/directus-extension-analyst-sql/dist/sql-tools.js');

assert.equal(typeof extension.default, 'function');
assert.equal(os7AuthEndpoint.default.id, 'os7');
assert.equal(typeof os7AuthEndpoint.default.handler, 'function');
assert.equal(typeof tools.assertSafeReadOnlySql, 'function');
assert.equal(typeof tools.runSqlQuery, 'function');

console.log('Analyst Directus MCP extension is importable.');
