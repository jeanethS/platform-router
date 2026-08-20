# Integración Canva MCP como path opcional de carousels

Fecha: 2026-08-20

## Contexto

Diagrama canónico del pipeline (estado real de implementación, con
status por componente):

```
live=implementado · partial=parcial · planned=por hacer · human=sesión interactiva humana

SH[Signal Harvester → raw_signal]:live
      ↓ Redis stream
SG[Semantic Graph → cluster_report]:partial
      ↓
PR[Platform Router → routed_job]:partial
      ↓
 ┌──────────────┼──────────────┬───────────────────┐
 ↓              ↓              ↓                    ↓
CS[Carousel   SF[Shortform   YG[YouTubeGen    CV[Canva MCP
   Studio]      Engine        long-form]:      interactive
   :partial     Veo/HyperF]:  partial          human session]:
                partial                          human
 └──────────────┴──────────────┴───────────────────┘
                            ↓
                  CA[content_artifact]:planned
                            ↓
                  PQ[Publish Queue]:live
                            ↓
        TG[Telegram HITL — review → approve → schedule]:live
                            ↓
              TAI[Taisly — validate → publish]:partial
                            ↓
   NET[Instagram · LinkedIn · YouTube · X · TikTok ·
        Douyin · RedNote]:partial
                            ↓
        AN[Analytics → Platform Router]:planned  (loop back a PR)

Adicional (fuera de alcance de este spec, solo contexto):
- SH -. selección editorial temporal .-> TG
- TG -. segunda aprobación .-> GQ[brand-os:generation]:live
- GQ -. workers por conectar .-> CS, SF, YG
- K[Katsi/asset-bridge, material grabado]:planned -. assets+locators .-> SF, CS
```

Este diagrama reemplaza la versión mermaid pasada en el turno
anterior de este spec (que usaba nombres aspiracionales
`content-planner`/`Text Studio`/`review queue` de 3 tiers) — esos
nombres no reflejan el estado real; se descartan a favor de los
nombres y estados de arriba.

Punto clave para este spec: `CV` (Canva MCP) está marcado `human` —
la sesión interactiva del humano ocurre **dentro** del paso CV, antes
de que exista `content_artifact`. El `Telegram HITL` de más abajo en
el diagrama es un segundo gate genérico (review → approve → schedule)
que aplica a **cualquier** `content_artifact` ya terminado, sin
importar el path que lo generó — no hay que confundirlo con el canal
usado para la sesión interactiva de Canva (ver Componente 4).

Se agrega Canva MCP como ruta alternativa dentro del branch de
Carousel Studio, sin reemplazarlo. La ruta se selecciona según el tipo
de contenido/template que indica `cluster_report` (output de
Semantic Graph, consumido como `routed_job` por Platform Router).

## Objetivo

Permitir que ciertos carousels se generen usando templates de marca en
Canva (via Canva Connect API a través de un servidor MCP), en vez del
render custom de Carousel Studio. Una vez que Canva produce un
`content_artifact`, el resto del pipeline (Publish Queue → Telegram
HITL → Taisly → redes → Analytics) funciona igual que para cualquier
otro path, sin cambios.

## Arquitectura

```
cluster_report (campo nuevo: template_engine: "canva" | "custom")
      ↓
platform-router (routed_job)
      ↓ (si template_engine == "canva")
Canva Connector (nuevo servicio, wraps Canva MCP)  ── nodo CV, status "human"
      ↓
[sesión interactiva] canal Telegram-Canva (reviewer abre edit_url, edita directo en Canva)
      ↓ /approve (confirmación explícita "¿ya terminaste de editar?")
Canva Connector.export_design(design_id) → imágenes finales
      ↓
content_artifact { type: "canva_design" }   ── nodo CA
      ↓
Publish Queue → Telegram HITL (review → approve → schedule) → Taisly (validate → publish) → redes → Analytics
```

