// Mock the entire tracer module to avoid deep @opentelemetry dependency chain in tests
jest.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("@opentelemetry/auto-instrumentations-node", () => ({
  getNodeAutoInstrumentations: jest.fn().mockReturnValue([]),
}));

jest.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: jest.fn().mockReturnValue({}),
}));

jest.mock("@opentelemetry/semantic-conventions", () => ({
  SEMRESATTRS_SERVICE_NAME: "service.name",
}));

jest.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: jest.fn().mockReturnValue({
      startSpan: jest.fn().mockReturnValue({
        setStatus: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn(),
      }),
    }),
  },
  SpanStatusCode: { ERROR: 2 },
}));

import { initTracer, getTracer, startSpan, endSpan, shutdownTracer } from "../src/tracer";

describe("Tracer", () => {
  it("initTracer creates NodeSDK and starts it", () => {
    initTracer();
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    expect(NodeSDK).toHaveBeenCalled();
  });

  it("getTracer returns a tracer", () => {
    const tracer = getTracer();
    expect(tracer).toBeDefined();
  });

  it("startSpan returns a span", () => {
    const span = startSpan("test-span");
    expect(span).toBeDefined();
  });

  it("endSpan ends a span without error", () => {
    const span = startSpan("test-span");
    endSpan(span);
    expect(span.end).toHaveBeenCalled();
  });

  it("endSpan sets error status when error provided", () => {
    const span = startSpan("test-span");
    endSpan(span, new Error("test error"));
    expect(span.setStatus).toHaveBeenCalled();
    expect(span.recordException).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalled();
  });

  it("shutdownTracer shuts down SDK", async () => {
    initTracer();
    await shutdownTracer();
  });
});
