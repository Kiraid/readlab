"""A fresh, migrated test database (readlab_test on the compose Postgres), and helpers to fill it."""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def prepare_database() -> None:
    from app.backend import config

    url = make_url(config.DATABASE_URL)
    try:
        admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
        with admin.connect() as c:
            if not c.scalar(text("SELECT 1 FROM pg_database WHERE datname = :d"), {"d": url.database}):
                c.execute(text(f'CREATE DATABASE "{url.database}"'))
        admin.dispose()
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"no Postgres for the app tests ({type(e).__name__}); run `docker compose up -d db`")
    from app.backend.db import engine

    with engine.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    from app.backend.cli import migrate

    migrate()


def make_user(client, email: str, password: str = "correct-horse-1", admin: bool = False) -> dict:
    r = client.post("/api/auth/signup", json={"email": email, "password": password, "name": email.split("@")[0]})
    assert r.status_code == 200, r.text
    if admin:
        from app.backend.db import session
        from app.backend.models import User

        with session() as db:
            u = db.query(User).filter(User.email == email).one()
            u.role = "admin"
            db.commit()
    return r.json()
