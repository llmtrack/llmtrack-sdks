"""Opt-in live checks. Requires a dedicated LLMTRACK_API_KEY."""
import asyncio
import os
import uuid

from llmtrack_sdk import LLMtrack, LLMtrackError

API_KEY = os.environ.get("LLMTRACK_API_KEY")
if not API_KEY:
    raise SystemExit("FAIL setup: LLMTRACK_API_KEY is required")
EVENT = dict(provider="openai", model="gpt-4o-mini", prompt_tokens=2, completion_tokens=1,
             reasoning_tokens=1, feature="sdk-integration")
failures = 0

async def check(name, operation):
    global failures
    try:
        await operation()
        print(f"PASS {name}")
    except Exception as exc:
        failures += 1
        print(f"FAIL {name}: {exc}")

async def callback_error(client):
    loop = asyncio.get_running_loop()
    done = loop.create_future()
    def receive(error):
        loop.call_soon_threadsafe(lambda: None if done.done() else done.set_result(error))
    client.on_error = receive
    client.track(**EVENT)
    return await asyncio.wait_for(done, 7)

async def main():
    client = LLMtrack(api_key=API_KEY)
    await check("happy path with reasoning tokens", lambda: client.track_sync(**EVENT))
    async def invalid():
        error = await callback_error(LLMtrack(api_key="invalid-integration-key", max_retries=1))
        assert error.code == "INVALID_API_KEY", error.code
    await check("invalid key is reported and track never raises", invalid)
    async def visibility():
        warnings=[]; c=LLMtrack(api_key=API_KEY, environment=f"sdk-mismatch-{uuid.uuid4()}", on_warning=warnings.append)
        await c.track_sync(**EVENT)
        assert any(w.code == "NOT_DASHBOARD_VISIBLE" for w in warnings), "use a free-plan test key bound to another environment"
    await check("free-plan visibility warning", visibility)
    async def pricing():
        warnings=[]; c=LLMtrack(api_key=API_KEY, on_warning=warnings.append)
        await c.track_sync(**{**EVENT,"model":f"unknown-integration-{uuid.uuid4()}"})
        assert any(w.code == "UNKNOWN_MODEL" for w in warnings), "missing UNKNOWN_MODEL warning"
    await check("unknown-model pricing warning", pricing)
    async def invalid_payload(**changes):
        try: await client.track_sync(**{**EVENT,**changes})
        except LLMtrackError as exc:
            assert exc.code == "INVALID_PAYLOAD"; return
        raise AssertionError("expected INVALID_PAYLOAD")
    await check("oversized metadata is rejected client-side", lambda: invalid_payload(metadata={"value":"x"*8193}))
    await check("negative tokens are rejected client-side", lambda: invalid_payload(prompt_tokens=-1))
    async def duplicate():
        key=str(uuid.uuid4()); await client.track_sync(**EVENT,idempotency_key=key)
        second=await client.track_sync(**EVENT,idempotency_key=key); assert second["duplicate"] is True
    await check("same idempotency key is a successful duplicate", duplicate)
    async def network():
        error=await callback_error(LLMtrack(api_key=API_KEY,base_url="http://127.0.0.1:1",timeout_ms=250,max_retries=1))
        assert error.code == "NETWORK_ERROR", error.code
    await check("unreachable network failure is reported without raising", network)

asyncio.run(main())
raise SystemExit(1 if failures else 0)
