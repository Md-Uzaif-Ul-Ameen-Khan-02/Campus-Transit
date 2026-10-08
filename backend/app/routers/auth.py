from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import EmailStr
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import Driver, StudentProfile, User
from ..schemas import ProfileOut, RegisterIn, TokenOut
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.post("/register", response_model=TokenOut)
def register(data: RegisterIn, db: Session = Depends(get_db)):
    if data.role not in ("student", "driver"):
        raise HTTPException(400, "Admin accounts are created by administrators only")
    if db.query(User).filter(User.email == data.email.lower()).first():
        raise HTTPException(409, "An account with this email already exists")

    user = User(
        id="",  # assigned below with uniqueness check
        email=data.email.lower(),
        phone=data.phone,
        full_name=data.full_name.strip(),
        role=data.role,
        password_hash=hash_password(data.password),
    )
    # ensure unique id
    while db.get(User, user.id):
        import uuid

        user.id = f"usr_{uuid.uuid4().hex[:10]}"
    db.add(user)
    db.flush()

    if data.role == "student":
        db.add(StudentProfile(user_id=user.id))
    else:
        db.add(Driver(user_id=user.id, employee_code=data.employee_code, status="offline"))
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.role)
    return TokenOut(access_token=token, role=user.role, full_name=user.full_name, user_id=user.id)


@router.post("/login", response_model=TokenOut)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username.lower()).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    if user.disabled:
        raise HTTPException(403, "This account has been deactivated")

    if user.role == "driver":
        drv = db.query(Driver).filter(Driver.user_id == user.id).first()
        if drv and not drv.active:
            raise HTTPException(403, "Driver account is deactivated")

    token = create_access_token(user.id, user.role)
    return TokenOut(access_token=token, role=user.role, full_name=user.full_name, user_id=user.id)


@router.get("/me", response_model=ProfileOut)
def me(user: User = Depends(get_current_user)):
    return user
