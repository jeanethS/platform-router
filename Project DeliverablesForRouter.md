## 📚 Project Deliverables  

Below are the four markdown files you asked for.  
Each file is **self‑contained** and can be copied into its own `.md` file in the repo.

---  

# 1️⃣ `requirements.md` – Functional & Non‑Functional Requirements  

### 1.1 Feature Specs (User Stories)

| # | User Story | Acceptance Criteria |
|---|------------|---------------------|
| **F‑001** | **As a content‑analysis pipeline,** I need the router to read each `cluster_report` event and decide which platforms it should go to, so that the right audience sees the right content. | 1. The service consumes from Kafka topic `analysis.cluster_reports`. <br>2. For every incoming report a `routed_job` is emitted for **each** platform that the routing matrix allows. <br>3. The `target_platform` field contains only values from the allowed list (`instagram`, `linkedin`, `youtube`, `x`, `tiktok`, `douyin`, `rednote`). |
| **F‑002** | **As a product manager,** I want the routing matrix to be editable by ops without redeploying, so that we can react quickly to market changes. | 1. `routing.yaml` and `formats.yaml` live under `src/rules/`. <br>2. Updating the ConfigMap (or the file on disk) causes the router to reload the rules within **≤ 2 seconds**. <br>3. No loss of in‑flight messages during reload. |
| **F‑003** | **As a downstream content generator,** I need to know which format to use (carousel, short video, …) for each platform, so that the output matches the platform’s native UI. | 1. `content_format` in the emitted `routed_job` matches the rule in `formats.yaml`. <br>2. If a category‑specific format is missing, the service falls back to the `default` entry. |
| **F‑004** | **As a data‑driven marketer,** I want a priority score (1‑10) that reflects engagement potential, so that high‑impact pieces are processed first. | 1. Priority is computed by the `PriorityScorer` using the weights from `priority.yaml`. <br>2. The computed value is an integer between 1 and 10 inclusive. <br>3. The field is named `priority` in the output schema. |
| **F‑005** | **As an SRE,** I need health endpoints and observability metrics, so that I can monitor the router in production. | 1. `GET /healthz` returns 200 OK when the service can poll Kafka. <br>2. `GET /metrics` serves Prometheus exposition format with counters, histograms and gauges (see design). <br>3. Structured JSON logs include `traceId` and `service=platform-router`. |
| **F‑006** | **As a developer,** I want the service to be horizontally scalable, so that we can increase throughput under load. | 1. The router is stateless – all state is derived from the incoming message. <br>2. Docker image runs a single Node process listening on a configurable port. <br>3. Deployable via a Helm chart with replica count > 1. |
| **F‑007** | **As an auditor,** I need the router to guarantee at‑least‑once delivery but be idempotent, so that duplicate jobs are harmless. | 1. The `id` of a `routed_job` is `${cluster_report.id}:${platform}`. <br>2. The downstream generator can safely deduplicate on this key. |

### 1.2 Non‑Functional Requirements  

| # | Requirement | Metric / Acceptance |
|---|-------------|---------------------|
| **NF‑001** | **Performance** – processing latency per report | ≤ 10 ms (excluding Kafka I/O) measured by `router_latency_seconds` histogram 95th percentile. |
| **NF‑002** | **Reliability** – message loss | ≤ 0.01 % messages lost (validated by end‑to‑end test harness). |
| **NF‑003** | **Scalability** – max throughput | ≥ 5 k reports / sec per replica (verified with k6 load test). |
| **NF‑04** | **Observability** – metrics & traces | All required Prometheus metrics present; traces exportable to OpenTelemetry Collector. |
| **NF‑05** | **Security** – transport encryption | Kafka connection uses TLS + SASL‑SCRAM; HTTP endpoints protected by mTLS (optional). |
| **NF‑06** | **Maintainability** – test coverage | ≥ 95 % statement coverage (Jest). |
| **NF‑07** | **Configurability** – hot‑reload | Config reload occurs automatically within 2 s after file change. |
| **NF‑08** | **Compliance** – no PII persisted | Router never writes raw content to disk; only transient in‑memory objects. |

---  

# 2️⃣ `bugfix.md` – Bug Analysis Template  

> **Note:** No known bugs exist in the initial version. Use the template below for future bug reports.

| Field | Description |
|-------|-------------|
| **Bug ID** | `BUG‑<auto‑increment>` |
| **Title** | Short, descriptive title (e.g., “Router does not reload routing.yaml on ConfigMap update”). |
| **Reported By** | Name / Slack handle |
| **Date Reported** | YYYY‑MM‑DD |
| **Environment** | `dev / staging / prod` – details (K8s version, Node version, etc.) |
| **Current Behavior** | Exact observable output (e.g., “router continues to use old rules after ConfigMap change”). |
| **Expected Behavior** | What should happen (e.g., “router reloads within 2 seconds”). |
| **Steps to Reproduce** | 1. Deploy router. <br>2. Edit `routing.yaml`. <br>3. Observe emitted `routed_job`s for a new report. |
| **Impact** | Severity (Low/Medium/High) and affected users. |
| **Root‑Cause Analysis** | (filled after debugging) |
| **Fix Description** | Code changes, config updates, etc. |
| **Regression Test** | New test case(s) added to prevent recurrence. |
| **Verification** | How QA validated the fix (e.g., “run integration test suite, verify hot‑reload works”). |
| **Release Notes** | Text to add to changelog. |

