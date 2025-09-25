# Future Enhancements – Yahoo Iron-Man Pipeline

This backlog captures the next wave of improvements. Each item outlines the motivation, success criteria, and suggested implementation steps so the next agent can execute with minimal guesswork.

---

## Feature 1 – Multi-Season Availability Weighting (Completed)

Shipped March 2025. Key outcomes:
- `nba_pull.py` now stacks three regular seasons by default, attaching `SEASON_ID` and a start-year helper for downstream sorting.
- `run_pipeline.py` builds a 60/30/10 recency blend, renormalizes when seasons are missing, and records weighted/median GP plus the applied variance penalty.
- `ironman.py` z-scores the durability composite (70% weighted GP + 30% median GP − 0.05·variance) so volatility directly reduces availability credit.
- `ironmen_rankings.csv` exposes the new durability columns, and the workflow is documented in `AGENT_GUIDE.md` under "Availability & minutes" and "Multi-season durability".

No further action required unless the weighting philosophy changes.

---

## Feature 2 – Per-Game Value Recalibration (Priority)

**Goal**: Ensure ValueZ captures per-minute/per-game skill rather than re-counting minutes already captured in durability metrics.

**Why**
- The current pipeline uses totals, so players with heavy minutes get rewarded twice (through raw stats and MinutesZ).
- Switching ValueZ to per-game averages isolates efficiency/production, leaving DurabilityZ/MinutesZ to model availability.

**Requirements**
1. Create per-game columns (PTS/G, REB/G, AST/G, etc.) from the multi-season dataset.
2. Compute z-scores on per-game stats only for ValueZ.
3. Keep turnover as a negative contribution by multiplying by -1 before z-score.
4. Reassess weighting between DurabilityZ, MinutesZ, ValueZ, and ADP once the scale shifts; document chosen weights.
5. If, after experimentation, per-game ValueZ degrades rankings (e.g., favors low-minute specialists too heavily), capture the rationale and keep totals instead. That rationale must be added to `AGENT_GUIDE.md`.

**Implementation Notes**
- Consider minimum minutes/games filters so per-game rankings aren’t dominated by tiny sample sizes (e.g., require ≥500 minutes or ≥40 GP to be scored, or cap their ValueZ impact).
- Optionally blend per-game and totals (e.g., 70% per-game + 30% totals) if that produces more intuitive results; validate on historical injury data.

---

## Feature 3 – "Good Iron-Man" Composite Score & Extended Stats (Priority)

**Goal**: Add a secondary ranking that highlights players who are both durable and high-impact across key fantasy categories.

**Why**
- The current Iron-Man score prioritizes availability; decision-makers may also want reassurance that the durable players carry strong production.
- Surfacing core fantasy categories (PTS, REB, AST, 3PM, 3P%, BLK, STL, TOV, double-doubles) helps downstream consumers act without inspecting external data.

**Requirements**
1. Pull or compute per-game and multi-season averages for the following categories (use same multi-season dataset from Feature 1):
   - Points, rebounds, assists, steals, blocks, made threes, three-point percentage, free-throw percentage, turnovers, double-doubles.
   - For double-doubles, use NBA stats endpoints that expose advanced splits or compute heuristically (count games with ≥10 in two categories).
   - Hight Turnovers should count as negative as lower is better
2. Normalize each stat to z-scores (ensure turnovers remain negative) using multi-season averages.
3. Construct a "Good Iron-Man Score" (`GI_Score`) combining:
   - Iron-Man availability score (possibly the output from Feature 1).
   - Offensive/defensive production weights (e.g., 40% durability, 40% production, 20% efficiency; adjust after testing).
   - Document the formula and reasoning within `ironman.py` and `AGENT_GUIDE.md`.
4. Add new columns to the output CSV:
   - Raw per-game stats for each category above.
   - `Good_IronMan_Score` and `Good_IronMan_Rank`.
   - Keep existing `IronMan_Score`/`IronMan_Rank` for backward compatibility.
5. Update downstream documentation and any consumers to explain the difference between pure Iron-Man and Good Iron-Man rankings.

**Implementation Notes**
- Review NBA API rate limits; gathering double-double counts may require game logs.
- If a full double-double count proves too heavy, approximate using season totals (e.g., track how many categories average near 10+) or mark as stretch goal.
- Provide sample players illustrating how rankings shift with the new composite metric to validate usefulness.

