# AGENTS.md — platform-router

## Project

Smart content moderation & routing engine. Consumes `cluster_report` events from BullMQ, evaluates against YAML routing rules, emits `routed_job` events for downstream content generators (IG, LI, YT, X, TikTok, Douyin, RedNote).

Stack: TypeScript/Node.js, Fastify, BullMQ, ioredis, js-yaml, zod, Jest+ts-jest, Prometheus, OpenTelemetry.

## Architecture

```
BullMQ (clusters.reports) → platform-router → BullMQ (jobs.routed)
                                    ↑
                          ConfigMap (YAML: routing, formats, priority)
                                    ↑
                          Prometheus + OpenTelemetry
                                   (Redis transport)
```

Core modules:
- `src/config.ts` — ConfigService (YAML load, zod validate, fs.watch hot-reload)
- `src/router.ts` — Router (tag normalize, platform union, format select, priority)
- `src/priority.ts` — PriorityScorer (weighted sum → 1-10)
- `src/bus.ts` — BullMQ worker (clusters.reports) + producer (jobs.routed), zod-validates payloads with ClusterReportSchema, UnrecoverableError on invalid payloads, failed set replaces DLQ
- `src/server.ts` — HTTP server (/healthz, /metrics, /config)
- `src/metrics.ts` — Prometheus counters/histograms
- `src/tracer.ts` — OpenTelemetry spans
- `src/index.ts` — Bootstrap (wire all, handle SIGTERM)
- `src/rules/` — routing.yaml, formats.yaml, priority.yaml

## TDD — Strict Red-Green-Refactor

**NO production code without a failing test first.**

Cycle per feature:
1. RED — write one minimal failing test
2. Run test → confirm fails for right reason (feature missing, not typo)
3. GREEN — write minimal code to pass
4. Run test → confirm passes, all other tests green
5. REFACTOR — clean up, keep green

Test command: `npx jest --runInBand -t "<name>"` (single) / `npx jest --runInBand` (full)

Rules:
- One behavior per test, clear name, real code (mocks only if unavoidable)
- Never keep pre-written code as "reference" — delete, rewrite from tests
- Edge cases + error paths always tested
- 100% coverage on pure functions (router, scorer, config loader)

## Communication

Caveman mode active. Drop filler, articles, pleasantries. Technical substance unchanged. Causality via arrows (X → Y). Fragments OK.

Examples:
- "Bug in tag normalize. Regex miss `&` → fix: add `&` to char class"
- "Config load fail → YAML syntax error on line 12" not "I'd be happy to help you with this configuration issue"

Exception: security warnings, destructive ops, multi-step sequences — use full sentences.

## Persistent State Routine (Handoff Protocol)

### Session Init
Before any code edits or execution planning:
1. Read `config/tasks.json` → current milestone
2. Read `config/progress_notes.txt` → text memory / what changed last session

### Session End
Before wrapping up:
1. Toggle completed items in `config/tasks.json` from `"incomplete"` to `"complete"`
2. Rewrite `config/progress_notes.txt` with exact lines changed + linter errors remaining

## File Conventions

- `src/` — production code
- `tests/` — test files (`*.test.ts` beside source or in `tests/`)
- `src/rules/` — YAML config files
- All production code in `src/` must have corresponding test before commit

## Deployment

- Docker multi-stage build, non-root user, ports 8080 (HTTP) + 9090 (metrics)
- Kubernetes Deployment (3 replicas), ConfigMap for YAML rules
- Redis transport via `REDIS_URL` (default `redis://localhost:6379`), mTLS for HTTP (optional)
