# Unified AI

**Every AI in one chat. The best one answers.** An MVP by Team Unity.

Unified AI reads each prompt, works out what kind of task it is, compares AI models' benchmark scores for that task, and sends the prompt to the best model. Every answer shows which AI answered and why. You can chat in English, Uzbek or Russian.

Built with **Angular 22** and a small **Node/Express** API server.

## How it works

```
Angular UI  ──POST /api/chat──▶  Node server
                                   ├─ 1. Classifier      → task category + confidence + language
                                   ├─ 2. Benchmark table → each model's score for that category
                                   ├─ 3. Router          → highest score wins (tie → cheaper model)
                                   ├─ 4. Provider        → the chosen model answers
                                   │        ├─ MockProvider        (default, used in the demo)
                                   │        └─ OpenRouterProvider  (real models, needs an API key)
                                   └─ 5. Quality judge   → 0–100 score + a short verdict
```

👍 and 👎 on an answer change that model's score for that task (+1 / −2). The changes are saved to `server/data/learned.json`, so the router keeps learning across restarts.

## Getting started

Requirements: Node.js 22.18 or newer (the server is TypeScript, run directly by Node).

```bash
npm install
npm start          # API on :3000 + Angular on :4200
```

Open http://localhost:4200. No `.env` and no API key are needed: the app starts in **mock mode**, shown by the **Demo mode** badge in the header.

