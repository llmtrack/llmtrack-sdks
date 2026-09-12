# LLMtrack SDK — v0.1.1 Fix Brief

**Repo:** `llmtrack/llmtrack-sdks` (public, GitHub org)
**Packages:** `llmtrack` on npm (Node) · `llmtrack-sdk` on PyPI (import `llmtrack_sdk`)
**Current published version:** 0.1.0
**Status:** functional. Nothing here is an outage. This is a cleanup and hygiene release.

---

## 0. The one-line summary

The published SDK **works correctly** — verified by reading the shipped type declarations and by an 8/8 live integration test. But it ships documentation and warning code for a **product feature that no longer exists**, carries **dead files from a spec that was never real**, and has an **export name that has already crash-looped one production service**. v0.1.1 fixes those three things.

---

## 1. What is verified correct (do not "fix" these)

Read directly from `node_modules/llmtrack/dist/index.d.ts` of the published package:

- The accepted event type is **`TrackOptions`**, and it **is exported**. There is no `TrackEvent`.
- Node fields are **camelCase only**: `provider`, `model`, `promptTokens`, `completionTokens`, `totalTokens`, `reasoningTokens`, `cachedInputTokens`, `cacheWriteTokens`, `feature`, `customerId`, `customerName`, `metadata`, `latencyMs`, `status`, `environment`, `idempotencyKey`.
- Only `provider` and `model` are required. **All token fields are optional.**
- Wire conversion to snake_case happens inside the wrapper. `prompt_tokens` passed by a Node caller is **silently dropped** — it is not an accepted alias.
- Generated models shipped correctly; the barrel exports the 14 correct types with no dangling imports.
- Python mirrors this in snake_case.

Two integration failures happened in the field. **Neither was the SDK's fault** — both were an AI agent guessing the API because its sandbox blocked npm, then writing a fabricated local `.d.ts` stub that shadowed the real types. But both are preventable at the library level, which is what §2.3 and §2.4 address.

---

## 2. What needs fixing

### 2.1 Stale free-plan binding — code *and* docs (highest priority)

**Background.** LLMtrack used to bind each free-plan ingestion key to a single provider/model/feature triple. Events that didn't match were accepted, billed, and **hidden from the dashboard**. That feature was **removed entirely** from the server. Free users now get every feature and unlimited keys, limited only by 3,000 events/month and 30-day retention.

The SDK still implements and documents it.

**Remove from both wrappers:**
- The `NOT_DASHBOARD_VISIBLE` warning path. It is visible in the shipped type: `LLMtrackWarning.code: 'NOT_DASHBOARD_VISIBLE' | 'UNKNOWN_MODEL'`. The server now always returns `dashboard_visible: true`, so this warning is unreachable code that describes a deleted feature.
- Node: the visibility-response conversion logic.
- Python: the `dashboard_visible` check and `visibility_context` interpretation.

**Keep `UNKNOWN_MODEL`.** `pricing_status: "unknown_model"` is still real and still returned.

**Remove from both READMEs:**
- The `dashboard_visible: false` row in the warnings table
- The section stating free-plan keys bind to a provider/model/feature triple and that mismatched events are hidden
- The troubleshooting entry telling users to compare events against the key's bound triple

**Update `spec/openapi.yaml`:**
- The top-level `description` still explains the binding and names `dashboard_visible`, `visibility_reason`, and `free_source_mismatch`. Rewrite it.
- `IngestSuccess` still lists `dashboard_visible`, `visibility_reason`, `visibility_context` as **required**. The API still returns these fields for contract stability, so **keep them in the schema** — but remove the prose implying they can indicate hidden events, and reduce `visibility_reason`'s enum to null-only if `free_source_mismatch` is no longer ever returned (verify against the live API first).

**Do not remove the response fields themselves.** The server still sends them. Only the meaning and the documentation change.

### 2.2 Orphan generated files from an invented spec

The published tarball contains five model files that describe an API that never existed:

```
CreatedResponse.d.ts / .js
ErrorResponse.d.ts / .js
ErrorResponseLimit.d.ts / .js
TrackRequest.d.ts / .js
TrackResponse.d.ts / .js
```

**Origin.** Early on, the coding agent could not reach the website repo to copy the real `openapi.yaml`, so it **fabricated one**. That fictional spec generated these models. The real spec was later copied in and regeneration produced the correct files — but the OpenAPI Generator does not delete files it no longer emits, and the package was published before a clean step existed.

**Impact:** low. They are not re-exported by `dist/generated/models/index.d.ts`, so nobody can accidentally import them. But they are dead code in a public open-source package that people may read.

