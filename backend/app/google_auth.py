import base64
import hashlib
import html
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import HTMLResponse

from app.auth import STAFF_ACCESS_ENABLED, STAFF_DISABLED_MESSAGE
from app.database import SessionLocal
from app.google_config import CLIENT_ID, CONFIG_PATH, CLIENT_SECRET, is_configured
from app.models import User
from app.security import create_token

router = APIRouter(prefix="/api/auth/google", tags=["Auth"])

REDIRECT = os.getenv(
    "GOOGLE_AUTH_REDIRECT_URI",
    "http://127.0.0.1:8077/api/auth/google/callback",
)
SCOPE = "openid email profile"
TTL = 600
PENDING: dict[str, tuple[str, float]] = {}
RESULTS: dict[str, tuple[dict, float]] = {}
LOCK = threading.Lock()


def _cleanup() -> None:
    cutoff = time.time() - TTL
    with LOCK:
        for store in (PENDING, RESULTS):
            for key in [key for key, value in store.items() if value[1] < cutoff]:
                store.pop(key, None)


def _result(state: str, payload: dict) -> None:
    with LOCK:
        RESULTS[state] = (payload, time.time())


def _call(url: str, token: str | None = None, data: bytes | None = None,
          headers: dict | None = None) -> dict:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace").strip()[:300]
        raise RuntimeError(f"Google error {exc.code}: {detail}" if detail else f"Google error {exc.code}")
    except Exception as exc:
        raise RuntimeError(f"Could not reach Google: {exc}") from exc
    try:
        return json.loads(body) if body else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError("Google returned an unexpected response") from exc


def _form(url: str, fields: dict) -> dict:
    body = urllib.parse.urlencode(fields).encode()
    return _call(url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})


def _page(title: str, message: str, ok: bool = False) -> str:
    color = "#0f766e" if ok else "#b91c1c"
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{html.escape(title)}</title></head>"
        "<body style='font-family:system-ui,sans-serif;text-align:center;"
        "margin:18vh auto;max-width:480px;padding:0 20px;color:#0f172a'>"
        f"<h2 style='color:{color}'>{html.escape(title)}</h2>"
        f"<p style='line-height:1.6;color:#475569'>{html.escape(message)}</p>"
        "</body></html>"
    )


@router.get("/status")
def status():
    return {
        "configured": is_configured(),
        "config_path": str(CONFIG_PATH) if CONFIG_PATH else None,
        "redirect_uri": REDIRECT,
    }


@router.post("/start")
def start():
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail="Google sign-in is not configured. Add GOOGLE_CLIENT_ID and "
                   "GOOGLE_CLIENT_SECRET to the app's .env file, then restart.",
        )
    _cleanup()
    verifier = secrets.token_urlsafe(64)
    state = secrets.token_urlsafe(24)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    with LOCK:
        PENDING[state] = (verifier, time.time())
        RESULTS[state] = ({"status": "pending"}, time.time())
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    })
    try:
        webbrowser.open(url)
    except Exception:
        pass
    return {"state": state, "url": url}


@router.get("/result")
def result(state: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    _cleanup()
    with LOCK:
        item = RESULTS.get(state)
    if not item:
        raise HTTPException(404, "The sign-in request expired. Please try again.")
    return item[0]


@router.get("/callback", response_class=HTMLResponse)
def callback(code: str = "", state: str = "", error: str = ""):
    with LOCK:
        pending = PENDING.pop(state, None) if state else None

    def fail(message: str, status_code: int = 400) -> HTMLResponse:
        if state:
            _result(state, {"status": "error", "message": message})
        return HTMLResponse(_page("Sign-in failed", message), status_code=status_code)

    if error:
        return fail(f"Google did not complete the sign-in: {error}")
    if not code or not pending:
        return fail("The sign-in request expired or was already used. Try again in the app.")
    verifier, created = pending
    if time.time() - created > TTL:
        return fail("The sign-in request expired. Try again in the app.")

    try:
        tokens = _form("https://oauth2.googleapis.com/token", {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT,
        })
        if not tokens.get("access_token"):
            raise RuntimeError("Google did not return an access token")
        info = _call(
            "https://openidconnect.googleapis.com/v1/userinfo",
            token=tokens["access_token"],
        )
    except Exception as exc:
        return fail(f"Could not finish Google sign-in: {exc}", 502)

    email = str(info.get("email") or "").strip().lower()
    if not email or not info.get("email_verified", False):
        return fail("Google has not verified this email address. Use a verified Google account.")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
    finally:
        db.close()
    if not user or not user.is_active:
        return fail(
            f"There is no active GST Office account for {email}. "
            "Ask an administrator to add this email, then try again."
        )
    if user.role != "Admin" and not STAFF_ACCESS_ENABLED:
        return fail(STAFF_DISABLED_MESSAGE)

    payload = {
        "status": "ok",
        "token": create_token(user.id, user.role, user.token_version),
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role,
            "is_active": user.is_active,
        },
    }
    _result(state, payload)
    return HTMLResponse(_page(
        "Signed in",
        f"Signed in as {email}. You can close this tab and go back to GST Office.",
        ok=True,
    ))
