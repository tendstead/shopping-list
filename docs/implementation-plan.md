# Shared Shopping List — implementation and resume plan

Updated 2026-10-09. Implementation and resource-limit follow-up are complete.
Latest `make deps check` passed with caps on all Compose services; see the
resource record below and docs/verification.md.
Final `make check` exited 0: 14 synchronization units, 6 release units, 32 browser
checks, backend/service race tests, lint/type/vulnerability checks and AMD64 build.
`make observe` also exited 0. See docs/verification.md for evidence and limits.
Read this file first after context compression, then the files and logs referenced
below. Do not restart completed work.

## Authority and constraints

The user requested implementation of the supplied Shared Shopping List design.
The latest steering requested a durable resume plan when progress was below 75%;
that plan was created, and work has continued past that point.

- The project workspace was empty, without Git.
  Do not initialize Git, commit, push, publish images/releases, or set up accounts.
- All tools, tests and services run in Docker. Authorized filesystem/Docker writes
  use escalated exec because the default sandbox is read-only.
- The supplied design excludes neighboring projects and Automatix integration.
- Inline implementation uses Superpowers executing-plans/TDD/debugging/verification.
  One fresh-context read-only final reviewer ran via requesting-code-review.
- Product requirements remain the supplied plan: Go embedded SvelteKit SPA,
  Melt UI controls, EN/DE, PostgreSQL, one household/trip, no app authentication,
  offline durable trip changes and ordering, explicit conflicts, immutable history,
  container-only checks, and retry-safe automatic semantic releases.

## Implemented

1. **Foundation:** Go 1.26.9/pgx 5.9.2, SvelteKit 3/Svelte 5/Vite 8/TypeScript 6,
   multi-stage AMD64 production image with no Node runtime, PostgreSQL 18 Compose,
   password-file/search-path configuration, startup SQL migrations with checksum
   validation/advisory lock, health checks, shutdown drain,1 CPU/128 MiB/96 MiB defaults.
2. **Domain/REST:** reusable and one-time items, independent counter/tag controls,
   normalized duplicates, field-base comparisons, independent merges/identical
   convergence, shared layout CRUD/orders, trip-revision completion, purchased
   reset/removal, unfinished carryover, immutable history, operation-ID/hash dedup.
   Singleton state uses PostgreSQL JSONB row locking; history and acknowledgements
   are separate tables. SSE sends committed-change events after the transaction.
3. **Mobile UI:** EN/DE, History | Shopping list | Edit, per-browser view/layout/
   language/scroll preferences, needed/cart Melt checks, counters/tag chips, edit
   forms, duplicate selection, layout management, drag/touch handles and up/down
   alternatives, collapsed cart, two-tap completion and explicit conflict choices.
4. **Synchronization:** atomic IndexedDB snapshot+pending writes, FIFO queue,
   bounded retries, startup/online/focus/visibility authoritative fetch, SSE,
   real status indicators, named newly-needed notifications, late-trip review,
   cached history, secure-context service-worker shell cache.
5. **Delivery:** Docker Make targets, isolated PostgreSQL/HTTPS browser runners,
   lint/vet/audits/race/unit/E2E/build, draft hooks, CI and release workflows,
   README/API/deployment/TrueNAS/release docs, resource observation tooling.
   Release allocation uses annotated Git tags with durable PR/SHA/version metadata
   and atomic ref creation; publication explicitly builds merged SHA then creates
   GitHub release. No external publication or account setup has occurred.

## Verification already observed

- Domain/config units and PostgreSQL/HTTP service suites pass with race checking.
  Persistence, concurrent fields, atomic completion/exact retry, migrations/checksum,
  late trips, strict JSON, same-origin writes, rejected/no-SSE mutations covered.
- Initial 7 synchronization units pass; reviewed rapid-input API regression increased
  this to 8; conflict ordering and duplicate-selection regressions increased to 10.
  Those failures were observed before fixes. Follow-up tests for duplicate action races/order, concurrent tab draining, and notifications bring the final suite to 14.
- Release 6 unit tests pass: labels, versions, concurrent allocations, exact retry,
  failed publication recovery, unlabeled skip, credential-free CLI validation.
- Prior complete 22 browser scenarios pass in both Chromium and WebKit through
  isolated trusted test TLS, including actual origin outage/offline shell reopen,
  pending reload, lost/timed-out acknowledgements, independent merge, competing
  values/layouts, late changes, immutable history, keyboard/translation/basic UI.
- Fresh govulncheck and npm audit previously report no vulnerabilities.
- Final short resource sample: idle 2.145 MiB, two SSE 2.234 MiB, editing 3.129 MiB,
  after editing 3.168 MiB; no OOM/restarts, shutdown exit 0; limits 128 MiB/1 CPU.

## Final review findings and fixes

Fresh-context reviewer found no Critical issues, three Important client issues.
All three have fixes and passing regression tests in the final tree:

- Rapid taps originally derived absolute values from stale props. `Sync.enqueue`
  now accepts an intent factory executed inside its serialized persistence queue;
  counter deltas/tag toggles use the latest durable projection.
- Keeping a conflict generated a new operation ID but appended it after dependent
  operations. IDB merge now inserts a replacement before its next local successor
  while preserving operations from another tab. Unit covers final dependent count.
