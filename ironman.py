import numpy as np
import pandas as pd


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

    stats = ["PTS", "REB", "AST", "STL", "BLK", "FG3M", "FG_PCT", "FT_PCT"]
    data["TOV_NEG"] = -data["TOV"]
    zcols = stats + ["TOV_NEG"]
    for col in zcols:
        data[f"z_{col}"] = z(pd.to_numeric(data[col], errors="coerce").fillna(0))
    data["ValueZ"] = data[[f"z_{col}" for col in zcols]].mean(axis=1)

    data["DurabilityZ"] = z(data["Durability_Composite"])
    data["MinutesZ"] = z(data["MPG"])

    if "ADP" in data.columns and data["ADP"].notna().any():
        data["ADP_INV"] = -data["ADP"]
        data["ADPz"] = z(data["ADP_INV"])
        value_vs_adp = data["ValueZ"] - data["ADPz"]
    else:
        value_vs_adp = pd.Series(0.0, index=data.index)

    data["IronMan_Score"] = (
        0.45 * data["DurabilityZ"]
        + 0.25 * data["MinutesZ"]
        + 0.30 * data["ValueZ"]
        + 0.15 * value_vs_adp
    )
    data["IronMan_Score"] = data["IronMan_Score"].fillna(0)
    data["IronMan_Rank"] = data["IronMan_Score"].rank(ascending=False, method="min").astype(int)
    return data.sort_values("IronMan_Rank")
