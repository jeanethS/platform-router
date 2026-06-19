import { registerMetrics, routerProcessedTotal, routerErrorsTotal, routerLatencyHistogram, routerPriorityHistogram } from "../src/metrics";

describe("Metrics", () => {
  it("registerMetrics() returns a Registry with all metrics", () => {
    const registry = registerMetrics();
    expect(registry).toBeDefined();
    const names = registry.getMetricsAsArray().map((m) => m.name);
    expect(names).toContain("router_processed_total");
    expect(names).toContain("router_errors_total");
    expect(names).toContain("router_latency_seconds");
    expect(names).toContain("router_priority_histogram");
  });

  it("routerProcessedTotal increments", () => {
    routerProcessedTotal.reset();
    routerProcessedTotal.inc({ platform: "instagram" });
    // No throw = pass
  });

  it("routerErrorsTotal increments", () => {
    routerErrorsTotal.reset();
    routerErrorsTotal.inc({ type: "validation" });
  });

  it("routerLatencyHistogram observes", () => {
    const end = routerLatencyHistogram.startTimer();
    end({ stage: "routing" });
  });

  it("routerPriorityHistogram observes", () => {
    routerPriorityHistogram.observe(5);
  });
});
