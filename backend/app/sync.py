import base64, hashlib, html, json, os, secrets, shutil, tempfile, threading, time, webbrowser, zipfile
import urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, time as clock_time
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Literal
from sqlalchemy import Integer, create_engine, event, func, inspect, select, text
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import SessionLocal, data_dir, engine
from app.google_config import CLIENT_ID, CLIENT_SECRET, CONFIG_PATH, is_configured
from app.models import Base, User

router = APIRouter(prefix="/api/sync", tags=["Sync"], dependencies=[Depends(require_admin)])
public_router = APIRouter(prefix="/api/sync", tags=["Sync"])

DATA = data_dir()
UPLOADS = DATA / "uploads"
TOKEN_FILE = DATA / "google_token.json"
STATE_FILE = DATA / "sync_state.json"
REDIRECT = os.getenv(
    "GOOGLE_REDIRECT_URI",
    "http://127.0.0.1:8077/api/sync/google/callback",
)
SCOPE = "openid email https://www.googleapis.com/auth/drive.appdata"
NAME = "gst-sync.zip"
FORMAT = "gst-client-sync"
SNAPSHOT_VERSION = 1
PENDING: dict[str, tuple[str, float]] = {}
OAUTH_TIMEOUT = 300
STATE_LOCK = threading.Lock()
SYNC_LOCK = threading.Lock()
TOKEN_LOCK = threading.Lock()


# ---------- small state file ----------
def _base_state() -> dict:
    return {
        "base_rev": 0, "dirty": False, "dirty_since": 0, "changed_at": 0,
        "version": 0, "status": "idle", "error": "", "oauth_error": "",
        "last_sync": None, "oauth_url": "",
    }


def _read_unlocked() -> dict:
    state = _base_state()
    try:
        state.update(json.loads(STATE_FILE.read_text()))
    except Exception:
        pass
    return state


def _write_unlocked(state: dict) -> None:
    temp = STATE_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(state))
    os.replace(temp, STATE_FILE)


def _state() -> dict:
    with STATE_LOCK:
        return _read_unlocked()


def _mutate(**kw) -> dict:
    with STATE_LOCK:
        state = _read_unlocked()
        state.update(kw)
        _write_unlocked(state)
        return state


def _save(**kw):
    _mutate(**kw)


def mark_dirty():
    with STATE_LOCK:
        state = _read_unlocked()
        if not state.get("dirty"):
            state["dirty_since"] = time.time()
        state["dirty"] = True
        state["changed_at"] = time.time()
        _write_unlocked(state)


# ---------- notice every real data change ----------
# This works for every database engine (PostgreSQL in development, SQLite
# in the packaged app), so automatic sync is not limited to the desktop build.
@event.listens_for(Session, "before_commit")
def _before(session):
    if session.new or session.dirty or session.deleted:
        session.info["changed"] = True


@event.listens_for(Session, "after_commit")
def _after(session):
    if session.info.pop("changed", False):
        mark_dirty()


# ---------- Google HTTP (standard library only) ----------
def _call(url, token=None, data=None, headers=None, method=None, raw=False):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace").strip()
        if len(detail) > 300:
            detail = detail[:300]
        raise RuntimeError(f"Google error {e.code}: {detail}" if detail else f"Google error {e.code}")
    except Exception:
        raise ConnectionError("offline")
    if raw:
        return body
    return json.loads(body) if body else {}


def _form(url, fields):
    return _call(url, data=urllib.parse.urlencode(fields).encode(),
                 headers={"Content-Type": "application/x-www-form-urlencoded"})


def _tokens() -> dict:
    try:
        return json.loads(TOKEN_FILE.read_text())
    except Exception:
        return {}


def _access_token() -> str:
    t = _tokens()
    if not t.get("refresh_token"):
        raise RuntimeError("Google account is not connected")
    if t.get("expires_at", 0) > time.time() + 60 and t.get("access_token"):
        return t["access_token"]
    try:
        r = _form("https://oauth2.googleapis.com/token", {
            "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
            "refresh_token": t["refresh_token"], "grant_type": "refresh_token"})
    except RuntimeError as exc:
        if "invalid_grant" in str(exc):
            TOKEN_FILE.unlink(missing_ok=True)
            raise RuntimeError("Google sign-in expired. Connect your account again.") from exc
        raise
    if not r.get("access_token"):
        raise RuntimeError("Google did not return an access token")
    t["access_token"] = r["access_token"]
    t["expires_at"] = time.time() + int(r.get("expires_in", 3600))
    with TOKEN_LOCK:
        TOKEN_FILE.write_text(json.dumps(t))
    return t["access_token"]


