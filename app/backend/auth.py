"""Accounts: sign up, sign in, sign out, who am I.

Passwords are hashed with scrypt (stdlib). A session is a random token in an httpOnly, SameSite=Lax cookie; only
its sha256 is stored, so a leaked sessions table cannot be replayed. Everyone who signs up is a `user`; admins are
made with `python -m app.backend.cli create-admin`.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from . import config
from .db import get_db
from .models import AuthSession, User

router = APIRouter(prefix="/api/auth", tags=["auth"])
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8
_N, _R, _P = 2 ** 14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def user_json(u: User) -> dict:
    return {"id": str(u.id), "email": u.email, "name": u.name or u.email.split("@")[0], "role": u.role,
            "is_admin": u.role == "admin", "created_at": u.created_at.isoformat() if u.created_at else None}


def find_user(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))


def start_session(db: Session, user: User, request: Request, response: Response, remember: bool = True) -> None:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=config.SESSION_DAYS if remember else 1)
    db.add(AuthSession(token_hash=_token_hash(token), user_id=user.id, expires_at=expires,
                       user_agent=(request.headers.get("user-agent") or "")[:300]))
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    response.set_cookie(config.COOKIE_NAME, token, httponly=True, samesite="lax", secure=config.COOKIE_SECURE,
                        max_age=int((expires - datetime.now(timezone.utc)).total_seconds()) if remember else None, path="/")


def session_user(db: Session, request: Request) -> User | None:
    token = request.cookies.get(config.COOKIE_NAME)
    if not token:
        return None
    s = db.get(AuthSession, _token_hash(token))
    if not s or s.expires_at < datetime.now(timezone.utc):
        return None
    return s.user


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = session_user(db, request)
    if not user:
        raise HTTPException(401, "sign in to continue")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "admins only")
    return user


# Failed sign-ins per email and per address in the last 15 minutes; enough to stop guessing, kept in memory.
_fails: dict[str, deque] = defaultdict(deque)
WINDOW_S, MAX_FAILS = 15 * 60, 8


def _throttled(*keys: str) -> bool:
    now = time.time()
    for k in keys:
        q = _fails[k]
        while q and q[0] < now - WINDOW_S:
            q.popleft()
        if len(q) >= MAX_FAILS:
            return True
    return False


def _fail(*keys: str) -> None:
    for k in keys:
        _fails[k].append(time.time())


@router.post("/signup")
def signup(request: Request, response: Response, body: dict = Body(...), db: Session = Depends(get_db)) -> dict:
    email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "")
    name = str(body.get("name") or "").strip()[:120]
    if not EMAIL.match(email):
        raise HTTPException(422, "enter a valid email address")
    if len(password) < MIN_PASSWORD:
        raise HTTPException(422, f"use at least {MIN_PASSWORD} characters for the password")
    if find_user(db, email):
        raise HTTPException(409, "an account with this email already exists")
    user = User(email=email, name=name, password_hash=hash_password(password), role="user")
    db.add(user)
    db.flush()
    start_session(db, user, request, response)
    return user_json(user)


@router.post("/signin")
def signin(request: Request, response: Response, body: dict = Body(...), db: Session = Depends(get_db)) -> dict:
    email = str(body.get("email") or "").strip().lower()
    ip = request.client.host if request.client else "?"
    if _throttled(f"e:{email}", f"i:{ip}"):
        raise HTTPException(429, "too many attempts; try again in a few minutes")
    user = find_user(db, email)
    if not user or not verify_password(str(body.get("password") or ""), user.password_hash):
        _fail(f"e:{email}", f"i:{ip}")
        raise HTTPException(401, "wrong email or password")
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at < func.now()))
    start_session(db, user, request, response, remember=bool(body.get("remember", True)))
    return user_json(user)


@router.post("/signout")
def signout(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    token = request.cookies.get(config.COOKIE_NAME)
    if token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == _token_hash(token)))
        db.commit()
    response.delete_cookie(config.COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict:
    return user_json(user)
