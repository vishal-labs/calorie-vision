import os
import time
import datetime
import secrets
from collections import defaultdict, deque
import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import DB
from models import User, AppSecret

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 30

# Set from the JWT_SECRET env var, or loaded/created in the database at startup
# (see load_jwt_secret). The random fallback only matters before startup, e.g. in tests.
_jwt_secret: str = os.getenv("JWT_SECRET") or secrets.token_urlsafe(48)

security = HTTPBearer()


async def load_jwt_secret(db: AsyncSession) -> None:
    """Use JWT_SECRET if set, otherwise a random secret persisted in the database.

    Persisting it keeps sessions valid across container restarts without
    shipping a guessable default secret.
    """
    global _jwt_secret
    if os.getenv("JWT_SECRET"):
        return
    row = await db.get(AppSecret, "jwt_secret")
    if row is None:
        row = AppSecret(name="jwt_secret", value=secrets.token_urlsafe(48))
        db.add(row)
        await db.commit()
    _jwt_secret = row.value


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user_id: int, username: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, _jwt_secret, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _jwt_secret, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session. Sign in again.")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = DB,
) -> User:
    payload = decode_token(credentials.credentials)
    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid session. Sign in again.")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def generate_reset_token() -> str:
    """Generate a secure random token for password reset."""
    return secrets.token_urlsafe(32)


def verify_reset_token(token: str) -> bool:
    """Verify that a reset token has the correct format."""
    return len(token) == 43


class RateLimiter:
    """In-memory sliding-window limiter for auth endpoints (single process)."""

    def __init__(self, max_attempts: int, window_seconds: int):
        self.max_attempts = max_attempts
        self.window = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> deque:
        hits = self._hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        return hits

    def check(self, key: str) -> None:
        if len(self._prune(key, time.monotonic())) >= self.max_attempts:
            raise HTTPException(
                status_code=429,
                detail="Too many attempts. Wait a few minutes and try again.",
            )

    def hit(self, key: str) -> None:
        now = time.monotonic()
        self._prune(key, now).append(now)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)


login_limiter = RateLimiter(max_attempts=8, window_seconds=15 * 60)
reset_limiter = RateLimiter(max_attempts=5, window_seconds=15 * 60)
