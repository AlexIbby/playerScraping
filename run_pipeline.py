import json
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import pandas as pd

from extract import draft_analysis, game_key, players
from ironman import compute
from match import match
from nba_pull import DEFAULT_SEASON, pull_totals
from yfs import get, log
RECENT_SEASON_COUNT = 3
AVAILABILITY_WEIGHTS = (0.60, 0.30, 0.10)
DURABILITY_PENALTY_FACTOR = 0.05


def recent_seasons(latest: str, count: int = RECENT_SEASON_COUNT) -> list[str]:
    start_year = int(latest[:4])
    seasons = []
    for offset in range(count):
        year = start_year - offset
        seasons.append(f"{year}-{(year + 1) % 100:02d}")
    return seasons


def build_availability_metrics(
    nba_df: pd.DataFrame,
    weights: Sequence[float] = AVAILABILITY_WEIGHTS,
    penalty_factor: float = DURABILITY_PENALTY_FACTOR,
) -> pd.DataFrame:
    if nba_df.empty:
        return pd.DataFrame(
            columns=
            [
                "PLAYER_ID",
                "Weighted_GP",
                "GP_Median",
                "GP_Variance",
                "Durability_Composite",
                "Durability_Penalty",
                "Seasons_Weighted",
                "Seasons_Total",
            ]
        )

    records = []
    base_weights = np.asarray(weights, dtype=float)
    if base_weights.ndim != 1 or base_weights.size == 0:
        raise ValueError("weights must be a non-empty 1D sequence")

    for player_id, group in nba_df.groupby("PLAYER_ID"):
        ordered = group.sort_values(
            ["SEASON_START_YEAR", "SEASON_ID"], ascending=[False, False], na_position="last"
        )
        gp_all = pd.to_numeric(ordered["GP"], errors="coerce").fillna(0.0)
        if gp_all.empty:
            total_seasons = 0
            median_gp = 0.0
            variance_gp = 0.0
        else:
            total_seasons = int(gp_all.count())
            median_gp = float(gp_all.median())
            variance_gp = float(gp_all.var(ddof=0))

        considered = ordered.head(base_weights.size)
        gp_considered = pd.to_numeric(considered["GP"], errors="coerce").fillna(0.0).to_numpy()
        seasons_used = considered["SEASON_ID"].tolist()
        weights_used = base_weights[: gp_considered.size]
        if weights_used.size == 0:
            weighted_gp = 0.0
            seasons_weighted = 0
        else:
            weight_sum = weights_used.sum()
            if weight_sum == 0:
                weights_norm = np.full_like(weights_used, 1 / weights_used.size)
            else:
                weights_norm = weights_used / weight_sum
            weighted_gp = float(np.dot(gp_considered, weights_norm))
            seasons_weighted = int(weights_used.size)

        availability_anchor = (weighted_gp * 0.7) + (median_gp * 0.3)
        stability_penalty = variance_gp * penalty_factor
        durability_composite = max(availability_anchor - stability_penalty, 0.0)

        records.append(
            {
                "PLAYER_ID": player_id,
                "Weighted_GP": weighted_gp,
                "GP_Median": median_gp,
                "GP_Variance": variance_gp,
                "Durability_Composite": durability_composite,
                "Durability_Penalty": stability_penalty,
                "Seasons_Weighted": seasons_weighted,
                "Seasons_Total": total_seasons,
                "Seasons_Used": ",".join(seasons_used),
            }
        )

    return pd.DataFrame.from_records(records)


TOK_PATH = Path("oauth2.json")


def bearer() -> str:
    try:
        with TOK_PATH.open("r", encoding="utf-8") as fh:
            return json.load(fh)["access_token"]
    except FileNotFoundError as exc:
        raise SystemExit("oauth2.json not found. Run auth_init.py first.") from exc
    except KeyError as exc:
        raise SystemExit("oauth2.json missing access_token") from exc


def get_gamekey() -> str:
    data = get("/game/nba", bearer())
    gk = game_key(data)
    if not gk:
        raise SystemExit("Failed to resolve game_key from /game/nba")
    log.info("Using game_key=%s", gk)
    return gk


def get_all_players(gamekey: str) -> pd.DataFrame:
    print("Pulling Yahoo player list in batches of 25...")
    log.info("Fetching Yahoo player list in batches of 25")
    rows = []
    start = 0
    while True:
        data = get(f"/game/{gamekey}/players;start={start};count=25", bearer())
        batch = players(data)
        if not batch:
            print("No additional players returned; finished fetching Yahoo roster.")
            log.debug("No player batch returned at start=%d; stopping", start)
            break
        print(f"Fetched {len(batch)} players at offset {start}")
        log.debug("Fetched %d players at start=%d", len(batch), start)
        rows.extend(batch)
        start += 25
    df = pd.DataFrame(rows).drop_duplicates(subset=["player_key"])
    print(f"Collected {len(df)} unique Yahoo players.")
    log.info("Pulled %d players", len(df))
    return df


