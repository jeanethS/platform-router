# Integración Canva MCP como path opcional de carousels

Fecha: 2026-08-20

## Contexto

Pipeline actual:

```
raw_signal → semantic-graph → cluster_report → platform-router
  → {Carousel Studio | shortform-engine | youtubeGen}
  → content_artifact → Telegram review → publish → analytics
```

Se agrega Canva MCP como ruta alternativa para generar carousels, sin
reemplazar Carousel Studio. La ruta se selecciona según el tipo de
contenido/template que indica `cluster_report`.

## Objetivo

Permitir que ciertos carousels se generen usando templates de marca en
Canva (via Canva Connect API a través de un servidor MCP), en vez del
render custom de Carousel Studio, manteniendo el resto del pipeline
(review en Telegram, publish, analytics) funcionando igual para ambos
paths.

## Arquitectura

```
cluster_report (campo nuevo: template_engine: "canva" | "custom")
      ↓
platform-router
      ↓ (si template_engine == "canva")
Canva Connector (nuevo servicio, wraps Canva MCP)
      ↓
content_artifact { type: "canva_design", edit_url, design_id }
      ↓
Telegram review (reviewer abre edit_url, edita directo en Canva)
      ↓ /approve (con confirmación explícita "¿ya terminaste de editar?")
Canva Connector.export_design(design_id) → imágenes finales
      ↓
publish → analytics
```

La ruta actual (Carousel Studio → `content_artifact { type:
"rendered_media" }`) no cambia.

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

### 4. Telegram review bot

Ramifica según `content_artifact.type`:

- `"rendered_media"`: comportamiento actual (preview de imagen, aprobar/rechazar).
- `"canva_design"`: manda `edit_url` (Canva no expone webhook fiable de "diseño listo", así que no hay preview automático). Comando `/approve` pregunta confirmación explícita ("¿ya terminaste de editar en Canva? sí/no") antes de llamar `export_design`. Solo tras el export exitoso el artifact pasa a publish.

### 5. Setup externo (no es código de pipeline)

- Registrar app en Canva Connect API, credenciales OAuth.
- Definir al menos un Brand Template en Canva con placeholders mapeables a los campos de `cluster_report` (texto, imágenes).
- Instalar/configurar servidor Canva MCP.
- Guardar tokens de refresh de forma segura (secrets manager, no en repo).

## Manejo de errores

- `create_from_template` falla (template inválido, auth expirado): platform-router cae back a error visible en Telegram review (no fallback silencioso a Carousel Studio — el contenido no es intercambiable 1:1).
- `export_design` falla tras `/approve`: bot notifica error al reviewer, artifact queda en estado `pending_export`, reviewer puede reintentar `/approve`.
- Reviewer aprueba sin terminar de editar: mitigado solo con la confirmación explícita en `/approve` (sin lock de estado real, Canva MCP no lo expone).

## Riesgos / límites conocidos

- No hay verificación automática de que el diseño en Canva esté "terminado" — depende de la confirmación humana en `/approve`.
- Tokens OAuth de Canva Connect requieren refresh; si expiran, `create_from_template` falla y bloquea esa ruta hasta reautenticar.
- Un template Canva por ahora; multi-template/multi-brand queda fuera de este spec (ampliar `brand_template_id` mapping después si hace falta).

## Fuera de alcance

- Reemplazo de Carousel Studio.
- Polling automático de estado del diseño en Canva.
- Multi-brand template mapping (un template inicial es suficiente para validar el flujo).
