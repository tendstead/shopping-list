# Deployment

The first supported image platform is Linux AMD64. The app listens on container
port 8080 and runs as a nonroot user with a read-only filesystem. Default app limits
are 1 CPU and 128 MiB, with GOMEMLIMIT=96MiB and GOMAXPROCS=1. PostgreSQL and build tools
have separate budgets. Run one app replica; SSE fanout is local to that process.

## Container resource budgets

All Compose services have explicit `cpus`, `mem_limit` and `memswap_limit` values.
The swap limit equals the memory limit, so there is no additional swap allowance.
The same app limits apply to bundled and external-database deployments; test
PostgreSQL uses the same budget as bundled PostgreSQL.

| Container | CPU limit | RAM limit |
| --- | --- | --- |
| Go application | 1 | 128 MiB |
| Bundled/test PostgreSQL | 1 | 512 MiB |
| Test HTTPS proxy | 0.5 | 128 MiB |
| Playwright E2E runner | 2 | 4 GiB |
| Go tools, backend service tests, golangci-lint | 2 | 2 GiB each |
| Frontend tools | 2 | 1 GiB |
| Resource-observation probe | 0.5 | 128 MiB |
| Workflow lint tool | 1 | 128 MiB |

The bundled deployment's combined RAM ceiling is 640 MiB and CPU budget is 2.
Browser/build/test tools are separate from deployment. Image-build steps run in
Docker's builder and are not governed by Compose service limits.

The E2E suite and full checks passed under these budgets. Defaults leave headroom
above observed kernel RAM peaks; PostgreSQL also has room for its default shared
buffers and the app's small connection pool. Larger workloads may need new
measurements. See [verification](verification.md) for observed peaks and CPU quotas.

Docker's [Compose service settings](https://docs.docker.com/reference/compose-file/services/)
and [resource constraint documentation](https://docs.docker.com/engine/containers/resource_constraints/)
explain the enforced CPU/RAM and swap behavior. Keep `memswap_limit` equal to
`mem_limit` when changing a budget, and keep the app's Go memory target below its
container RAM limit.

## PostgreSQL on an existing NAS

Use the application-container example in [compose.external.yaml](../compose.external.yaml)
without the bundled PostgreSQL service. Create a database and schema first, with
an application user able to create tables and apply future migrations in that
schema. Mount a password file read-only instead of putting a password in YAML.

| Variable | Default | Purpose |
| --- | --- | --- |
| DB_HOST | localhost (binary) / postgres (bundled Compose) | Database hostname |
| DB_PORT | 5432 | Database port |
| DB_USERNAME | shopping | Database user |
| DB_PASSWORD | empty (binary) | Password when no password file is supplied |
| DB_PASSWORD_FILE | empty | Password file; takes precedence, strips final newline |
| DB_NAME | shopping | Database name |
| DB_SSL_MODE | disable | pgx PostgreSQL TLS mode; use verify-full with trusted CA for remote DB |
| DB_SEARCH_PATH | server default (binary) / public (Compose) | Existing PostgreSQL schema search path |
| GOMEMLIMIT | 96MiB (container) | Go runtime memory target |

Never expose the bundled development password outside your development machine.
The default bundled Compose binding is 127.0.0.1:8080. Choose the shared host's
LISTEN_ADDR/PORT deliberately when deploying. The external example expects
SHOPPING_IMAGE, DB_HOST/PORT/USERNAME/NAME/SSL_MODE, a DB password file, and host port.
TrueNAS Custom App can import the same Compose application (adjust the secret file
path to your dataset); Docker's deployment user must be able to read that file.
The application container has no host data volume: shared data lives in PostgreSQL.
The example is not automatically installed on a NAS by this task.

## HTTPS and private access

There is no app authentication. Use the household's private network or VPN and a
trusted HTTPS reverse proxy for access from phones. DNS, certificate issuance and
VPN setup are deliberately outside this implementation. A proxy must forward the
original Host and allow long-lived `/api/events` responses without buffering or a
short upstream timeout. The backend disables buffering with X-Accel-Buffering:no.

After one successful secure-context load and service-worker installation, the app
shell can reopen offline; trip snapshots and pending edits come from IndexedDB.
An untrusted self-signed certificate is not reliable on phones. Plain HTTP to a
LAN hostname does not permit service workers. Loopback may be treated as secure by
browsers for development. The test suite uses an isolated TLS proxy and bypasses
its test certificate errors; this does not configure trust on real phones.
Browser storage can be evicted by the OS or cleared by the user. Keep the app
installed/regularly used and wait for Synced before clearing site data.

## Operations and backups

Readiness `/health/ready` checks a live PostgreSQL connection. Startup migration
failure exits the process, so an unusable schema never reports ready. Liveness
`/health/live` only indicates the HTTP process is serving. Shutdown closes SSE
clients and drains HTTP requests. Preserve the database on upgrades.

Back up PostgreSQL using a scheduled NAS backup or `pg_dump`; include shared_state,
trip_history, acknowledged_operations and schema_migrations. Restore into a fresh
database, keep the same deployment configuration, then restart the app. Retaining
acknowledged_operations is necessary to deduplicate old browser retries. Browser
pending queues are device data and are not in a server backup.

The bundled Compose volume is `shopping-list_postgres-data`. `make down` preserves
it. Never run `docker compose down --volumes` against deployment unless deliberately
removing all household data. Test commands use separate projects and tmpfs databases.
