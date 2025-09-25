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
5. **NBA stats**: Pull a three-season stack of regular-season totals from `nba_api`, keep a recency flag per season, and fuzzy match the latest campaign back to Yahoo players.
6. **Scoring**: `ironman.py` computes z-scores, blends durability/minutes/value/ADP, and ranks the result set.
7. **Output**: Save `ironmen_rankings.csv`; log HTTP activity in `adp_pipeline.log` for auditing.

## Iron-Man Score Methodology
- **Data prep**: Convert GP/MIN to numeric, fill gaps with zero, and derive `MPG = MIN / GP` so players with limited appearances don’t receive inflated playing-time credit.
- **Production profile**: Calculate z-scores for core counting stats (`PTS`, `REB`, `AST`, `STL`, `BLK`, `FG3M`) plus efficiency (`FG_PCT`, `FT_PCT`). Turnovers are multiplied by `-1` (`TOV_NEG`) before z-scoring so giveaways lower a player’s value. Missing or zero-variance columns fall back to zero-centered z-scores to keep the blend stable.
- **ValueZ**: Average the above z-scores, yielding a single production signal that rewards well-rounded players and punishes one-dimensional box-score contributors.
- **Availability & minutes**: Build a durability composite upstream by blending recency-weighted Games Played (60/30/10 over the last three seasons) with the multi-season median and subtracting a variance-driven penalty (`0.05 * variance`). The composite is z-scored into `DurabilityZ`, while `MPG` is still z-scored into `MinutesZ` to represent role security. When historical data is missing, the pipeline falls back to the most recent season’s GP so players without history don’t collapse the metric.
- **ADP context**: When Yahoo ADP exists, invert it (`ADP_INV = -ADP`) and z-score (`ADPz`). Subtracting `ADPz` from `ValueZ` creates a “value vs cost” lever that pushes up productive players who are still draftable at a discount; if ADP is missing, the lever is neutral.
- **Weighted blend**: `IronMan_Score = 0.45*DurabilityZ + 0.25*MinutesZ + 0.30*ValueZ + 0.15*(ValueZ - ADPz)`. In practice this tilts the score toward players who stay on the court (45%), maintain a rotation role (25%), deliver cumulative box-score value (30% base +15% when beating cost), and penalizes over-drafted names. NaNs are coerced to zero so absent data doesn’t tank the ranking.
- **Ranking**: Sort descending by `IronMan_Score` and assign dense ranks (`IronMan_Rank`). This keeps ties aligned and exposes the top durable/value hybrid targets.

## File Tree & Responsibilities
- `run_pipeline.py` – orchestrates the end-to-end flow (Yahoo discovery, ADP fetch, NBA merge, scoring, CSV export).
- `auth_init.py` – miniature Flask server to complete Yahoo OAuth and persist `oauth2.json`.
- `yfs.py` – Yahoo Fantasy service wrapper with retry logging for GET requests.
- `extract.py` – JSON parsers for Yahoo game/player/draft payloads, normalizing nested list structures.
- `nba_pull.py` – pulls multi-season regular-season totals (`LeagueDashPlayerStats`), tagging each row with `SEASON_ID` and the start year for recency-aware weights.
- `match.py` – fuzzy name matching (RapidFuzz + unidecode) linking Yahoo players to NBA stats rows.
- `ironman.py` – defines z-score helper and Iron-Man scoring algorithm, ingesting the durability composite while keeping NaN-safe weighting.
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
  - `name_full`, `team`, `pos`, `ADP`, `GP`, `MIN`, `Weighted_GP`, `GP_Median`, `Durability_Composite`, `Durability_Penalty`, `Seasons_Used`, `IronMan_Score`, `IronMan_Rank`, `DurabilityZ`, `MinutesZ`, `ValueZ`.

## Implementation Notes
- **Yahoo pagination**: 25 players per request; stop when the API returns zero items.
- **Draft analysis batching**: Call `/players;player_keys=.../draft_analysis` in groups of ≤20 keys to stay under URL limits.
- **Stat normalization**: `ironman.py` converts raw stats to z-scores and guards against zero-variance columns.
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
