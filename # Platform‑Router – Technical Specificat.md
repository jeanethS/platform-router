# Platform‑Router – Technical Specification  
*Version 1.0 – 07 Jun 2026*  

---

## 1. Overview

**Project name** – `platform-router`  

**Tagline** – *Smart content moderation and routing engine*  

**Purpose** – Ingest `cluster_report` events produced by the content‑analysis pipeline, evaluate them against configurable routing rules, pick the appropriate output format, compute a priority score, and emit a `routed_job` for downstream content generators (IG Carousel, LinkedIn Article, YouTube Long‑form, X Thread, TikTok/Douyin Short‑video, RedNote, etc.).  

**Scope** –  
1. Stateless, highly‑available micro‑service written in TypeScript/Node.js.  
2. Config‑driven routing matrix (YAML) that can be updated without redeploy.  
3. Pluggable format‑selection rules per platform+category.  
4. Engagement‑based priority scoring (based on the `cluster_report` metrics).  
5. Publication of `routed_job` events to a Kafka topic (`platform-router.routed_jobs`).  
6. Observability (metrics, logs, tracing) and basic health‑checks.  

---

## 2. Glossary

| Term | Definition |
|------|------------|
| **ClusterReport** | JSON object produced by the upstream clustering service. Contains `id`, `category_tags[]`, `engagement_metrics`, `content`, `created_at`, … |
| **RoutedJob** | The output event that tells a downstream generator *what* to produce (platform, format, priority). |
| **Routing Rules** | Matrix that maps a *category tag* to the set of allowed `target_platform`s. |
| **Format Rules** | Mapping that decides which `content_format` to use for a given `(platform, category)` pair. |
| **Priority Scorer** | Function that converts engagement metrics into a numeric priority (1‑10). |
| **Connector** | Kafka consumer/producer wrapper used by the router. |
| **YAML Config** | Human‑readable configuration files (`routing.yaml`, `formats.yaml`) that are hot‑reloaded. |

---

## 3. Functional Requirements

| # | Requirement |
|---|-------------|
| FR‑1 | **Consume** `cluster_report` events from Kafka topic `analysis.cluster_reports`. |
| FR‑2 | **Validate** payload against the `ClusterReport` contract. |
| FR‑3 | **Determine** the set of compatible platforms using the *routing* matrix. |
| FR‑4 | **Select** a `content_format` based on the *formats* matrix. |
| FR‑5 | **Score** a priority value `1‑10` using the engagement scorer. |
| FR‑6 | **Emit** one `routed_job` per `(report, platform)` pair that passed the routing check. |
| FR‑7 | **Publish** `routed_job` events to Kafka topic `platform-router.routed_jobs`. |
| FR‑8 | **Log** a warning for any `category_tag` that has **no** matching platform. |
| FR‑9 | **Expose** a `/healthz` endpoint (readiness & liveness). |
| FR‑10 | **Provide** an HTTP `GET /config` endpoint that returns the active routing & format rules (useful for Ops). |
| FR‑11 | **Allow** hot‑reloading of the YAML files without service restart (watch file system). |
| FR‑12 | **Support** graceful shutdown (finish processing in‑flight messages). |
| FR‑13 | **Instrument** Prometheus metrics: `router_processed_total`, `router_errors_total`, `router_latency_seconds`, `router_priority_histogram`. |

---

## 4. Non‑Functional Requirements

| NFR | Description |
|-----|-------------|
| **Performance** | ≤ 10 ms processing latency per message (excluding Kafka I/O). |
| **Scalability** | Stateless → horizontal scaling via Kubernetes Deployment (replica count). |
| **Reliability** | At‑least‑once delivery semantics with idempotent `routed_job` IDs (use `cluster_report.id + platform` as composite key). |
| **Observability** | Structured JSON logs, OpenTelemetry tracing, Prometheus metrics. |
| **Security** | Kafka TLS + SASL, service‑to‑service mTLS for HTTP endpoints, no external network exposure. |
| **Maintainability** | 100 % unit‑test coverage, linting (ESLint/Prettier), typed contracts (`*.d.ts`). |
| **Configurability** | All routing/format rules live in YAML under `src/rules/`. Changes are hot‑reloaded automatically. |
| **Compliance** | No personal data stored; all data is transient. |

---

## 5. System Architecture

```
+-------------------+         +----------------------+          +----------------------+
|  Kafka Cluster    |  <--->  | platform-router svc |  <--->   |  Downstream Generators|
|  analysis.cluster |  Pull   | (Node.js/TS)         |  Publish |  (IG, LI, YT, X,…) |
|  reports topic    |         |                      |          |                      |
+-------------------+         +----------------------+          +----------------------+

                ^                     ^               ^
                |                     |               |
                |                     |               |
                |                     |               |
                |   ConfigMap (YAML)  |   Prometheus   |
                +---------------------+-----------------+
```

