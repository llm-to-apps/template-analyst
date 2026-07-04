import assert from 'node:assert/strict';
import test from 'node:test';

import { runSqlQuery } from '../extensions/hooks/directus-extension-analyst-sql/dist/sql-tools.js';

let sqlite;

try {
  sqlite = await import('node:sqlite');
} catch {
  sqlite = null;
}

test('runs read-only SQL against an in-memory SQLite database', { skip: !sqlite }, async () => {
  const db = new sqlite.DatabaseSync(':memory:');

  try {
    db.exec(`
      CREATE TABLE sales (
        id INTEGER PRIMARY KEY,
        region TEXT NOT NULL,
        amount INTEGER NOT NULL
      );
      INSERT INTO sales (region, amount) VALUES
        ('north', 100),
        ('north', 75),
        ('south', 50);
    `);

    const database = createSqliteKnexLikeDatabase(db);
    const result = await runSqlQuery(database, {
      sql: 'select region, sum(amount) as total from sales group by region order by region',
      limit: 10
    });

    assert.equal(result.rowCount, 2);
    assert.deepEqual(result.columns, ['region', 'total']);
    assert.deepEqual(result.rows, [
      { region: 'north', total: 175 },
      { region: 'south', total: 50 }
    ]);
    assert.match(result.sql, /LIMIT 10$/);
  } finally {
    db.close();
  }
});

test('rejects mutating SQL before it reaches SQLite', { skip: !sqlite }, async () => {
  const db = new sqlite.DatabaseSync(':memory:');

  try {
    db.exec('CREATE TABLE sales (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL);');
    const database = createSqliteKnexLikeDatabase(db);

    await assert.rejects(
      () =>
        runSqlQuery(database, {
          sql: 'delete from sales',
          limit: 10
        }),
      /Only read-only SQL/
    );

    const rows = db.prepare('select count(*) as count from sales').all();
    assert.equal(rows[0].count, 0);
  } finally {
    db.close();
  }
});

function createSqliteKnexLikeDatabase(db) {
  return {
    raw(sql, params = []) {
      return {
        async timeout() {
          const statement = db.prepare(sql);
          const rows = statement.all(...params).map((row) => ({ ...row }));
          return [rows, []];
        }
      };
    }
  };
}
