# analytics-ingestor (MEASURE & RECYCLE) — design spec

Fecha: 2026-08-20
Estado: diseñado, listo para implementation plan (`superpowers:writing-plans`).
Precede a: `2026-08-20-measure-recycle-analytics-ingestor.md` (brainstorming source, preguntas abiertas resueltas acá).

**REVISIÓN 2026-08-20 (misma sesión):** el diseño original de este doc
proponía un repo standalone `analytics-ingestor/`. Al arrancar
`writing-plans` se descubrió que `publish-queue` ya tiene un módulo de
analytics — `AnalyticsCollectorService`, `PerformanceScorerService`,
adapters `pullAnalytics` — pero está **muerto y mockeado**:
`scheduleAnalyticsCollection` nunca se llama desde el flujo de publish real,
y `InstagramAdapter`/`LinkedInAdapter`.`pullAnalytics` devuelven
`Math.random()`. Pivot: completar ese módulo in-place en vez de construir
un repo nuevo. Ver sección "Arquitectura" (revisada) abajo — el resto del
documento refleja la revisión, no el diseño original.

## Contexto

Tercer gap de BrandOSS vs `social-media-skills`: cierra el loop
`publish → analytics → semantic-graph → platform-router`. FOUNDATION
(`brand-config`) y CREATE (`brand-os-generation`) ya en producción; este es
MEASURE & RECYCLE.

Hallazgos clave de esta sesión:

- `publish-queue` ya persiste `ContentArtifact.externalId` en su Postgres
  tras un publish real (`publish-queue.service.ts:183`, vía `PublishResult`
  del adapter activo). Punto de entrada natural para saber qué se publicó y
  con qué ID nativo.
- `publish-queue/src/analytics/` ya tiene `AnalyticsCollectorService`
  (BullMQ delay-job de 6h post-publish, config
  `ANALYTICS_COLLECTION_DELAY_HOURS`) y `PerformanceScorerService`
  (score ponderado por plataforma + **percentil vs historial de 30 días,
  ya calculado** en `getHistoricalComparison`). Ninguno de los dos está
  conectado al flujo real — `scheduleAnalyticsCollection` no tiene
  callers, y `InstagramAdapter`/`LinkedInAdapter.pullAnalytics` son mocks
  con `Math.random()`.
- `platform-router` es stateless — no tiene DB. `PriorityScorer` calcula
  prioridad solo desde el `engagement` efímero de cada `ClusterReport`
  recibido por BullMQ. La dimensión estable a través del tiempo es
  `ClusterReport.category` (7 valores fijos, usada ya como key de
  `routing_rules`), no `cluster_id` (que es efímero, re-generado en cada
  corrida de clustering de `semantic-graph`).
- `ContentArtifact` (Prisma, `publish-queue`) no tiene ninguna columna que
  lo enlace de vuelta a su `cluster_report`/`category` de origen. Tampoco
  existe ningún `.create()` de `ContentArtifact` en el código presente en
  este workspace — esa parte del pipeline (CREATE → fila en la DB de
  publish-queue) es un gap preexistente, fuera de alcance de este plan.
- Bajo `PUBLISH_DRIVER=taisly` (el driver real), `linkedin` no está en la
  lista de override de `AdapterFactory`, así que el publish de LinkedIn
  sigue siendo mock en producción hoy. Gap preexistente, no relacionado a
  analytics, no se toca en este plan.

## Decisiones

| Pregunta | Decisión |
|---|---|
| Repo | **Ninguno nuevo** — completar `publish-queue/src/analytics/` in-place (revisado; ver nota arriba) |
| Fuente de datos | Lectura nativa por plataforma (Instagram Graph API, LinkedIn API) vía los adapters `pullAnalytics` ya existentes en `publish-queue`, con implementación real en vez de mock |
| Scope de plataformas v1 | Instagram + LinkedIn únicamente. Resto (`youtube`, `x`, `tiktok`, `douyin`, `rednote`) sin tocar |
| Discovery de artifacts publicados | No hace falta un scan — el collector se dispara inline (`scheduleAnalyticsCollection`) justo después de un publish real exitoso, ya usando `result.externalId` que `publish-queue.service.ts` ya tiene en mano |
| Contrato de métricas | Extender la interfaz `Analytics` ya existente en `publish-queue/src/adapters/platform.interface.ts` (no un contrato nuevo en `@brand-os/contracts` — los datos viven en el Postgres de `publish-queue`, no se emiten como evento cross-service) |
| Métricas (framework METER) | `saves, watch_time_seconds, engagement_rate_by_reach, follower_growth_rate, ctr` agregados a `Analytics` (views/likes/comments/shares/engagementRate ya existían) |
| Cierre del loop hacia semantic-graph/platform-router | **Redis, no un campo en `ClusterReport`.** `historical_performance:<category>` (hash: `avg`, `sample_size`, `updated_at`), escrito por `HistoricalPerformanceService` en `publish-queue`, leído por `PriorityScorer` en `platform-router` vía la misma conexión ioredis que `BusConnector` ya mantiene. Motivo: `ClusterReport` es un mensaje efímero, no una entidad consultable — y `category` es la dimensión estable, no `cluster_id` |
| Cadencia | El delay-job de 6h que `AnalyticsCollectorService` ya implementaba se conserva tal cual — no hace falta un cron/repeat-job nuevo |
| Trigger de recycle | Reutiliza `PerformanceScorerService.calculateScore().comparison.percentile` (ya calculado, nunca leído hasta ahora). Percentil ≥ umbral configurable (default 90, top 10%) → encola en topic nuevo `RECYCLE_CANDIDATES` |
| Columna nueva en `ContentArtifact` | `category: String?` (nullable) — permite el rollup por categoría; queda `null` hasta que se construya la wiring de creación de `ContentArtifact` (gap preexistente, fuera de alcance) |