* **Kafka** – source and sink of events.  
* **platform‑router** – stateless microservice, runs multiple replicas behind a Service.  
* **ConfigMap** – stores `routing.yaml` & `formats.yaml`. Mounted read‑only, watched for changes.  
* **Prometheus** – scrapes `/metrics` endpoint.  
* **OpenTelemetry Collector** – gathers trace data.

---

## 6. Data Model

### 6.1 ClusterReport (input)

```typescript
// contracts/cluster_report.ts
export interface EngagementMetrics {
  likes: number;
  shares: number;
  comments: number;
  views: number;
  watch_time_seconds?: number; // optional for video content
}

export interface ClusterReport {
  id: string;                     // globally unique
  category_tags: string[];        // e.g. ["tech", "science"]
  content: string;                // raw text or markdown
  engagement_metrics: EngagementMetrics;
  created_at: string;             // ISO‑8601
  // additional fields (ignored by router)
}
```

### 6.2 RoutedJob (output)

```typescript
// contracts/routed_job.ts
export type Platform =
  | "instagram"
  | "linkedin"
  | "youtube"
  | "x"
  | "tiktok"
  | "douyin"
  | "rednote";

export type ContentFormat = "carousel" | "short_video" | "long_video" | "thread" | "note";

export interface RoutedJob {
  id: string;                 // `${clusterReport.id}:${platform}`
  cluster_report: ClusterReport;
  target_platform: Platform;
  content_format: ContentFormat;
  priority: number;           // 1‑10
  created_at: string;         // ISO‑8601 (router timestamp)
}
```

---

## 7. Configuration Files

### 7.1 `routing.yaml`

```yaml
# src/rules/routing.yaml
# Mapping: category_tag → allowed platforms (true = allowed)
tech_science:
  instagram: true
  linkedin: true
  youtube: true
  x: true
  tiktok: true
  douyin: false
  rednote: false

robotics_maker:
  instagram: true
  linkedin: true
  youtube: true
  x: true
  tiktok: true
  douyin: true
  rednote: false

culture_aesthetics:
  instagram: true
  linkedin: false
  youtube: false
  x: false
  tiktok: true
  douyin: true
  rednote: true

biz_startups:
  instagram: false
  linkedin: true
  youtube: true
  x: true
  tiktok: false
  douyin: false
  rednote: false

cn_market:
  instagram: false
  linkedin: false
  youtube: true
  x: false
  tiktok: true
  douyin: true
  rednote: true
```

> **Note** – The keys (`tech_science`, `robotics_maker`, …) are *canonical* names for the categories. The router normalises incoming tags (lower‑case, underscores) before lookup.

### 7.2 `formats.yaml`

```yaml
# src/rules/formats.yaml
# Default format per platform (fallback if no category‑specific entry)
default:
  instagram: carousel
  linkedin: carousel
  youtube: long_video
  x: thread
  tiktok: short_video
  douyin: short_video
  rednote: note

# Category‑specific overrides
tech_science:
  instagram: carousel
  linkedin: carousel
  youtube: long_video
  x: thread
  tiktok: short_video
  douyin: short_video

culture_aesthetics:
  instagram: carousel
  tiktok: short_video
  douyin: short_video
  rednote: note

biz_startups:
  linkedin: carousel
  youtube: long_video
  x: thread
```

> **Hot‑reload** – Both YAML files are read on startup and re‑read whenever the underlying file changes (via `fs.watch`).

---

## 8. Component Design

| Component | Responsibility | Key Interfaces |
|-----------|----------------|----------------|
| **KafkaConnector** | Consume `cluster_report`s, Produce `routed_job`s | `subscribe(topic, handler)`, `publish(topic, message)` |
| **Router** | Core business logic – rule evaluation, format selection, priority scoring | `process(report: ClusterReport): RoutedJob[]` |
| **PriorityScorer** | Convert `engagement_metrics` → `priority` (1‑10) | `score(metrics: EngagementMetrics): number` |
| **ConfigService** | Load & watch YAML files, expose `getRoutingRules()`, `getFormatRules()` | `onChange(callback)` |
| **Metrics** | Prometheus counters/gauges/histograms | `inc()`, `observe()` |
| **HTTP Server** | `/healthz`, `/metrics`, `/config` endpoints | Express/Koa/Fastify |
| **Tracer** | OpenTelemetry spans for each message processed | `startSpan(name)` |

---

### 8.1 Router Algorithm (pseudo‑code)

