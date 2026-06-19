/**
 * k6 load test for platform-router.
 *
 * Tests the HTTP health endpoint and (optionally) pushes messages via Kafka.
 *
 * Run: k6 run tests/load/k6-http.js
 */

import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 100 },   // Ramp up
    { duration: "1m", target: 1000 },   // Stay at 1000 RPS
    { duration: "30s", target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<10"],     // 95th percentile < 10ms
    http_req_failed: ["rate<0.05"],      // < 5% errors
  },
};

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:8080";

export default function () {
  const res = http.get(`${BASE_URL}/healthz`);
  check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 10ms": (r) => r.timings.duration < 10,
  });
  sleep(0.001); // ~1000 RPS per VU
}
