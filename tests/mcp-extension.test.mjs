import assert from 'node:assert/strict';
import test from 'node:test';

import extension from '../extensions/hooks/directus-extension-analyst-sql/dist/index.js';

let sqlite;

try {
  sqlite = await import('node:sqlite');
} catch {
  sqlite = null;
}

test('registers Analyst SQL tools in Directus MCP tools list', () => {
  const harness = createExtensionHarness();

  extension(null, harness.context);

  const tools = harness.applyFilter('mcp.tools.list', [{ name: 'schema' }]);
  const toolNames = tools.map((tool) => tool.name);

  assert.deepEqual(toolNames, [
    'schema',
    'analyst_describe_database',
    'analyst_describe_table',
    'analyst_run_sql_query'
  ]);

  const runSqlTool = tools.find((tool) => tool.name === 'analyst_run_sql_query');
  assert.equal(runSqlTool.inputSchema.required.includes('sql'), true);
});

test('handles analyst_run_sql_query through MCP call filter', { skip: !sqlite }, async () => {
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
        ('south', 50);
    `);

    const harness = createExtensionHarness(createSqliteKnexLikeDatabase(db));
    extension(null, harness.context);

    const response = await harness.applyFilter('analyst_run_sql_query.mcp.tools.call', {
      arguments: {
        sql: 'select region, amount from sales order by region',
        limit: 10
      }
    });

    const payload = JSON.parse(response.content[0].text);
    assert.equal(payload.rowCount, 2);
    assert.deepEqual(payload.columns, ['region', 'amount']);
    assert.deepEqual(payload.rows, [
      { region: 'north', amount: 100 },
      { region: 'south', amount: 50 }
    ]);
  } finally {
    db.close();
  }
});

test('handles analyst_describe_table through MCP call filter', { skip: !sqlite }, async () => {
  const db = new sqlite.DatabaseSync(':memory:');

  try {
    db.exec('CREATE TABLE sales (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL);');

    const harness = createExtensionHarness(createSqliteKnexLikeDatabase(db));
    extension(null, harness.context);

    const response = await harness.applyFilter('analyst_describe_table.mcp.tools.call', {
      arguments: {
        table: 'sales'
      }
    });

    const payload = JSON.parse(response.content[0].text);
    assert.equal(payload.table, 'sales');
    assert.equal(payload.columns.some((column) => column.name === 'amount'), true);
  } finally {
    db.close();
  }
});

function createExtensionHarness(database = createNoopDatabase()) {
  const filters = new Map();

  return {
    applyFilter(name, input) {
      const handler = filters.get(name);
      assert.equal(typeof handler, 'function', `Missing filter handler: ${name}`);
      return handler(input);
    },
    context: {
      database,
      emitter: {
        onFilter(name, handler) {
          filters.set(name, handler);
        }
      },
      logger: {
        error() {},
        info() {}
      }
    }
  };
}

function createNoopDatabase() {
  return {
    raw() {
      throw new Error('Unexpected database call');
    }
  };
}

function createSqliteKnexLikeDatabase(db) {
  return {
    raw(sql, params = []) {
      const execute = async () => {
        const normalizedSql = normalizeInformationSchemaQuery(sql, params);
        const statement = db.prepare(normalizedSql);
        const bindings = normalizedSql.includes('?') ? params : [];
        const rows = statement.all(...bindings).map((row) => ({ ...row }));
        return [rows, []];
      };

      return {
        then(resolve, reject) {
          return execute().then(resolve, reject);
        },
        timeout: execute
      };
    }
  };
}

function normalizeInformationSchemaQuery(sql, params = []) {
  if (sql.includes('information_schema.COLUMNS')) {
    const table = quoteSqliteString(params[0]);
    return `
      SELECT
        name AS name,
        type AS type,
        CASE WHEN "notnull" = 0 THEN 'YES' ELSE 'NO' END AS nullable,
        dflt_value AS defaultValue,
        CASE WHEN pk > 0 THEN 'PRI' ELSE '' END AS columnKey,
        '' AS extra,
        '' AS comment
      FROM pragma_table_info(${table})
      ORDER BY cid
    `;
  }

  if (sql.includes('information_schema.STATISTICS')) {
    const table = quoteSqliteString(params[0]);
    return `
      SELECT
        name AS indexName,
        '' AS columnName,
        0 AS nonUnique,
        0 AS sequenceInIndex
      FROM pragma_index_list(${table})
      ORDER BY name
    `;
  }

  if (sql.includes('information_schema.TABLES')) {
    return `
      SELECT
        name AS tableName,
        type AS tableType,
        0 AS estimatedRows,
        '' AS comment
      FROM sqlite_master
      WHERE type IN ('table', 'view')
      ORDER BY name
    `;
  }

  return sql;
}

function quoteSqliteString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