# ---------- snapshot and restore ----------
# Every backup contains two representations of the same data:
#   data.json      portable rows (works with PostgreSQL and SQLite)
#   gst_client.db  a SQLite copy (lets older installed desktop apps restore it)
# Restoring prefers data.json, but can also read a legacy SQLite-only backup
# and load it into PostgreSQL.
def _encode(value):
    if isinstance(value, datetime):
        return {"__type": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"__type": "date", "value": value.isoformat()}
    if isinstance(value, clock_time):
        return {"__type": "time", "value": value.isoformat()}
    if isinstance(value, Decimal):
        return {"__type": "decimal", "value": str(value)}
    if isinstance(value, bytes):
        return {"__type": "bytes", "value": base64.b64encode(value).decode()}
    return value


def _decode(value):
    if isinstance(value, dict) and "__type" in value:
        kind, raw = value.get("__type"), value.get("value")
        if kind == "datetime":
            return datetime.fromisoformat(raw)
        if kind == "date":
            return date.fromisoformat(raw)
        if kind == "time":
            return clock_time.fromisoformat(raw)
        if kind == "decimal":
            return Decimal(raw)
        if kind == "bytes":
            return base64.b64decode(raw)
    return value


def _read_tables() -> dict:
    tables = {}
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.connect() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                tables[table.name] = []
                continue
            existing_columns = {col["name"] for col in inspector.get_columns(table.name)}
            columns = [col for col in table.columns if col.name in existing_columns]
            if not columns:
                tables[table.name] = []
                continue
            tables[table.name] = [
                dict(row) for row in conn.execute(select(*columns)).mappings().all()
            ]
    return tables


def _write_sqlite(path: Path, tables: dict):
    """Create a standalone SQLite database containing the given rows."""
    legacy = create_engine("sqlite:///" + path.as_posix())
    try:
        Base.metadata.create_all(bind=legacy)
        with legacy.begin() as conn:
            for table in Base.metadata.sorted_tables:
                rows = tables.get(table.name) or []
                if rows:
                    conn.execute(table.insert(), rows)
    finally:
        legacy.dispose()


def _snapshot(tmp: Path) -> Path:
    raw = _read_tables()
    encoded = {
        name: [{key: _encode(value) for key, value in row.items()} for row in rows]
        for name, rows in raw.items()
    }
    payload = {
        "format": FORMAT,
        "version": SNAPSHOT_VERSION,
        "created": datetime.now().isoformat(timespec="seconds"),
        "tables": encoded,
    }

    sqlite_copy = tmp / "gst_client.db"
    _write_sqlite(sqlite_copy, raw)

    z = tmp / "snapshot.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("data.json", json.dumps(payload, ensure_ascii=False))
        zf.write(sqlite_copy, "gst_client.db")
        if UPLOADS.exists():
            for f in UPLOADS.rglob("*"):
                if f.is_file():
                    zf.write(f, "uploads/" + f.relative_to(UPLOADS).as_posix())
    return z


def _reset_sequences(conn):
    """Move PostgreSQL id sequences past the ids we just inserted."""
    if engine.dialect.name != "postgresql":
        return
    for table in Base.metadata.sorted_tables:
        pk = list(table.primary_key.columns)
        if len(pk) != 1 or not isinstance(pk[0].type, Integer):
            continue
        column = pk[0]
        max_id = conn.execute(select(func.max(column))).scalar()
        if max_id is None:
            continue
        sequence = conn.execute(
            text("SELECT pg_get_serial_sequence(:table, :column)"),
            {"table": table.name, "column": column.name},
        ).scalar()
        if sequence:
            conn.execute(
                text("SELECT setval(CAST(:sequence AS regclass), :value)"),
                {"sequence": sequence, "value": max_id},
            )