**Fix:** the `generate:node` script now runs `rimraf` before generating, so a clean rebuild removes them automatically. Verify with `npm pack --dry-run` that the tarball no longer contains those five names.

### 2.3 Export-name alias

The class export is **`LLMtrack`** — lowercase `t` after `LLM`. This is unusual enough that an integrator wrote `import { LLMTrack }`, got `undefined`, and `new undefined()` **crash-looped a production worker**.

**Fix:** export `LLMTrack` as an alias of `LLMtrack` from both package entry points, and include it in the generated `.d.ts`. Python: alias `LLMTrack` to `LLMtrack` in `__all__`.

Keep `LLMtrack` as the canonical name in all documentation and examples. The alias exists to make a common mistake harmless, not to become the preferred spelling.

### 2.4 Documentation hardening

The type is exported but neither README says so. Integrators redeclare the event shape by hand and drift from it — which is exactly what caused a type mismatch in the field.

**Add to both READMEs:**
- A short section showing how to import and use the event type:
  ```ts
  import { LLMtrack, type TrackOptions } from 'llmtrack';
  const event: TrackOptions = { provider: 'openai', model: 'gpt-5.6-sol', promptTokens: 241, completionTokens: 86 };
  ```
- A **"Common mistakes"** section covering: the `LLMtrack` casing; camelCase-only in Node and snake_case-only in Python, with the warning that wrong casing is silently ignored; and that client-supplied `cost` is ignored because cost is computed server-side.
- The exact import line stated prominently, with the capitalisation called out.

### 2.5 Stale model name in the spec

`spec/openapi.yaml` uses `gpt-4o-mini` in its example payload. Replace with a current model — `gpt-5.6-luna`. Cosmetic, but the spec is public and feeds generated docs.

### 2.6 Release tagging

There is **no git tag** identifying the commit 0.1.0 was published from. Tag it retroactively if the commit can be identified, and tag 0.1.1 on release. Without tags there is no way to diff published versions against source.

---

## 3. What to explicitly leave alone

- **The wire format.** Field names sent to `/api/ingest` are correct and match the spec.
- **The never-throws guarantee.** `track()` must never throw into user code; `trackSync()` throws by design.
- **Retry and idempotency behaviour.** Verified working — retries reuse a stable idempotency key and cannot double-count.
- **Client-side validation.** The 8 KB metadata cap and non-negative integer token checks are correct.
- **`TrackOptions` field names.** They are right. Do not rename to `inputTokens`/`outputTokens` — a fabricated stub used those names and it was wrong.
- **The Anthropic guidance in both READMEs**, which correctly states that thinking tokens are already inside `output_tokens` and must not be duplicated in the reasoning field.

---

## 4. Considered for v0.2.0, not this release

A `trackCompletion(response, { feature })` helper that accepts a provider response object and reads `usage` itself, instead of making the caller hand-map six fields.

**Rationale:** the mapping boilerplate is where both field-name mistakes happened, and forgetting `reasoning_tokens` silently under-counts cost — the worst failure mode for a cost tracker. A helper would eliminate the class entirely. It is deferred because the ergonomics should be designed from a real integration rather than speculation, and because it is a new feature rather than a fix.

---

## 5. Release checklist

- [ ] Remove `NOT_DASHBOARD_VISIBLE` path from both wrappers
- [ ] Remove binding sections from both READMEs
- [ ] Update `openapi.yaml` description and `IngestSuccess` prose (keep the fields)
- [ ] Replace `gpt-4o-mini` in the spec example
- [ ] Export `LLMTrack` alias in both packages
- [ ] Add type-import and "Common mistakes" sections to both READMEs
- [ ] Bump both packages to `0.1.1`; add a `CHANGELOG.md` entry
- [ ] Clean rebuild; verify `npm pack --dry-run` excludes the five orphan files
- [ ] Verify README examples type-check against the built package
- [ ] Publish npm and PyPI; tag the release
- [ ] Re-integrate into the extraction worker as a real-world test — **with no hand-written `.d.ts`**

---

## 6. Operating notes for whoever does this

The coding agent working this repo has a **network allowlist that blocks npm, PyPI, models.dev, and llm-track.com**, and it has **repeatedly reported commits that never reached the remote** ("no configured git remote"). Two rules follow:

1. Instruct it explicitly: *if you cannot reach a required resource, stop and report it — do not reconstruct it.* Both prior disasters came from it fabricating a file it couldn't fetch.
2. **Verify every claimed fix by opening the file on GitHub.** Do not trust a success report.
