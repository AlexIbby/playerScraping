# Ironman Rankings Table UI Plan

## Goal & Scope
- Deliver a responsive single-page experience that visualizes `ironmen_rankings.csv` with sortable rankings, detailed stat views, inline filters, and player removal.
- Maintain feature parity across desktop and mobile while tailoring layout to each form factor.
- Keep all transformations (sorting, filtering, deletions, re-ranking) client-side against the CSV payload without mutating the source file.
- Present a plain-language summary within the HTML so users know what the table highlights and how to use it.


## Current Status
- Desktop table experience is functional with live CSV load, filtering, column sorting, tier highlighting, per-row deletion, and undo.
- Summary bar reflects active filters/sort order through chips and exposes undo/reset controls.
- Expandable detail drawer surfaces deeper metrics (z-scores, availability, per-game stats) per player; data normalization ensures numeric comparisons.
- Mobile breakpoint now ships with a card view, off-canvas filter drawer, and touch-friendly sort controls that mirror desktop behaviour.

## Completed Work
- HTML scaffold in `index.html` with header intro, filter sidebar, summary region, table shell, tooltip container, and PapaParse CDN link.
- Base styling in `styles.css` covering layout grid, sticky header table, tooltip theme, and responsive breakpoints (desktop-first).
- JavaScript in `app.js` handling CSV load, normalization (including MPG), search/filters, sorting, deletion, undo stack, summary updates, tier highlighting, and tooltip positioning.
- Detail drawer implementation exposing ranking, score components, availability, and per-game groupings; expansion state is tracked client-side.
- Mobile experience covering a responsive card layout, off-canvas/slideover filters, overlay dismissal, and synced sort controls.
- `requirements.txt` generated from the venv and annotated to flag the PapaParse CDN dependency.

- [x] Phase 1 scaffold (HTML shell, responsive layout starter, tooltip infrastructure).
- [x] Phase 2 data layer (PapaParse wiring, state refinement, undo control).
- [x] Phase 3 interactions (sorting/filter polish, deletion undo, rank toggle styling, tier highlighting, detail drawer).
- [x] Phase 4 responsive polish (mobile cards, off-canvas filters, mobile sort/reset control pass).
- [x] Phase 5 validation (cross-browser checks, content QA).

## Recent Implementation Notes
- Added summary chips (`app.js`, `styles.css`) that render rank basis, sort state, search query, team/position selections, and minimum GP filters; chips update in real time.
- Introduced undo stack and controls (`Undo Delete`) alongside reset, wired to the summary region.
- Row rendering now layers tier classes/badges and injects an expandable detail row containing key metrics grouped for at-a-glance review.
- Expanded state persists while filters change (unless the player leaves the visible set), and expands are tied to accessible `aria-expanded`/`aria-controls` attributes.
- Numeric parsing centralised via `NUMERIC_FIELDS`, ensuring comparisons/sorting operate on numbers and default gracefully.
- Styling additions cover action button layout, detail card grid, chip styling, and hover feedback for destructive actions.
- PapaParse CDN script now carries the verified SHA-384 hash so browsers with SRI enforcement load it correctly; the mismatch previously blocked parsing and raised `Papa is not defined`.
- Header sanitiser strips the UTF-8 BOM emitted with the CSV so `name_full` resolves properly and filter options populate.
- Validation pass hardens ADP handling (`N/A` placeholders, stable sort for missing values) and adds legacy `replaceChildren` fallbacks; see `table ui/QA_REPORT.md` for the checklist.

## File Overview (table ui/)
```
table ui/
├── index.html        # Single-page shell with filters, summary bar, table, tooltip, and data loading scripts
├── styles.css        # Desktop-first layout, summary chips, tier styling, detail drawer grid, responsive tweaks
└── app.js            # Client-side state (filters, sorting, undo, expand), CSV ingestion, rendering, tooltip logic
```

## Next Steps for Handoff
- [x] Simplify contextual help: replaced the brittle tooltip implementation with a lighter global tooltip overlay that reads from `data-tooltip`, carries console logging for header hovers, and ships with refreshed styling for consistent desktop/mobile presentation.
- [x] UX copy + affordance polish: clarified cue delivery through enriched tooltips; inline copy pass still pending but deferred to dedicated copy task.
- [ ] Touch-friendly info: after simplifying the tooltip approach above, double-check mobile/touch flows—information should be discoverable without hover, ideally via always-on helper text or tap targets that rely on native browser focus/press behaviour rather than custom positioning.
- [ ] Documentation: propagate run instructions from `QA_REPORT.md` into README once copy polish lands.
- [ ] Persistence follow-up: evaluate storing filter/rank basis selections via `localStorage` once the UX copy changes land and QA signs off.
- [ ] Accessibility follow-up: full keyboard navigation audit (drawer toggles, detail buttons), focus styling, and assistive technology smoke tests across Chrome, Firefox, Safari, and Edge.