def _preserve_local_credentials(raw: dict) -> dict:
    rows = raw.get("users")
    if not rows:
        return raw
    db = SessionLocal()
    try:
        local = {user.email: user for user in db.query(User).all()}
    finally:
        db.close()

    preserved = []
    for row in rows:
        row = dict(row)
        current = local.get(row.get("email"))
        if current:
            row["password_hash"] = current.password_hash
            row["token_version"] = int(current.token_version or 0)
        row["token_version"] = int(row.get("token_version") or 0) + 1
        preserved.append(row)
    raw["users"] = preserved
    return raw


def _restore_tables(raw: dict):
    raw = _preserve_local_credentials(raw)
    meta = Base.metadata
    with engine.begin() as conn:
        for table in reversed(meta.sorted_tables):
            conn.execute(table.delete())
        for table in meta.sorted_tables:
            rows = raw.get(table.name) or []
            allowed = {column.name for column in table.columns}
            clean = [{key: value for key, value in row.items() if key in allowed} for row in rows]
            if clean:
                keys = set().union(*(row.keys() for row in clean))
                clean = [{key: row.get(key) for key in keys} for row in clean]
                conn.execute(table.insert(), clean)
        _reset_sequences(conn)


def _restore_portable(data: dict):
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise RuntimeError("The saved data was made by a different version of the app")
    tables = data.get("tables")
    if not isinstance(tables, dict) or "users" not in tables:
        raise RuntimeError("The saved data is not valid")

    raw = {
        name: [{key: _decode(value) for key, value in row.items()} for row in rows]
        for name, rows in tables.items()
    }
    _restore_tables(raw)


def _restore_legacy(z: zipfile.ZipFile, tmp: Path):
    newdb = tmp / "legacy.db"
    newdb.write_bytes(z.read("gst_client.db"))
    source = create_engine("sqlite:///" + newdb.as_posix())
    try:
        inspector = inspect(source)
        existing = set(inspector.get_table_names())
        if "users" not in existing:
            raise RuntimeError("The saved data is not valid")
        raw = {}
        with source.connect() as conn:
            for table in Base.metadata.sorted_tables:
                if table.name not in existing:
                    raw[table.name] = []
                    continue
                # Older backups may be missing columns that were added later.
                source_columns = {col["name"] for col in inspector.get_columns(table.name)}
                columns = [col for col in table.columns if col.name in source_columns]
                if not columns:
                    raw[table.name] = []
                    continue
                raw[table.name] = [
                    dict(row) for row in conn.execute(select(*columns)).mappings().all()
                ]
    finally:
        source.dispose()
    _restore_tables(raw)


def _extract_uploads(z: zipfile.ZipFile):
    UPLOADS.mkdir(parents=True, exist_ok=True)
    root = UPLOADS.resolve()
    for name in z.namelist():
        if name.startswith("uploads/") and not name.endswith("/"):
            target = (UPLOADS / name[len("uploads/"):]).resolve()
            if root in target.parents:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(name))


def _backup_before_restore():
    try:
        with tempfile.TemporaryDirectory() as d:
            shutil.copy2(_snapshot(Path(d)), DATA / "before-sync.zip")
    except Exception:
        pass


def _restore_backup():
    backup = DATA / "before-sync.zip"
    if not backup.exists():
        return
    with zipfile.ZipFile(backup) as z:
        if "data.json" in z.namelist():
            _restore_portable(json.loads(z.read("data.json")))


def _apply(raw: bytes):
    _backup_before_restore()
    try:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "in.zip"
            p.write_bytes(raw)
            with zipfile.ZipFile(p) as z:
                names = z.namelist()
                if "data.json" in names:
                    _restore_portable(json.loads(z.read("data.json")))
                elif "gst_client.db" in names:
                    _restore_legacy(z, Path(d))
                else:
                    raise RuntimeError("The saved data is not valid")
                _extract_uploads(z)
    except Exception:
        _restore_backup()
        raise


# ---------- Drive file ----------
def _remote(token):
    q = urllib.parse.quote(f"name='{NAME}'")
    r = _call("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" + q +
              "&fields=files(id,appProperties,modifiedTime)", token=token)
    files = r.get("files") or []
    return max(files, key=lambda f: f.get("modifiedTime") or "") if files else None


