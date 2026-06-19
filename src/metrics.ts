import * as client from "prom-client";

export const routerProcessedTotal = new client.Counter({
  name: "router_processed_total",
  help: "Number of routed_job events emitted",
  labelNames: ["platform"],
});

export const routerErrorsTotal = new client.Counter({
  name: "router_errors_total",
  help: "Count of processing errors",
  labelNames: ["type"],
});

export const routerLatencyHistogram = new client.Histogram({
  name: "router_latency_seconds",
  help: "Time spent in routing function",
  labelNames: ["stage"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
});

export const routerPriorityHistogram = new client.Histogram({
  name: "router_priority_histogram",
  help: "Distribution of computed priority values",
  buckets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
});

export function registerMetrics(): client.Registry {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: "platform-router" });
  client.collectDefaultMetrics({ register: registry });
  registry.registerMetric(routerProcessedTotal);
  registry.registerMetric(routerErrorsTotal);
  registry.registerMetric(routerLatencyHistogram);
  registry.registerMetric(routerPriorityHistogram);
  return registry;
}
