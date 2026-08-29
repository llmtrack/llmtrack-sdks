from __future__ import annotations

import asyncio
import json
import logging
import random
import threading
import uuid
from dataclasses import dataclass
from typing import Any, Callable

import httpx


@dataclass(frozen=True)
class LLMtrackWarning:
    code: str
    message: str


class LLMtrackError(Exception):
    def __init__(self, code: str, message: str, payload: dict[str, Any], status: int | None = None, response_body: Any = None):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status
        self.response_body, self.payload = response_body, payload


_warned: set[str] = set()
_warning_lock = threading.Lock()


class LLMtrack:
    def __init__(self, *, api_key: str, base_url: str = "https://llm-track.com", environment: str = "production",
                 on_error: Callable[[LLMtrackError], None] | None = None,
                 on_warning: Callable[[LLMtrackWarning], None] | None = None, enabled: bool = True,
                 timeout_ms: int = 5000, max_retries: int = 3):
        if not api_key:
            raise ValueError("api_key is required")
        self.api_key, self.base_url, self.environment = api_key, base_url.rstrip("/"), environment
        self.on_error = on_error or (lambda e: logging.warning("[llmtrack] %s: %s", e.code, e.message))
        self.on_warning = on_warning or (lambda w: logging.warning("[llmtrack] %s: %s", w.code, w.message))
        self.enabled, self.timeout, self.max_retries = enabled, timeout_ms / 1000, max_retries

    def track(self, **event: Any) -> None:
        """Schedule delivery in a daemon thread; always return immediately and never raise."""
        if not self.enabled:
            return
        def run() -> None:
            try:
                asyncio.run(self.track_sync(**event))
            except Exception as exc:
                try:
                    self.on_error(exc if isinstance(exc, LLMtrackError) else self._network_error(exc, event))
                except Exception:
                    pass  # A user callback must never produce a background-thread traceback.
        threading.Thread(target=run, name="llmtrack", daemon=True).start()

    async def track_sync(self, *, provider: str, model: str, prompt_tokens: int, completion_tokens: int,
                         reasoning_tokens: int | None = None, feature: str | None = None,
                         customer_id: str | None = None, customer_name: str | None = None,
                         metadata: dict[str, Any] | None = None, latency_ms: int | None = None,
                         status: str | None = None, environment: str | None = None,
                         idempotency_key: str | None = None) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        raw = locals().copy(); raw.pop("self")
        key = raw.pop("idempotency_key") or str(uuid.uuid4())
        payload = {k: v for k, v in raw.items() if v is not None}
        payload["environment"] = environment or self.environment
        self._validate(payload)
        last: Exception | None = None
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for attempt in range(self.max_retries):
                try:
                    response = await client.post(f"{self.base_url}/api/ingest", json=payload,
                        headers={"X-API-Key": self.api_key, "Idempotency-Key": key})
                    try: body: Any = response.json()
                    except ValueError: body = response.text
                    if response.is_success:
                        self._warnings(body, payload)
                        return body
                    error = self._http_error(response.status_code, body, payload)
                    if response.status_code < 500:
                        raise error
                    last = error
                except LLMtrackError as exc:
                    if exc.status is not None and exc.status < 500: raise
                    last = exc
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    last = exc
                if attempt + 1 < self.max_retries:
                    await asyncio.sleep(random.random() * .1 * 2**attempt)
        if isinstance(last, LLMtrackError) and last.status is not None:
            raise last
        raise self._network_error(last or RuntimeError("request failed"), payload)

    def _safe(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in payload.items() if k != "metadata"}

    def _validate(self, payload: dict[str, Any]) -> None:
        safe = self._safe(payload)
        for name in ("provider", "model"):
            if not isinstance(payload.get(name), str) or not payload[name].strip():
                raise LLMtrackError("INVALID_PAYLOAD", f"{name} must be a non-empty string.", safe)
        for name in ("prompt_tokens", "completion_tokens", "reasoning_tokens"):
            value = payload.get(name)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
                raise LLMtrackError("INVALID_PAYLOAD", f"{name} must be a non-negative integer.", safe)
        if "metadata" in payload and len(json.dumps(payload["metadata"], separators=(",", ":")).encode()) > 8192:
            raise LLMtrackError("INVALID_PAYLOAD", "metadata must serialize to at most 8192 bytes.", safe)

    def _http_error(self, status: int, body: Any, payload: dict[str, Any]) -> LLMtrackError:
        data = body if isinstance(body, dict) else {}
        code, message = "NETWORK_ERROR", f"LLMtrack returned HTTP {status}."
        if status == 400:
            code, message = "INVALID_PAYLOAD", f"Invalid payload{(' field ' + repr(data['field'])) if data.get('field') else ''}: {data.get('message', 'check the submitted value')}."
        elif status == 401:
            code = {"Revoked API key": "REVOKED_API_KEY", "Inactive API key": "INACTIVE_API_KEY"}.get(data.get("error"), "INVALID_API_KEY")
            message = f"Authentication failed: {data.get('error', 'Invalid API key')}. Check LLMTRACK_API_KEY."
        elif status == 402:
            code = "PLAN_INACTIVE" if data.get("code") == "PAID_PLAN_INACTIVE" else "QUOTA_EXCEEDED"
            quota = data.get("quota")
            message = (f"Plan '{quota['plan']}' cannot accept this event (limit: {quota['limit']}). Check billing or plan limits."
                       if quota else f"{data.get('error', 'Usage limit reached')}. Check billing or plan limits.")
        return LLMtrackError(code, message, self._safe(payload), status, body)

    def _network_error(self, exc: Exception, payload: dict[str, Any]) -> LLMtrackError:
        return LLMtrackError("NETWORK_ERROR", f"Request failed after retries; check network connectivity and the LLMtrack URL. ({exc})", self._safe(payload))

    def _warnings(self, body: Any, payload: dict[str, Any]) -> None:
        if not isinstance(body, dict) or body.get("duplicate") is True: return
        if body.get("dashboard_visible") is False:
            c = body.get("visibility_context") or {}
            mismatches = ", ".join(c.get("mismatched_fields", [])) or "source fields"
            binding, submitted = c.get("key_binding", {}), c.get("submitted", {})
            source = lambda value: f"provider={value.get('provider')}, model={value.get('model')}, feature={value.get('feature')}"
            self._warn_once(f"visibility:{json.dumps(c, sort_keys=True)}", "NOT_DASHBOARD_VISIBLE",
                f"Event accepted but hidden: {mismatches} differ from the key binding ({source(binding)}) and submitted source ({source(submitted)}).")
        if body.get("pricing_status") == "unknown_model":
            self._warn_once(f"pricing:{payload['provider']}/{payload['model']}", "UNKNOWN_MODEL",
                f"No pricing configured for {payload['provider']}/{payload['model']}; cost recorded as 0.")

    def _warn_once(self, key: str, code: str, message: str) -> None:
        with _warning_lock:
            if key in _warned: return
            _warned.add(key)
        self.on_warning(LLMtrackWarning(code, message))
