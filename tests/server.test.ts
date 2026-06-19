jest.mock("../src/config", () => ({
  ConfigService: {
    instance: {
      getRoutingRules: () => ({ tech_science: { instagram: true } }),
      getFormatRules: () => ({ default: { instagram: "carousel" } }),
      getPriorityConfig: () => ({ weights: { likes: 0.2 }, max_score: 100 }),
    },
  },
}));

import { createServer } from "../src/server";

describe("Server", () => {
  it("GET /healthz returns 200", async () => {
    const app = await createServer();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
    await app.close();
  });

  it("GET /metrics returns prometheus format", async () => {
    const app = await createServer();
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    await app.close();
  });

  it("GET /config returns routing and format rules", async () => {
    const app = await createServer();
    const res = await app.inject({ method: "GET", url: "/config" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("routing");
    expect(body).toHaveProperty("formats");
    expect(body).toHaveProperty("priority");
    await app.close();
  });
});
