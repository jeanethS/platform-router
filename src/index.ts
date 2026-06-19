import { KafkaConnector } from "./kafka";
import { createServer } from "./server";
import { ConfigService } from "./config";
import { initTracer, shutdownTracer } from "./tracer";

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID ?? "platform-router";
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9090);

async function main(): Promise<void> {
  // Load config (watches for hot-reload)
  new ConfigService();

  // Init OpenTelemetry tracing
  initTracer();

  // Start Kafka connector
  const connector = new KafkaConnector(KAFKA_BROKERS, KAFKA_CLIENT_ID);
  await connector.start();
  console.log("[main] Kafka connector started");

  // Start HTTP server
  const app = await createServer();
  await app.listen({ port: HTTP_PORT, host: "0.0.0.0" });
  console.log(`[main] HTTP server listening on :${HTTP_PORT}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[main] Received ${signal}, shutting down...`);
    await connector.shutdown();
    await app.close();
    await shutdownTracer();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Start consuming
  await connector.run();
}

main().catch((err) => {
  console.error("[main] Fatal error:", err);
  process.exit(1);
});
