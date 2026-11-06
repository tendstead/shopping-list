# Repository Guidelines

## Project Structure & Module Organization

Together is a shared household shopping list with a Go backend, PostgreSQL, and Svelte 5/TypeScript frontend.

- `cmd/server/`: server entry point and embedded static assets.
- `internal/domain/`: shopping rules; `internal/store/`: persistence and SQL migrations; `internal/httpapi/`: HTTP API and SSE notifications.
- `web/src/`: routes, reusable components, synchronization logic, and service worker; `web/static/`: icons and manifest.
- `web/tests/`: browser acceptance tests. Go tests live beside their packages; frontend unit tests live beside source files.
- `scripts/`: release and container tooling; `docs/`: API, deployment, release, and verification references.

## Build, Test, and Development Commands

Build tools run in Docker containers.

- `cp .env.example .env && make up`: configure and start the app at `http://127.0.0.1:8080`.
- `make down`: stop services while retaining database storage.
- `make deps`: install frontend dependencies and tidy Go modules.
- `make fmt`: format Go and frontend files.
- `make test`: run Go tests with race detection, Vitest, and release-script tests.
- `make service-test`: exercise PostgreSQL transactions and HTTP behavior against an isolated database.
- `make e2e`: run mobile Chromium and WebKit scenarios through HTTPS.
- `make build`: build the Linux AMD64 production image.
- `make check`: run formatting, lint, types, vet, vulnerability audits, tests, build, and workflow validation.

## Coding Style & Naming Conventions

Use `gofmt` for Go indentation and formatting. Follow existing package names and exported `PascalCase` identifiers. Use Prettier for frontend formatting, `camelCase` for TypeScript variables, and `PascalCase.svelte` component filenames. ESLint rejects explicit TypeScript `any`; run `make lint` for lint and type checks.

## Testing Guidelines

Name Go tests `*_test.go` with `Test...` functions, Vitest tests `*.test.ts`, and Playwright scenarios `*.spec.ts`. Cover changed behavior, especially offline queues, conflict resolution, retries, and immutable trip history. No numeric coverage threshold is configured. Database tests may skip under `make test`; run `make service-test` for database changes. Run `make check` before submitting.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout; use concise, imperative commit subjects. PRs should explain changes, link issues, report checks, and include screenshots for UI changes. Releases are manually started from the default branch using Actions → Release with a `patch`, `minor`, or `major` increment; PR labels do not publish releases.

## Security & Configuration

Keep credentials out of commits and replace the example database password for shared deployments. The app has no login: follow `docs/deployment.md` for access controls and trusted HTTPS. Preserve the single-replica architecture because SSE fanout is process-local.