---

## Feature 4 – Positional Context & Tiering

**Goal**: Help drafters understand positional scarcity and balance rosters while leveraging Iron-Man metrics.

**Why**
- Current rankings are position-agnostic, so managers still need to mentally adjust for thinner positions (e.g., C vs. SG depth).
- Tiering by position can surface where durability/value peaks or drops off, guiding pick timing.

**Requirements**
1. After computing scores, group players by Yahoo position eligibility (`pos` column) and create positional tiers (e.g., top 12 PG, next 12, etc.).
2. Add `Position_Tier` and `Scarcity_Flag` columns to the CSV (e.g., "PG Tier 1", "Scarce" if tier depth < league starters).
3. Optionally derive scarcity scoring by comparing average Iron-Man scores per position to league average.
4. Update documentation so downstream agents know how the tiers are built and how to adjust thresholds for different league formats.

**Implementation Notes**
- Support multi-position players by assigning them to multiple tiers or choosing primary position based on minutes played.
- Allow config for league size (e.g., 10/12/14 teams) to adjust tier breakpoints.

---

## Feature 5 – ADP Freshness & Alerting

**Goal**: Keep preseason ADP data aligned with current Yahoo draft trends.

**Why**
- ADP updates quickly as news breaks; stale data undermines draft-day decisions.

**Requirements**
1. Track the retrieval timestamp for each draft-analysis pull (store in output or metadata file).
2. Surface a `ADP_Last_Updated` column and optionally flag rows older than a configurable threshold (e.g., 7 days).
3. Provide a lightweight CLI command or script (`python run_pipeline.py --refresh-adp-only`) to refresh ADP without re-pulling NBA stats.
4. Document recommended refresh cadence (e.g., weekly until preseason, daily during peak draft week).

**Implementation Notes**
- If Yahoo throttles frequent calls, add caching and only refresh players whose ADP changed beyond a tolerance.
- Consider optional notification hook (email/Slack) if ADP freshness exceeds the threshold.

---

## Feature 6 – Risk & Variance Tagging

**Goal**: Give managers quick insight into injury/volatility risk.

**Why**
- Even with multi-season durability weighting, users benefit from explicit risk labels.

**Requirements**
1. Convert the variance penalty from Feature 1 into categorical labels (e.g., Low/Medium/High risk) and add a `Durability_Risk` column.
2. Introduce configurable thresholds for what constitutes high variance.
3. Optionally integrate qualitative flags (e.g., redshirt season, age >33) if data is accessible.

**Implementation Notes**
- Keep labels simple so they can be read at draft speed.
- Document thresholds and allow overrides (e.g., via config file or CLI flag).

---

## Feature 7 – Role/Usage Change Tracking (Stretch)

**Goal**: Highlight players whose situation has materially changed (team, coach, role) so Iron-Man projections can be adjusted.

**Why**
- Availability and production often shift with new roles; flagging these cases prevents blind reliance on historical averages.

**Requirements**
1. Detect team changes between seasons (compare `TEAM_ABBREVIATION` year-over-year) and flag moves.
2. Pull usage-rate and advanced role metrics via `LeagueDashPlayerStats` with `measure_type="Advanced"` and compute deltas (USG%, pace, possessions) across seasons.
3. Capture current-team metadata with `CommonPlayerInfo` (or `player_profile_v2`) and compare against historical totals to confirm moves.
4. Add qualitative notes column (e.g., `Context_Notes`) summarizing detected changes, including coaching turnover from `TeamCoaches`.
5. Maintain an optional overrides sheet (CSV/JSON) for projected minutes or qualitative insights sourced from beat reports/Rotowire when automated data isn’t available.

**Implementation Notes**
- This feature can be iterative: start with simple team-change flags, then expand to deeper usage analytics as time allows.
- Place at the end of the roadmap; it depends on multi-season data and is more data-intensive.
- Consider caching advanced endpoint responses to stay under NBA API rate limits.
- Document external manual sources (depth charts, news feeds) in `AGENT_GUIDE.md` once the override workflow is in place.

---

## Shared Deliverables
- Update `AGENT_GUIDE.md` after implementing each feature to reflect new data sources, formulas, and configuration knobs.
- Consider adding regression tests or snapshot comparisons of top-10 rankings before/after changes to ensure stability.
- Communicate any new secrets (e.g., additional API keys) or cron requirements in the guide.
