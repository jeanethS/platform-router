# MEASURE & RECYCLE — analytics-ingestor (not yet started)

Fecha: 2026-08-20
Estado: documentado pero no implementado — próximo sub-proyecto tras FOUNDATION (brand-config) y CREATE (brand-os-generation) ambos ya en producción.

## Contexto

Este spec documenta el tercer y último gap identificado al comparar BrandOSS
contra el repo `social-media-skills` (https://github.com/social-media-skills/skills),
tras completar los otros dos:

1. **FOUNDATION** — `brand-config` repo (`brand-profile.md` + `voice.md`), wireado a `semantic-graph/src/report/generator.ts` vía `BRAND_CONFIG_DIR`. Hecho.
2. **CREATE** — `brand-os-generation` (el nodo `GQ` del diagrama), consume `jobs.routed`, genera copy de slides con `carousel-writer` + voz de marca, publica a `carousel.jobs`; `carousel-studio` ahora lo consume. Hecho.
3. **MEASURE & RECYCLE** — este documento. No empezado.

## El gap real

El diagrama de arquitectura de esta misma sesión ya marcaba:

```
NET[redes] → AN[Analytics → Platform Router]: planned
```

No existe ningún repo `analytics-ingestor` en BrandOSS. El loop que cierra
`publish → analytics → semantic-graph` (retroalimentando qué funcionó hacia
el clustering) está sin construir.

Estado real de los datos que ya existen y podrían alimentar esto:

- `ContentArtifact.analytics` (`infra-social/contracts/src/content_artifact.ts`) ya tiene el campo:
  ```ts
  analytics: {
    views: number | null;
    engagement: number | null;
    collected_at: string | null;
  };
  ```
  Pero es delgado — solo views/engagement genéricos, no las métricas de "señal" (saves, shares, watch-time/retention, engagement-rate-by-reach) que `analytics-and-reporting` (skill) insiste en medir en vez de vanity metrics.
- `publish/publish-queue` (Taisly, fork de Postiz) es quien realmente publica — cualquier ingestor tiene que leer de ahí o de las APIs nativas de cada red, nunca inventar métricas (regla dura de todas las skills de esta familia: "WoopSocial/Taisly no tiene surface de analytics").

## Mapeo a las skills instaladas (`.claude/skills/`, scoped a este proyecto)

- `analytics-and-reporting` — framework METER, qué métricas de señal capturar por objetivo (no vanity). Es la fuente de verdad de qué debería computar `analytics-ingestor`.
- `content-audit` — framework AUDIT, triage keep/kill/refresh de contenido existente. Podría alimentar una revisión periódica, no solo tiempo real.
- `experimentation-and-ab-testing` — framework TEST, para cuando se quiera A/B testear hooks/formatos usando los datos que capture el ingestor.
- `content-recycling` — cierra el loop real: identifica ganadores por analytics nativos, refresca el insight (no repost idéntico), vuelve a entrar al pipeline.
- `cross-platform-repurposing` — distinto (mismo momento, muchas plataformas) pero relacionado, mismo dato de análisis de qué funcionó.
- `competitor-analysis` — solo datos públicos, no toca el ingestor de analytics propio.

## Preguntas abiertas pra la próxima sesión (no resueltas todavía)

1. **Fuente de datos**: ¿leer analytics nativos vía API de cada red (Instagram Graph API, LinkedIn API, etc.) directo desde `analytics-ingestor`, o pasar por Taisly/publish-queue si expone algo? (Confirmado en esta sesión: Taisly NO tiene analytics surface propio — mismo patrón que WoopSocial en las skills — así que tiene que ser lectura nativa por plataforma.)
2. **Métricas de señal exactas**: definir qué campos agregar a `ContentArtifact.analytics` (o un contrato nuevo `AnalyticsSnapshot`) — saves, shares, watch_time/retention, engagement_rate_by_reach, follower_growth_rate, CTR — siguiendo el framework METER.
3. **Cómo cierra el loop hacia semantic-graph**: ¿el ingestor escribe directo a `key_insights` de futuros `cluster_report`? ¿O alimenta un nuevo campo `historical_performance` que `platform-router` usa para priorizar? Necesita diseño — no asumir, brainstormear con el usuario cuando se retome.
4. **Cadencia**: ¿polling periódico (cron) o webhooks nativos donde existan? BullMQ ya es el patrón establecido en el resto del pipeline (`platform-router`, `canva-connector`, `brand-os-generation` todos usan Worker/Queue) — probablemente un `Worker` con repeat-job de BullMQ en vez de webhooks, dado que no todas las plataformas ofrecen webhooks de analytics.
5. **content-recycling wiring**: una vez el ingestor identifica ganadores, ¿quién decide recycle? ¿Otro worker automático, o pasa por el mismo Telegram HITL que ya existe pra review?

## Fuera de alcance de este documento

Este .md es un punto de partida pra la próxima sesión de brainstorming
(`superpowers:brainstorming`), no un plan de implementación — no se hizo
el proceso completo de preguntas/approaches/spec/plan que sí se hizo pra
FOUNDATION y CREATE. Retomar desde acá cuando se priorice este trabajo.
