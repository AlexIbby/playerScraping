import numpy as np
import pandas as pd


MIN_GAMES_FULL_WEIGHT = 40
MIN_MINUTES_FULL_WEIGHT = 500


def z(series: pd.Series) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce")
    mean = s.mean()
    std = s.std(ddof=0)
    if std == 0 or np.isnan(std):
        return pd.Series(np.zeros(len(s)), index=s.index)
    return (s - mean) / std


def compute(df: pd.DataFrame) -> pd.DataFrame:
    data = df.copy()
    data["GP"] = pd.to_numeric(data["GP"], errors="coerce").fillna(0)
    data["MIN"] = pd.to_numeric(data["MIN"], errors="coerce").fillna(0)
    data["MPG"] = np.where(data["GP"] > 0, data["MIN"] / data["GP"], 0.0)

    per_game_fallbacks = {
        "PTS_PG": "PTS",
        "REB_PG": "REB",
        "AST_PG": "AST",
        "STL_PG": "STL",
        "BLK_PG": "BLK",
        "FG3M_PG": "FG3M",
        "TOV_PG": "TOV",
    }
    for pg_col, total_col in per_game_fallbacks.items():
        if pg_col not in data.columns:
            totals = pd.to_numeric(data.get(total_col), errors="coerce").fillna(0.0)
            data[pg_col] = np.where(data["GP"] > 0, totals / data["GP"], 0.0)
        else:
            data[pg_col] = pd.to_numeric(data[pg_col], errors="coerce").fillna(0.0)

    data["FG_PCT"] = pd.to_numeric(data.get("FG_PCT"), errors="coerce").fillna(0.0)
    data["FT_PCT"] = pd.to_numeric(data.get("FT_PCT"), errors="coerce").fillna(0.0)

    data["Weighted_GP"] = pd.to_numeric(data.get("Weighted_GP"), errors="coerce")
    data["GP_Median"] = pd.to_numeric(data.get("GP_Median"), errors="coerce")
    data["GP_Variance"] = pd.to_numeric(data.get("GP_Variance"), errors="coerce")
    data["Durability_Penalty"] = (
        pd.to_numeric(data.get("Durability_Penalty"), errors="coerce").fillna(0.0)
    )

    # Durability composite comes from a 70/30 blend of weighted GP (recency bias)
    # and median GP, minus a variance-scaled penalty derived upstream.
    durability_composite = pd.to_numeric(
        data.get("Durability_Composite"), errors="coerce"
    )
    durability_fallback = data["Weighted_GP"].where(
        data["Weighted_GP"].notna(), data["GP"]
    )
    data["Durability_Composite"] = durability_composite.where(
        durability_composite.notna(), durability_fallback
    ).fillna(0.0)

    per_game_stats = [
        "PTS_PG",
        "REB_PG",
        "AST_PG",
        "STL_PG",
        "BLK_PG",
        "FG3M_PG",
        "FG_PCT",
        "FT_PCT",
    ]
    data["TOV_PG_NEG"] = -data["TOV_PG"]
    zcols = per_game_stats + ["TOV_PG_NEG"]
    for col in zcols:
        data[f"z_{col}"] = z(pd.to_numeric(data[col], errors="coerce").fillna(0))
    value_components = [f"z_{col}" for col in per_game_stats] + ["z_TOV_PG_NEG"]
    data["ValueZ_raw"] = data[value_components].mean(axis=1)

    games_factor = np.clip(
        np.where(data["GP"] > 0, data["GP"] / MIN_GAMES_FULL_WEIGHT, 0.0), 0.0, 1.0
    )
    minutes_factor = np.clip(
        np.where(data["MIN"] > 0, data["MIN"] / MIN_MINUTES_FULL_WEIGHT, 0.0), 0.0, 1.0
    )
    sample_strength = np.maximum(games_factor, minutes_factor)
    data["ValueZ"] = data["ValueZ_raw"] * sample_strength

    data["DurabilityZ"] = z(data["Durability_Composite"])
    data["MinutesZ"] = z(data["MPG"])

    if "ADP" in data.columns and data["ADP"].notna().any():
        data["ADP_INV"] = -data["ADP"]
        data["ADPz"] = z(data["ADP_INV"])
        value_vs_adp = data["ValueZ"] - data["ADPz"]
    else:
        value_vs_adp = pd.Series(0.0, index=data.index)

    data["IronMan_Score"] = (
        0.40 * data["DurabilityZ"]
        + 0.20 * data["MinutesZ"]
        + 0.30 * data["ValueZ"]
        + 0.10 * value_vs_adp
    )
    data["IronMan_Score"] = data["IronMan_Score"].fillna(0)
    data["IronMan_Rank"] = data["IronMan_Score"].rank(ascending=False, method="min").astype(int)
    return data.sort_values("IronMan_Rank")