- Server-detected duplicate conflicts now offer **Use existing** with the returned
  existing item ID. Selection atomically removes the duplicate and appends the
  selection after existing edits; expected-ID guards prevent repeated resolution
  from deleting unrelated pending edits.

Additional main lifecycle fix waits for Shutdown to finish before closing the pool.
Service-worker navigation now falls back to cache after 3 seconds or nonOK responses,
so a stalled network cannot indefinitely prevent offline reopening. Notification
comparison uses the previous projected Needed status rather than suppressing all
remote notifications for an item with an independent local tag edit.

## Remaining work / continuation

No implementation step remains pending. All Important review findings were fixed
with regression evidence. Fresh final log `.implementation/check-complete.log`
records complete `make check` exit 0; `.implementation/observe-final.log` records
resource observations and stop exit 0. Visual/test stacks and their test volumes
were cleaned up. The production local image `shopping-list:local` remains.
No deployment volume was created or modified.

Future deployment actions require a new user instruction: repository/account
setup, Docker Hub/GitHub credentials/publication, NAS configuration, trusted phone
HTTPS/VPN/DNS, backups and real-device acceptance. Do not infer authorization to
publish, initialize Git or integrate Automatix from this completed task.

To resume development later, read this plan and docs/verification.md, inspect the
current sources, then run Docker-backed checks appropriate to the requested change.
To run locally, follow README.md (`cp .env.example .env`, `make up`).

## Files and commands

- Domain `internal/domain/domain.go`; storage/migrations `internal/store/`;
  HTTP/SSE `internal/httpapi/api.go`; runtime `cmd/server/main.go`.
- Frontend `web/src/routes/+page.svelte`, `web/src/lib/{sync,model,i18n}.ts`,
  `Checkbox.svelte`, `ItemRow.svelte`, `web/src/service-worker/index.ts`.
- Tests `web/src/lib/sync.test.ts`, `web/tests/{shopping,synchronization}.spec.ts`,
  backend `*_test.go`, `scripts/release.test.mjs`.
- Docker/Make/workflows at root; release driver `scripts/release.mjs`.
- `make deps`, `make fmt`, `make check`, `make observe`: all in Docker.
- Detailed historical scratch ledger `.implementation/progress.md` and check logs.
  `.implementation/` is ignored and excluded from image builds.

## Design rulings and limits

- No Git/worktree because initialization explicitly excluded; no branch isolation.
- No neighbor/Automatix because supplied accepted scope excludes integration.
- Single JSONB state plus history/ack tables keeps one-household storage small;
  one Go replica only, since SSE fanout is process-local.
- Blank initial checklist and editable per-item tag vocabulary; no supplied household
  initials/inventory to import. Four named layouts seeded as requested.
- Current actionlint parser lacks GitHub's documented concurrency.queue key;
  workflow-lint suppresses exactly that parser diagnostic, retaining queue:max and
  other checks. Actual GitHub scheduling/publication awaits repository setup.
- WebKit Playwright offline emulation rejects service-worker responses (upstream
  issue 42775). Secure-reopen acceptance stops/restarts only the isolated Docker TLS
  proxy instead. No production service or host certificate trust is changed.
- HTTP supports loaded disconnected editing; dependable reopening needs previously
  cached trusted HTTPS. Browser data can be evicted/cleared. Resource observations
  are short functional samples, not sustained-load proof.

## Resource-limit follow-up record

User requested RAM/CPU limits informed by observed E2E consumption. Baseline
`make e2e` passed 32/32; raw cgroup peaks (including file cache) were app 14.51 MiB,
PostgreSQL 90.54 MiB, proxy 28.25 MiB and Playwright 2498.70 MiB. Baseline evidence is
`.implementation/resources-baseline{.json,.jsonl,-summary.log}` and
`.implementation/e2e-resources-baseline.log`.

All Compose services now have explicit cpus/mem_limit/memswap_limit: app 1 CPU/128 MiB,
PostgreSQL 1 CPU/512 MiB, proxy 0.5 CPU/128 MiB, Playwright 2 CPU/4 GiB, Go/service-tests/lint
2 CPU/2 GiB, frontend 2 CPU/1 GiB. Swap limits equal memory so no extra swap budget.
Observe's probe and actionlint Docker invocations also have caps. No app code,
migrations, neighboring services or deployment volumes changed.

`make deps check` exited 0 under the new caps: 14 sync tests, 6 release tests,
32 browser checks, backend/service race tests, lint/vet/types/audits/build/workflows.
Evidence: `.implementation/check-resource-limits.log` and `resources-limited*`.
Capped `make observe` exited 0: `.implementation/observe-resource-limits.log`.
Actual Docker Engine caps were sampled; the E2E kernel check confirmed two CPU,
4 GiB RAM and zero swap in `.implementation/cgroup-limits-e2e.log`. No sampled
OOM kills/restarts. Test, probe and inspection stacks cleaned; no deployment data
was used. README includes a filtered docker stats watch command; deployment docs
list all budgets and verification docs list measured RAM/CPU peaks and limits.

No task remains pending. The sampler is an ignored throwaway host Docker CLI
orchestration script, not a host service or new production subsystem.
