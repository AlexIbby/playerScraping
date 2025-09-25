from typing import List, Sequence, Tuple

import pandas as pd
from rapidfuzz import fuzz, process
from unidecode import unidecode

OVERRIDES = {
    # "yahoo_name": "NBA_API_NAME",
}


def norm(text: str) -> str:
    cleaned = unidecode((text or "").lower())
    for token in [" jr.", " jr", " sr.", " sr", " iii", " ii", ".", "'"]:
        cleaned = cleaned.replace(token, "")
    return " ".join(cleaned.split())


def build_index(nba_df: pd.DataFrame) -> Tuple[Sequence[str], dict]:
    keys = nba_df["PLAYER_NAME"].map(norm).tolist()
    lookup = {
        norm(row.PLAYER_NAME): idx
        for idx, row in nba_df.reset_index().iterrows()
    }
    return keys, lookup


def match(yahoo_df: pd.DataFrame, nba_df: pd.DataFrame, cutoff: int = 91) -> List[Tuple[str, int]]:
    keys, lookup = build_index(nba_df)
    links: List[Tuple[str, int]] = []
    for _, row in yahoo_df.iterrows():
        name = row.get("name_full")
        if not name:
            continue
        override = OVERRIDES.get(name)
        if override:
            idx = lookup.get(norm(override))
            if idx is not None:
                links.append((row["player_key"], idx))
            continue
        best = process.extractOne(norm(name), keys, scorer=fuzz.token_sort_ratio, score_cutoff=cutoff)
        if best:
            idx = lookup.get(best[0])
            if idx is not None:
                links.append((row["player_key"], idx))
    return links
