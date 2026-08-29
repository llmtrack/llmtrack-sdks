# llmtrack-sdk (Python)

LLMtrack records server-side LLM token usage, cost, and request context so teams can understand AI usage in one dashboard.

> [!WARNING]
> **Server-side only.** Never put an LLMtrack key in browser, mobile, desktop-client, or other public code. Load it from a server-side environment variable only.

The PyPI distribution is named `llmtrack-sdk`, while Python imports use `llmtrack_sdk`: distribution names can contain hyphens, but import identifiers cannot, and the distinct name also avoids the unrelated `llmtrack` distribution.

## Install

```sh
pip install llmtrack-sdk
```

## Quickstart

Create an ingestion key in LLMtrack, save it at `~/.config/llmtrack/api-key`, and run:

```sh
export LLMTRACK_API_KEY="$(cat ~/.config/llmtrack/api-key)"
```

```python
import os
from llmtrack_sdk import LLMtrack
tracker = LLMtrack(api_key=os.environ["LLMTRACK_API_KEY"])
tracker.track(provider="openai", model="gpt-5.6-sol", prompt_tokens=241,
              completion_tokens=86, reasoning_tokens=32, feature="support-chat")
```

## Provider examples

Both examples call `track()` immediately after the provider completion and read counts from the official response objects.

### OpenAI

```python
import os
from openai import OpenAI
from llmtrack_sdk import LLMtrack
openai, tracker = OpenAI(), LLMtrack(api_key=os.environ["LLMTRACK_API_KEY"])
response = openai.chat.completions.create(model="gpt-5.6-sol", messages=[{"role": "user", "content": "Explain why the sky is blue in two sentences."}])
usage = response.usage
tracker.track(provider="openai", model=response.model, prompt_tokens=usage.prompt_tokens, completion_tokens=usage.completion_tokens,
              reasoning_tokens=usage.completion_tokens_details.reasoning_tokens if usage.completion_tokens_details else 0, feature="science-explainer")
```

### Anthropic

Anthropic includes thinking tokens in `output_tokens` rather than exposing a separate reasoning-token count, so do not duplicate them in `reasoning_tokens`.

```python
import os
from anthropic import Anthropic
from llmtrack_sdk import LLMtrack
anthropic, tracker = Anthropic(), LLMtrack(api_key=os.environ["LLMTRACK_API_KEY"])
response = anthropic.messages.create(model="claude-opus-5", max_tokens=1024, messages=[{"role": "user", "content": "Summarize the benefits of typed APIs."}])
tracker.track(provider="anthropic", model=response.model, prompt_tokens=response.usage.input_tokens,
              completion_tokens=response.usage.output_tokens, feature="document-summary")
```

## Fire-and-forget and awaited usage

| Method | Behavior |
|---|---|
| `track(**event)` | Synchronous fire-and-forget entry point: starts a daemon delivery thread, returns `None` immediately, **never blocks and never raises**. Errors go to `on_error`. |
| `await track_sync(**event)` | Async awaited entry point: returns the API dictionary and **raises `LLMtrackError`** on failure. Despite its compatibility name, it must be awaited. |

```python
result = await tracker.track_sync(provider="openai", model="gpt-5.6-sol", prompt_tokens=241,
                                  completion_tokens=86, reasoning_tokens=32, feature="support-chat")
```

Set `enabled=False` in tests and local development to make both methods no-ops:

```python
tracker = LLMtrack(api_key=os.environ["LLMTRACK_API_KEY"], enabled=False)
```

## Constructor options

| Name | Type | Default | Description |
|---|---|---|---|
| `api_key` | `str` | required | Server-side LLMtrack ingestion key. |
| `base_url` | `str` | `https://llm-track.com` | API origin; primarily useful with a test server. |
| `environment` | `str` | `production` | Environment applied when an event does not override it. |
| `on_error` | `Callable[[LLMtrackError], None] \| None` | logs one `[llmtrack]` warning | Receives `track()` background errors; callback exceptions are contained. |
| `on_warning` | `Callable[[LLMtrackWarning], None] \| None` | logs one `[llmtrack]` warning | Receives visibility and pricing warnings, once per distinct warning per process. |
| `enabled` | `bool` | `True` | When `False`, both tracking methods do nothing. |
| `timeout_ms` | `int` | `5000` | Timeout in milliseconds for each request attempt. |
| `max_retries` | `int` | `3` | Maximum attempts, including the first request. |

## Event fields

The wrapper intentionally accepts the following snake-case subset of the `IngestRequest` contract. `total_tokens`, `cached_input_tokens`, and `cache_write_tokens` exist in the wire contract but are not arguments in the current Python public API; do not pass them to this SDK.

