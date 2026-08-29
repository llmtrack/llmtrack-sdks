# llmtrack (Node.js)

LLMtrack records server-side LLM token usage, cost, and request context so teams can understand AI usage in one dashboard.

> [!WARNING]
> **Server-side only.** Never put an LLMtrack key in browser, mobile, desktop-client, or other public code. Anyone who can read the bundle can steal the key; load it from a server-side environment variable only.

> [!IMPORTANT]
> **ESM-only; Node.js 18 or newer is required.** Use `import`; CommonJS `require()` will not work.

## Install

```sh
npm install llmtrack
```

## Quickstart

Create an ingestion key in LLMtrack, save it at `~/.config/llmtrack/api-key`, and run:

```sh
export LLMTRACK_API_KEY="$(cat ~/.config/llmtrack/api-key)"
```

```ts
import { LLMtrack } from 'llmtrack';
const tracker = new LLMtrack({ apiKey: process.env.LLMTRACK_API_KEY! });
tracker.track({ provider: 'openai', model: 'gpt-5.6-sol', promptTokens: 241,
  completionTokens: 86, reasoningTokens: 32, feature: 'support-chat' });
```

`track()` schedules that event and returns immediately. It is safe on latency-sensitive request paths.

## Provider examples

These examples use the response shapes supplied by the official provider SDKs and call `track()` immediately after the completion.

### OpenAI

OpenAI reports reasoning tokens inside `completion_tokens_details`:

```ts
import OpenAI from 'openai';
import { LLMtrack } from 'llmtrack';
const openai = new OpenAI();
const tracker = new LLMtrack({ apiKey: process.env.LLMTRACK_API_KEY! });
const response = await openai.chat.completions.create({ model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'Explain why the sky is blue in two sentences.' }] });
tracker.track({ provider: 'openai', model: response.model, promptTokens: response.usage?.prompt_tokens ?? 0, completionTokens: response.usage?.completion_tokens ?? 0,
  reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens ?? 0, feature: 'science-explainer' });
```

### Anthropic

Anthropic reports `input_tokens` and `output_tokens`; thinking tokens are included in `output_tokens` rather than exposed as a separate `reasoning_tokens` value, so do not duplicate them in `reasoningTokens`.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { LLMtrack } from 'llmtrack';
const anthropic = new Anthropic();
const tracker = new LLMtrack({ apiKey: process.env.LLMTRACK_API_KEY! });
const response = await anthropic.messages.create({ model: 'claude-opus-5', max_tokens: 1024, messages: [{ role: 'user', content: 'Summarize the benefits of typed APIs.' }] });
tracker.track({ provider: 'anthropic', model: response.model, promptTokens: response.usage.input_tokens, completionTokens: response.usage.output_tokens,
  cachedInputTokens: response.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0, feature: 'document-summary' });
```

## `track()` and `trackSync()`

| Method | Behavior |
|---|---|
| `track(event)` | Fire-and-forget: returns `void` immediately, **never blocks and never throws**. Validation and delivery failures go to `onError`. |
| `await trackSync(event)` | Waits for delivery and returns the API result. **Throws `LLMtrackError`** on validation, authentication, quota, or exhausted delivery failures. |

`enabled: false` makes both methods no-ops, which is useful in tests and local development:

```ts
const tracker = new LLMtrack({ apiKey: process.env.LLMTRACK_API_KEY!, enabled: false });
```

## Constructor options

| Name | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | required | Server-side LLMtrack ingestion key. |
| `baseUrl` | `string` | `https://llm-track.com` | API origin; primarily useful with a test server. |
| `environment` | `string` | `production` | Environment applied when an event does not override it. |
| `onError` | `(error: LLMtrackError) => void` | logs one `[llmtrack]` warning | Receives errors from fire-and-forget `track()`. Callback exceptions are contained. |
| `onWarning` | `(warning: LLMtrackWarning) => void` | logs one `[llmtrack]` warning | Receives visibility and unknown-pricing warnings. Each distinct warning is emitted once per process. |
| `enabled` | `boolean` | `true` | When `false`, both tracking methods do nothing. |
| `timeoutMs` | `number` | `5000` | Timeout in milliseconds for each request attempt. |
| `maxRetries` | `number` | `3` | Maximum attempts, including the first request. |

## Event fields

Names below are the camel-case `TrackOptions` names; the SDK maps them to the `IngestRequest` wire format.

