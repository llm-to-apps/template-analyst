# Analyst Agent Guide

Analyst is a minimal Directus-backed data workspace. It uses Directus as the
runtime application, API layer, admin studio, and MCP endpoint. OS7 adds a small
Directus hook extension that contributes guarded read-only SQL tools to the same
Directus `/mcp` endpoint.

## Default Agent Mode

Prefer small, direct changes. Most work should adjust the Directus extension,
runtime bootstrap, or template manifest. Do not add a separate app UI unless the
user explicitly asks; the universal OS7 canvas is responsible for visualization.

Use Directus MCP for schema and content management:

- create or modify collections
- create or modify fields
- create or modify relations
- load or update collection items

Use Analyst SQL MCP tools only for analytical reads:

- `analyst_describe_database`
- `analyst_describe_table`
- `analyst_run_sql_query`

`analyst_run_sql_query` is intentionally read-only. Do not bypass its safeguards
for routine analysis. If a user needs schema mutation, use Directus collections,
fields, and relations tools instead of raw SQL.

## Common Places

- Template manifest: `manifest.json`
- Directus runtime package: `package.json`
- Container runtime: `Dockerfile`
- Directus MCP SQL extension entrypoint:
  `extensions/hooks/directus-extension-analyst-sql/dist/index.js`
- SQL guardrails and query helpers:
  `extensions/hooks/directus-extension-analyst-sql/dist/sql-tools.js`
- Directus bootstrap helper: `scripts/enable-mcp.mjs`
- Extension smoke validation: `scripts/validate-extension.mjs`
- SQL guardrail tests: `tests/sql-tools.test.mjs`

## Product Shape

Analyst starts with a clean database. A user or importer can provide structured
file metadata later, and the agent should use Directus MCP to turn that metadata
into collections, fields, relations, and imported rows. The canvas then consumes
query results and collection metadata to render tables, charts, and analysis
views.

Do not build spreadsheet parsing into this template yet. Treat XLSX/CSV parsing
as a future ingestion layer that feeds schema summaries and row batches into
Directus.

## Verification

For extension or SQL tool changes, run:

```sh
npm run test
npm run build
```

The SQL tool tests include an in-memory SQLite path. Keep that coverage when
changing query execution or guardrails so tests do not require a running MySQL
service.

For manifest-only changes, validate the manifest against the platform schema if
the surrounding tooling is available.
