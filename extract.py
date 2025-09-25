import logging
from typing import Any, Dict, List, Optional

log = logging.getLogger("yfs")


def game_key(data: Dict[str, Any]) -> Optional[str]:
    try:
        return data["fantasy_content"]["game"][0]["game_key"]
    except Exception:
        log.exception("game_key parse error")
        return None


def players(data: Dict[str, Any]) -> List[Dict[str, Optional[str]]]:
    out: List[Dict[str, Optional[str]]] = []
    try:
        players_block = data["fantasy_content"]["game"][1]["players"]
        for _, value in players_block.items():
            if not isinstance(value, dict) or "player" not in value:
                continue
            arr = value["player"]
            if not isinstance(arr, list):
                continue
            # Yahoo sometimes nests the payload inside another singleton list.
            if arr and isinstance(arr[0], list):
                arr = arr[0]
            if not isinstance(arr, list):
                continue

            key = None
            name = None
            team = None
            pos = None
            for item in arr:
                if not isinstance(item, dict):
                    continue
                if "player_key" in item:
                    key = item.get("player_key")
                name_block = item.get("name")
                if isinstance(name_block, dict) and name is None:
                    name = name_block.get("full")
                if "editorial_team_abbr" in item and team is None:
                    team = item.get("editorial_team_abbr")
                if "display_position" in item and pos is None:
                    pos = item.get("display_position")
            if key and name:
                out.append({
                    "player_key": key,
                    "name_full": name,
                    "team": team,
                    "pos": pos,
                })
    except Exception:
        log.exception("players parse error")
    return out


def draft_analysis(data: Dict[str, Any]) -> Dict[str, Dict[str, Optional[float]]]:
    res: Dict[str, Dict[str, Optional[float]]] = {}
    try:
        plist = data["fantasy_content"]["players"]
        for _, value in plist.items():
            if not isinstance(value, dict) or "player" not in value:
                continue
            arr = value["player"]
            if not isinstance(arr, list):
                continue

            player_meta: List[Dict[str, Any]] = []
            draft_block: Optional[List[Dict[str, Any]]] = None
            for item in arr:
                if isinstance(item, list):
                    player_meta = item
                elif isinstance(item, dict) and "draft_analysis" in item:
                    block = item.get("draft_analysis")
                    if isinstance(block, list):
                        draft_block = block

            key = None
            for meta in player_meta:
                if isinstance(meta, dict) and "player_key" in meta:
                    key = meta.get("player_key")
                    break
            if not key or not draft_block:
                continue

            da_dict: Dict[str, Any] = {}
            for entry in draft_block:
                if isinstance(entry, dict):
                    da_dict.update(entry)

            def num(val: Any) -> Optional[float]:
                try:
                    return float(val)
                except (TypeError, ValueError):
                    return None

            res[key] = {
                "avg_pick": num(da_dict.get("average_pick")),
                "avg_round": num(da_dict.get("average_round")),
                "avg_cost": num(da_dict.get("average_cost")),
                "pct_drafted": num(da_dict.get("percent_drafted")),
                "pre_avg_pick": num(da_dict.get("preseason_average_pick")),
                "pre_avg_round": num(da_dict.get("preseason_average_round")),
                "pre_avg_cost": num(da_dict.get("preseason_average_cost")),
                "pre_pct_drafted": num(da_dict.get("preseason_percent_drafted")),
            }
    except Exception:
        log.exception("draft_analysis parse error")
    return res