---  

# 3️⃣ `design.md` – Architecture & Implementation Approach  

## 3.1 High‑Level System Architecture  

```
+-------------------+          +----------------------+          +---------------------------+
|  Kafka Cluster    |  <--->   |  platform-router     |  <--->   |  Content Generators       |
|  analysis.cluster |  Pull    |  (Node.js/TS)        |  Publish |  (IG Carousel, LI Note, |
|  reports topic    |          |                      |          |   YT Long‑form, X Thread) |
+-------------------+          +----------------------+          +---------------------------+

      ^                     ^            ^               ^
      |                     |            |               |
      |   ConfigMap (YAML)  |  Prometheus| OpenTelemetry |
      +---------------------+------------+----------------+
```

* Stateless micro‑service → easy horizontal scaling.  
* ConfigMap holds `routing.yaml`, `formats.yaml`, `priority.yaml`.  
* Hot‑reload via `fs.watch` (fallback to periodic polling).  

## 3.2 Component Diagram  

```
+--------------------+     +-------------------+     +--------------------+
| KafkaConsumer      | --> | Router Core       | --> | KafkaProducer      |
| (analysis…reports) |     |  - ConfigService  |     | (platform-router…) |
+--------------------+     |  - PriorityScorer |     +--------------------+
                           |  - Rule Engine    |
                           +-------------------+
                ^                     |
                |                     v
          +-----------+        +-----------------+
          |  Health   |        |  Metrics/Tracer |
          |  Server   |        +-----------------+
          +-----------+
```

### 3.3 Detailed Data Flow (Sequence Diagram)

```
Participant Client  (Kafka Producer) 
Participant Router   (platform-router)
Participant Config   (File/ConfigMap)

Client->Router: push cluster_report (JSON)
Router->Config: read routing.yaml + formats.yaml + priority.yaml
Router->Router: normalize tags, lookup allowed platforms
Router->Router: compute priority (PriorityScorer)
Router->Router: pick content_format (fallback to default)
Router->Router: build RoutedJob objects (one per platform)
Router->Client: publish each RoutedJob to platform-router.routed_jobs
Router->Metrics: record latency, counters, priority histogram
Router->Tracer : emit spans (consume → process → produce)
```

### 3.4 Implementation Approach  

| Module | Responsibility | Key Types / Functions |
|--------|----------------|-----------------------|
| **KafkaConnector** (`src/kafka.ts`) | Wrap `node-rdkafka` consumer & producer. Handles graceful shutdown, reconnection, back‑pressure. | `subscribe(topic, handler)`, `publish(topic, payload)`, `shutdown()` |
| **ConfigService** (`src/config.ts`) | Loads YAML files, validates schema with `zod`, watches for changes, emits `onChange`. | `load()`, `getRoutingRules()`, `getFormatRules()`, `onChange(cb)` |
| **Router** (`src/router.ts`) | Core business logic – normalises tags, aggregates allowed platforms, chooses format, computes priority, returns `RoutedJob[]`. | `process(report): Promise<RoutedJob[]>` |
| **PriorityScorer** (`src/priority.ts`) | Reads `priority.yaml`, applies weighted sum, normalises to 1‑10. | `score(metrics): number` |
| **Server** (`src/server.ts`) | Express (or Fastify) exposing `/healthz`, `/metrics`, `/config`. | `app.get('/healthz')` |
| **Metrics** (`src/metrics.ts`) | Prometheus client registration. | `routerProcessedTotal`, `routerLatencyHistogram`, etc. |
| **Tracer** (`src/tracer.ts`) | OpenTelemetry SDK – creates a root span per Kafka message. | `startSpan(name)`, `endSpan()` |
| **Index** (`src/index.ts`) | Bootstrap: init ConfigService, KafkaConnector, Router, HTTP server. Handles SIGTERM/INT for graceful shutdown. | `main()` |

### 3.5 Error Handling  

| Layer | Error Types | Recovery Strategy |
|-------|-------------|-------------------|
| **Kafka Consumer** | Connection loss, poll timeout, deserialization error | Auto‑reconnect; on malformed JSON → log error, increment `router_errors_total{type="validation"}` and **skip** the message. |
| **Config Load** | YAML syntax error, missing keys | Fail fast on startup; if hot‑reload fails, keep previous good config and log warning. |
| **Routing Logic** | No matching platform | Log `WARN` with report ID; continue (no job emitted). |
| **Priority Scorer** | Division by zero (max_score = 0) | Guard against zero; default to priority = 1. |
| **Producer** | Publish failure, back‑pressure | Retry with exponential back‑off (max 3 attempts). If still failing → move message to dead‑letter topic `platform-router.dlq`. |
| **HTTP Server** | Unexpected exception | Return 500, capture in tracer, increment `router_errors_total{type="http"}`. |
| **Graceful Shutdown** | In‑flight messages | Stop consuming new messages, wait for all pending `process(report)` promises to resolve (configurable timeout 30 s). |