Todo lo que sigue de `content_artifact` en adelante es el pipeline
genérico existente, sin cambios para este path. La ruta actual
(Carousel Studio → `content_artifact { type: "rendered_media" }`)
tampoco cambia.

## Componentes

### 1. Canva Connector

Servicio delgado que envuelve el servidor Canva MCP. Sin lógica de
negocio propia, solo traduce datos de `cluster_report` a los campos de
autofill del template Canva.

- `create_from_template(brand_template_id, autofill_data) → { design_id, edit_url }`
- `export_design(design_id) → [image_urls]`

### 2. `content_artifact` schema

Se agrega campo discriminante `type`:

- `"rendered_media"` — path actual de Carousel Studio/shortform-engine/youtubeGen. Sin cambios.
- `"canva_design"` — nuevo. Incluye `edit_url` y `design_id`, sin imagen renderizada todavía.

### 3. platform-router

Lee `cluster_report.template_engine`. Si es `"canva"`, rutea a Canva
Connector en vez de Carousel Studio. Default (`"custom"` o ausente) es
el comportamiento actual.

### 4. Canal Telegram-Canva (sesión interactiva, distinto del Telegram HITL genérico)

Este es el canal usado **dentro** del nodo CV para la edición humana,
anterior a que exista `content_artifact`. No es el mismo componente
que `Telegram HITL` del pipeline genérico (ese corre después, sobre
cualquier `content_artifact` ya terminado, y no cambia con este spec).

- Manda `edit_url` al reviewer (Canva no expone webhook fiable de "diseño listo", así que no hay preview automático).
- Comando `/approve` pregunta confirmación explícita ("¿ya terminaste de editar en Canva? sí/no") antes de llamar `export_design`.
- Solo tras el export exitoso se emite el `content_artifact` y entra a Publish Queue → Telegram HITL como cualquier otro artifact.

### 5. Setup externo (no es código de pipeline)

- Registrar app en Canva Connect API, credenciales OAuth.
- Definir al menos un Brand Template en Canva con placeholders mapeables a los campos de `cluster_report` (texto, imágenes).
- Instalar/configurar servidor Canva MCP.
- Guardar tokens de refresh de forma segura (secrets manager, no en repo).

## Manejo de errores

- `create_from_template` falla (template inválido, auth expirado): platform-router cae back a error visible en el canal Telegram-Canva (no fallback silencioso a Carousel Studio — el contenido no es intercambiable 1:1).
- `export_design` falla tras `/approve`: bot notifica error al reviewer, artifact queda en estado `pending_export`, reviewer puede reintentar `/approve`.
- Reviewer aprueba sin terminar de editar: mitigado solo con la confirmación explícita en `/approve` (sin lock de estado real, Canva MCP no lo expone).
- Taisly rechaza el `content_artifact` en `validate` (paso genérico, no específico de Canva): mismo comportamiento que para cualquier otro path, fuera de alcance de este spec.

## Riesgos / límites conocidos

- No hay verificación automática de que el diseño en Canva esté "terminado" — depende de la confirmación humana en `/approve`.
- Tokens OAuth de Canva Connect requieren refresh; si expiran, `create_from_template` falla y bloquea esa ruta hasta reautenticar.
- Un template Canva por ahora; multi-template/multi-brand queda fuera de este spec (ampliar `brand_template_id` mapping después si hace falta).

## Fuera de alcance

- Reemplazo de Carousel Studio.
- Polling automático de estado del diseño en Canva.
- Multi-brand template mapping (un template inicial es suficiente para validar el flujo).
- Segunda aprobación / loop `GQ (brand-os:generation)` y wiring de workers hacia CS/SF/YG.
- Integración `Katsi/asset-bridge` (assets grabados) hacia Carousel Studio o Shortform Engine.
- Cambios a Taisly, Publish Queue, Telegram HITL genérico o Analytics — se consumen tal cual existen.
