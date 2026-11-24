import os
from getpass import getpass

from app.database import SessionLocal
from app.models import User
from app.security import hash_password

db = SessionLocal()

try:
    email = os.getenv("ADMIN_EMAIL", "").strip().lower() or input(
        "Admin email: "
    ).strip().lower()

    user = db.query(User).filter(
        User.email == email,
        User.role == "Admin"
    ).first()

    if not user:
        print("Admin account not found.")
    else:
        password = getpass("Enter new Admin password: ")
        confirm = getpass("Confirm new Admin password: ")

        if password != confirm:
            print("Passwords do not match.")
        elif len(password) < 8 or len(password.encode("utf-8")) > 72:
            print("Password must be 8 to 72 bytes long.")
        else:
            user.password_hash = hash_password(password)
            db.commit()
            print("Admin password updated successfully.")

finally:
    db.close()