### 3.6 Testing Strategy  

| Test Level | Tools | Scope |
|------------|-------|-------|
| **Unit** | Jest + `ts-jest` | All pure functions: tag normalisation, rule lookup, priority scoring, format selection. |
| **Integration** | Testcontainers (Kafka) + Supertest (HTTP) | End‑to‑end: consume a `cluster_report`, verify correct `routed_job`s on output topic, health endpoint. |
| **Contract** | Pact (consumer‑provider) | Ensure schema compatibility for both inbound (`ClusterReport`) and outbound (`RoutedJob`). |
| **Load / Performance** | k6 (scripted 10‑k msgs/s) | Measure latency, CPU, error rate, verify SLA (< 10 ms). |
| **Security** | OWASP ZAP (API), npm audit | Scan HTTP endpoints, check dependency vulnerabilities. |
| **Chaos** | Gremlin / Pod‑kill tests | Verify that service recovers from sudden pod loss and continues processing. |

All tests run in CI (GitHub Actions) on every PR. A `make test` target runs unit + integration; `make test-load` runs the k6 script.

---  

# 4️⃣ `tasks.md` – Implementation Task List  

| ID | Title | Description | Owner | Estimate | Status |
|----|-------|-------------|-------|----------|--------|
| **T‑001** | Project scaffolding | Initialise `npm` package, TypeScript config, ESLint/Prettier, GitHub Actions CI. | Dev A | 2 h | ✅ Done |
| **T‑002** | Add contract definitions | Create `contracts/cluster_report.ts` and `contracts/routed_job.ts`. Export types. | Dev A | 1 h | ✅ Done |
| **T‑003** | Kafka connector wrapper | Implement `src/kafka.ts` with consumer (topic `analysis.cluster_reports`) and producer (`platform-router.routed_jobs`). Include graceful shutdown logic. | Dev B | 4 h | ✅ Done |
| **T‑004** | ConfigService (YAML loader) | Load `routing.yaml`, `formats.yaml`, `priority.yaml` using `js-yaml`. Validate schema with `zod`. Implement `fs.watch` hot‑reload. | Dev B | 3 h | ✅ Done |
| **T‑005** | PriorityScorer implementation | Read weights from config, compute weighted sum, normalise to 1‑10. Add unit tests. | Dev C | 2 h | ✅ Done |
| **T‑006** | Router core logic | Implement `Router.process(report)` per design (tag normalisation, platform union, format selection, priority). Add Jest tests for each matrix case. | Dev C | 5 h | ✅ Done |
| **T‑007** | HTTP server (health & metrics) | Use Fastify: `/healthz`, `/metrics`, `/config`. Wire Prometheus client. | Dev D | 3 h | ✅ Done |
| **T‑008** | OpenTelemetry tracing | Initialise tracer, create a span for each consumed message, add attributes (reportId, platformCount). | Dev D | 2 h | ✅ Done |
| **T‑009** | Dockerfile & Helm chart | Multi‑stage build, non‑root user, expose ports 8080 & 9090. Helm chart with ConfigMap for YAML files. | Dev E | 3 h | ✅ Done |
| **T‑010** | Integration test suite | Spin up Kafka container, produce a sample `cluster_report`, assert correct `routed_job`s on output topic. | Dev A | 4 h | ✅ Done |
| **T‑011** | Load test & performance benchmark | Write k6 script, run against local cluster, ensure latency < 10 ms. | Dev B | 3 h | ✅ Done |
| **T‑012** | Error handling & dead‑letter path | Add retry logic for producer, dead‑letter topic publishing, unit tests for failure cases. | Dev C | 2 h | ✅ Done |
| **T‑013** | Security hardening | Enable Kafka TLS/SASL via env vars, add mTLS to HTTP server (optional flag), run npm audit. | Dev D | 2 h | ✅ Done |
| **T‑014** | Documentation | Complete README, add usage examples, update `pitch.md` with architecture diagram. | Dev E | 2 h | ✅ Done |
| **T‑015** | Release & rollout plan | Tag version `v1.0.0`, push Docker image, update Helm repo, create rollout Canary strategy. | Dev A | 1 h | ✅ Done |

**How to run tasks**

- **All at once**: `make all` (runs lint → build → unit tests → integration tests).  
- **Individual task**: `make task T-006` (targets are generated automatically from the table).  

**Status legend**

- ☐ Not started  
- 🔄 In progress  
- ✅ Done  

---  

## 📌 Quick Start (for reviewers)

```bash
# Clone repo
git clone https://github.com/yourorg/platform-router.git
cd platform-router

# Build & run locally (Docker Compose includes Kafka)
docker compose up -d kafka
npm ci
npm run build
npm start   # starts router, health on :8080, metrics on :9090
```

You can now push a `cluster_report` JSON to Kafka (`docker exec -i kafka kafka-console-producer ...`) and watch the `routed_job` events appear on the output topic.

---  

*End of specification package.*