# platform-router

**Brand OS · Layer 3 — Content Routing Engine**
Positronica Labs

---

## Project Context

Brand OS is a modular content automation pipeline that transforms raw signals from 10+ sources into platform-ready content across Instagram, LinkedIn, YouTube, X, TikTok, Douyin, and RedNote. The system is 7 independent microservice repos connected by shared JSON schemas and a Redis message bus.

This repo — **platform-router** — is **Layer 3: Content Routing**. It consumes `cluster_report` events from BullMQ, evaluates them against YAML routing rules, picks a content format per platform, computes an engagement priority score (1-10), and emits `routed_job` events for downstream content generators.

```
signal-harvester → [raw_signal] → semantic-graph → [cluster_report] → platform-router
                                                                     ↓
                                                              [routed_job]
                                                     ↙            ↓              ↘
                                             Carousel Studio   shortform-engine   youtubeGen
```

**Hackathon pitch:** "Smart content moderation and routing engine."

This is the taste layer that ensures cultural content never hits LinkedIn and business content never hits TikTok.

---

## Architecture

```
BullMQ (clusters.reports) → platform-router → BullMQ (jobs.routed)
                                    ↑
                          ConfigMap (routing.yaml, formats.yaml, priority.yaml)
                                    ↑
                          Prometheus + OpenTelemetry
                                   (Redis transport)
```

Core modules:
- `src/config.ts` — ConfigService (YAML load, zod validate, fs.watch hot-reload)
- `src/router.ts` — Router (tag normalize, platform union, format select, priority)
- `src/priority.ts` — PriorityScorer (weighted sum → 1-10)
- `src/bus.ts` — BullMQ worker (clusters.reports) + producer (jobs.routed), zod-validates payloads
- `src/server.ts` — HTTP server (/healthz, /metrics, /config) via Fastify
- `src/metrics.ts` — Prometheus counters/histograms
- `src/tracer.ts` — OpenTelemetry spans
- `src/index.ts` — Bootstrap (wire all, handle SIGTERM)
- `src/rules/` — routing.yaml, formats.yaml, priority.yaml

---

## Routing Rules Matrix

| Category | Instagram | LinkedIn | YouTube | X | TikTok | Douyin | RedNote |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Tech + science | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Robotics + maker | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Culture + aesthetics | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Biz + startups | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| CN market | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ |

---

## Output Schema: `routed_job`

```typescript
{
  id:              string
  cluster_report:  ClusterReport
  target_platform: string
  content_format:  'carousel' | 'short_video' | 'long_video' | 'thread' | 'note'
  priority:        number          // 1-10, boosted by ai-marketing-skills A/B results
  ab_variant:      string | null   // assigned variant for current experiment
  created_at:      string
}
```

---

## Priority Scoring

Weighted sum normalized to 1-10:

```
raw = likes*w_likes + shares*w_shares + comments*w_comments + views*w_views
priority = clamp(round((raw / max_score) * 10), 1, 10)
```

Weights are in `src/rules/priority.yaml` and are hot-reloaded on change.

---

## Quick Start

```bash
# Install dependencies
npm ci

# Run tests
npm test

# Build
npm run build

# Start (requires Redis running)
REDIS_URL=redis://localhost:6379 npm start
```

---

## Docker

```bash
docker build -t platform-router .
docker run -p 8080:8080 -p 9090:9090 \
  -e REDIS_URL=redis://host:6379 \
  platform-router
```

---

## Kubernetes

```bash
helm install platform-router ./helm
```

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /healthz` | Liveness/readiness probe |
| `GET /metrics` | Prometheus metrics |
| `GET /config` | Active routing & format rules |

---

## Configuration

- `src/rules/routing.yaml` — category → platforms mapping
- `src/rules/formats.yaml` — category/platform → content format
- `src/rules/priority.yaml` — engagement weights for priority scoring

All files are hot-reloaded on change (fs.watch).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL for BullMQ |
| `HTTP_PORT` | `8080` | HTTP server port |
| `METRICS_PORT` | `9090` | Prometheus metrics port |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OpenTelemetry collector |

---

## Testing

```bash
# All tests
npm test

# With coverage
npm run test:coverage

# Specific suite
npx jest --runInBand tests/router.test.ts
```

---

## OSS Integration

| OSS Repo | Integration Point | How to Wire |
|---|---|---|
| `ai-marketing-skills` | `analytics/feedback.ts` | Claude Code skills for growth-engine A/B testing. Runs experiments (carousel vs thread, caption variant A vs B) and feeds results into `priority.ts` to update routing weights. |

---

## Project Structure

```
platform-router/
├── src/
│   ├── config.ts       # ConfigService (YAML loader + hot-reload)
│   ├── router.ts       # Core routing logic
│   ├── priority.ts     # Engagement priority scorer
│   ├── bus.ts          # BullMQ worker + producer
│   ├── server.ts       # HTTP server (Fastify)
│   ├── metrics.ts      # Prometheus metrics
│   ├── tracer.ts       # OpenTelemetry tracing
│   ├── index.ts        # Bootstrap
│   └── rules/          # YAML configuration files
│       ├── routing.yaml
│       ├── formats.yaml
│       └── priority.yaml
├── tests/              # Jest test files
├── helm/               # Kubernetes Helm chart
├── Dockerfile          # Multi-stage build, non-root user
├── package.json
└── jest.config.js
```

---

## Tech Stack

- TypeScript / Node.js 20+
- Fastify (HTTP server)
- BullMQ + ioredis (message bus)
- js-yaml + zod (config loading + validation)
- Jest + ts-jest (testing)
- Prometheus (metrics)
- OpenTelemetry (tracing)
- Docker multi-stage build (3 replicas in K8s)

---

*Brand OS · Positronica Labs · Confidential*