## Arquitectura (revisada)

Sin repo nuevo. Cambios en tres repos existentes:

```
infra-social/contracts/
  src/topics.ts              # + RECYCLE_CANDIDATES

publish/publish-queue/
  prisma/schema.prisma        # + ContentArtifact.category (nullable)
  src/adapters/
    platform.interface.ts     # Analytics + campos METER
    platforms/
      instagram.adapter.ts    # pullAnalytics real (Instagram Graph API)
      linkedin.adapter.ts     # pullAnalytics real (LinkedIn API)
  src/analytics/
    analytics-collector.service.ts   # wired: score + historical rollup + recycle enqueue
    historical-performance.service.ts # nuevo — rollup Redis por category
  src/scheduler/
    publish-queue.service.ts  # llama scheduleAnalyticsCollection tras publish real

platform-router/
  src/priority.ts              # lee historical_performance:<category> de Redis
  src/router.ts                # pasa report.category + await al scorer
  src/bus.ts                   # comparte su conexión ioredis con Router/PriorityScorer
```

## Flujo de datos

1. `publish-queue.service.ts` publica un artifact. Si el resultado no es un
   `handoff` (i.e. publicación real, no draft a revisión humana), llama
   `analyticsCollector.scheduleAnalyticsCollection(artifactId, platform,
   externalId)` — ya existente, antes sin caller.
2. Tras el delay configurado (`ANALYTICS_COLLECTION_DELAY_HOURS`, default
   6h), `AnalyticsCollectorService` invoca
   `adapterFactory.pullAnalytics(platform, externalId)` — ahora una llamada
   real a Instagram Graph API o LinkedIn API en vez de `Math.random()`.
3. El resultado se mergea en `ContentArtifact.analytics` (ya existente) y
   además:
   - `PerformanceScorerService.calculateScore()` — ya existente, ahora
     invocado — calcula `score` y `comparison.percentile`.
   - `HistoricalPerformanceService.record(artifact.category,
     analytics.engagementRateByReach)` — nuevo — actualiza el promedio
     corriente en Redis para esa categoría.
   - Si `comparison.percentile >= RECYCLE_PERCENTILE_THRESHOLD` (default
     90), se encola un job en `TOPICS.RECYCLE_CANDIDATES` — el ángulo de
     refresh lo decide un consumidor futuro (`content-recycling` skill),
     no este worker.
4. `platform-router`, al rutear un `ClusterReport`, lee
   `historical_performance:<report.category>` de Redis y blende ese
   promedio (ponderado 30%) con el score de engagement del reporte actual
   (70%) para la prioridad final — solo si `sample_size` de esa categoría
   alcanza un mínimo (3), si no cae al comportamiento actual sin cambios.

## Manejo de errores

- Falla o rate-limit de API nativa → se propaga como excepción del job
  BullMQ (ya tenía `attempts: 3` con backoff exponencial en
  `scheduleAnalyticsCollection`); no se agrega retry adicional.
- Un adapter de plataforma caído no bloquea al otro — llamadas HTTP
  aisladas por adapter.
- `artifact.category` nulo → `HistoricalPerformanceService.record` es no-op
  (no rompe el flujo de analytics).
- `comparison` undefined (sin historial de 30 días todavía) → no se encola
  recycle candidate.
- `platform-router` sin datos en Redis para una categoría, o
  `sample_size` insuficiente → usa el score base sin blend, mismo
  fallback que ya existía para `engagement` ausente.

## Testing

- `instagram.adapter.spec.ts` / `linkedin.adapter.spec.ts` (nuevos): mocks
  de `fetch`, casos éxito/error por plataforma.
- `historical-performance.service.spec.ts` (nuevo): running average,
  no-op con category/metric null.
- `analytics-collector.service.spec.ts` (nuevo — no existía): scoring +
  rollup + recycle enqueue, con y sin threshold alcanzado.
- `publish-queue.service.spec.ts` (extendido): confirma que
  `scheduleAnalyticsCollection` se llama tras publish real y NO tras un
  handoff.
- `priority.test.ts` (extendido): blend de historical performance con
  distintos `sample_size`, fallback cuando `category` es undefined.

## Fuera de alcance (este plan)

- Adapters para tiktok, x, youtube, douyin, rednote, whatsapp.
- Wiring de creación de `ContentArtifact` con `category` poblado (gap
  preexistente — la columna queda lista pero nadie la llena todavía).
- Publish real de LinkedIn bajo `PUBLISH_DRIVER=taisly` (sigue mock, gap
  preexistente no relacionado a analytics).
- UI/dashboard de analytics — no pedido.
- A/B testing de hooks (`experimentation-and-ab-testing` skill) —
  consumidor futuro de `RECYCLE_CANDIDATES`, no parte de este plan.
- Consumidor real de `RECYCLE_CANDIDATES` (decide el ángulo de refresh) —
  el topic queda definido y productores lo publican; el consumidor es
  trabajo futuro, como pasó con `CAROUSEL_JOBS` antes de que
  `carousel-studio` lo consumiera.
