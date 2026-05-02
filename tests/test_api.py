"""
Tests for Calorie Vision API endpoints.
"""

import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


# ──────────────────────────────────────────
# GET /
# ──────────────────────────────────────────
class TestIndex:
    def test_serves_html(self):
        """GET / should return the index.html page."""
        response = client.get("/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert "Calorie Vision" in response.text


# ──────────────────────────────────────────
# POST /api/analyze — validation
# ──────────────────────────────────────────
class TestAnalyzeValidation:
    def test_missing_image_returns_422(self):
        """POST /api/analyze without image should return 422."""
        response = client.post("/api/analyze", json={"description": "test"})
        assert response.status_code == 422

    def test_empty_body_returns_422(self):
        """POST /api/analyze with empty body should return 422."""
        response = client.post("/api/analyze", json={})
        assert response.status_code == 422

    @patch("main.OPENROUTER_API_KEY", "")
    def test_missing_api_key_returns_500(self):
        """Should return 500 if OPENROUTER_API_KEY is not set."""
        response = client.post("/api/analyze", json={"image": "dGVzdA=="})
        assert response.status_code == 500
        assert "OPENROUTER_API_KEY" in response.json()["detail"]


# ──────────────────────────────────────────
# POST /api/analyze — mocked OpenRouter
# ──────────────────────────────────────────
MOCK_LLM_RESPONSE = {
    "items": [
        {
            "name": "Grilled Chicken",
            "calories": 300,
            "protein": 32,
            "carbs": 0,
            "fat": 15,
            "weight_g": 200,
        }
    ],
    "total": {"calories": 300, "protein": 32, "carbs": 0, "fat": 15},
    "suggestions": "Consider adding some vegetables for fiber.",
}


class TestAnalyzeSuccess:
    @patch("main.OPENROUTER_API_KEY", "test-key-123")
    @patch("main.httpx.AsyncClient")
    def test_successful_analysis(self, mock_client_class):
        """Should return structured nutritional data on success."""
        # Build mock response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(MOCK_LLM_RESPONSE)
                    }
                }
            ]
        }

        # Wire up the async context manager
        mock_instance = AsyncMock()
        mock_instance.post.return_value = mock_response
        mock_instance.__aenter__.return_value = mock_instance
        mock_instance.__aexit__.return_value = None
        mock_client_class.return_value = mock_instance

        response = client.post(
            "/api/analyze",
            json={"image": "dGVzdA==", "description": "grilled chicken"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "suggestions" in data
        assert data["items"][0]["name"] == "Grilled Chicken"
        assert data["total"]["calories"] == 300

    @patch("main.OPENROUTER_API_KEY", "test-key-123")
    @patch("main.httpx.AsyncClient")
    def test_handles_markdown_wrapped_response(self, mock_client_class):
        """Should handle LLM responses wrapped in markdown code fences."""
        wrapped_content = "```json\n" + json.dumps(MOCK_LLM_RESPONSE) + "\n```"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": wrapped_content}}]
        }

        mock_instance = AsyncMock()
        mock_instance.post.return_value = mock_response
        mock_instance.__aenter__.return_value = mock_instance
        mock_instance.__aexit__.return_value = None
        mock_client_class.return_value = mock_instance

        response = client.post("/api/analyze", json={"image": "dGVzdA=="})
        assert response.status_code == 200
        data = response.json()
        assert data["items"][0]["name"] == "Grilled Chicken"

    @patch("main.OPENROUTER_API_KEY", "test-key-123")
    @patch("main.httpx.AsyncClient")
    def test_optional_description(self, mock_client_class):
        """Should work with or without a description."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": json.dumps(MOCK_LLM_RESPONSE)}}]
        }

        mock_instance = AsyncMock()
        mock_instance.post.return_value = mock_response
        mock_instance.__aenter__.return_value = mock_instance
        mock_instance.__aexit__.return_value = None
        mock_client_class.return_value = mock_instance

        # Without description
        response = client.post("/api/analyze", json={"image": "dGVzdA=="})
        assert response.status_code == 200


# ──────────────────────────────────────────
# POST /api/analyze — error handling
# ──────────────────────────────────────────
class TestAnalyzeErrors:
    @patch("main.OPENROUTER_API_KEY", "test-key-123")
    @patch("main.httpx.AsyncClient")
    def test_openrouter_http_error(self, mock_client_class):
        """Should return 502 when OpenRouter returns an HTTP error."""
        import httpx

        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_response.text = "Rate limited"

        mock_instance = AsyncMock()
        mock_instance.post.side_effect = httpx.HTTPStatusError(
            "rate limited",
            request=MagicMock(),
            response=mock_response,
        )
        mock_instance.__aenter__.return_value = mock_instance
        mock_instance.__aexit__.return_value = None
        mock_client_class.return_value = mock_instance

        response = client.post("/api/analyze", json={"image": "dGVzdA=="})
        assert response.status_code == 502

    @patch("main.OPENROUTER_API_KEY", "test-key-123")
    @patch("main.httpx.AsyncClient")
    def test_invalid_json_from_llm(self, mock_client_class):
        """Should return 502 when LLM returns invalid JSON."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "This is not JSON at all"}}]
        }

        mock_instance = AsyncMock()
        mock_instance.post.return_value = mock_response
        mock_instance.__aenter__.return_value = mock_instance
        mock_instance.__aexit__.return_value = None
        mock_client_class.return_value = mock_instance

        response = client.post("/api/analyze", json={"image": "dGVzdA=="})
        assert response.status_code == 502
        assert "parse" in response.json()["detail"].lower()
