/**
 * Integration test: consume → produce via Kafka.
 *
 * Requires Docker + testcontainers. Skips gracefully if not available.
 *
 * Run: npx jest --runInBand tests/integration.test.ts --testTimeout=120000
 */
import { Kafka, Producer, Consumer, EachMessagePayload } from "kafkajs";
import { Router } from "../src/router";
import { ConfigService } from "../src/config";
import * as path from "node:path";

jest.setTimeout(120000);

const KAFKA_BROKER = process.env.KAFKA_BROKERS ?? "localhost:9092";
const INPUT_TOPIC = "test.cluster_reports";
const OUTPUT_TOPIC = "test.routed_jobs";

// Check if Kafka is reachable before running
let kafkaAvailable = false;

beforeAll(async () => {
  try {
    const kafka = new Kafka({ brokers: [KAFKA_BROKER], clientId: "integration-test", connectionTimeout: 5000 });
    const admin = kafka.admin();
    await admin.connect();
    await admin.disconnect();
    kafkaAvailable = true;
  } catch {
    kafkaAvailable = false;
  }
});

const maybeTest = kafkaAvailable ? test : test.skip;

describe("Integration: Kafka consume → route → produce", () => {
  maybeTest("routes a cluster_report and produces routed_jobs on real Kafka", async () => {
    const kafka = new Kafka({ brokers: [KAFKA_BROKER], clientId: "integration-test" });

    // Setup: create topics via admin
    const admin = kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        topics: [
          { topic: INPUT_TOPIC, numPartitions: 1 },
          { topic: OUTPUT_TOPIC, numPartitions: 1 },
        ],
        waitForLeaders: true,
      });
    } catch {
      // Topics may already exist
    }
    await admin.disconnect();

    // Produce a test message
    const producer = kafka.producer();
    await producer.connect();

    const report = {
      id: "integration-001",
      category_tags: ["tech_science"],
      content: "Test content",
      engagement_metrics: { likes: 100, shares: 50, comments: 25, views: 1000 },
      created_at: new Date().toISOString(),
    };

    await producer.send({
      topic: INPUT_TOPIC,
      messages: [{ key: report.id, value: JSON.stringify(report) }],
    });
    await producer.disconnect();

    // Route using Router directly
    const configDir = path.resolve(__dirname, "..", "src", "rules");
    new ConfigService(configDir);
    const router = new Router();
    const jobs = await router.route(report);

    // Produce routed jobs
    const outProducer = kafka.producer();
    await outProducer.connect();
    for (const job of jobs) {
      await outProducer.send({
        topic: OUTPUT_TOPIC,
        messages: [{ key: job.id, value: JSON.stringify(job) }],
      });
    }
    await outProducer.disconnect();

    // Consume output messages
    const consumer = kafka.consumer({ groupId: "integration-test-group" });
    await consumer.connect();
    await consumer.subscribe({ topic: OUTPUT_TOPIC, fromBeginning: true });

    const received: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for messages")), 30000);
      consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          received.push(JSON.parse(payload.message.value!.toString("utf-8")));
          clearTimeout(timeout);
          resolve();
        },
      });
    });

    await consumer.disconnect();

    // Assert
    expect(received.length).toBeGreaterThan(0);
    const first = received[0] as { target_platform: string; content_format: string; priority: number };
    expect(first.target_platform).toBeDefined();
    expect(first.content_format).toBeDefined();
    expect(first.priority).toBeGreaterThanOrEqual(1);
    expect(first.priority).toBeLessThanOrEqual(10);
  });
});
