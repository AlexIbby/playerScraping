import base64
import json
import os
import time
import secrets
import webbrowser
from threading import Thread
from urllib.parse import urlencode

import requests
from flask import Flask, Response, request

DEFAULT_REDIRECT_URI = "https://ddd6fe0ba8e7.ngrok-free.app/callback"

CLIENT_ID = os.environ.get("YH_CLIENT_ID")
CLIENT_SECRET = os.environ.get("YH_CLIENT_SECRET")
if not CLIENT_ID or not CLIENT_SECRET:
    raise RuntimeError(
        "Missing Yahoo OAuth client credentials. Set YH_CLIENT_ID and YH_CLIENT_SECRET in the environment."
    )
REDIRECT_URI = os.environ.get("YH_REDIRECT_URI", DEFAULT_REDIRECT_URI)
AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
TOK_PATH = "oauth2.json"
STATE = secrets.token_urlsafe(24)
CODE = {"value": None, "error": None}

app = Flask(__name__)


def _basic_auth() -> str:
    raw = f"{CLIENT_ID}:{CLIENT_SECRET}".encode()
    return "Basic " + base64.b64encode(raw).decode()


@app.get("/callback")
def callback() -> Response:
    if request.args.get("state") != STATE:
        return Response("State mismatch.", status=400)
    if "error" in request.args:
        CODE["error"] = request.args["error"]
        return Response("Auth error.", status=400)
    CODE["value"] = request.args.get("code")
    return Response("Authorized. You can close this tab.", status=200)


def run_server() -> None:
    app.run(host="127.0.0.1", port=5000, debug=False)


def exchange(code: str) -> None:
    headers = {
        "Authorization": _basic_auth(),
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
    }
    response = requests.post(TOKEN_URL, headers=headers, data=data, timeout=30)
    response.raise_for_status()
    tokens = response.json()
    tokens["obtained_at"] = int(time.time())
    with open(TOK_PATH, "w", encoding="utf-8") as fh:
        json.dump(tokens, fh, indent=2)
    print(f"Saved {TOK_PATH}")


if __name__ == "__main__":
    Thread(target=run_server, daemon=True).start()

    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": "fspt-r",
        "state": STATE,
    }
    url = f"{AUTH_URL}?{urlencode(params)}"
    print("Open this URL:\n", url)
    try:
        webbrowser.open(url)
    except Exception:
        pass
    print("Waiting for callback...")

    for _ in range(600):
        if CODE["error"]:
            raise SystemExit(f"Auth error: {CODE['error']}")
        if CODE["value"]:
            break
        time.sleep(0.5)
    else:
        raise SystemExit("Timed out waiting for OAuth callback")

    exchange(CODE["value"])
