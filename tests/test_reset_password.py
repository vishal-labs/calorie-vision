import pytest
import pytest_asyncio
import datetime
import secrets
from sqlalchemy import select

from models import User
from auth import hash_password, generate_reset_token, verify_reset_token
from tests.conftest import create_test_user


class TestResetPassword:
    """Tests for the password reset flow."""

    @pytest.mark.asyncio
    async def test_request_password_reset(self, client, db_session):
        """Test requesting a password reset generates a token."""
        # Create a test user
        user = await create_test_user(db_session, username="resetuser", password="oldpass")

        # Request password reset
        response = await client.post(
            "/api/auth/forgot-password",
            json={"username": "resetuser"}
        )

        assert response.status_code == 200
        data = response.json()
        assert "reset_token" in data
        assert "message" in data

        # Verify token was stored in database
        result = await db_session.execute(select(User).where(User.username == "resetuser"))
        db_user = result.scalar_one()
        assert db_user.reset_token is not None
        assert db_user.reset_expiry is not None

    @pytest.mark.asyncio
    async def test_request_password_reset_nonexistent_user(self, client):
        """Test requesting reset for nonexistent user returns success (prevents enumeration)."""
        response = await client.post(
            "/api/auth/forgot-password",
            json={"username": "nonexistent"}
        )

        assert response.status_code == 200
        data = response.json()
        # Should return empty token to prevent username enumeration
        assert data["reset_token"] == ""

    @pytest.mark.asyncio
    async def test_reset_password_with_valid_token(self, client, db_session):
        """Test resetting password with a valid token."""
        # Create user and request reset
        user = await create_test_user(db_session, username="validtoken", password="oldpass")

        # Get the reset token
        reset_response = await client.post(
            "/api/auth/forgot-password",
            json={"username": "validtoken"}
        )
        reset_token = reset_response.json()["reset_token"]

        # Reset password
        response = await client.post(
            "/api/auth/reset-password",
            json={
                "username": "validtoken",
                "reset_token": reset_token,
                "new_password": "newpass123"
            }
        )

        assert response.status_code == 200
        assert response.json()["message"] == "Password reset successfully"

        # Verify password was updated
        result = await db_session.execute(select(User).where(User.username == "validtoken"))
        db_user = result.scalar_one()
        assert db_user.password_hash != hash_password("oldpass")
        # Token should be cleared
        assert db_user.reset_token is None
        assert db_user.reset_expiry is None

    @pytest.mark.asyncio
    async def test_reset_password_invalid_token(self, client, db_session):
        """Test resetting password with invalid token fails."""
        user = await create_test_user(db_session, username="invalidtoken", password="oldpass")

        # Request reset first to set token
        await client.post(
            "/api/auth/forgot-password",
            json={"username": "invalidtoken"}
        )

        # Try to reset with wrong token
        response = await client.post(
            "/api/auth/reset-password",
            json={
                "username": "invalidtoken",
                "reset_token": "invalid_token_12345",
                "new_password": "newpass"
            }
        )

        assert response.status_code == 400
        assert "Invalid reset token" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_reset_password_expired_token(self, client, db_session):
        """Test resetting password with expired token fails."""
        user = await create_test_user(db_session, username="expiredtoken", password="oldpass")

        # First request a reset token
        reset_response = await client.post(
            "/api/auth/forgot-password",
            json={"username": "expiredtoken"}
        )
        reset_token = reset_response.json()["reset_token"]

        # Now manually update the expiry to be in the past (bypass the endpoint to set expired)
        result = await db_session.execute(select(User).where(User.username == "expiredtoken"))
        db_user = result.scalar_one()
        db_user.reset_expiry = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
        await db_session.flush()
        await db_session.commit()

        # Try to reset with expired token
        response = await client.post(
            "/api/auth/reset-password",
            json={
                "username": "expiredtoken",
                "reset_token": reset_token,
                "new_password": "newpass"
            }
        )

        assert response.status_code == 400
        assert "expired" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_reset_password_wrong_username(self, client, db_session):
        """Test resetting password with wrong username fails."""
        user = await create_test_user(db_session, username="correctuser", password="oldpass")

        # Get reset token
        reset_response = await client.post(
            "/api/auth/forgot-password",
            json={"username": "correctuser"}
        )
        reset_token = reset_response.json()["reset_token"]

        # Try with different username
        response = await client.post(
            "/api/auth/reset-password",
            json={
                "username": "wronguser",
                "reset_token": reset_token,
                "new_password": "newpass"
            }
        )

        assert response.status_code == 400


class TestAuthHelpers:
    """Tests for auth helper functions."""

    def test_generate_reset_token(self):
        """Test token generation produces valid format."""
        token = generate_reset_token()
        assert isinstance(token, str)
        assert len(token) == 43  # token_urlsafe(32) produces 43 chars
        assert verify_reset_token(token)

    def test_verify_reset_token_valid(self):
        """Test valid token verification."""
        token = generate_reset_token()
        assert verify_reset_token(token) is True

    def test_verify_reset_token_invalid_length(self):
        """Test invalid token format is rejected."""
        assert verify_reset_token("short") is False
        assert verify_reset_token("a" * 100) is False
        assert verify_reset_token("") is False