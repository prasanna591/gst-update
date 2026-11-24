from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import STAFF_ACCESS_ENABLED, get_db, require_admin
from app.models import User
from app.schemas import UserCreate, UserResponse, UserUpdate
from app.security import bump_token_version, hash_password

router = APIRouter(prefix="/api/users", tags=["Users"])


def _check_role_allowed(role: str) -> None:
    if role != "Admin" and not STAFF_ACCESS_ENABLED:
        raise HTTPException(
            status_code=422,
            detail="Staff accounts are currently disabled. Choose Admin.",
        )


@router.get("/", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return db.query(User).order_by(User.full_name).all()


@router.post("/", response_model=UserResponse, status_code=201)
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    _check_role_allowed(data.role)
    email = data.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="This email is already registered")

    user = User(
        full_name=data.full_name.strip(),
        email=email,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    _check_role_allowed(data.role)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == admin.id and (data.role != "Admin" or not data.is_active):
        raise HTTPException(
            status_code=422,
            detail="You cannot remove your own admin role or disable your own account",
        )

    removing_admin = (
        user.role == "Admin"
        and user.is_active
        and (data.role != "Admin" or not data.is_active)
    )
    if removing_admin:
        other_admins = (
            db.query(User)
            .filter(
                User.id != user.id,
                User.role == "Admin",
                User.is_active.is_(True),
            )
            .count()
        )
        if other_admins == 0:
            raise HTTPException(
                status_code=422,
                detail="At least one active admin account is required",
            )

    user.full_name = data.full_name.strip()
    user.role = data.role
    user.is_active = data.is_active
    if data.password:
        user.password_hash = hash_password(data.password)
        bump_token_version(user)

    db.commit()
    db.refresh(user)
    return user
