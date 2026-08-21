# analytics-ingestor — design spec

Fecha: 2026-08-20
Estado: diseñado, listo para implementation plan (`superpowers:writing-plans`).
Precede a: `2026-08-20-measure-recycle-analytics-ingestor.md` (brainstorming source, preguntas abiertas resueltas acá).

## Contexto

Tercer gap de BrandOSS vs `social-media-skills`: cierra el loop
`publish → analytics → semantic-graph → platform-router`. FOUNDATION
(`brand-config`) y CREATE (`brand-os-generation`) ya en producción; este es
MEASURE & RECYCLE.

Hallazgo clave de esta sesión: `publish-queue` ya persiste
`ContentArtifact.externalId` en su Postgres tras un publish real
(`publish-queue.service.ts:183`, vía `PublishResult` del adapter de Taisly).
Ese es el punto de entrada natural para saber qué se publicó y con qué ID
nativo — no hace falta un topic nuevo solo para el discovery.

## Decisiones (resueltas en brainstorming)

| Pregunta | Decisión |
|---|---|
| Repo | Standalone `analytics-ingestor/`, mismo shape que `brand-os-generation`/`canva-connector` (BullMQ Worker, `@brand-os/contracts`, ioredis) |
| Fuente de datos | Lectura nativa por plataforma (Instagram Graph API, LinkedIn API) — Taisly no expone analytics surface |
| Scope de plataformas v1 | Instagram + LinkedIn primero (lo que carousel-studio publica hoy); resto de `platform_flags` (tiktok, x, youtube, douyin, rednote, whatsapp) queda como adapter stub con TODO documentado, no implementado en este plan |
| Discovery de artifacts publicados | Leer `publish-queue` Postgres: `ContentArtifact` con `status='published'` y `externalId` no nulo |
| Contrato de métricas | Nuevo `AnalyticsSnapshot` en `@brand-os/contracts` (no extender `ContentArtifact.analytics` in place) |
| Métricas (framework METER) | `saves, shares, watch_time_seconds, engagement_rate_by_reach, follower_growth_rate, ctr, views` |
| Cierre del loop hacia semantic-graph | Nuevo campo opcional `historical_performance` en `ClusterReport` — separado de `engagement` (que agrega señal de trend signals, no performance de contenido propio) |
| Cadencia | BullMQ repeat-job (cron-like), mismo patrón que el resto del pipeline — no webhooks |
| Trigger de recycle | Worker automático — top-N% por `engagement_rate_by_reach` dentro del cluster/categoría del artifact, umbral relativo (no absoluto) |

## Arquitectura

Nuevo repo `analytics-ingestor/`, TypeScript, mismo layout que
`brand-os-generation`:

```
analytics-ingestor/
  src/
    worker.ts            # Collector Worker (BullMQ repeat-job)
    adapters/
      instagram.ts        # Instagram Graph API client
      linkedin.ts          # LinkedIn API client
      types.ts             # AnalyticsAdapter interface (shared shape)
    aggregate/
      historicalPerformance.ts  # snapshot → ClusterReport.historical_performance rollup
    recycle/
      threshold.ts          # top-N% percentile logic, emits recycle candidate
    db/
      publishQueueReader.ts # read-only query against publish-queue Postgres
  tests/
    worker.test.ts
    adapters/instagram.test.ts
    adapters/linkedin.test.ts
    recycle/threshold.test.ts
```

## Contratos nuevos (`@brand-os/contracts`, fuente en `infra-social/contracts`)

```ts
// src/analytics_snapshot.ts
export interface AnalyticsSnapshot {
  id: string; // UUID v4
  artifact_id: string; // ref ContentArtifact.id
  platform: string;
  external_id: string; // ref ContentArtifact.externalId
  saves: number | null;
  shares: number | null;
  watch_time_seconds: number | null;
  engagement_rate_by_reach: number | null;
  follower_growth_rate: number | null;
  ctr: number | null;
  views: number | null;
  collected_at: string; // ISO-8601
}
```

```ts
// añadido a src/topics.ts
ANALYTICS_COLLECTED: 'analytics.collected',
RECYCLE_CANDIDATES: 'recycle.candidates',
```

```ts
// añadido a src/cluster_report.ts, campo opcional en ClusterReport
/**
 * Performance real de contenido publicado que se originó de este cluster,
 * agregado por analytics-ingestor. Distinto de `engagement` (que agrega
 * señal de trend signals de origen, no performance de contenido propio).
 */
historical_performance?: {
  avg_engagement_rate_by_reach: number;
  sample_size: number; // # de artifacts con snapshot agregados
  updated_at: string; // ISO-8601
};
```

Zod schemas correspondientes en `src/schemas/analytics_snapshot.zod.ts`,
siguiendo el patrón existente de los otros contratos.

## Flujo de datos

1. **Collector Worker** — BullMQ repeat-job cada 6h. Lee `publish-queue`
   Postgres (read-only) por `ContentArtifact` con `status='published'` y
   `externalId` no nulo, filtrado a `platform IN ('instagram', 'linkedin')`.
2. Por cada artifact, invoca el adapter nativo correspondiente
   (`adapters/instagram.ts` o `adapters/linkedin.ts`) para pedir las métricas
   METER de ese post vía su `externalId`.
3. Escribe un `AnalyticsSnapshot` y publica en `ANALYTICS_COLLECTED`.
4. **Aggregator** (mismo worker, corre después de cada snapshot) recalcula
   `historical_performance` del `ClusterReport` correspondiente
   (`routed_job_id → cluster_id`) y lo persiste vía el mismo mecanismo que
   `semantic-graph` usa para emitir `ClusterReport` actualizados.
5. **Recycle Worker** — al recibir cada `ANALYTICS_COLLECTED`, calcula el
   percentil de `engagement_rate_by_reach` del artifact contra la historia
   reciente de su cluster/categoría. Si cae en el top-N% (config, default
   10%), publica un job en `RECYCLE_CANDIDATES` — `content-recycling` skill
   decide el ángulo de refresh (nunca repost idéntico), no este worker.

## Manejo de errores

- Falla o rate-limit de API nativa → log, artifact queda para el próximo
  tick del cron (sin retry agresivo).
- Un adapter de plataforma caído no bloquea a los demás — aislados por
  plataforma.
- `externalId` faltante o inválido → skip, no fatal.
- Aggregator sin snapshots suficientes (`sample_size` bajo) → no escribe
  `historical_performance` (evita que platform-router priorice sobre
  muestra insuficiente).

## Testing

- Contract test: `AnalyticsSnapshot` zod schema válido/inválido, mismo
  patrón que los otros `*.zod.ts` tests.
- Adapter tests: mocks de respuesta HTTP por plataforma (Instagram Graph
  API, LinkedIn API), casos éxito/rate-limit/malformed.
- Worker test: `historical_performance` aggregation correcto dado un set
  de snapshots (mirror de `brand-os-generation/tests/worker.test.ts`).
- Threshold test: top-N% percentile logic, casos borde (cluster con 1
  solo sample, empate en el percentil).

## Fuera de alcance (este plan)

- Adapters para tiktok, x, youtube, douyin, rednote, whatsapp — stub con
  TODO, no implementados.
- UI/dashboard de analytics — no pedido.
- A/B testing de hooks (`experimentation-and-ab-testing` skill) — consumidor
  futuro de estos datos, no parte de este ingestor.
