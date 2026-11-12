from logging.config import fileConfig

from alembic import context

from app.backend import models  # noqa: F401  (registers the tables)
from app.backend.db import Base, engine

if context.config.config_file_name:
    fileConfig(context.config.config_file_name)


def run() -> None:
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=Base.metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


run()
