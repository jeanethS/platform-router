# GCP Architecture & Implementation Specs — platform-router

> ⚠️ **DESACTUALIZADO (2026-07-12): este documento describe la arquitectura Kafka ANTERIOR a la migración a BullMQ.** El servicio ya NO usa Kafka/kafkajs — consume `clusters.reports` y produce `jobs.routed` vía BullMQ sobre Redis (`REDIS_URL`, default `redis://localhost:6379`). `src/kafka.ts` ya no existe (ver `src/bus.ts` y `AGENTS.md`). Las secciones de aprovisionamiento que digan "No provisionar Redis" o referencien `KAFKA_BROKERS` son la INVERSA de la realidad actual — Redis ahora es requerido. Pendiente de re-auditoría con la arquitectura BullMQ.

> Auditado contra `src/index.ts`, `src/kafka.ts`, reglas YAML, Dockerfile y Helm el 2026-07-12. Proyecto `positronica-labs`; región `us-central1`.

## 1. Resumen de uso de créditos

| Bolsa | Uso de este repo | Prioridad |
|---|---|---|
| Free credit, $3,205 MXN, vence 2026-07-15 | Cloud Run worker y, solo con aprobación explícita, Kafka temporal | No provisionar Redis: este repo usa KafkaJS, no Redis |
| GenAI, $18,039 MXN, vence 2027 | Ninguno directo; routing determinista | N/A |

El proceso consume `analysis.cluster_reports`, produce `platform-router.routed_jobs` y DLQ `platform-router.dlq`. Requiere Kafka continuo y CPU fuera de requests. La spec anterior basada en Memorystore era incompatible con el código real.

## 2. Arquitectura recomendada

```text
semantic graph --analysis.cluster_reports--> Kafka
Kafka --private VPC--> platform-router Cloud Run (instance-based, min 1)
platform-router --routed_jobs / dlq--------> Kafka
rules YAML --------------------------------> imagen inmutable
/healthz, /metrics, /config ---------------> puerto HTTP 8080
OTLP traces -------------------------------> collector/Cloud Trace
```

Managed Service for Apache Kafka exige recursos en tres zonas y su ejemplo oficial de 18 DCU cuesta USD 1.62/h on-demand: no es una dependencia pequeña. Antes de crearlo debe existir un owner, fecha de destrucción y presupuesto; para dev puede ser mejor un broker ya existente o una migración posterior a Pub/Sub.

## 3. Servicios a provisionar YA

1. Reutilizar Artifact Registry y VPC/subnet globales.
2. Confirmar primero un endpoint Kafka compatible. Sin broker, no desplegar Cloud Run: `connector.start()` falla antes de abrir HTTP.
3. Si se aprueba un cluster Kafka temporal para gastar crédito útil, limitarlo a 72 h, crear topics explícitos, alertas y teardown automático el 2026-07-15. No asumir que el crédito cubre gasto posterior.
4. Desplegar `platform-router` con instance-based billing, `min=1`, `max=1`, Direct VPC egress y sin acceso público.
5. No crear Memorystore para este repo.

## 4. Specs de implementación

### Terraform / IaC objetivo

```hcl
resource "google_cloud_run_v2_service" "router" {
  name = "platform-router"; location = "us-central1"
  template {
    service_account = google_service_account.router.email
    containers {
      image = "us-central1-docker.pkg.dev/positronica-labs/brand-os/platform-router:${var.image_tag}"
      env { name = "KAFKA_BROKERS"; value = var.kafka_bootstrap_servers }
      env { name = "KAFKA_CLIENT_ID"; value = "platform-router" }
      env { name = "HTTP_PORT"; value = "8080" }
      env { name = "OTEL_EXPORTER_OTLP_ENDPOINT"; value = var.otel_endpoint }
      resources { limits = { cpu = "1", memory = "512Mi" }; cpu_idle = false }
    }
    vpc_access { network_interfaces { network = google_compute_network.brand_os.name; subnetwork = google_compute_subnetwork.serverless.name } egress = "PRIVATE_RANGES_ONLY" }
    scaling { min_instance_count = 1; max_instance_count = 1 }
  }
}
```

### Build/deploy

```bash
docker build -t us-central1-docker.pkg.dev/positronica-labs/brand-os/platform-router:$IMAGE_TAG .
docker push us-central1-docker.pkg.dev/positronica-labs/brand-os/platform-router:$IMAGE_TAG
gcloud run deploy platform-router --image=us-central1-docker.pkg.dev/positronica-labs/brand-os/platform-router:$IMAGE_TAG --region=us-central1 --no-allow-unauthenticated --network=brand-os --subnet=serverless-us-central1 --vpc-egress=private-ranges-only --min=1 --max=1 --no-cpu-throttling --set-env-vars=KAFKA_BROKERS=$KAFKA_BROKERS,KAFKA_CLIENT_ID=platform-router,HTTP_PORT=8080
```

Antes: crear `analysis.cluster_reports`, `platform-router.routed_jobs`, `platform-router.dlq`; verificar conectividad privada y políticas de retención. El cliente actual no configura TLS/SASL aunque AGENTS lo promete: si el broker los exige, implementar y probar variables/Secret Manager antes del deploy.

## 5. Burn rate mensual estimado

- Router min 1, 1 vCPU/512 MiB: decenas de USD/mes.
- Kafka administrado domina el costo: el ejemplo oficial de 18 DCU es USD 1.62/h (~USD 1,183/mes) antes de storage/network; dimensionar en Pricing Calculator.
- Sin GenAI.

## 6. Plan de delegación de bajo costo

1. Codex/GLM: contract test TLS/SASL + env validation.
2. Command Code: topics, Terraform y canary.
3. Revisión final: retención, DLQ, IAM, teardown y costo real del SKU.

## 7. Criterios de Done

- [ ] Broker aprobado, topics/retención creados y conexión TLS/SASL probada.
- [ ] `/healthz` verde después de conectar Kafka; servicio privado.
- [ ] Fixture entra por `analysis.cluster_reports` y sale por `routed_jobs`.
- [ ] Mensaje inválido llega a `platform-router.dlq`.
- [ ] Worker sigue consumiendo sin tráfico HTTP.
- [ ] Alertas, owner y teardown definidos.

## 8. Riesgos y mitigaciones

- Kafka administrado excede ampliamente el crédito si queda activo → teardown automático y aprobación humana.
- Cloud Run request-based pausa al consumer → instance-based + min 1.
- Código sin TLS/SASL → no exponer Kafka; implementar autenticación primero.
- `/healthz` no comprueba `connector.ready` → smoke externo que produzca/consuma; mejorar readiness en cambio separado con TDD.
- `METRICS_PORT` se lee pero `/metrics` sirve en el mismo Fastify/HTTP port → configurar scraping a 8080, no 9090.

Referencias: [Managed Kafka overview](https://cloud.google.com/managed-service-for-apache-kafka/docs/overview), [Cloud Run instance-based billing](https://cloud.google.com/run/docs/configuring/billing-settings).
