import asyncio
import httpx
import pytest
from llmtrack_sdk import LLMTrack, LLMtrack, LLMtrackError, from_anthropic_usage, from_openai_usage

def test_llmtrack_alias():
    assert LLMTrack is LLMtrack

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

def test_openai_chat_completions_adapter():
    class Details:
        reasoning_tokens = 2
        cached_tokens = 4
    class Usage:
        prompt_tokens = 10
        completion_tokens = 6
        total_tokens = 16
        prompt_tokens_details = Details()
        completion_tokens_details = Details()
    assert from_openai_usage(Usage()) == {"prompt_tokens": 10, "completion_tokens": 6, "total_tokens": 16,
        "reasoning_tokens": 2, "cached_input_tokens": 4, "cache_accounting": "inclusive"}

def test_openai_responses_adapter():
    usage = {"input_tokens": 11, "output_tokens": 7, "total_tokens": 18,
        "input_tokens_details": {"cached_tokens": 5}, "output_tokens_details": {"reasoning_tokens": 3}}
    assert from_openai_usage(usage) == {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18,
        "reasoning_tokens": 3, "cached_input_tokens": 5, "cache_accounting": "inclusive"}

def test_anthropic_adapter_and_missing_fields():
    assert from_anthropic_usage({"input_tokens": 12, "output_tokens": 8, "cache_read_input_tokens": 6,
        "cache_creation_input_tokens": 4}) == {"prompt_tokens": 12, "completion_tokens": 8,
        "cached_input_tokens": 6, "cache_write_tokens": 4, "cache_accounting": "exclusive"}
    assert from_anthropic_usage({"input_tokens": 12}) == {"prompt_tokens": 12, "cache_accounting": "exclusive"}
    assert from_openai_usage(None) == {}

@pytest.mark.asyncio
async def test_new_token_fields_and_cache_accounting_are_sent(monkeypatch):
    seen = {}
    async def post(self, url, **kwargs):
        seen.update(kwargs)
        return httpx.Response(200, json={"ok": True, "duplicate": True})
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    await LLMtrack(api_key="x").track_sync(provider="p", model="m", prompt_tokens=1, completion_tokens=2,
        total_tokens=10, cached_input_tokens=3, cache_write_tokens=4, cache_accounting="exclusive")
    assert seen["json"] == {"provider": "p", "model": "m", "prompt_tokens": 1, "completion_tokens": 2,
        "total_tokens": 10, "cached_input_tokens": 3, "cache_write_tokens": 4,
        "cache_accounting": "exclusive", "environment": "production"}

@pytest.mark.asyncio
async def test_invalid_cache_accounting_is_rejected():
    with pytest.raises(LLMtrackError, match="cache_accounting"):
        await LLMtrack(api_key="x").track_sync(provider="p", model="m", prompt_tokens=1,
            completion_tokens=2, cache_accounting="invalid")