| Name | Type | Requirement | Description |
|---|---|---|---|
| `provider` | `str` | required | Provider name, such as `openai` or `anthropic`. |
| `model` | `str` | required | Provider model name, such as `gpt-5.6-sol`. |
| `prompt_tokens` | `int` | required | Non-negative integer input-token count. |
| `completion_tokens` | `int` | required | Non-negative integer output-token count. |
| `total_tokens` | `int \| None` | not exposed | Optional explicit total in `IngestRequest`; the current wrapper relies on the server-computed total. |
| `reasoning_tokens` | `int \| None` | optional | Non-negative reasoning-token count when separately reported. |
| `cached_input_tokens` | `int \| None` | not exposed | Optional cached-input count in `IngestRequest`; not an argument in the current Python public API. |
| `cache_write_tokens` | `int \| None` | not exposed | Optional cache-write count in `IngestRequest`; not an argument in the current Python public API. |
| `latency_ms` | `int \| None` | optional | End-to-end latency in milliseconds. |
| `status` | `str \| None` | optional | One of `success`, `error`, `timeout`, or `cancelled`. |
| `feature` | `str \| None` | optional | Product feature, such as `support-chat`; defaults server-side to `unknown`. |
| `customer_id` | `str \| None` | optional | Your stable customer identifier. |
| `customer_name` | `str \| None` | optional | Your customer display name. |
| `environment` | `str \| None` | optional | Overrides the constructor environment for this event. |
| `metadata` | `dict[str, Any] \| None` | optional | JSON object containing request context; maximum serialized size is 8 KiB (8192 bytes). |
| `idempotency_key` | `str \| None` | optional | SDK-only header option used to deduplicate the call, not an event-body field. |

The client validates `prompt_tokens`, `completion_tokens`, and `reasoning_tokens` as non-negative integers and rejects metadata whose compact UTF-8 JSON serialization exceeds 8192 bytes. The server validates the remaining contract constraints.

## Delivery, retries, and idempotency

Each call automatically receives a UUID v4 idempotency key. That key stays stable across retries, preventing double-counting when a stored response is lost. Supply your own stable key to deduplicate separate calls:

```python
tracker.track(provider="openai", model="gpt-5.6-sol", prompt_tokens=241, completion_tokens=86,
              reasoning_tokens=32, feature="support-chat", idempotency_key="9ea0c2ec-7b98-4bc3-9802-20ae6a468a35")
```

The SDK retries only network failures, timeouts, and HTTP 5xx responses. It never retries HTTP 4xx responses.

## Errors

| Code | Meaning | Fix |
|---|---|---|
| `INVALID_API_KEY` | The key is missing, unknown, or belongs to a missing workspace. | Check `LLMTRACK_API_KEY` and create or copy a valid ingestion key. |
| `REVOKED_API_KEY` | The key was revoked. | Replace it with an active key. |
| `INACTIVE_API_KEY` | The key was deactivated. | Reactivate it or replace it. |
| `INVALID_PAYLOAD` | A field failed local or server validation. | Correct the named field; check integer token counts and metadata size. |
| `QUOTA_EXCEEDED` | The event allowance or pay-per-event credits are exhausted. | Wait for reset, add credits, or upgrade. |
| `PLAN_INACTIVE` | Billing status prevents ingestion. | Restore billing and reactivate the plan. |
| `NETWORK_ERROR` | Network/timeout retries were exhausted, or an unclassified HTTP/server failure occurred. | Check connectivity, `base_url`, timeout, and service availability. |

`track_sync()` raises these errors. `track()` sends them to `on_error` and never raises.

## Warnings and free-plan key binding

| Response | Meaning |
|---|---|
| `dashboard_visible: false` | The event was accepted and billed/consumed quota, but is hidden because its source does not match the free-key binding. |
| `pricing_status: unknown_model` | No active pricing matched the provider/model, so cost is `0`; token usage is still recorded. |

**The most common reason events do not appear:** free-plan keys bind to one **provider/model/feature triple**. Mismatched events are accepted and billed (or consume quota) but hidden. Match all three values to the binding shown in LLMtrack. `NOT_DASHBOARD_VISIBLE` includes the bound and submitted triples.

## Troubleshooting

### Events are not appearing

Check warnings for `NOT_DASHBOARD_VISIBLE` and compare provider, model, and feature with the key binding. A short-lived process can exit before the daemon thread finishes; use `await track_sync()` in scripts and jobs that must confirm delivery.

### Cost shows 0

Check for `UNKNOWN_MODEL` or `pricing_status: unknown_model`. Use the exact `response.model` returned by the provider so active pricing can match it.

### The key is rejected

Inspect `LLMtrackError.code`: replace invalid/revoked keys, reactivate inactive keys, and confirm the environment variable is available to the server process. Use `await track_sync()` to inspect the complete exception.

## Contributing

Async tests use `pytest-asyncio` (included in the `test` and `dev` extras):

```sh
pip install -e 'packages/python[test]'
pytest packages/python/tests
```

## More information

- [LLMtrack documentation](https://llm-track.com/docs)
- [MIT License](./LICENSE)