```typescript
// src/router.ts
import { ClusterReport } from "../contracts/cluster_report";
import { RoutedJob, Platform, ContentFormat } from "../contracts/routed_job";
import { ConfigService } from "./config";
import { PriorityScorer } from "./priority";

export class Router {
  private cfg = ConfigService.instance;
  private scorer = new PriorityScorer();

  async route(report: ClusterReport): Promise<RoutedJob[]> {
    const jobs: RoutedJob[] = [];

    // 1️⃣ Normalise tags → canonical names
    const canonicalTags = report.category_tags.map(t => this.normalizeTag(t));

    // 2️⃣ Gather allowed platforms (union across tags)
    const allowedPlatforms = new Set<Platform>();
    const formatOverrides: Record<Platform, ContentFormat> = {};

    for (const tag of canonicalTags) {
      const rule = this.cfg.routing[tag];
      if (!rule) continue; // unknown tag → ignore

      for (const [platform, allowed] of Object.entries(rule) as [Platform, boolean][]) {
        if (allowed) allowedPlatforms.add(platform);
      }

      // Store format overrides (later tag wins – deterministic order)
      const fmt = this.cfg.formats[tag];
      if (fmt) Object.assign(formatOverrides, fmt);
    }

    // 3️⃣ If no platform matched → warn & return empty
    if (allowedPlatforms.size === 0) {
      Logger.warn(`No routing target for report ${report.id} tags=${report.category_tags}`);
      return jobs;
    }

    // 4️⃣ Compute priority once (shared across all platforms)
    const priority = this.scorer.score(report.engagement_metrics);

    // 5️⃣ Emit a job per allowed platform
    for (const platform of allowedPlatforms) {
      const format: ContentFormat =
        (formatOverrides[platform] as ContentFormat) ??
        this.cfg.formats.default[platform]; // fallback

      const job: RoutedJob = {
        id: `${report.id}:${platform}`,
        cluster_report: report,
        target_platform: platform,
        content_format: format,
        priority,
        created_at: new Date().toISOString(),
      };
      jobs.push(job);
    }

    return jobs;
  }

  private normalizeTag(tag: string): string {
    // "Tech + Science" → "tech_science"
    return tag
      .trim()
      .toLowerCase()
      .replace(/[ +&]/g, "_")
      .replace(/[^a-z0-9_]/g, "");
  }
}
```

---

### 8.2 Priority Scorer

The scorer is *configurable* via `priority.yaml` (optional) to tune the weighting model. The default implementation uses a simple weighted sum:

```yaml
# src/rules/priority.yaml
weights:
  likes: 0.2
  shares: 0.3
  comments: 0.25
  views: 0.15
  watch_time_seconds: 0.1   # only for video content
max_score: 100
```

```typescript
// src/priority.ts
export class PriorityScorer {
  private cfg = ConfigService.instance.priority; // loaded from priority.yaml

  score(metrics: EngagementMetrics): number {
    const w = this.cfg.weights;
    const raw =
      (metrics.likes ?? 0) * w.likes +
      (metrics.shares ?? 0) * w.shares +
      (metrics.comments ?? 0) * w.comments +
      (metrics.views ?? 0) * w.views +
      (metrics.watch_time_seconds ?? 0) * w.watch_time_seconds;

    // Normalise to 1‑10 using max_score → linear scaling
    const scaled = Math.min(10, Math.max(1, Math.round((raw / this.cfg.max_score) * 10)));
    return scaled;
  }
}
```

> **Extensibility** – Future versions could switch to a machine‑learning model (e.g., LightGBM) while preserving the same interface.

---

## 9. API Contracts

| Direction | Topic | Schema | Description |
|-----------|-------|--------|-------------|
| **Input** | `analysis.cluster_reports` | `ClusterReport` (see §6.1) | Produced by the clustering service. |
| **Output** | `platform-router.routed_jobs` | `RoutedJob` (see §6.2) | Consumed by platform‑specific generators. |

*All messages are JSON‑encoded UTF‑8.*

---

## 10. Deployment Architecture

### 10.1 Kubernetes Manifest (simplified)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: platform-router
  labels: { app: platform-router }
spec:
  replicas: 3
  selector:
    matchLabels: { app: platform-router }
  template:
    metadata:
      labels: { app: platform-router }
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      containers:
        - name: router
          image: ghcr.io/yourorg/platform-router:1.0.0
          ports:
            - containerPort: 8080   # HTTP
            - containerPort: 9090   # Prometheus
          env:
            - name: KAFKA_BROKERS
              value: "kafka-broker:9092"
            - name: KAFKA_CLIENT_ID
              value: "platform-router"
            - name: KAFKA_SASL_MECHANISM
              value: "SCRAM-SHA-256"
          volumeMounts:
            - name: config
              mountPath: /app/src/rules
      volumes:
        - name: config
          configMap:
            name: platform-router-config   # contains routing.yaml, formats.yaml, priority.yaml
