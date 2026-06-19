import Fastify from "fastify";
import { registerMetrics } from "./metrics";
import { ConfigService } from "./config";

export async function createServer() {
  const app = Fastify();
  const metricsRegistry = registerMetrics();

  app.get("/healthz", async (_req, reply) => {
    reply.code(200).send({ status: "ok" });
  });

  app.get("/metrics", async (_req, reply) => {
    const metrics = await metricsRegistry.metrics();
    reply.header("Content-Type", metricsRegistry.contentType).send(metrics);
  });

  app.get("/config", async (_req, reply) => {
    const cfg = ConfigService.instance!;
    reply.send({
      routing: cfg.getRoutingRules(),
      formats: cfg.getFormatRules(),
      priority: cfg.getPriorityConfig(),
    });
  });

  return app;
}
