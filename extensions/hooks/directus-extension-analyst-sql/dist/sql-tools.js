const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 30000;

const READ_ONLY_START = new Set(['select', 'with', 'show', 'describe', 'desc', 'explain']);
const FORBIDDEN_WORDS = [
  'alter',
  'analyze',
  'call',
  'create',
  'delete',
  'drop',
  'grant',
  'insert',
  'load',
  'lock',
  'optimize',
  'rename',
  'replace',
  'revoke',
  'set',
  'truncate',
  'unlock',
  'update'
];

export function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

export function normalizeTimeoutMs(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('timeoutMs must be a positive integer');
  }
  return Math.min(parsed, MAX_TIMEOUT_MS);
}

export function assertSafeReadOnlySql(sql) {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new Error('sql is required');
  }

  const sanitized = stripCommentsAndStrings(sql).trim();
  if (sanitized.length === 0) {
    throw new Error('sql must contain a query');
  }

  if (hasStatementSeparator(sanitized)) {
    throw new Error('Only one SQL statement is allowed');
  }

  const firstWord = sanitized.match(/^[a-zA-Z_]+/)?.[0]?.toLowerCase();
  if (!firstWord || !READ_ONLY_START.has(firstWord)) {
    throw new Error('Only read-only SQL is allowed: SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN');
  }

  for (const word of FORBIDDEN_WORDS) {
    const pattern = new RegExp(`\\b${word}\\b`, 'i');
    if (pattern.test(sanitized)) {
      throw new Error(`Forbidden SQL keyword: ${word.toUpperCase()}`);
    }
  }
}

export function applyLimit(sql, limit) {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  const firstWord = stripCommentsAndStrings(trimmed).trim().match(/^[a-zA-Z_]+/)?.[0]?.toLowerCase();

  if ((firstWord === 'select' || firstWord === 'with') && !/\blimit\b/i.test(stripCommentsAndStrings(trimmed))) {
    return `${trimmed} LIMIT ${limit}`;
  }

  return trimmed;
}

export function normalizeRows(result) {
  const rawRows = Array.isArray(result) ? result[0] : result?.rows ?? result;
  if (Array.isArray(rawRows)) return rawRows;
  if (rawRows && typeof rawRows === 'object') return [rawRows];
  return [];
}

export function toMcpJson(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

export async function runSqlQuery(database, args = {}) {
  const sql = args.sql;
  const limit = normalizeLimit(args.limit);
  const timeoutMs = normalizeTimeoutMs(args.timeoutMs);
  const params = Array.isArray(args.params) ? args.params : [];

  assertSafeReadOnlySql(sql);
  const limitedSql = applyLimit(sql, limit);

  const startedAt = Date.now();
  const query = database.raw(limitedSql, params);
  const result =
    typeof query.timeout === 'function'
      ? await query.timeout(timeoutMs, { cancel: false })
      : await query;

  const rows = normalizeRows(result);
  const columns = rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [];

  return {
    columns,
    elapsedMs: Date.now() - startedAt,
    limit,
    rowCount: rows.length,
    rows,
    sql: limitedSql
  };
}

export async function describeDatabase(database) {
  const result = await database.raw(
    `
      SELECT
        TABLE_NAME AS tableName,
        TABLE_TYPE AS tableType,
        TABLE_ROWS AS estimatedRows,
        TABLE_COMMENT AS comment
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `
  );

  return {
    tables: normalizeRows(result)
  };
}

export async function describeTable(database, args = {}) {
  const table = String(args.table ?? '').trim();
  if (!/^[A-Za-z0-9_]+$/.test(table)) {
    throw new Error('table must be a simple table name');
  }

  const columns = await database.raw(
    `
      SELECT
        COLUMN_NAME AS name,
        COLUMN_TYPE AS type,
        IS_NULLABLE AS nullable,
        COLUMN_DEFAULT AS defaultValue,
        COLUMN_KEY AS columnKey,
        EXTRA AS extra,
        COLUMN_COMMENT AS comment
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `,
    [table]
  );

  const indexes = await database.raw(
    `
      SELECT
        INDEX_NAME AS indexName,
        COLUMN_NAME AS columnName,
        NON_UNIQUE AS nonUnique,
        SEQ_IN_INDEX AS sequenceInIndex
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `,
    [table]
  );

  return {
    columns: normalizeRows(columns),
    indexes: normalizeRows(indexes),
    table
  };
}

function stripCommentsAndStrings(sql) {
  let output = '';
  let index = 0;
  let quote = null;

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (quote) {
      if (current === '\\') {
        index += 2;
        output += ' ';
        continue;
      }
      if (current === quote) quote = null;
      output += ' ';
      index += 1;
      continue;
    }

    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      output += ' ';
      index += 1;
      continue;
    }

    if (current === '-' && next === '-') {
      while (index < sql.length && sql[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (current === '#') {
      while (index < sql.length && sql[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (current === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
        output += ' ';
        index += 1;
      }
      if (index < sql.length) {
        output += '  ';
        index += 2;
      }
      continue;
    }

    output += current;
    index += 1;
  }

  return output;
}

function hasStatementSeparator(sql) {
  const withoutTrailing = sql.trim().replace(/;+\s*$/, '');
  return withoutTrailing.includes(';');
}
