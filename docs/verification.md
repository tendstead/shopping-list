# Verification record

Verified on 2026-10-09 in Docker on Linux AMD64. Latest `make deps check` exited 0
with CPU/RAM limits on all Compose containers. Its local scratch log is
`.implementation/check-resource-limits.log`; capped `make observe` also exited 0
with `.implementation/observe-resource-limits.log`. Earlier implementation evidence
is retained in `.implementation/check-complete.log` and `observe-final.log`. Reproduce with
`make deps check` and `make observe`. Test data uses unique Compose projects,
tmpfs PostgreSQL storage and project-local test volumes; all test/visual containers
and their volumes were removed. Deployment storage was never started or modified.

## Fresh checks

| Check | Observed result |
| --- | --- |
| Go formatting / golangci-lint / vet | Pass; 0 lint issues |
| Frontend ESLint / Prettier / Svelte type checks | Pass; 0 type errors or warnings |
| govulncheck / npm audit | No reported vulnerabilities |
| Go domain/config unit tests | Pass with race checking |
| PostgreSQL/HTTP service tests | Pass with race checking against fresh PostgreSQL 18 |
| IndexedDB/synchronization units | 14/14 pass |
| Release label/version/retry units and CLI validation | 6/6 pass |
| Browser acceptance | 32/32 pass: 16 Chromium, 16 WebKit |
| Production Docker build | Pass; Linux AMD64, nonroot 65532, embedded SPA, 13.1 MiB image |
| GitHub workflow lint | Pass, with the documented concurrency-key parser exception below |

Database-dependent tests skip when their test DB environment is absent in the
unit target; the separate service target ran them with PostgreSQL. No Node runtime
is included in the production image.

## Exercised behavior

Domain/service checks cover normalized duplicates, reusable/one-time selection,
optional counters and tags, control changes, needed-item deletion/carryover,
purchased reset/removal, needed-only immutable history, stale/atomic completion
and exact finish retry, persistent reopened state, migration checksums/startup
failure, concurrent writes, per-field conflicts, idempotent lost-response retries,
strict JSON and same-origin writes, postcommit SSE and rejected writes without SSE.

Synchronization checks cover durable pending reloads, storage failure without a
false saved state, exact operation-ID retries, explicit conflict/late-trip review,
shared-origin queue preservation and concurrent draining, rapid counter/tag intents,
dependent operations retaining their position after review, duplicate selection
with later edits, repeated resolution preserving unrelated edits, and newly-needed
notifications alongside independent local tag changes. Review regressions were
observed failing before their fixes and passing afterward.

Browser checks cover mobile preparation/shopping/cart/history, item controls,
duplicates, one-time carryover, needed reusable deletion, independent phone modes
and layouts, SSE notifications, conflicting counts and reorders, offline ordering,
late-trip review without changing history, lost/timed-out committed responses,
rapid taps, remote duplicate selection, layout CRUD, scroll preservation, keyboard
operation, German text, desktop drag and the touch-handler pointer sequence.
A Playwright MCP visual inspection also checked preparation/shopping at 390×844
with a counter and tags: no horizontal overflow or console errors were observed.

