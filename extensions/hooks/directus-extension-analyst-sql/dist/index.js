import {
  describeDatabase,
  describeTable,
  runSqlQuery,
  toMcpJson
} from './sql-tools.js';

const tools = [
  {
    name: 'analyst_describe_database',
    annotations: {
      title: 'Analyst - Describe Database'
    },
    description:
      'List user-visible tables and views in the current Analyst database. Use before writing analysis SQL.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'analyst_describe_table',
    annotations: {
      title: 'Analyst - Describe Table'
    },
    description:
      'Describe one table in the current Analyst database, including columns and indexes.',
    inputSchema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: 'Simple table name to inspect.'
        }
      },
      required: ['table'],
      additionalProperties: false
    }
  },
  {
    name: 'analyst_run_sql_query',
    annotations: {
      title: 'Analyst - Run SQL Query'
    },
    description:
      'Run one guarded read-only SQL query against the current Analyst database. Allows SELECT, WITH, SHOW, DESCRIBE, and EXPLAIN. Mutating SQL is rejected. SELECT/WITH queries receive an automatic LIMIT when omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'Read-only SQL statement.'
        },
        params: {
          type: 'array',
          description: 'Optional positional bindings for ? placeholders.',
          items: {}
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 5000,
          description: 'Maximum rows for SELECT/WITH queries. Defaults to 500.'
        },
        timeoutMs: {
          type: 'integer',
          minimum: 1,
          maximum: 30000,
          description: 'Query timeout in milliseconds. Defaults to 10000.'
        }
      },
      required: ['sql'],
      additionalProperties: false
    }
  }
];

export default (_, { database, emitter, logger }) => {
  emitter.onFilter('mcp.tools.list', (existingTools) => [...existingTools, ...tools]);

  emitter.onFilter('analyst_describe_database.mcp.tools.call', async () => {
    try {
      return toMcpJson(await describeDatabase(database));
    } catch (error) {
      logger?.error(error, 'analyst_describe_database failed');
      throw error;
    }
  });

  emitter.onFilter('analyst_describe_table.mcp.tools.call', async (payload) => {
    try {
      return toMcpJson(await describeTable(database, payload?.arguments));
    } catch (error) {
      logger?.error(error, 'analyst_describe_table failed');
      throw error;
    }
  });

  emitter.onFilter('analyst_run_sql_query.mcp.tools.call', async (payload) => {
    try {
      const result = await runSqlQuery(database, payload?.arguments);
      logger?.info(
        {
          elapsedMs: result.elapsedMs,
          rowCount: result.rowCount,
          tool: 'analyst_run_sql_query'
        },
        'Analyst SQL query finished'
      );
      return toMcpJson(result);
    } catch (error) {
      logger?.error(error, 'analyst_run_sql_query failed');
      throw error;
    }
  });
};
