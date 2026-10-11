import os
from fastapi import Depends
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://calorievision:calorievision@localhost:5432/calorievision",
)

engine = create_async_engine(DATABASE_URL, echo=False)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# FastAPI's default "request" scope runs the code after `yield` (the commit) only
# once the response has been sent, so a client's next request could read stale
# data. "function" scope commits before the response goes out.
DB = Depends(get_db, scope="function")


def add_missing_columns(sync_conn) -> list[str]:
    """Add model columns that are missing from existing tables.

    create_all() only creates new tables, so columns added to a model later
    would never reach an existing deployment. Every column added this way must
    be nullable (no backfill is done).
    """
    insp = inspect(sync_conn)
    added = []
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        existing = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in existing:
                continue
            col_type = col.type.compile(dialect=sync_conn.dialect)
            sync_conn.exec_driver_sql(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col_type}')
            added.append(f"{table.name}.{col.name}")
    return added


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(add_missing_columns)
