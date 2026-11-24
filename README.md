# OmniChat

One chat. The best AI for every question.

OmniChat reads each question, works out what kind of task it is, and routes it to the AI model that scores best for that task. This repo is the MVP, built with **Angular 22** and a small **Node/Express** API server.

## How it works

1. **Classify.** A fast model (Claude Haiku 5.5) labels the question as one of: coding, math, writing, research, image, translation or general. If the classifier is unavailable, keyword rules take over.
2. **Score.** The router looks up each model's benchmark score for that category (`src/app/core/routing.ts`).
3. **Route.** The highest-scoring model answers. If two models tie, the cheaper one wins.

In this MVP only Claude is connected, so Claude (Opus 5.5) writes every answer and says so when it stands in for another model. The scores are illustrative placeholders, to be replaced with real benchmark data.

## Getting started

Requirements: Node.js 22.18 or newer (the server is TypeScript, run directly by Node).

```bash
npm install
cp .env.example .env      # then put your Anthropic API key in .env
npm start                 # API on :3000 + Angular on :4200
```

Open http://localhost:4200.

Without an API key the app still loads and routes questions with the keyword rules. Each answer then shows a message asking you to set `ANTHROPIC_API_KEY`.

| Script | What it does |
| --- | --- |
| `npm start` | Runs the API server and the Angular dev server together |
| `npm run web` / `npm run server` | Runs just one of them |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Production build into `dist/omnichat/browser` |
| `npm run serve:prod` | Serves the production build and the API from one Node process on :3000 |
| `npm run typecheck:server` | Type-checks the server code |

If port 4200 is busy, run `npm run server` in one terminal and `npx ng serve --port 4300` in another.

## Configuration (`.env`)

| Variable | Default | |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (none) | Required for AI classification and answers |
| `OMNICHAT_ANSWER_MODEL` | `claude-opus-5-5` | Model that writes answers |
| `OMNICHAT_CLASSIFIER_MODEL` | `claude-haiku-5-5` | Model that labels questions |
| `PORT` | `3000` | API server port |

The API key stays on the server. The browser only talks to `/api`, which the Angular dev server proxies to the API server (`proxy.conf.json`).

## Project structure

```
server/
  index.ts          Express app: /api/classify, /api/chat (streams NDJSON), /api/health
  claude.ts         Anthropic SDK calls, prompts, error mapping
src/app/
  core/routing.ts   Models, routing table, keyword fallback, ranking
  core/chat-store.ts  Conversation state (signals): classify → score → route → stream
  core/omnichat-api.ts  fetch client for the API, reads the streamed answer
  chat/             Chat thread, bot message, composer
  sidebar/          Last routing decision, session stats, how it works
  shared/markdown.pipe.ts  Renders answers as Markdown (sanitized by Angular)
```

## Server API

- `POST /api/classify` `{ question }` returns `{ category, reason }`
- `POST /api/chat` `{ messages: [{ role, content }], category }` streams one JSON object per line: `{"type":"text","delta":"…"}` …, then `{"type":"done","model":"…","stopReason":"…"}` or `{"type":"error","code":"…","message":"…"}`

Errors use these codes: `not_configured`, `rate_limited`, `overloaded`, `connection`, `upstream`, `refusal`, `bad_request`.

## Connecting another provider

Each model in `MODELS` (`src/app/core/routing.ts`) already has a routing score. To make one of them answer for real, add its API client in `server/` and send `/api/chat` requests to it when the router picks that model.
