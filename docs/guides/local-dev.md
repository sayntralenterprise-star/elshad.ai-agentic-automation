# Local Development Guide

## 1. Cross-Platform Workspace Commands

All workspace scripts work on Windows PowerShell, macOS, and Linux.

| Command | Purpose |
|---|---|
| `pnpm install` | Install JS/TS workspace dependencies |
| `pnpm build` | Build all packages and apps in dependency order via Turborepo |
| `pnpm typecheck` | Run strict TypeScript type checks across all packages/apps |
| `pnpm lint` | Run ESLint across workspace |
| `pnpm depcruise` | Enforce architecture & module boundary rules (`.dependency-cruiser.cjs`) |
| `pnpm openapi:generate` | Regenerate `docs/api/openapi.json` from `@elshad/api-contract` |
| `pnpm test` | Run Vitest unit, integration, contract, and console accessibility tests |

## 2. Running Python Checks

```bash
cd python
python -m pip install pytest ruff black
ruff check .
black --check .
PYTHONPATH=sandbox-runtime:eval-graders:sdk-py pytest
```

## 3. Running with Docker Compose

1. Ensure Docker Desktop (WSL2 backend on Windows) is running.
2. Copy `deploy/docker-compose/.env.example` to `deploy/docker-compose/.env` and review `PLATFORM_MASTER_KEY` and `PLATFORM_ADMIN_*`.
3. Bring up the stack:
   ```bash
   docker compose -f deploy/docker-compose/compose.yaml up --build
   ```
4. Optional profiles:
   - `--profile observability`: starts OpenTelemetry Collector (`4317`/`4318`)
   - `--profile local-models`: starts Ollama (`11434`)
5. Stop and clean volumes when resetting local DB state:
   ```bash
   docker compose -f deploy/docker-compose/compose.yaml down -v
   ```

## 4. Database Migrations & RLS

SQL migrations live in `packages/db/migrations/`:
- `0001_extensions_and_roles.sql`: extensions (`pgcrypto`, `vector`, `pg_trgm`, `citext`), DB roles (`platform_owner`, `platform_app` with `NOBYPASSRLS`, `platform_system`), and `enable_tenant_rls(regclass)`.
- `0002_s01_core_schema.sql`: tenancy, projects, IAM, idempotency, outbox, hash-chained partitioned `audit_events`, and baseline `agents` tables with forced RLS.

Run migrations manually against a running Postgres instance:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/platform pnpm --filter @elshad/db migrate:up
```
