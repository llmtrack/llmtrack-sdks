import asyncio
import httpx
import pytest
from llmtrack_sdk import LLMtrack, LLMtrackError

@pytest.mark.asyncio
async def test_duplicate_and_idempotency(monkeypatch):
    seen = {}
    async def post(self, url, **kwargs):
        seen.update(kwargs); seen["url"] = url; return httpx.Response(200, json={"ok": True, "duplicate": True})
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    result = await LLMtrack(api_key="x").track_sync(provider="openai", model="m", prompt_tokens=1, completion_tokens=2, idempotency_key="same")
    assert result["duplicate"] and seen["headers"]["Idempotency-Key"] == "same"
    assert seen["url"].endswith("/api/ingest")

@pytest.mark.asyncio
async def test_oversize_is_client_side(monkeypatch):
    called = False
    async def post(*args, **kwargs):
        nonlocal called; called = True
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    with pytest.raises(LLMtrackError, match="8192"):
        await LLMtrack(api_key="x").track_sync(provider="p", model="m", prompt_tokens=0, completion_tokens=0, metadata={"x":"a"*8193})
    assert not called

def test_track_never_throws():
    LLMtrack(api_key="x").track(provider="", model="m", prompt_tokens=0, completion_tokens=0)
