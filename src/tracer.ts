import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { trace, Span, SpanStatusCode, Tracer } from "@opentelemetry/api";

let sdk: NodeSDK | null = null;

export function initTracer(): void {
  const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: "platform-router",
    }) as any,
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
}

export function getTracer(): Tracer {
  return trace.getTracer("platform-router");
}

export function startSpan(name: string): Span {
  const tracer = getTracer();
  return tracer.startSpan(name);
}

export function endSpan(span: Span, error?: Error): void {
  if (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
  }
  span.end();
}

export async function shutdownTracer(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}