def _rev(f) -> int:
    try:
        return int(((f or {}).get("appProperties") or {}).get("revision", 0))
    except ValueError:
        return 0


def _push(token, remote, rev):
    with tempfile.TemporaryDirectory() as d:
        z = _snapshot(Path(d))
        meta = {"appProperties": {"revision": str(rev), "saved": datetime.now().isoformat(timespec="seconds")}}
        if not remote:
            meta.update(name=NAME, parents=["appDataFolder"])
        b = secrets.token_hex(12)
        body = (f"--{b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(meta)}\r\n"
                f"--{b}\r\nContent-Type: application/zip\r\n\r\n").encode() \
               + z.read_bytes() + f"\r\n--{b}--".encode()
        h = {"Content-Type": f"multipart/related; boundary={b}"}
        base = "https://www.googleapis.com/upload/drive/v3/files"
        if remote:
            _call(f"{base}/{remote['id']}?uploadType=multipart", token=token, data=body, headers=h, method="PATCH")
        else:
            _call(f"{base}?uploadType=multipart", token=token, data=body, headers=h)


def _pull(token, remote):
    raw = _call(f"https://www.googleapis.com/drive/v3/files/{remote['id']}?alt=media", token=token, raw=True)
    _apply(raw)
    _save(base_rev=_rev(remote), dirty=False, dirty_since=0, version=_state()["version"] + 1)


def sync_now(force=None, manual=False):
    """force: None, 'drive' (take Drive data) or 'local' (overwrite Drive)."""
    if not _tokens().get("refresh_token"):
        return public_state()
    with SYNC_LOCK:
        try:
            token = _access_token()
            remote = _remote(token)
            rrev, s = _rev(remote), _state()
            started = s["changed_at"]

            if force == "drive":
                if not remote:
                    raise RuntimeError("No saved data was found in this Google account")
                _pull(token, remote)
            elif force == "local":
                _push(token, remote, rrev + 1)
                _save(base_rev=rrev + 1, dirty=False, dirty_since=0)
            elif rrev > s["base_rev"]:
                if s["dirty"]:
                    _save(status="conflict", error="")
                    return public_state()
                _pull(token, remote)
            elif s["dirty"] or not remote:
                dirty_since = s.get("dirty_since") or s["changed_at"]
                quiet = time.time() - s["changed_at"]
                waiting = time.time() - dirty_since
                if not manual and quiet < 8 and waiting < 60:
                    return public_state()
                _push(token, remote, rrev + 1)
                if _state()["changed_at"] == started:
                    _save(base_rev=rrev + 1, dirty=False, dirty_since=0)
                else:
                    _save(base_rev=rrev + 1)
            _save(status="synced", error="", oauth_error="", last_sync=datetime.now().strftime("%d %b %Y %H:%M"))
        except ConnectionError:
            _save(status="offline", error="")
        except Exception as exc:
            _save(status="error", error=str(exc))
        return public_state()


def _loop():
    while True:
        try:
            sync_now()
        except Exception:
            pass
        time.sleep(30)


def start_sync():
    threading.Thread(target=_loop, daemon=True).start()


# ---------- status ----------
def public_state() -> dict:
    s, t = _state(), _tokens()
    connected = bool(t.get("refresh_token"))
    return {
        "supported": True,
        "configured": is_configured(),
        "config_path": str(CONFIG_PATH) if CONFIG_PATH else None,
        "connected": connected,
        "email": t.get("email"),
        "status": s["status"] if connected else "off",
        "pending": bool(s["dirty"]),
        "last_sync": s["last_sync"],
        "version": s["version"],
        "error": s.get("oauth_error") or s["error"],
        "auth_url": s.get("oauth_url", ""),
    }


@public_router.get("/status")
def status():
    return public_state()


# ---------- Google sign-in ----------
def _cleanup_pending():
    cutoff = time.time() - OAUTH_TIMEOUT
    for key, (_, created) in list(PENDING.items()):
        if created < cutoff:
            PENDING.pop(key, None)


def _start_oauth() -> str:
    if not is_configured():
        raise HTTPException(500, "Google is not configured in this build")
    _cleanup_pending()
    verifier, state = secrets.token_urlsafe(64), secrets.token_urlsafe(16)
    PENDING[state] = (verifier, time.time())
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": CLIENT_ID, "redirect_uri": REDIRECT, "response_type": "code", "scope": SCOPE,
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
        "access_type": "offline", "prompt": "consent"})
    _save(oauth_url=url, oauth_error="", status="waiting")
    webbrowser.open(url)
    return url


