# Tendstead shopping list implementation plan

**Goal**  
Make a long spice list easy to shop in one stop, then add optional local LLM sorting along a saved supermarket route.

**Architecture**  
The shopping list owns categories, layout order, and corrections. Phase 1 renders a collapsible spice section using existing item controls. Phase 2 extends existing layouts with an ordered route and uses the established Vision Bill integration to suggest categories for unknown products.

**Stack**  
Go, PostgreSQL, Svelte 5 and TypeScript in Shopping List. Vision Bill uses FastAPI and supports local Ollama inference.

## Before implementing

- [ ] In the Codex CLI, open `tendstead/shopping-list` and read its current `AGENTS.md`, `docs/api.md`, and any existing work on this feature. Locate item and layout types in `internal/domain/`, persistence in `internal/store/`, endpoints in `internal/httpapi/`, and shopping mode, Arrange, and IndexedDB sync in `web/src/`. Browser acceptance tests live under `web/tests/`. These are verified module locations. Resolve the exact files in the checkout.
- [ ] For Phase 2, locate the existing Vision Bill connection plan or implementation from the other Codex session. Use its actual contract and access rules. Initial connection setup is outside this plan. Store routes and manual sorting can proceed independently if the model interface is pending.
- [ ] Keep each phase independently shippable. Use the existing operation IDs, revision checks, sync and conflict behavior for shared edits. Preserve immutable finished-trip snapshots. Add numbered migrations if the data change requires them.

References: [Shopping List guide](https://github.com/tendstead/shopping-list/blob/main/AGENTS.md), [sync API](https://github.com/tendstead/shopping-list/blob/main/docs/api.md), [Vision Bill guide](https://github.com/tendstead/vision-bill/blob/main/AGENTS.md).

## Phase 1 — Collapsible Gewürze section

### 1. Give items an explicit spice assignment

- [ ] Add an optional category to the existing item representation, with a stable `spices` ID and an unassigned default for existing data. Reuse an equivalent field if the checkout already has one. Extend the existing checklist Edit flow to assign or clear Gewürze. Support explicit assignment for one-time additions through the existing add flow where applicable, with the default still unassigned.
- [ ] Carry the field through the current item write and state snapshot paths. Where category is editable on a shared item, use the existing base/value conflict rules so category changes compose with unrelated edits. Older snapshots and queued additions that omit the field must still load and replay.
- [ ] Test reading old snapshots, saving and clearing the assignment, and syncing the change to another phone.

### 2. Render a single shelf stop

- [ ] In shopping mode, render one collapsed-by-default section at the position of the first active spice in the selected layout. Preserve the relative order of spice rows within it and the relative order of other rows. Hide the section when there are no remaining spices. Use localized Gewürze / Spices and a remaining-item count, such as **Gewürze · 3 offen**.
- [ ] Use an accessible expand/collapse button and keep its state on the device. Render the existing item rows inside the section so quantities, person tags and purchase actions work as before. Keep purchased spices in **In cart**, where they can be unchecked. The header controls visibility only.
- [ ] Test with Kreuzkümmel, Paprikapulver and Zimt. Check one and verify the remaining count goes from 3 to 2, and the checked row appears in **In cart**. Check the rest and verify the section disappears. Uncheck one and verify it returns. Cover a purchase queued offline, sync on reconnect, and an unfinished spice carrying over after Finish.

**Phase 1 done when** the shopper sees one spice stop, can check individual products, and can use the feature without any model or Vision Bill dependency.

## Phase 2 — Store routes and local LLM sorting via Vision Bill

### 3. Extend the existing named layouts

- [ ] In Arrange, let users enable sections for a layout, order the sections, and move products between them. Use stable category IDs with localized labels. Reuse `spices` from Phase 1. A branch can have its own named layout. Example route: Gemüse → Brot → Reis & Nudeln → Gewürze → Tiefkühl → Drogerie.
- [ ] Store the route and any per-layout product overrides in the existing shared layout state. Resolve each item by layout override, then saved product category, then **Nicht zugeordnet** if it has no category in that route. Retain existing manual item order within each section, skip empty sections, and place unassigned items last in their existing order. Keep layouts without sections on their current ordering behavior with Phase 1 grouping.
- [ ] Make route and assignment data available in the cached state so a phone can switch among saved layouts and shop offline. Test two layouts with different section order, a shelf exception for Zimt, an uncategorized one-time item, and an existing flat layout. Verify old queued `layout_order` operations and shared conflict handling still work.

### 4. Add the initial sorting pass and support later sorting

- [ ] Add **Suggest sections** in Arrange. For the initial pass, include uncategorized reusable checklist items even when they are outside the active trip. For later runs, include newly added or still-unassigned items in the selected scope. Use saved assignments first. Trigger the model from this action initially so reopening the list and checking off products use saved data only.
- [ ] Through the established Vision Bill integration, request local classification in bounded batches. Supply item IDs and names and the allowed category IDs with labels. Accept item ID plus a category ID or an explicit unknown result. Validate returned IDs and category values. Treat missing, ambiguous or invalid results as unresolved. Send shopping product names only for this operation. Reuse authorized Vision Bill product hints if the existing connection provides them.
- [ ] Preview suggestions in store order. Let users edit or dismiss individual suggestions before saving. Preserve explicit user assignments and branch overrides. Persist approved suggestions through existing revision-aware writes. If the underlying item or category changes while the preview is open, refresh or surface a conflict before applying the stale suggestion. Keep the selected layout's route order independent of model output.
- [ ] Keep manual sorting available if Vision Bill or the model is offline, slow, or returns an error. Preserve unresolved products under **Nicht zugeordnet**. Allow retrying unresolved items without overwriting approved assignments.
- [ ] Test with a stubbed integration: classify Paprikapulver as Gewürze, leave ambiguous Paprika unresolved, reject an invented category and unknown item ID, and retain a correction on a second run. Verify timeout and partial response handling, a concurrent edit during preview, and unchanged quantities and purchased state when applying suggestions. After the integration is available, smoke-test a mixed German list against the local model.

**Phase 2 done when** you can set up a route once, preview and apply a first sort of the reusable checklist, re-sort new items later, and use the resulting order on both phones without live inference during the trip.

## Verification and handoff

- [ ] Run `make test`, `make service-test` for persistence or API changes, and `make e2e` for mobile and offline behavior. Run `make check` before submitting each phase.
- [ ] Exercise a two-phone trip with an offline purchase and reconnect. Confirm Finish still produces an immutable history snapshot and leaves unfinished items available for the next trip.
- [ ] Review these proposed defaults before changing them: explicit spice assignment in Phase 1, section placement at the first active spice, and a user-triggered preview in Phase 2. The Vision Bill connection contract is intentionally delegated to the existing integration work.
