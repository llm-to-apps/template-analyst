import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyLimit,
  assertSafeReadOnlySql,
  normalizeLimit,
  normalizeRows
} from '../extensions/hooks/directus-extension-analyst-sql/dist/sql-tools.js';

test('allows read-only SQL starts', () => {
  assert.doesNotThrow(() => assertSafeReadOnlySql('select * from sales'));
  assert.doesNotThrow(() => assertSafeReadOnlySql('WITH monthly AS (select 1) select * from monthly'));
  assert.doesNotThrow(() => assertSafeReadOnlySql('show tables'));
  assert.doesNotThrow(() => assertSafeReadOnlySql('describe sales'));
  assert.doesNotThrow(() => assertSafeReadOnlySql('explain select * from sales'));
});

test('blocks mutating SQL and multiple statements', () => {
  assert.throws(() => assertSafeReadOnlySql('delete from sales'), /Only read-only SQL/);
  assert.throws(() => assertSafeReadOnlySql('select * from sales; drop table sales'), /Only one SQL statement/);
  assert.throws(() => assertSafeReadOnlySql('select * from sales where id in (delete from x)'), /Forbidden SQL keyword/);
});

test('ignores forbidden words inside strings', () => {
  assert.doesNotThrow(() => assertSafeReadOnlySql("select 'drop table sales' as note"));
});

test('applies a default limit to select queries without one', () => {
  assert.equal(applyLimit('select * from sales', 25), 'select * from sales LIMIT 25');
  assert.equal(applyLimit('select * from sales limit 10', 25), 'select * from sales limit 10');
  assert.equal(applyLimit('show tables', 25), 'show tables');
});

test('normalizes limit bounds', () => {
  assert.equal(normalizeLimit(undefined), 500);
  assert.equal(normalizeLimit(10000), 5000);
  assert.throws(() => normalizeLimit(0), /positive integer/);
});

test('normalizes common database raw result shapes', () => {
  assert.deepEqual(normalizeRows([[{ id: 1 }], []]), [{ id: 1 }]);
  assert.deepEqual(normalizeRows({ rows: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepEqual(normalizeRows({ ok: true }), [{ ok: true }]);
});
