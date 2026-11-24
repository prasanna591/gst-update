import json
import secrets
import threading

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import get_db
from app.database import data_dir
from app.models import User
from app.schemas import PasswordText
from app.security import hash_password

router = APIRouter(prefix="/api/setup", tags=["Setup"])
SETUP_LOCK = threading.Lock()


class AdminCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: PasswordText


@router.get("/status")
def setup_status(db: Session = Depends(get_db)):
    return {"needs_setup": db.query(User).count() == 0}


@router.post("/admin", status_code=201)
def create_first_admin(data: AdminCreate, db: Session = Depends(get_db)):
    with SETUP_LOCK:
        if db.get_bind().dialect.name == "postgresql":
            db.execute(text(f'LOCK TABLE "{User.__tablename__}" IN EXCLUSIVE MODE'))

        if db.query(User).count() > 0:
            db.rollback()
            raise HTTPException(status_code=403, detail="Setup is already complete")

        user = User(
            full_name=data.full_name.strip(),
            email=data.email.strip().lower(),
            password_hash=hash_password(data.password),
            token_version=0,
            role="Admin",
            is_active=True,
        )
        db.add(user)
        db.commit()

        raw = secrets.token_hex(8).upper()
        recovery_key = "-".join(raw[i:i + 4] for i in range(0, 16, 4))
        (data_dir() / "recovery.json").write_text(
            json.dumps({"hash": hash_password(recovery_key.upper())})
        )
        return {"status": "created", "recovery_key": recovery_key}