Secure offline reopening runs through an isolated Caddy TLS proxy whose test CA
is installed only inside the test container. The test stops/restarts that proxy
and verifies cached reopening, pending persistence through reload and reconnect.
WebKit's emulated offline mode has an upstream service-worker response bug;
using a real origin outage avoids that emulation behavior. See
[Playwright issue 42775](https://github.com/microsoft/playwright/issues/42775).
Navigation falls back to the cached shell after 3 seconds or an unsuccessful
response, so stalled requests cannot indefinitely block a previously cached app.

Release tests cover zero baseline and all semantic increments, release-label
validation, concurrent unique allocation, same-PR retry reuse, image-publication
failure followed by recovery, unlabeled skip, and CLI validation without publishing
credentials. The workflow builds the merged commit and explicitly publishes the
image before creating the release. Allocation tests use fake repository/publisher
adapters; actual GitHub tag creation, queue scheduling, Docker Hub credentials and
publication have not been exercised because repository/account setup and actual
publication remain future deployment actions.

## Resource observations

The application container had 1 CPU, 128 MiB memory and GOMEMLIMIT=96MiB.
PostgreSQL/build/test containers have separate budgets.

| Short sample | App memory | App CPU |
| --- | --- | --- |
| No clients | 2.145 MiB | 2.20% |
| Two idle SSE clients | 2.234 MiB | 2.22% |
| Editing/reconnection fetches | 3.129 MiB | 2.94% |
| After editing | 3.168 MiB | 3.19% |

The probe attached two SSE clients, performed 20 edits with authoritative fetches,
and disconnected. Docker reported no OOM kills, zero restarts and a normal stop
exit 0. These are brief samples with the test stack's 1 second health checks; they
are not sustained-load measurements or a guarantee for every household size.
Long blocked-request draining was reviewed in code, not stress tested.

## E2E resource peaks and applied limits

A follow-up measured the full 32-scenario browser run, then applied CPU/RAM caps
and repeated `make deps check`. Both runs passed 32/32 browser scenarios; the full
capped run also passed 14 sync tests, 6 release tests, backend/service race tests,
format/lint/types/vulnerability checks and the production build. The capped
resource probe completed 20 edits/reconnection fetches and exited 0 as well.

Only shopping test/tool containers were sampled, about once per second, using
Docker Engine configuration and cgroup v2 `memory.peak`, `cpu.stat` and
`memory.events`. RAM peaks include charged file cache and kernel memory. This
explains why they exceed the Linux Docker CLI's cache-adjusted RAM display; see
[Docker stats documentation](https://docs.docker.com/reference/cli/docker/container/stats/).
Raw samples/reports are ignored local artifacts `resources-baseline*` and
`resources-limited*` under `.implementation/`.

| Service | Baseline RAM peak | Capped RAM peak | RAM limit | CPU limit | Capped sampled CPU peak |
| --- | --- | --- | --- | --- | --- |
| App | 14.51 MiB | 15.27 MiB | 128 MiB | 1 | 6.19% |
| PostgreSQL | 90.54 MiB | 89.84 MiB | 512 MiB | 1 | 72.50% |
| HTTPS proxy | 28.25 MiB | 23.57 MiB | 128 MiB | 0.5 | 9.03% |
| Playwright | 2498.70 MiB | 2410.43 MiB | 4096 MiB | 2 | 207.98% |
| Go tools | — | 686.29 MiB | 2048 MiB | 2 | 202.63% |
| Backend service tests | — | 655.59 MiB | 2048 MiB | 2 | 205.23% |
| Frontend tools | — | 476.93 MiB | 1024 MiB | 2 | 202.07% |

Lint's short warm-cache invocation was also capped at 2 CPU/2 GiB and passed, but was
too short for a useful CPU sample. These are observed peaks from this functional
suite, not a sustained-load guarantee or complete cold-cache build profile.
Docker image-build steps are outside the sampled Compose service containers.

CPU percent uses 100% per logical CPU. Short sample windows may slightly exceed
the nominal quota because they are not aligned to CPU scheduling periods. The
kernel check inside the E2E container confirmed `cpu.max=200000 100000` (two CPU
seconds per wall-clock second), `memory.max=4294967296` (4 GiB), and
`memory.swap.max=0`; see `.implementation/cgroup-limits-e2e.log`. Docker Engine
inspection during the suite confirmed the configured caps on the other services.
CPU quotas are enforced over scheduling periods, not instantaneous percentages;
see [Docker CPU constraints](https://docs.docker.com/engine/containers/resource_constraints/#cpu).

All sampled containers reported zero OOM kills and zero restarts. The HTTPS proxy
was intentionally stopped/restarted by the offline tests. Test stacks, inspection
containers and their volumes were cleaned up; neighboring services and deployment
volumes were untouched. All services have `memswap_limit` equal to `mem_limit`,
so test success does not depend on additional swap memory.

## Evidence limits and deployment checks

- One Go replica is the supported architecture. SSE fanout is process-local;
  PostgreSQL transactions preserve shared state but do not broadcast across replicas.
- Actual phones, native touch gesture delivery, OS storage eviction, NAS database
  privileges/backups, trusted phone HTTPS and VPN access need deployment validation.
  The touch test exercises the pointer handlers; it does not emulate OS gesture delivery.
- HTTP supports disconnected editing while loaded. Reliable offline reopening needs
  a successfully cached secure-context shell. Clearing/evicting browser data can
  remove unacknowledged changes.
- Current actionlint lacks GitHub's documented `concurrency.queue` syntax. The
  workflow-lint target suppresses only its exact unsupported-key diagnostic and
  retains all other diagnostics. The configured `queue: max` has a 100 pending-run
  limit; excess merges need manual retry. See [GitHub concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
- The approved plan excludes neighboring-project/Automatix integration. No such
  integration was performed. No Git initialization, commit, push or publication
  occurred. No infrastructure accounts or host certificate trust were changed.
