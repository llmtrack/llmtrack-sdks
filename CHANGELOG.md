# Changelog

All notable changes to the LLMtrack SDKs are documented in this file.

## 0.2.0

### Node.js

- Added `cacheAccounting` and OpenAI/Anthropic usage adapters.

### Python

- Added `total_tokens`, cache token fields, `cache_accounting`, and OpenAI/Anthropic usage adapters.

## 0.1.1

- Removed obsolete free-plan key-binding visibility warnings and their documentation while retaining unknown-model pricing warnings.
- Added `LLMTrack` as a safety alias for the canonical `LLMtrack` export in Node.js and Python.
- Documented the exported Node.js `TrackOptions` type, accepted casing, and server-side cost calculation.
- Updated the OpenAPI description and example model while retaining response compatibility fields.
- Cleaned generated output so orphan models from an obsolete specification are excluded from the Node.js package.
- Bumped both SDK packages to version 0.1.1.

## 0.1.0

- Initial release of the ESM-only Node.js SDK (`llmtrack`) for Node.js 18 and newer.
- Initial release of the Python SDK (`llmtrack-sdk`) for Python 3.9 and newer.
- Added fire-and-forget and awaited tracking, client-side validation, retries, idempotency, structured errors, and visibility/pricing warnings.
- Added generated OpenAPI clients backed by the shared ingestion contract.