```

### 10.2 ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: platform-router-config
data:
  routing.yaml: |
    # (contents from §7.1)
  formats.yaml: |
    # (contents from §7.2)
  priority.yaml: |
    weights:
      likes: 0.2
      shares: 0.3
      comments: 0.25
      views: 0.15
      watch_time_seconds: 0.1
    max_score: 200
```

*Updating the ConfigMap triggers a rolling update of the pods (or the in‑process `fs.watch` picks up changes automatically).*

---

## 11. Observability & Monitoring

| Metric | Type | Description |
|--------|------|-------------|
| `router_processed_total{platform="<platform>"}` | Counter | Number of `routed_job`s emitted per platform. |
| `router_errors_total{type="<validation|routing|kafka>"}` | Counter | Count of processing errors. |
| `router_latency_seconds{stage="routing"}` | Histogram | Time spent in the routing function. |
| `router_priority_histogram` | Histogram | Distribution of computed priority values (1‑10). |
| `process_cpu_seconds_total`, `process_resident_memory_bytes` | Standard Prometheus | Process health. |

*All logs are structured JSON: `{timestamp, level, service, traceId, message, ...}`.*

Tracing: a parent span is created for each consumed Kafka message; child spans are added for config loading, rule lookup, scoring, and publishing.

---

## 12. Testing Strategy

| Layer | Tool | Coverage Goal |
|-------|------|---------------|
| **Unit** | Jest + `ts-jest` | 100 % of router, scorer, config loader. |
| **Integration** | Testcontainers (Kafka) + Supertest | End‑to‑end validation of consume → produce. |
| **Contract** | Pact (producer/consumer) | Ensure schema compatibility. |
| **Load** | k6 (scripted 10 k msgs/s) | ≤ 10 ms processing latency, < 5 % errors. |
| **Security** | OWASP ZAP (HTTP endpoints) | No vulnerabilities. |

All CI runs on GitHub Actions; PRs must pass all checks.

---

## 13. Security Considerations

| Threat | Mitigation |
|--------|------------|
| **Message tampering** | Kafka SSL + SASL, message signing optional via schema registry. |
| **Unauthorised config change** | ConfigMap RBAC limited to `platform-router` service account. |
| **Information leakage** | Only IDs and category tags are forwarded; content is anonymised for routing. |
| **Denial‑of‑service** | Rate‑limit consumer (`max.poll.records`) and set `max.poll.interval.ms`. |
| **Dependency vulnerabilities** | Dependabot alerts, weekly `npm audit` in CI. |

---

## 14. Future Enhancements (Roadmap)

| Version | Feature |
|---------|---------|
| 1.1 | **A/B testing** – probabilistic routing (e.g., 80 % to IG carousel, 20 % to short video). |
| 1.2 | **ML‑based priority** – replace linear scorer with a trained model (ONNX). |
| 2.0 | **Dynamic rule service** – replace YAML with a small REST rule engine for enterprise customers. |
| 2.1 | **Multi‑language support** – auto‑detect language and add locale‑specific platforms. |
| 3.0 | **Feedback loop** – ingest `generated_content` performance metrics to re‑calibrate scoring. |

---

## 15. Project Timeline (approx.)

| Sprint | Milestones |
|-------|------------|
| **Sprint 0** (2 weeks) | Repo init, CI pipeline, basic Kafka contract, skeleton code. |
| **Sprint 1** (2 weeks) | Config loader, routing matrix implementation, unit tests. |
| **Sprint 2** (2 weeks) | Priority scorer, format selector, Prometheus metrics. |
| **Sprint 3** (2 weeks) | End‑to‑end integration tests, Dockerfile, Helm chart. |
| **Sprint 4** (2 weeks) | Observability (OpenTelemetry), health endpoints, docs. |
| **Sprint 5** (1 week) | Load testing, performance tuning, security audit. |
| **Release** | Deploy to staging → production (canary rollout). |

---

## 16. Glossary Recap

- **ClusterReport** – Input event from upstream analysis.  
- **RoutedJob** – Output event consumed by content generators.  
- **Router** – Core service that decides *where* and *how* to publish.  
- **Priority** – Numerical ranking (1‑10) derived from engagement cues.  

---

## 17. References

| Document | Link |
|----------|------|
| Kafka Client (node‑rdkafka) | https://github.com/Blizzard/node-rdkafka |
| OpenTelemetry Node SDK | https://github.com/open-telemetry/opentelemetry-js |
| Prometheus Exporter for Node | https://github.com/siimon/prom-client |
| Kubernetes ConfigMap pattern | https://kubernetes.io/docs/concepts/configuration/configmap/ |
| RFC 6902 (JSON Patch) – used for future dynamic rule updates | https://tools.ietf.org/html/rfc6902 |

---

*Prepared by the Platform‑Router Architecture Team*  
*Contact: architecture@yourorg.com*  