def get_draft(game_df: pd.DataFrame) -> pd.DataFrame:
    keys = game_df["player_key"].tolist()
    out = {}
    for i in range(0, len(keys), 20):
        chunk = ",".join(keys[i : i + 20])
        data = get(f"/players;player_keys={chunk}/draft_analysis", bearer())
        out.update(draft_analysis(data))
    adp = (
        pd.DataFrame.from_dict(out, orient="index")
        .reset_index()
        .rename(columns={"index": "player_key"})
    )
    adp["ADP"] = adp["pre_avg_pick"].where(adp["pre_avg_pick"].notna(), adp["avg_pick"])
    log.info(
        "Draft analysis rows: %d (with ADP: %d)",
        len(adp),
        adp["ADP"].notna().sum(),
    )
    return adp


def main() -> None:
    print("Starting IronMen pipeline run...")
    log.info("Starting ironmen pipeline run")
    gamekey = get_gamekey()
    print(f"Yahoo NBA game key resolved: {gamekey}")
    log.info("Fetching Yahoo players for game %s", gamekey)
    print("Fetching Yahoo players from Yahoo Fantasy Sports...")
    yahoo_players = get_all_players(gamekey)
    print("Pulling draft analysis data from Yahoo...")
    log.info("Pulling draft analysis for %d players", len(yahoo_players))
    draft = get_draft(yahoo_players)

    season_list = recent_seasons(DEFAULT_SEASON, RECENT_SEASON_COUNT)
    print(f"Requesting NBA statistics for seasons: {', '.join(season_list)}")
    log.info("Pulling NBA totals for seasons: %s", ", ".join(season_list))
    nba_totals = pull_totals(season_list)
    print(f"Retrieved {len(nba_totals)} NBA stat rows. Building availability metrics...")
    log.info("Retrieved %d NBA total rows", len(nba_totals))
    log.info("Building availability metrics")
    availability = build_availability_metrics(nba_totals)
    print(f"Computed availability metrics for {len(availability)} players.")
    log.info("Computed availability metrics for %d players", len(availability))

    nba_latest = (
        nba_totals.sort_values(
            ["PLAYER_ID", "SEASON_START_YEAR", "SEASON_ID"],
            ascending=[True, True, True],
            na_position="last",
        )
        .drop_duplicates("PLAYER_ID", keep="last")
    )
    nba_latest = nba_latest.reset_index(drop=True)

    links = match(yahoo_players, nba_latest)
    log.info("Matched %d players", len(links))
    print(f"Matched {len(links)} Yahoo players to NBA stats.")

    nba_idx = nba_latest.reset_index().rename(columns={"index": "nba_row_index"})
    link_df = pd.DataFrame(links, columns=["player_key", "nba_row_index"])

    merged = (
        link_df.merge(yahoo_players, on="player_key", how="left")
        .merge(nba_idx, on="nba_row_index", how="left")
        .merge(draft[["player_key", "ADP"]], on="player_key", how="left")
        .merge(availability, on="PLAYER_ID", how="left")
    )

    print("Computing IronMen scores and rankings...")
    log.info("Computing IronMan scores")
    scored = compute(merged)
    cols = [
        "name_full",
        "IronMan_Rank",
        "Good_IronMan_Rank",
        "team",
        "pos",
        "ADP",
        "Good_IronMan_Score",
        "IronMan_Score",
        "DurabilityZ",
        "ProductionZ",
        "EfficiencyZ",
        "MinutesZ",
        "ValueZ",
        "GP",
        "MIN",
        "Weighted_GP",
        "GP_Median",
        "Durability_Composite",
        "Durability_Penalty",
        "Seasons_Used",
        "PTS_PG",
        "REB_PG",
        "AST_PG",
        "STL_PG",
        "BLK_PG",
        "FG3M_PG",
        "FG3_PCT",
        "FT_PCT",
        "TOV_PG",
        "DD2_PG",
    ]
    print("Writing results to ironmen_rankings.csv...")
    log.info("Writing rankings CSV to ironmen_rankings.csv")
    scored[cols].to_csv("ironmen_rankings.csv", index=False, encoding="utf-8-sig")
    print(f"Saved {len(scored)} rows to ironmen_rankings.csv. Run complete!\n")
    log.info("Wrote ironmen_rankings.csv (%d rows)", len(scored))
    log.info("Ironmen pipeline run complete")


if __name__ == "__main__":
    main()
