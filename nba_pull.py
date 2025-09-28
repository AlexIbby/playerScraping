from collections.abc import Sequence

import numpy as np
import pandas as pd
from nba_api.stats.endpoints import leaguedashplayerstats


DEFAULT_SEASON = "2024-25"


def _ensure_list(seasons: Sequence[str] | str) -> list[str]:
    if isinstance(seasons, str):
        return [seasons]
    return list(seasons)


def pull_totals(seasons: Sequence[str] | str = DEFAULT_SEASON) -> pd.DataFrame:
    """Fetch regular-season totals for one or more seasons.

    Parameters
    ----------
    seasons
        Either a single season string (e.g. "2024-25") or an iterable of
        seasons. When multiple seasons are provided, the returned DataFrame is
        stacked with a `SEASON_ID` column indicating which campaign each row
        belongs to.
    """

    frames: list[pd.DataFrame] = []
    for season in _ensure_list(seasons):
        result = leaguedashplayerstats.LeagueDashPlayerStats(
            season=season,
            per_mode_detailed="Totals",
            season_type_all_star="Regular Season",
        )
        df = result.get_data_frames()[0]
        keep = [
            "SEASON_ID",
            "PLAYER_ID",
            "PLAYER_NAME",
            "TEAM_ID",
            "TEAM_ABBREVIATION",
            "GP",
            "MIN",
            "PTS",
            "REB",
            "AST",
            "STL",
            "BLK",
            "TOV",
            "FG_PCT",
            "FT_PCT",
            "FG3M",
        ]
        frame = df.copy()
        if "SEASON_ID" not in frame.columns:
            frame["SEASON_ID"] = str(season)
        if "TEAM_ID" not in frame.columns:
            frame["TEAM_ID"] = pd.NA
        missing_columns = [col for col in keep if col not in frame.columns]
        for col in missing_columns:
            frame[col] = pd.NA
        frame = frame[keep].copy()
        frame["SEASON_ID"] = frame["SEASON_ID"].astype(str)

        gp_numeric = pd.to_numeric(frame["GP"], errors="coerce")
        gp_nonzero = gp_numeric.replace(0, np.nan)
        per_game_stats = ["PTS", "REB", "AST", "STL", "BLK", "FG3M", "TOV"]
        for stat in per_game_stats:
            stat_numeric = pd.to_numeric(frame[stat], errors="coerce")
            per_game = stat_numeric.div(gp_nonzero)
            frame[f"{stat}_PG"] = per_game.fillna(0.0)

        frames.append(frame)

    combined = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not combined.empty:
        combined["SEASON_START_YEAR"] = pd.to_numeric(
            combined["SEASON_ID"].str.slice(0, 4), errors="coerce"
        ).astype("Int64")
    return combined
