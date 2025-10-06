# Table UI Phase 5 Validation

## Scope
- Surface missing ADP values as `N/A` instead of misleading zeroes across table and card layouts.
- Ensure sorting keeps rows with missing numeric data at the end for both ascending and descending directions.
- Add DOM fallbacks so the filter multi-selects populate correctly in older WebKit builds that lack `replaceChildren`.

## Data Checks
- Verified the CSV contains 309 rows without ADP data using:
  - `python - <<'PY'` (with `encoding='utf-8-sig'`) to count empty `ADP` cells.
- Confirmed no other numeric columns ship blank values, preventing unintended `NaN` renders in detail drawers.

## Manual QA Checklist
- Serve locally from repo root: `python -m http.server 8000` then open `/table%20ui/index.html`.
- Desktop browsers (Chrome/Edge/Firefox/Safari):
  - Toggle sort on `ADP` (asc/desc) and confirm players with `N/A` stay at the bottom.
  - Delete and undo a player after sorting; rows should maintain ordering and updated ranks.
  - Adjust filters and confirm summary chips update while tooltips remain positioned.
- Mobile or device emulation:
  - Open filter drawer via `Filters` button, apply team/position filters, then close with overlay tap and `Esc` key.
  - Use the mobile sort select to switch to `ADP` and flip direction; card list should reflect `N/A` placeholders.

## Outstanding Follow-Ups
- Run full accessibility sweep (focus order, screen reader labels) once copy tweaks land.
- Capture screenshots for documentation after stakeholders sign off on the validation pass.
