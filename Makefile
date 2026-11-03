TOOLS = docker compose -p shopping-tools -f compose.tools.yaml
.PHONY: deps fmt fmt-check lint vet vuln test service-test e2e build up down logs check release-test
deps:
	$(TOOLS) run --rm go go mod tidy
	$(TOOLS) run --rm frontend npm ci
fmt:
	$(TOOLS) run --rm go gofmt -w cmd internal
	$(TOOLS) run --rm frontend npm run format
fmt-check:
	$(TOOLS) run --rm go sh -c 'test -z "$$(gofmt -l cmd internal)"'
lint:
	$(TOOLS) run --rm lint golangci-lint run
	$(TOOLS) run --rm frontend npm run lint
	$(TOOLS) run --rm frontend npm run check
vet:
	$(TOOLS) run --rm go go vet ./...
vuln:
	$(TOOLS) run --rm go sh -c 'go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...'
	$(TOOLS) run --rm frontend npm audit --audit-level=high
test:
	$(TOOLS) run --rm go go test -race -count=1 ./...
	$(TOOLS) run --rm frontend npm test
	$(MAKE) release-test
service-test:
	sh scripts/test-containers.sh service
e2e:
	sh scripts/test-containers.sh e2e
build:
	docker build --platform linux/amd64 -t shopping-list:local .
up:
	docker compose up -d --build --wait
down:
	docker compose down
logs:
	docker compose logs -f --tail=100
check: fmt-check lint vet vuln test service-test e2e build workflow-lint
release-test:
	$(TOOLS) run --rm frontend node --test /app/scripts/release.test.mjs
.PHONY: observe workflow-lint
observe:
	sh scripts/observe.sh
workflow-lint:
	docker run --rm --cpus 1 --memory 128m --memory-swap 128m -v "$(CURDIR):/repo:ro" -w /repo rhysd/actionlint:latest -no-color -ignore 'unexpected key "queue" for "concurrency" section' .github/workflows/checks.yml .github/workflows/release.yml