## Data Model Assumptions
- Source: `ironmen_rankings.csv` in repo root; columns include `name_full`, `IronMan_Rank`, `Good_IronMan_Rank`, `team`, `pos`, `ADP`, scoring components (`IronMan_Score`, `Good_IronMan_Score`, `DurabilityZ`, `ProductionZ`, `EfficiencyZ`, `MinutesZ`, `ValueZ`), availability stats (`GP`, `Minutes`, `Weighted_GP`, `GP_Median`, `Durability_Composite`, `Durability_Penalty`, `Seasons_Used`), and per-game box score rates.
- CSV rows contain quoted fields with embedded commas (e.g., `"SF,PF"`), so parsing must respect quotes and numeric coercion.
- All numeric columns should be parsed as numbers for accurate comparisons and charting; fallback to `null` for blanks.
- Minutes values represent season totals; compute `MPG` from `MIN / GP` for display consistency with the pipeline.
- CSV currently includes a UTF-8 BOM; anything reading it must remove the marker before trimming headers or the leading column name will break downstream filters/search.

## User Workflows
- **Desktop analyst**: scan complete table, compare durability vs production, sort by any metric, and trim players (e.g., already drafted by others) while watching rankings update.
- **Mobile drafter**: quickly view key info (name, team, positions, Iron-Man rank, select stats), apply quick filters (team, position, show only top N), and remove players on the go.
- **Shared need**: delete a player from the current view and immediately see recalculated ranking numbers and percentile cues.

## Feature Requirements

### Shared Interactions
- Global search by player name (case-insensitive substring match).
- Multi-select filters for team and position, numeric slider/filter for minimum games played, toggle to choose ranking basis (`IronMan` vs `Good IronMan`).
- Column-based sorting: primary click toggles ascending/descending; visual indicator in header; sorted column dictates display rank.
- Automatic re-ranking: whenever the visible dataset changes (filter, sort, delete), recompute a `displayRank` (1..N) column and update the rank shown.
- Player removal: `Delete` control per row/card removes the player from current dataset; maintain an undo stack per session to restore last removed player.
- Provide contextual guidance for filters, columns, and critical actions using simple, accessible patterns (shared tooltip overlay, inline helper copy, or always-visible info icons). Avoid bespoke hover-only solutions that fail on touch devices.
- Session state resets on reload to support quick testing; persistence can be revisited later.

### Desktop Layout
- Two-column layout: left sidebar (filters, search, quick actions) and main content (data grid).
- Sticky table header with horizontal scroll for overflow columns; freeze first column (player info) and rank column.
- Expandable row drawer or modal for extended stat detail (advanced z-scores, season list) when the user clicks a row.
- Highlight top tiers via row shading or badges (e.g., top 12, 25, 50) based on current `displayRank`.
- Summary strip above table: counts (visible players, removed players), current sort & filter chips, quick reset.

### Mobile Layout
- Collapse filters into a slide-over panel triggered by a filter button.
- Present players as vertically stacked cards: headline includes rank, name, team, position; body shows key stats (IronMan score, Good IronMan rank, GP, Minutes, ADP) with toggle for "more stats" accordion.
- Floating action buttons for sort toggle and reset; ensure 44px tap targets for delete and expand.
- Table-to-card switch controlled by CSS breakpoints (e.g., <= 768px) with shared markup where feasible.

## Technical Approach

### File Structure (within `table ui/`)
- `index.html` – static shell with layout regions, filter controls, and references to CSS/JS.
- `styles.css` – responsive styling, utility classes, and CSS custom properties for theme consistency.
- `app.js` – data fetch/parsing, state management, rendering logic, event binding, responsive behavior helpers.
- (Optional) `assets/` for icons or SVGs; avoid heavy dependencies.

### Data Loading & Parsing
- Use `fetch('../ironmen_rankings.csv')` from the HTML page; note requirement to serve files via a lightweight static server locally (`python -m http.server`) to avoid CORS issues.
- Parse CSV with PapaParse (loaded via CDN `<script>` tag) to handle quoted commas reliably; capture this dependency in `requirements.txt` for visibility.
- Normalize records into objects with:
  - `raw`: original values for potential export/reset.
  - `display`: derived fields (formatted percentages, minutes as hours/mins) for UI.
- Pre-compute numeric conversions and store metadata (`isNumeric`, `label`, `tooltip`, plain-language descriptions) per column for consistent rendering and tooltips.

### State Management
- Central `state` object holding: `players` (full dataset), `visiblePlayers`, `filters`, `sort` (`{ key, direction }`), `rankBasis` (`ironman` | `goodIronman`), `removedStack`.
- Derive `visiblePlayers` through pure functions applied in order: filter → delete → sort → rank.
- Recalculate `displayRank` inside the ranking step; update both `IronMan_Rank` or `Good_IronMan_Rank` display badges to reflect the chosen basis.
- Keep state in memory only for now to guarantee a clean slate on refresh; capture persistence as a backlog enhancement.

