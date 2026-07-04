# Analyst Template

Analyst is a minimal OS7 app template for agent-managed analytical databases.
It runs Directus as the primary runtime and extends Directus MCP with guarded SQL
analysis tools.

## Runtime

- Directus Studio, REST, GraphQL, and MCP run on the app port.
- Directus uses the project MySQL database provisioned by OS7.
- The local `directus-extension-analyst-sql` hook adds SQL tools to the same
  `/mcp` endpoint exposed by Directus.

## MCP Tools

Native Directus MCP tools handle schema and content work:

- collections
- fields
- relations
- items
- schema

Analyst adds:

- `analyst_describe_database`
- `analyst_describe_table`
- `analyst_run_sql_query`

`analyst_run_sql_query` allows one read-only statement at a time. It accepts
`SELECT`, `WITH`, `SHOW`, `DESCRIBE`, and `EXPLAIN`, applies a row limit to
unbounded `SELECT`/`WITH` queries, and rejects mutating SQL.

## Local Development

Configure MySQL and Directus admin env vars, then run:

```sh
npm install
npm run bootstrap
npm run dev
```

Useful checks:

```sh
npm run test
npm run build
```

`npm run test` includes an in-memory SQLite check for the Analyst SQL tool so
the guarded query path is exercised against a real database without requiring
MySQL.
