# Yahoo NBA Iron-Man Pipeline – Agent Guide

## Purpose
- Build a ranked list of upcoming-season NBA players that balances durability and production.
- Blend Yahoo preseason ADP (including auction price) with last season’s NBA totals to produce an "Iron-Man" score.
- Output `ironmen_rankings.csv` so downstream tools can draft or analyze resilient players.

## High-Level Flow
1. **OAuth bootstrap**: Use Yahoo OAuth credentials to generate `oauth2.json` once via `auth_init.py`.
2. **Discover game context**: `run_pipeline.py` resolves the active Yahoo NBA game key at runtime.
3. **Player inventory**: Paginate `/game/{game_key}/players` to capture every player’s key, name, team, and positions.
4. **Draft analysis**: Batch `/players;player_keys=.../draft_analysis` requests (≤20 keys per call) to pull preseason ADP and auction averages.
5. **NBA stats**: Pull a three-season stack of regular-season totals from `nba_api`, derive per-game rates for the key box-score stats, keep a recency flag per season, and fuzzy match the latest campaign back to Yahoo players.
6. **Scoring**: `ironman.py` computes z-scores, blends durability/minutes/value/ADP, and ranks the result set.
7. **Output**: Save `ironmen_rankings.csv`; log HTTP activity in `adp_pipeline.log` for auditing.

## Iron-Man Score Methodology
- **Data prep**: Convert GP/MIN to numeric, fill gaps with zero, and derive `MPG = MIN / GP` so players with limited appearances don’t receive inflated playing-time credit.
- **Production profile**: Normalize per-game rates (`PTS_PG`, `REB_PG`, `AST_PG`, `STL_PG`, `BLK_PG`, `FG3M_PG`) alongside shooting efficiency (`FG_PCT`, `FT_PCT`). Turnovers are first converted to per-game (`TOV_PG`) and multiplied by `-1` so giveaways lower a player’s value. Missing or zero-variance columns fall back to zero-centered z-scores to keep the blend stable.
- **ValueZ**: Average the per-game z-scores and apply a sample-strength cap so players who failed to reach either 40 GP or 500 minutes have their production signal proportionally reduced. This keeps small-sample specialists from outkicking their availability-based peers.
- **Availability & minutes**: Build a durability composite upstream by blending recency-weighted Games Played (60/30/10 over the last three seasons) with the multi-season median and subtracting a variance-driven penalty (`0.05 * variance`). The composite is z-scored into `DurabilityZ`, while `MPG` is still z-scored into `MinutesZ` to represent role security. When historical data is missing, the pipeline falls back to the most recent season’s GP so players without history don’t collapse the metric.
- **ADP context**: When Yahoo ADP exists, invert it (`ADP_INV = -ADP`) and z-score (`ADPz`). Subtracting `ADPz` from `ValueZ` creates a “value vs cost” lever that pushes up productive players who are still draftable at a discount; if ADP is missing, the lever is neutral.
- **Weighted blend**: `IronMan_Score = 0.40*DurabilityZ + 0.20*MinutesZ + 0.30*ValueZ + 0.10*(ValueZ - ADPz)`. The lighter Minutes/ADP weights reflect the move to per-game production—durability still anchors the score (40%), ValueZ captures efficiency and skill independent of minutes (30%), and ADP remains a softer tiebreaker (10%). NaNs are coerced to zero so absent data doesn’t tank the ranking.
- **Ranking**: Sort descending by `IronMan_Score` and assign dense ranks (`IronMan_Rank`). This keeps ties aligned and exposes the top durable/value hybrid targets.

