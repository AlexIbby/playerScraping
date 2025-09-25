import base64
import json
import logging
import os
import time
from typing import Any, Dict, Optional

import requests
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

BASE = "https://fantasysports.yahooapis.com/fantasy/v2"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
TOKEN_PATH = os.environ.get("YH_TOKEN_PATH", "oauth2.json")

DEFAULT_REDIRECT_URI = "https://ddd6fe0ba8e7.ngrok-free.app/callback"

CLIENT_ID = os.environ.get("YH_CLIENT_ID")
CLIENT_SECRET = os.environ.get("YH_CLIENT_SECRET")
if not CLIENT_ID or not CLIENT_SECRET:
    raise RuntimeError(
        "Missing Yahoo OAuth client credentials. Set YH_CLIENT_ID and YH_CLIENT_SECRET in the environment."
    )
REDIRECT_URI = os.environ.get("YH_REDIRECT_URI", DEFAULT_REDIRECT_URI)

logging.basicConfig(
    filename="adp_pipeline.log",
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("yfs")


class ApiError(Exception):
    """Raised when Yahoo Fantasy API returns a non-success status."""

    def __init__(self, message: str, response: Optional[requests.Response] = None) -> None:
        super().__init__(message)
        self.response = response


def _basic_auth() -> str:
    if not CLIENT_ID or not CLIENT_SECRET:
        raise ApiError("Missing Yahoo OAuth client credentials in environment")
    raw = f"{CLIENT_ID}:{CLIENT_SECRET}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def _load_tokens() -> Dict[str, Any]:
    with open(TOKEN_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _save_tokens(tokens: Dict[str, Any]) -> None:
    tokens = dict(tokens)
    tokens["obtained_at"] = int(time.time())
    with open(TOKEN_PATH, "w", encoding="utf-8") as fh:
        json.dump(tokens, fh, indent=2)


def _refresh_access_token() -> str:
    tokens = _load_tokens()
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        raise ApiError("oauth2.json missing refresh_token; re-run auth_init.py")

    headers = {
        "Authorization": _basic_auth(),
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {"grant_type": "refresh_token", "refresh_token": refresh_token}
    log.info("Refreshing Yahoo access token")
    resp = requests.post(TOKEN_URL, headers=headers, data=data, timeout=30)
    if resp.status_code >= 400:
        snippet = resp.text[:400]
        log.error("HTTP %s %s : %s", resp.status_code, resp.url, snippet)
        raise ApiError(f"Failed to refresh token: {resp.status_code} {resp.reason}", resp)
    new_tokens = resp.json()
    new_tokens["refresh_token"] = new_tokens.get("refresh_token", refresh_token)
    _save_tokens(new_tokens)
    return new_tokens["access_token"]


def _check(resp: requests.Response) -> None:
    if 200 <= resp.status_code < 300:
        return
    body = resp.text[:400]
    log.error("HTTP %s %s : %s", resp.status_code, resp.url, body)
    raise ApiError(f"{resp.status_code} {resp.reason}", resp)


@retry(
    reraise=True,
    retry=retry_if_exception_type((requests.exceptions.RequestException, ApiError)),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    stop=stop_after_attempt(5),
)
def get(path: str, token: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Call the Yahoo Fantasy API with automatic retries and token refresh."""

    params = dict(params or {})
    params.setdefault("format", "json")

    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE}{path}", headers=headers, params=params, timeout=20)

    if resp.status_code == 401:
        log.warning("401 Unauthorized for %s; attempting token refresh", resp.url)
        token = _refresh_access_token()
        headers["Authorization"] = f"Bearer {token}"
        resp = requests.get(f"{BASE}{path}", headers=headers, params=params, timeout=20)

    _check(resp)
    return resp.json()
