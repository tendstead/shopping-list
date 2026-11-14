# Development and checks

```sh
make deps          # lockfile installs and Go dependencies, in Docker
make fmt           # Go and frontend formatting
make check         # formatting, lint, types, vet, audits, tests, production build
make service-test  # fresh isolated PostgreSQL transaction and HTTP tests
make e2e           # mobile Chromium + WebKit through an isolated HTTPS proxy
make observe       # app memory/CPU observations with idle SSE and editing
```

Other targets: `dependency-check`, `fmt-check`, `lint`, `vet`, `vuln`, `test`, `release-test`, `infra-test`, `build`,
`up`, `down`, `logs`, and `workflow-lint`. Test Compose projects use unique names,
keep their database in tmpfs, and clean up their own containers and volumes.
Deployment's `postgres-data` volume is not used by tests. Disposable Go module,
compiler, lint, and npm download caches live under `.implementation/cache/` and
are shared between tool and test containers. Test cleanup preserves those caches;
database contents and browser node_modules remain isolated. A draft
`.pre-commit-config.yaml` is provided for later opt-in use.

CI runs the same targets as `make check` in separately timed steps within the
required `checks` job, including `govulncheck` and `npm audit` through `make vuln`.
Actions restores content/compiler caches using OS, architecture, lockfiles and
tool image definitions. Cache misses still run the full suite; npm installs use
the lockfile and audits always query current advisories. Superseded runs for the
same PR are canceled. Browser tests stay sequential because the offline scenarios
disconnect the shared test origin.

`dependency-check` rejects a Playwright package/lockfile/browser-image mismatch
before browser setup. Update the exact npm version and `compose.test.yaml` image
together. CI also rejects dependency files changed by `make deps`.

TypeScript stays on 6.0.3 because the current SvelteKit, svelte-check and
typescript-eslint peer requirements exclude TypeScript 7. The scoped minimatch
override supplies its patched version to typescript-eslint until its upstream
range is updated; remove that override once upstream includes the fix.
The optional pre-commit hooks run formatting, lint, and type checks; install them
with `pre-commit install`. They do not run vulnerability scans.

Dependabot is configured in `.github/dependabot.yml` to open weekly update PRs
for Go modules, frontend npm packages, GitHub Actions, and Dockerfile base images.
Minor and patch version updates are grouped per ecosystem; major updates remain
separate, with at most three open version-update PRs per ecosystem. This takes
effect after the configuration reaches the default branch. Dependabot alerts
and security updates can be enabled separately in the repository's security
settings. [Dependabot is free](https://github.com/pricing), and
[standard GitHub-hosted runners are free for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

All Compose services have hard CPU/RAM budgets, with no additional swap allowance.
The deployed app is capped at 1 CPU/128 MiB and bundled PostgreSQL at 1 CPU/512 MiB;
Playwright and build tools have separate, larger budgets. See the
[resource budget table](deployment.md#container-resource-budgets).

To watch only the E2E containers while `make e2e` runs in another terminal:

```sh
watch -n 1 'ids=$(docker ps -q --filter name=shopping-test-); if [ -n "$ids" ]; then docker stats --no-stream $ids; fi'
```

The production image contains a single Go executable with embedded static assets;
Node runs only in build/test containers. PostgreSQL is a separate service. The app
has a four-connection pool, no broker and no recurring database polling. One app
instance serves SSE notifications in memory; run one replica for this household.

See [API and synchronization](api.md), [deployment](deployment.md),
[releases](releases.md), [verification](verification.md), and the
[implementation/resume plan](implementation-plan.md).
