import json
import logging
import os
import secrets
import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.database import SessionLocal, data_dir
from app.models import User
from app.schemas import LoginRequest, PasswordChange, PasswordText, TokenResponse, UserResponse
from app.security import (
    bump_token_version,
    create_token,
    decode_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["Auth"])
bearer = HTTPBearer(auto_error=False)

MAX_ATTEMPTS = 5
LOCK_SECONDS = 15 * 60
failed_logins: dict[str, list[float]] = {}
logger = logging.getLogger(__name__)
RESET_CODES_FILE = data_dir() / "reset_codes.json"
RESET_LOCK = threading.Lock()
STAFF_ACCESS_ENABLED = os.getenv("STAFF_ACCESS_ENABLED", "").strip().lower() in {
    "1", "true", "yes", "on",
}
STAFF_DISABLED_MESSAGE = "Staff access is currently disabled. Use an Admin account."


def login_key(email: str, request: Request) -> str:
    host = request.client.host if request.client else "unknown"
    return f"{email}|{host}"


def check_not_locked(key: str):
    now = time.time()
    recent = [t for t in failed_logins.get(key, []) if now - t < LOCK_SECONDS]
    failed_logins[key] = recent
    if len(recent) >= MAX_ATTEMPTS:
        minutes = int((recent[0] + LOCK_SECONDS - now) // 60) + 1
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {minutes} minute(s)",
        )


def _read_reset_codes() -> dict[str, tuple[str, float]]:
    with RESET_LOCK:
        try:
            raw = json.loads(RESET_CODES_FILE.read_text())
        except Exception:
            return {}
        now = time.time()
        cleaned = {}
        for email, item in raw.items():
            try:
                code, expires = str(item[0]), float(item[1])
            except Exception:
                continue
            if expires > now:
                cleaned[email] = (code, expires)
        return cleaned


def _write_reset_codes(codes: dict[str, tuple[str, float]]) -> None:
    with RESET_LOCK:
        temp = RESET_CODES_FILE.with_suffix(".tmp")
        temp.write_text(json.dumps(codes))
        os.replace(temp, RESET_CODES_FILE)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Please log in to continue")

    payload = decode_token(credentials.credentials)
    try:
        user_id = int(payload["sub"]) if payload else 0
    except (KeyError, TypeError, ValueError):
        user_id = 0
    if not payload or user_id <= 0:
        raise HTTPException(
            status_code=401,
            detail="Your session has expired. Please log in again",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="This account is not available")
    if int(payload.get("ver", 0) or 0) != int(user.token_version or 0):
        raise HTTPException(
            status_code=401,
            detail="The account details changed. Please sign in again",
        )
    if user.role != "Admin" and not STAFF_ACCESS_ENABLED:
        raise HTTPException(status_code=403, detail=STAFF_DISABLED_MESSAGE)
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only an admin can do this")
    return user


@router.get("/config")
def auth_config():
    return {"staff_enabled": STAFF_ACCESS_ENABLED}


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    key = login_key(email, request)
    check_not_locked(key)

    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(data.password, user.password_hash):
        failed_logins.setdefault(key, []).append(time.time())
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="This account has been disabled")
    if user.role != "Admin" and not STAFF_ACCESS_ENABLED:
        raise HTTPException(status_code=403, detail=STAFF_DISABLED_MESSAGE)

    failed_logins.pop(key, None)
    return TokenResponse(
        access_token=create_token(user.id, user.role, user.token_version),
        user=user,
    )


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password")
def change_password(
    data: PasswordChange,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Your current password is incorrect")
    if data.new_password == data.current_password:
        raise HTTPException(
            status_code=422,
            detail="The new password must be different from the current one",
        )

    user.password_hash = hash_password(data.new_password)
    bump_token_version(user)
    db.commit()
    return {"message": "Password changed"}


class ForgotRequest(BaseModel):
    email: EmailStr


class ResetRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: PasswordText


class RecoveryReset(BaseModel):
    email: EmailStr
    recovery_key: str
    new_password: PasswordText


class AdminReset(BaseModel):
    new_password: PasswordText


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/forgot-password")
def forgot_password(data: ForgotRequest, request: Request, db: Session = Depends(get_db)):
    from app.mailer import send_mail

    email = data.email.strip().lower()
    key = f"forgot|{email}|{_client(request)}"
    check_not_locked(key)

    user = db.query(User).filter(User.email == email).first()
    if not user or not user.is_active:
        failed_logins.setdefault(key, []).append(time.time())
        return {"message": "If this email has an account, a code has been sent."}

    code = f"{secrets.randbelow(10**6):06d}"
    try:
        send_mail(
            email,
            "Your GST Office password reset code",
            f"Hello {user.full_name},\n\nYour password reset code is {code}.\n"
            "It expires in 10 minutes. If you did not ask for this, ignore this email.",
        )
        codes = _read_reset_codes()
        codes[email] = (code, time.time() + 600)
        _write_reset_codes(codes)
    except Exception:
        logger.warning("Password reset email could not be sent", exc_info=True)
    return {"message": "If this email has an account, a code has been sent."}


@router.post("/reset-password")
def reset_password(data: ResetRequest, request: Request, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    key = f"reset|{email}|{_client(request)}"
    check_not_locked(key)
    saved = _read_reset_codes().get(email)
    if not saved or time.time() > saved[1] or not secrets.compare_digest(saved[0], data.code.strip()):
        failed_logins.setdefault(key, []).append(time.time())
        raise HTTPException(400, "The code is wrong or has expired")
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(400, "The code is wrong or has expired")
    user.password_hash = hash_password(data.new_password)
    bump_token_version(user)
    db.commit()
    codes = _read_reset_codes()
    codes.pop(email, None)
    _write_reset_codes(codes)
    failed_logins.pop(key, None)
    failed_logins.pop(f"forgot|{email}|{_client(request)}", None)
    return {"message": "Password changed. You can sign in now."}


@router.post("/reset-with-recovery-key")
def reset_with_recovery_key(data: RecoveryReset, request: Request, db: Session = Depends(get_db)):
    key = f"recovery|{_client(request)}"
    check_not_locked(key)
    try:
        saved = json.loads((data_dir() / "recovery.json").read_text())["hash"]
    except Exception:
        saved = None
    email = data.email.strip().lower()
    user = db.query(User).filter(User.email == email, User.role == "Admin").first()
    ok = bool(saved and user and verify_password(data.recovery_key.strip().upper(), saved))
    if not ok:
        failed_logins.setdefault(key, []).append(time.time())
        raise HTTPException(400, "Email or recovery key is wrong")
    user.password_hash = hash_password(data.new_password)
    bump_token_version(user)
    db.commit()
    return {"message": "Password changed. You can sign in now."}


@router.post("/admin-reset/{user_id}")
def admin_reset(user_id: int, data: AdminReset, db: Session = Depends(get_db),
                _: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.password_hash = hash_password(data.new_password)
    bump_token_version(user)
    db.commit()
    return {"message": "Password changed"}


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: PasswordText


@router.post("/register", status_code=201)
def register(
    data: RegisterRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if db.query(User).count() == 0:
        raise HTTPException(status_code=403, detail="Complete the first-time setup first")
    if not STAFF_ACCESS_ENABLED:
        raise HTTPException(status_code=403, detail=STAFF_DISABLED_MESSAGE)

    email = data.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    db.add(User(
        full_name=data.full_name.strip(), email=email,
        password_hash=hash_password(data.password),
        token_version=0,
        role="Staff", is_active=True,
    ))
    db.commit()
    return {"message": "Account created. You can sign in now."}