### Rendering Strategy
- Use template literals to generate table rows/cards; update DOM via `innerHTML` diffing per render cycle (dataset is small, ~400 rows, so full re-render acceptable).
- Debounce search input (150ms) to prevent excessive re-renders.
- Provide accessible ARIA roles: `role="table"`, `aria-sort` on headers, `aria-live` region for rank updates, keyboard support for sorting and deletion.
- Lazy-load detailed sections (e.g., collapsible advanced stats) to keep initial render light.

### CSS & Responsiveness
- Base layout with CSS Grid/Flexbox; breakpoints at 768px (tablet) and 1024px (desktop enhancements).
- Minutes badge reflects derived `MPG` to align with pipeline scoring context.
- Utilize CSS variables for colors/spacings; support dark mode via prefers-color-scheme media query.
- Style interactive states (hover/focus) for accessibility; ensure contrast ratio >= 4.5:1.
- Hide less critical columns on narrower widths while keeping access via expandable details.

### Deletion & Re-Ranking Mechanics
- Delete button triggers removal by unique key (player name + team) from active dataset; push removed item onto stack for undo.
- Undo control restores most recently deleted player and re-runs ranking.
- Re-ranking logic:
  1. Determine primary metric (`IronMan_Score` or `Good_IronMan_Score`) based on toggle.
  2. Apply current sort column/direction to visible set.
  3. Assign `displayRank = index + 1` post-sort.
  4. Reflect `displayRank` in UI rank badge and use for tier highlights.

### Additional Enhancements (Optional, backlog)
- Export current view to CSV/JSON.
- Inline sparkline showing durability vs production.
- Bookmark players to separate watchlist panel.
- Reintroduce persistent filters/deletions via `localStorage` once QA approves.
- Integrate lightweight chart for select metrics using a minimal library (e.g., Chart.js) if future requirements demand.

## Implementation Phases
1. **Scaffold** (done): Create file structure, HTML skeleton, filter placeholders, sample static table row. Initial tooltip targets and summary copy in place.
2. **Data Layer**: Implement CSV fetch/parse, data normalization, and initial render with static sorting.
3. **Interactions**: Add filtering, sorting, rank toggle, re-ranking, delete + undo; log future persistence work as backlog.
4. **Responsive UI**: Build desktop grid styling, mobile cards, off-canvas filters, accessibility polish.
5. **Validation**: Test across modern browsers (Chrome, Firefox, Safari, Edge), verify with sample data subsets, ensure no console errors, bundle instructions for serving locally.

## Assumptions & Decisions
- Sorting on numeric columns uses numeric comparison; textual columns use localeCompare.
- Re-ranking updates only on the client; original CSV remains untouched.
- `MIN` represents season totals from the pipeline; derive and display `MPG = MIN / GP` alongside totals.
- Default view shows Good Iron-Man rankings; toggle switches the primary ranking/ordering while still exposing the alternate rank in the detail view.
- Deletions reset on page reload (no localStorage persistence for now); persistence can return as a backlog enhancement.
- Use PapaParse via CDN for CSV parsing and document the dependency in `requirements.txt` so the runtime setup stays transparent.


## Next Steps
1. Context cues: finalize column tooltips/info icons, GP/MPG labelling, rank-basis explanation, and refresh the score column language to match product copy.
2. Touch optimisations: ensure tooltip content is reachable on mobile/touch, introducing tap-friendly info icons or inline helper text.
3. Documentation: capture run/reset instructions and mobile drawer guidance in README or this plan.
4. Persistence follow-up: explore `localStorage` for filters/rank basis once UX polish is approved.
5. Accessibility/testing: verify ARIA roles, contrast, and full keyboard workflow (drawer open/close, card toggles), then smoke-test in Chrome, Firefox, Safari, and Edge.

## Deliverables
- `table ui/index.html`, `table ui/styles.css`, `table ui/app.js` implementing the plan above, including an introductory paragraph explaining the table’s purpose and interactions in plain language.
- Update `requirements.txt` (or create if missing) to mention the PapaParse CDN inclusion and any local testing prerequisites.
- README snippet or comment block describing how to run (`python -m http.server`) and how to reset stored state.
- Optional screenshot mockups or wireframes (if time allows) to communicate layout decisions before building.

## Pipeline Context (`ironman.py`)
- Rankings originate from `ironman.py`, which normalises raw stats, derives per-game fallbacks, and computes z-scores for durability, minutes, production, efficiency, and value metrics.
- `IronMan_Score` weights durability (40%), minutes (20%), value (30%), and value-versus-ADP (10%); `Good_IronMan_Score` uses a 40/40/20 mix across durability, production, and efficiency, with ranks generated from each score.
- Sample-strength factors down-weight small workloads (thresholds: 40 games, 500 minutes) before averaging value components so sporadic appearances do not inflate ranks.
- The pipeline emits `MPG`, durability composites, per-game rates, and z-score components—treat the CSV as authoritative and avoid recomputing these values client-side.
