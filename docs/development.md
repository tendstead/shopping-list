# Development and checks

```sh
make deps          # lockfile installs and Go dependencies, in Docker
make fmt           # Go and frontend formatting
make check         # formatting, lint, types, vet, audits, tests, production build
make service-test  # fresh isolated PostgreSQL transaction and HTTP tests
make e2e           # mobile Chromium + WebKit through an isolated HTTPS proxy
make observe       # app memory/CPU observations with idle SSE and editing
```

Other targets: `fmt-check`, `lint`, `vet`, `vuln`, `test`, `release-test`, `build`,
`up`, `down`, `logs`, and `workflow-lint`. Test Compose projects use unique names,
keep their database in tmpfs, and clean up their own containers and volumes.
Deployment's `postgres-data` volume is not used by tests. Tooling cache volumes are
separate. A draft `.pre-commit-config.yaml` is provided for later opt-in use.

CI runs `make check`, including `govulncheck` and `npm audit` through `make vuln`.
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