| Script                           | What it does                                                             |
| -------------------------------- | ------------------------------------------------------------------------ |
| `npm start`                      | Runs the API server and the Angular dev server together                  |
| `npm run web` / `npm run server` | Runs just one of them                                                    |
| `npm test`                       | Angular unit tests (Vitest)                                              |
| `npm run test:server`            | Server tests (Node's built-in test runner), including all 7 demo prompts |
| `npm run build`                  | Production build into `dist/unified-ai/browser`                          |
| `npm run serve:prod`             | Serves the production build and the API from one Node process on :3000   |
| `npm run typecheck:server`       | Type-checks the server code                                              |

If port 4200 is busy, run `npm run server` in one terminal and `npx ng serve --port 4300` in another.

On Windows, run the tests from PowerShell or cmd. Git Bash can start them from a lowercase `c:\` path, which makes Vitest load twice and fail with "Vitest failed to find the runner".

## Mock mode and OpenRouter mode

Both modes run the same pipeline. Only the provider changes.

- **`mock`** (default): no network calls. Keyword rules (English, Uzbek, Russian) classify the prompt, answers come from `server/data/mock-answers.json`, and the judge gives a stable score based on the answer. This is what the demo runs on.
- **`openrouter`**: real models through [OpenRouter](https://openrouter.ai)'s OpenAI-compatible API. A small, fast model classifies the prompt and judges the answer. If either step fails, the mock version steps in.

To switch to real models:

1. Copy `.env.example` to `.env`.
2. Set `UNIFIED_AI_MODE=openrouter` and paste your key into `OPENROUTER_API_KEY`.
3. Check the `openrouterId` values in `server/data/benchmarks.json` against https://openrouter.ai/models (model IDs change over time).
4. Restart the server. `GET /api/health` should now return `"mode": "openrouter"`, and the Demo mode badge goes away.

If `UNIFIED_AI_MODE=openrouter` but the key is missing, the server logs a warning and stays in mock mode. DALL·E can't be called through OpenRouter, so for image prompts the best text model writes an image prompt in its place, and the answer card says so.

| Variable                  | Default                        |                                                 |
| ------------------------- | ------------------------------ | ----------------------------------------------- |
| `UNIFIED_AI_MODE`         | `mock`                         | `mock` or `openrouter`                          |
| `OPENROUTER_API_KEY`      | (none)                         | Needed for `openrouter` mode                    |
| `OPENROUTER_BASE_URL`     | `https://openrouter.ai/api/v1` |                                                 |
| `UNIFIED_AI_ROUTER_MODEL` | `google/gemini-2.5-flash`      | Classifier and judge model in `openrouter` mode |
| `PORT`                    | `3000`                         | API server port                                 |

API keys stay on the server. The browser only talks to `/api`, which the Angular dev server proxies to the API server (`proxy.conf.json`).

## Demo script

Each of these routes to a different model in mock mode and has a hand-written answer:

| Prompt                                              | Category        | Model                       |
| --------------------------------------------------- | --------------- | --------------------------- |
| `Fix this Python: for i in range(10) print(i)`      | Coding          | Claude                      |
| `Solve the integral of x·e^x dx step by step`       | Math            | ChatGPT                     |
| `What are the biggest AI news this week?`           | Research        | Perplexity                  |
| `Translate "Good morning, how are you?" into Uzbek` | Translation     | Gemini                      |
| `Draw a logo for a coffee shop in Tashkent`         | Image           | DALL·E                      |
| `Write a short wedding toast for my sister`         | Writing         | Claude                      |
| `Menga sog'lom nonushta uchun 3 ta g'oya ber`       | General (Uzbek) | ChatGPT, answering in Uzbek |

Before a live demo, clear the stats and learned scores with **Reset stats and learned scores** in the Stats tab (or `POST /api/reset`).

## Editing the data

Everything the router knows is in `server/data/`, so you can change it without touching code:

- `benchmarks.json`: models (name, OpenRouter ID, colour, cost tier) and each task's scores. The scores are samples, to be replaced with real leaderboard data (e.g. LMArena, Artificial Analysis).
- `mock-answers.json`: the demo answers, matched by exact prompt text (case, spacing and curly quotes are ignored), plus a fallback template per task and language.
- `learned.json`: adjustments learned from 👍/👎. Written by the server.

Ties: the higher score wins. If scores are equal, the model with the lower `costTier` wins. If that's equal too, the model listed first in that task's `scores` wins. That's why the general-question demo goes to ChatGPT.

## Project structure

```
server/
  index.ts                 Express app and endpoints
  config.ts                Mode switch (UNIFIED_AI_MODE, OPENROUTER_*)
  catalog.ts               Loads and checks benchmarks.json
  pipeline/classifier.ts   Keyword rules + the OpenRouter classifier prompt
  pipeline/router.ts       Ranking with learned adjustments and tie-breaks
  pipeline/judge.ts        Mock judge + the OpenRouter judge prompt
  pipeline/learning.ts     👍/👎 adjustments, saved to learned.json
  pipeline/chat.ts         Runs the five steps for one prompt
  providers/               AiProvider interface, MockProvider, OpenRouterProvider
  data/                    benchmarks.json, mock-answers.json, learned.json
src/app/
  core/unified-ai.service.ts  UnifiedAiService: fetch client for the API
  core/chat-store.ts       Conversation state (signals), pipeline animation, votes, toasts
  core/copy.ts             Example prompts and UI copy
  chat/                    Chat thread, assistant message card, composer
  sidebar/                 Routing, Benchmarks and Stats tabs
  shared/                  Markdown pipe (sanitized by Angular), logo, signed-number pipe
```

## Server API

| Endpoint              |                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/health`     | `{ status: "ok", mode: "mock" \| "openrouter" }`                                       |
| `POST /api/chat`      | `{ message, history? }` → `{ id, routing, answer, quality, mode, timings }`            |
| `POST /api/feedback`  | `{ messageId, category, model, vote: 1 \| -1 }` → `{ category, model, before, after }` |
| `GET /api/benchmarks` | Models, and per task: base scores, effective scores, learned adjustments, current best |
| `GET /api/stats`      | `{ totalRouted, byModel, avgQuality, feedbackCount }` (in memory)                      |
| `POST /api/reset`     | Clears stats and learned adjustments                                                   |

`routing` holds `category`, `categoryLabel`, `confidence`, `language`, `reason`, `classifiedBy` (`rules` or `ai`), `selectedModel` and the full `ranking`. Errors come back as `{ code, message }`. Codes include `bad_request`, `not_configured`, `payment_required`, `model_unavailable`, `rate_limited`, `overloaded`, `timeout`, `connection`, `upstream` and `already_voted`.
