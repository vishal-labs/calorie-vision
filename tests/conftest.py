import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool
from httpx import AsyncClient, ASGITransport
import tempfile
import os

from database import Base, get_db
from models import User, Meal, Preset, Budget
from auth import hash_password, create_token
from main import app


@pytest.fixture(scope="session")
def db_path():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    yield path
    os.unlink(path)


@pytest.fixture(scope="session")
def engine(db_path):
    url = f"sqlite+aiosqlite:///{db_path}"
    return create_async_engine(url, echo=False, poolclass=NullPool)


@pytest.fixture(scope="session")
def session_factory(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture(autouse=True)
async def setup_db(engine):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session(session_factory):
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(session_factory):
    async def _override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


async def create_test_user(db_session, username="testuser", password="testpass", must_change=False):
    user = User(
        username=username,
        password_hash=hash_password(password),
        must_change_password=must_change,
    )
    db_session.add(user)
    await db_session.flush()
    budget = Budget(user_id=user.id, daily_calories=2000)
    db_session.add(budget)
    await db_session.flush()
    await db_session.commit()
    return user


def auth_headers(user):
    token = create_token(user.id, user.username)
    return {"Authorization": f"Bearer {token}"}