def _callback_page(title: str, message: str) -> str:
    return (
        "<body style='font-family:sans-serif;text-align:center;margin-top:20vh'>"
        f"<h2>{html.escape(title)}</h2><p>{html.escape(message)}</p></body>"
    )


@public_router.get("/google/callback", response_class=HTMLResponse)
def callback(code: str = "", state: str = "", error: str = ""):
    if error:
        message = f"Google sign-in was rejected: {error}"
        _save(oauth_error=message, status="error", oauth_url="")
        return HTMLResponse(_callback_page("Connection failed", message), 400)

    pending = PENDING.pop(state, None)
    if not code or not pending:
        message = "The sign-in request expired or was already used. Try again in the app."
        _save(oauth_error=message, status="error", oauth_url="")
        return HTMLResponse(_callback_page("Connection failed", message), 400)

    verifier, created = pending
    if time.time() - created > OAUTH_TIMEOUT:
        message = "The sign-in request expired. Try again in the app."
        _save(oauth_error=message, status="error", oauth_url="")
        return HTMLResponse(_callback_page("Connection failed", message), 400)

    try:
        r = _form("https://oauth2.googleapis.com/token", {
            "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "code": code,
            "code_verifier": verifier, "grant_type": "authorization_code", "redirect_uri": REDIRECT})
        if not r.get("access_token"):
            raise RuntimeError("Google did not return an access token")
        info = _call("https://openidconnect.googleapis.com/v1/userinfo", token=r["access_token"])
    except Exception as exc:
        message = f"Could not finish Google sign-in: {exc}"
        _save(oauth_error=message, status="error", oauth_url="")
        return HTMLResponse(_callback_page("Connection failed", message), 502)

    previous = _tokens()
    token = {
        "refresh_token": r.get("refresh_token") or previous.get("refresh_token", ""),
        "access_token": r["access_token"],
        "expires_at": time.time() + int(r.get("expires_in", 3600)),
        "email": info.get("email") or previous.get("email"),
    }
    if not token["refresh_token"]:
        message = "Google did not allow offline access. Disconnect any previous grant and try again."
        _save(oauth_error=message, status="error", oauth_url="")
        return HTMLResponse(_callback_page("Connection failed", message), 400)

    with TOKEN_LOCK:
        TOKEN_FILE.write_text(json.dumps(token))
    _save(status="connected", error="", oauth_error="", oauth_url="")
    if _state()["base_rev"] == 0:
        mark_dirty()
    return HTMLResponse(_callback_page(
        "Google account connected", "You can close this tab and go back to the app."
    ))


def _user_count() -> int:
    db = SessionLocal()
    try:
        return db.query(User).count()
    finally:
        db.close()


# First-run setup on a new laptop (no login exists yet)
@public_router.post("/setup/connect")
def setup_connect():
    if _user_count() > 0:
        raise HTTPException(403, "Already set up")
    url = _start_oauth()
    return {"status": "waiting", "url": url}


@public_router.post("/setup/pull")
def setup_pull():
    if _user_count() > 0:
        raise HTTPException(403, "Already set up")
    s = sync_now(force="drive", manual=True)
    if s["status"] == "error":
        raise HTTPException(400, s["error"])
    if s["status"] == "offline":
        raise HTTPException(502, "No internet connection")
    return public_state()


# Admin actions
class Resolve(BaseModel):
    keep: Literal["local", "drive"]


@router.post("/connect")
def connect():
    url = _start_oauth()
    return {"status": "waiting", "url": url}


@router.post("/disconnect")
def disconnect():
    TOKEN_FILE.unlink(missing_ok=True)
    _save(base_rev=0, dirty=False, status="idle", error="", oauth_error="", oauth_url="")
    return public_state()


@router.post("/now")
def now():
    sync_now(manual=True)
    return public_state()


@router.post("/resolve")
def resolve(data: Resolve):
    sync_now(force="drive" if data.keep == "drive" else "local", manual=True)
    return public_state()