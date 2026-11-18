# Elshad AI Agent & Automation Platform

A self-hostable and cloud-deployable platform that unifies deterministic workflows and autonomous AI agents in one observable, bounded, permissioned, and auditable runtime.

Repository: `https://github.com/sayntralenterprise-star/elshad.ai-agentic-automation.git`

## Architecture & Development Docs

- Entry point: [`docs/00-START-HERE.md`](docs/00-START-HERE.md)
- Overview: [`docs/architecture/01-architecture-overview.md`](docs/architecture/01-architecture-overview.md)
- Repository boundaries: [`docs/architecture/02-repository-structure.md`](docs/architecture/02-repository-structure.md)
- Tech stack & conventions: [`docs/architecture/03-tech-stack-and-conventions.md`](docs/architecture/03-tech-stack-and-conventions.md)
- Core interfaces & data model: [`docs/architecture/04-core-interfaces-and-data.md`](docs/architecture/04-core-interfaces-and-data.md)
- Delivery plan: [`docs/plan/05-delivery-plan.md`](docs/plan/05-delivery-plan.md)
- OpenAPI 3.1 contract: [`docs/api/openapi.json`](docs/api/openapi.json)

## Quickstart (Local Development)

### Prerequisites

- Node.js `>= 22.0.0` (verified on `24.13.0`)
- `pnpm` `12.14.0`
- Docker Desktop (with WSL2 on Windows) for the full Compose stack
- Python `>= 3.12` (optional for `python/` packages)

### Run Verification Locally (No Docker required)

```bash
pnpm install
pnpm openapi:generate
pnpm build
pnpm typecheck
pnpm lint
pnpm depcruise
pnpm test
```

### Run Full Docker Compose Stack

```bash
cp deploy/docker-compose/.env.example deploy/docker-compose/.env
docker compose -f deploy/docker-compose/compose.yaml up --build
```

Services started:
- Web Console: `http://localhost:3000`
- API Gateway & Control Plane: `http://localhost:8080` (`GET /health`, `GET /ready`, `GET /openapi.json`, `GET /metrics`)
- Execution Engine: `http://localhost:8081` (`GET /health`, `GET /ready`)
- Worker, PostgreSQL 16 + pgvector, Valkey/Redis, NATS JetStream, MinIO (`http://localhost:9001`)

Default bootstrap credentials (Compose / dev mode only):
- Email: `admin@elshad.local`
- Password: `ChangeMe123!`

See [`docs/guides/local-dev.md`](docs/guides/local-dev.md) for detailed instructions and [`docs/plan/S0.1-demo.md`](docs/plan/S0.1-demo.md) for the Slice S0.1 walkthrough.
