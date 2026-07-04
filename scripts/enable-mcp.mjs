import { pathToFileURL } from 'node:url';

const config = {
  host: process.env.DB_HOST ?? process.env.MYSQL_HOST ?? 'mysql',
  port: Number(process.env.DB_PORT ?? process.env.MYSQL_PORT ?? 3306),
  database: process.env.DB_DATABASE ?? process.env.MYSQL_DATABASE ?? 'project',
  user: process.env.DB_USER ?? process.env.MYSQL_USER,
  password: process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD
};

const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@example.local';
const staticToken = process.env.ANALYST_MCP_STATIC_TOKEN;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!config.user || !config.password) {
    console.warn('Skipping Analyst bootstrap: database credentials are not configured.');
    process.exit(0);
  }

  const mysql = await import('mysql2/promise');
  const connection = await mysql.default.createConnection(config);

  try {
    await enableKnownMcpSettings(connection);
    await setDirectusOnboardingDefaults(connection);
    await setStaticToken(connection);
  } finally {
    await connection.end();
  }
}

async function enableKnownMcpSettings(connection) {
  const columns = await listColumns(connection, 'directus_settings');
  if (columns.size === 0) return;

  const { updates, params } = buildKnownSettingsUpdates(columns, [
    ['mcp_enabled', 1],
    ['mcp_allow_deletes', 0],
    ['mcp_system_prompt_enabled', 1],
    ['mcp_oauth_enabled', process.env.MCP_OAUTH_ENABLED === 'true' ? 1 : 0],
    ['mcp_oauth_dcr_enabled', process.env.MCP_OAUTH_DCR_ENABLED === 'true' ? 1 : 0],
    ['mcp_oauth_cimd_enabled', process.env.MCP_OAUTH_CIMD_ENABLED === 'true' ? 1 : 0]
  ]);

  if (updates.length === 0) {
    console.warn('No known Directus MCP settings columns found. MCP may need to be enabled in Studio.');
    return;
  }

  await connection.query(`UPDATE directus_settings SET ${updates.join(', ')} LIMIT 1`, params);
  console.log(`Enabled Analyst MCP settings: ${updates.map((update) => update.split(' ')[0]).join(', ')}`);
}

async function setDirectusOnboardingDefaults(connection) {
  const columns = await listColumns(connection, 'directus_settings');
  if (columns.size === 0) return;

  const ownerEmail = process.env.DIRECTUS_PROJECT_OWNER_EMAIL ?? adminEmail;
  const { updates, params } = buildKnownSettingsDefaults(columns, [
    ['project_owner', ownerEmail],
    ['project_usage', process.env.DIRECTUS_PROJECT_USAGE ?? 'commercial'],
    ['org_name', process.env.DIRECTUS_ORG_NAME ?? 'OS7'],
    ['product_updates', process.env.DIRECTUS_PRODUCT_UPDATES === 'true' ? 1 : 0]
  ]);

  if (updates.length === 0) return;

  await connection.query(`UPDATE directus_settings SET ${updates.join(', ')} LIMIT 1`, params);
  console.log(`Configured Analyst Directus onboarding defaults: ${updates.map((update) => update.split(' ')[0]).join(', ')}`);
}

async function setStaticToken(connection) {
  if (!staticToken) return;

  const columns = await listColumns(connection, 'directus_users');
  if (!columns.has('token') || !columns.has('email')) return;

  const [result] = await connection.query('UPDATE directus_users SET token = ? WHERE email = ? LIMIT 1', [
    staticToken,
    adminEmail
  ]);

  if (result.affectedRows === 0) {
    console.warn(`Could not set Analyst MCP static token: admin user ${adminEmail} was not found.`);
  } else {
    console.log(`Configured Analyst MCP static token for ${adminEmail}.`);
  }
}

async function listColumns(connection, tableName) {
  try {
    const [rows] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
    return new Set(rows.map((row) => row.Field));
  } catch {
    return new Set();
  }
}

export function buildKnownSettingsUpdates(columns, entries) {
  const updates = [];
  const params = [];

  for (const [column, value] of entries) {
    if (columns.has(column)) {
      updates.push(`\`${column}\` = ?`);
      params.push(value);
    }
  }

  return { updates, params };
}

export function buildKnownSettingsDefaults(columns, entries) {
  const updates = [];
  const params = [];

  for (const [column, value] of entries) {
    if (columns.has(column)) {
      updates.push(`\`${column}\` = COALESCE(\`${column}\`, ?)`);
      params.push(value);
    }
  }

  return { updates, params };
}