| Name | Type | Requirement | Description |
|---|---|---|---|
| `provider` | `string` | required | Provider name, for example `openai` or `anthropic`. |
| `model` | `string` | required | Provider model name, for example `gpt-5.6-sol`. |
| `promptTokens` | `number \| null` | optional | Non-negative integer input-token count. |
| `completionTokens` | `number \| null` | optional | Non-negative integer output-token count. |
| `totalTokens` | `number \| null` | optional | Explicit non-negative total; when absent, the server sums the token parts. |
| `reasoningTokens` | `number \| null` | optional | Non-negative reasoning-token count when the provider reports it separately. |
| `cachedInputTokens` | `number \| null` | optional | Non-negative cached input-token count. |
| `cacheWriteTokens` | `number \| null` | optional | Non-negative cache-write token count. |
| `latencyMs` | `number \| null` | optional | Non-negative integer end-to-end latency in milliseconds. |
| `status` | `success \| error \| timeout \| cancelled` | optional | Request outcome; the server defaults to `success`. |
| `feature` | `string` | optional | Product feature, such as `support-chat`; defaults server-side to `unknown`. |
| `customerId` | `string` | optional | Your stable customer identifier. |
| `customerName` | `string` | optional | Your customer display name. |
| `environment` | `string` | optional | Overrides the constructor environment for this event. |
| `metadata` | `Record<string, unknown>` | optional | JSON object containing request context; maximum serialized size is 8 KiB (8192 bytes). |
| `idempotencyKey` | `string` | optional | SDK-only header option used to deduplicate this call; it is not an event-body field. |

Token counts and `latencyMs` are validated client-side as non-negative integers. Metadata is validated client-side against the 8192-byte UTF-8 serialized limit.

## Delivery, retries, and idempotency

Each call gets a UUID v4 idempotency key automatically. The same key is retained across retries, so a response lost after storage cannot double-count the event. Supply a stable application key when you need deduplication across separate SDK calls:

```ts
tracker.track({ provider: 'openai', model: 'gpt-5.6-sol', promptTokens: 241, completionTokens: 86,
  reasoningTokens: 32, feature: 'support-chat', idempotencyKey: '9ea0c2ec-7b98-4bc3-9802-20ae6a468a35' });
```

The SDK retries only network failures, timeouts, and HTTP 5xx responses. It never retries HTTP 4xx responses such as a bad key, invalid payload, or exhausted quota.

## Errors

| Code | Meaning | Fix |
|---|---|---|
| `INVALID_API_KEY` | The key is missing, unknown, or belongs to a missing workspace. | Check the server's `LLMTRACK_API_KEY` and create or copy a valid ingestion key. |
| `REVOKED_API_KEY` | The key was revoked. | Replace it with an active key. |
| `INACTIVE_API_KEY` | The key was deactivated. | Reactivate it or replace it. |
| `INVALID_PAYLOAD` | A field failed local or server validation. | Correct the field named in the error; check integer token counts and metadata size. |
| `QUOTA_EXCEEDED` | The event allowance or available pay-per-event credits are exhausted. | Wait for the allowance to reset, add credits, or upgrade the plan. |
| `PLAN_INACTIVE` | Billing status prevents ingestion. | Restore billing and reactivate the plan. |
| `NETWORK_ERROR` | Network/timeout retries were exhausted, or an unclassified HTTP/server failure occurred. | Check connectivity, `baseUrl`, timeout settings, and service availability. |

`trackSync()` throws these errors. `track()` reports them to `onError` and still never throws.

## Warnings and free-plan key binding

| Response | Meaning |
|---|---|
| `dashboard_visible: false` | The event was accepted and billed/consumed quota, but is hidden because its source does not match the free-key binding. |
| `pricing_status: unknown_model` | No active server pricing matched the provider/model, so the recorded cost is `0`; token usage is still recorded. |

**The most common reason events do not appear:** free-plan ingestion keys bind to one **provider/model/feature triple**. Mismatched events are still accepted and billed (or consume quota), but are hidden from the dashboard. Match all three submitted values to the key binding shown in LLMtrack. The SDK emits `NOT_DASHBOARD_VISIBLE` with both the binding and submitted values.

## Troubleshooting

### Events are not appearing

Check `onWarning` for `NOT_DASHBOARD_VISIBLE`, then compare provider, model, and feature with the free-plan key's bound triple. Also confirm the constructor/event environment and that the process lives long enough for fire-and-forget delivery; use `await trackSync()` in short-lived scripts.

### Cost shows 0

Check for `UNKNOWN_MODEL` or `pricing_status: unknown_model`. Token counts were stored, but no active pricing row matched the exact provider/model name. Use the provider's exact returned `response.model` value.

### The key is rejected

Inspect the error code: replace an invalid or revoked key, reactivate an inactive key, and ensure the key is read only from the server environment. `trackSync()` is the simplest way to inspect the full `LLMtrackError` while diagnosing configuration.

## More information

- [LLMtrack documentation](https://llm-track.com/docs)
- [MIT License](./LICENSE)