## File Tree & Responsibilities
- `run_pipeline.py` – orchestrates the end-to-end flow (Yahoo discovery, ADP fetch, NBA merge, scoring, CSV export).
- `auth_init.py` – miniature Flask server to complete Yahoo OAuth and persist `oauth2.json`.
- `yfs.py` – Yahoo Fantasy service wrapper with retry logging for GET requests.
- `extract.py` – JSON parsers for Yahoo game/player/draft payloads, normalizing nested list structures.
- `nba_pull.py` – pulls multi-season regular-season totals (`LeagueDashPlayerStats`), derives per-game columns, and tags each row with `SEASON_ID` plus the start year for recency-aware weights.
- `match.py` – fuzzy name matching (RapidFuzz + unidecode) linking Yahoo players to NBA stats rows.
- `ironman.py` – defines z-score helper and Iron-Man scoring algorithm, ingesting the durability composite while weighting per-game ValueZ and enforcing small-sample dampening.
- `run_pipeline.py` (again) – writes intermediate JSON snapshots (`payload_game_players_start_*.json`) for debugging.
- `Requirements.txt` – project requirements/spec document outlining desired behavior and security constraints.
- `adp_pipeline.log` – runtime log (HTTP errors, counts) created automatically by `yfs.py` logging config.
- `ironmen_rankings.csv` – pipeline output; regenerated per run.
- `venv/` – isolated Python environment (Windows-style, contains interpreter and packages).
- `oauth2.json` – Yahoo access/refresh tokens (generated post-auth; keep out of version control).

## Configuration & Secrets
- `.env` must define `YH_CLIENT_ID`, `YH_CLIENT_SECRET`, `YH_REDIRECT_URI` (see `Requirements.txt`).
- Register the redirect URI with Yahoo and expose it via ngrok when running `auth_init.py` for the first time.
- Never commit `.env`, `oauth2.json`, or raw ngrok domains.

## Running the Pipeline (after OAuth setup)
```bash
python run_pipeline.py
```
- Requires active internet access to Yahoo and NBA endpoints.
- Saves `payload_game_players_start_{N}.json` snapshots; remove if disk usage becomes an issue.
- `ironmen_rankings.csv` contains columns:
  - `name_full`, `IronMan_Rank`, `team`, `pos`, `ADP`, `GP`, `MIN`, `Weighted_GP`, `GP_Median`, `Durability_Composite`, `Durability_Penalty`, `Seasons_Used`, `IronMan_Score`, `DurabilityZ`, `MinutesZ`, `ValueZ`.

## Implementation Notes
- **Yahoo pagination**: 25 players per request; stop when the API returns zero items.
- **Draft analysis batching**: Call `/players;player_keys=.../draft_analysis` in groups of ≤20 keys to stay under URL limits.
- **Stat normalization**: `ironman.py` now z-scores per-game rates (with automatic fallback generation) and scales ValueZ by sample size to rein in tiny workloads.
- **Multi-season durability**: `run_pipeline.py` controls recency via `DEFAULT_SEASON`, `RECENT_SEASON_COUNT`, and `AVAILABILITY_WEIGHTS`; update these when advancing to a new schedule or experimenting with different blends.
- **Logging**: Non-2xx responses trigger `ApiError` with truncated body logged to `adp_pipeline.log`.
- **Error tolerance**: Extractors catch parse errors, log, and continue so a malformed player record doesn’t abort the run.

## Troubleshooting
- **401 from Yahoo**: Refresh token may be expired; rerun `auth_init.py` or build a refresh-token handler (not yet implemented).
- **NaN/Infs in scoring**: `ironman.py` now coerces numeric fields and fills missing values; if issues persist, inspect NBA stats for missing columns.
- **Name mismatches**: Update `OVERRIDES` in `match.py` for edge cases (e.g., Jr./Sr., translations).
- **Rate limits**: Tenacity retries in `yfs.py` back off exponentially on 429/5xx responses up to five attempts.

## Next-Agent Handoff
- Confirm the `DEFAULT_SEASON` constant in `nba_pull.py` (and adjust `RECENT_SEASON_COUNT` if desired) before each preseason so the rolling three-year window stays fresh.
- Consider pruning or rotating `payload_game_players_start_*.json` to avoid growth during repeated runs.
- Future enhancements might add a refresh-token flow, richer logging/metrics, or alternative scoring weights based on user feedback.
