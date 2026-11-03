# Shared UI navigation implementation plan

**Goal:** Replace Together's navigation with published `@tendstead/ui@0.1.0`.

**Design:** Use AppShell with History, Shopping list, and Edit as desktop and mobile destinations. Keep the language selector in page actions and retain the existing shopping content and saved preferences. Add optional tab routes so ordinary, modified, and Back/Forward navigation all have valid URLs. Import the package theme explicitly and remove the old fixed navigation styles.

**Approach:** Consume the npm package rather than copying components or depending on the sibling checkout. Keep changes scoped to this app. Submit the completed integration on a feature branch for review; publishing and deployment remain separate.

- [x] Install the pinned published package and inspect its exported API.
- [x] Adapt browser scenarios to navigation links; cover active state, desktop/mobile layout, drawer, language switching, and Back/Forward.
- [x] Integrate AppShell and valid tab routes, preserving tab preferences and scroll restoration.
- [x] Run formatting, frontend checks, browser scenarios, and `make check`; review the resulting diff and screenshots.

Verification note: `make check` passes formatting, lint, types, and vet, then stops on the pre-existing Go 1.26.9 standard-library advisory GO-2026-6809 (fixed in 1.26.10). Remaining checks are run separately.

Results: frontend lint/types and Go lint/vet pass; 14 frontend unit tests, 6 release tests, Go race tests, database service tests, and all 38 Chromium/WebKit scenarios pass. Production image build and workflow validation pass. Frontend audit passes the configured high-severity threshold (existing low/moderate advisories remain). Screenshots are written to `web/test-results/navigation-{desktop,mobile}.png`.

Follow-up: mobile navigation uses app-supplied outline icons and visually hidden accessible labels; desktop and drawer labels remain visible. No icon dependency is required. Browser assertions cover icon visibility, accessible names, and preservation of desktop/drawer labels.

Branding follow-up: use Shopping List as the product name, with Tendstead as the smaller organization subtitle beneath it in the sidebar and page header. Browser/PWA title: Shopping List - Tendstead. Product naming stays consistent in both languages; destination labels remain translated.
