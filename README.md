# LLMtrack SDKs

This monorepo contains LLMtrack's two official server-side SDK packages. Both use small hand-written public wrappers over clients generated from the checked-in OpenAPI contract; generated output is recreated during builds and is not committed.

LLMtrack records LLM token usage, cost, and request context for analysis in the [LLMtrack dashboard and documentation](https://llm-track.com/docs).

## Packages

| Package | Node.js | Python |
|---|---|---|
| Source | [`packages/node`](packages/node) | [`packages/python`](packages/python) |
| Registry name | `llmtrack` | `llmtrack-sdk` |
| Import | `import { LLMtrack } from 'llmtrack'` | `from llmtrack_sdk import LLMtrack` |
| Runtime | Node.js 18+, ESM only | Python 3.9+ |
| Fire-and-forget | `track()` | `track()` |
| Awaited delivery | `await trackSync()` | `await track_sync()` |
| Package guide | [Node README](packages/node/README.md) | [Python README](packages/python/README.md) |

```sh
npm install llmtrack
pip install llmtrack-sdk
```

## Repository setup

Install the root generator dependencies and the Node package dependencies, then install Python build/test tooling:

```sh
npm install
npm --prefix packages/node install
python -m pip install build 'packages/python[test]'
```

## Generate clients from the API specification

Generation requires **Java 21 or newer**, Node.js, and npm. OpenAPI Generator 7.25.0 reads [`spec/openapi.yaml`](spec/openapi.yaml) and recreates both generated clients:

```sh
java -version
npm run generate
```

Generate only one language with `npm run generate:node` or `npm run generate:python`. Do not hand-edit generated directories; update the specification and regenerate instead.

## Build and test

Build both distributions (generation is included):

```sh
npm run build
```

Run both unit-test suites:

```sh
npm test
```

The CI workflow additionally lints the OpenAPI contract and exercises generation, the Node TypeScript build/tests, and the Python wheel/sdist build/tests.

## Links

- [LLMtrack website](https://llm-track.com)
- [Documentation](https://llm-track.com/docs)
- [MIT License](LICENSE)
