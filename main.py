"""
Calorie Vision — FastAPI Backend
Analyzes food images via OpenRouter (Gemma-4) and returns nutritional breakdowns.
"""

import os
import json
import asyncio
import httpx
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

load_dotenv()

# ──────────────────────────────────────────────
# MODEL CONFIGURATION — Change the model here
# ──────────────────────────────────────────────
LLM_MODEL = "google/gemma-4-31b-it:free"
# Other options:
#   "google/gemma-4-31b-it"          ← paid, more reliable
#   "google/gemma-4-27b-it"          ← smaller, faster
#   "meta-llama/llama-4-maverick:free" ← free alternative
# ──────────────────────────────────────────────

MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 1  # doubles each attempt: 1s → 2s → 4s

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """You are a nutritional analysis assistant. You will receive an image of a food item or meal, and optionally a text description from the user.

Your job is to:
1. Identify every distinct food item visible in the image.
2. For each item, estimate: calories (kcal), protein (g), carbs (g), fat (g), and approximate weight (g).
3. Provide a total summary across all items.
4. Give a short, practical suggestion to help the user stay within their calorie budget.

You MUST respond with ONLY valid JSON in this exact schema — no markdown, no explanation, no code fences:
{
  "items": [
    {
      "name": "Item Name",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "weight_g": 0
    }
  ],
  "total": {
    "calories": 0,
    "protein": 0,
    "carbs": 0,
    "fat": 0
  },
  "suggestions": "A short, helpful suggestion."
}

Be realistic with estimates. If unsure, give a reasonable mid-range estimate. Always respond with valid JSON only."""


app = FastAPI(title="Calorie Vision", version="0.1.0")

# Mount static files
static_dir = Path(__file__).parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


class AnalyzeRequest(BaseModel):
    image: str  # base64-encoded JPEG
    description: Optional[str] = None


class FoodItem(BaseModel):
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    weight_g: float


class AnalyzeResponse(BaseModel):
    items: list[FoodItem]
    total: dict
    suggestions: str


@app.get("/")
async def serve_index():
    """Serve the main SPA page."""
    return FileResponse(str(static_dir / "index.html"))


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_food(request: AnalyzeRequest):
    """Send food image to Gemma-4 via OpenRouter and return nutritional analysis."""
    if not OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENROUTER_API_KEY is not set. Add it to the .env file.",
        )

    # Build the user message content
    user_content = [
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{request.image}"},
        },
    ]

    if request.description:
        user_content.insert(
            0, {"type": "text", "text": f"Description: {request.description}"}
        )

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.3,
        "max_tokens": 1024,
    }

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8000",
        "X-Title": "Calorie Vision",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                response = await client.post(
                    OPENROUTER_URL, json=payload, headers=headers
                )
                response.raise_for_status()
                break  # success
            except httpx.HTTPStatusError as e:
                last_error = e
                # Only retry on server errors (5xx)
                if e.response.status_code >= 500 and attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAY_SECONDS * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
                raise HTTPException(
                    status_code=502,
                    detail=f"OpenRouter API error after {attempt + 1} attempt(s): {e.response.status_code} — {e.response.text}",
                )
            except httpx.RequestError as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAY_SECONDS * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to reach OpenRouter after {attempt + 1} attempt(s): {str(e)}",
                )

    data = response.json()

    try:
        content = data["choices"][0]["message"]["content"]
        # Strip markdown code fences if the model wraps its response
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]  # remove first line
            content = content.rsplit("```", 1)[0]  # remove last fence
            content = content.strip()
        result = json.loads(content)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to parse LLM response: {str(e)}. Raw: {data}",
        )

    return result


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
