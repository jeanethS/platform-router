import { Kafka, Consumer, Producer, EachMessagePayload } from "kafkajs";
import { ClusterReport } from "../contracts/cluster_report";
import { Router } from "./router";
import { routerProcessedTotal, routerErrorsTotal, routerLatencyHistogram } from "./metrics";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 100;
const DLQ_TOPIC = "platform-router.dlq";

export class KafkaConnector {
  private kafka: Kafka;
  private consumer: Consumer;
  private producer: Producer;
  private router: Router;
  private _ready = false;

  constructor(brokers: string[], clientId: string) {
    this.kafka = new Kafka({ brokers, clientId });
    this.consumer = this.kafka.consumer({ groupId: "platform-router" });
    this.producer = this.kafka.producer();
    this.router = new Router();
  }

  get ready(): boolean {
    return this._ready;
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.producer.connect();
    await this.consumer.subscribe({ topic: "analysis.cluster_reports", fromBeginning: false });
    this._ready = true;
  }

  async run(): Promise<void> {
    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        const end = routerLatencyHistogram.startTimer();
        try {
          const report = this.parseMessage(payload);
          const jobs = await this.router.route(report);
          for (const job of jobs) {
            await this.publishWithRetry(job);
            routerProcessedTotal.inc({ platform: job.target_platform });
          }
          end({ stage: "routing" });
        } catch (err) {
          routerErrorsTotal.inc({ type: "routing" });
          console.error(`[KafkaConnector] Error processing message: ${err}`);
          await this.sendToDlq(payload, err as Error);
        }
      },
    });
  }

  private async publishWithRetry(job: unknown): Promise<void> {
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.producer.send({
          topic: "platform-router.routed_jobs",
          messages: [{ key: (job as { id: string }).id, value: JSON.stringify(job) }],
        });
        return;
      } catch (err) {
        lastErr = err as Error;
        routerErrorsTotal.inc({ type: "kafka" });
        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_BASE_MS * Math.pow(2, attempt - 1));
        }
      }
    }
    throw lastErr;
  }

  private async sendToDlq(payload: EachMessagePayload, err: Error): Promise<void> {
    try {
      await this.producer.send({
        topic: DLQ_TOPIC,
        messages: [
          {
            key: payload.message.key,
            value: payload.message.value,
            headers: {
              "dlq-error": err.message,
              "dlq-timestamp": new Date().toISOString(),
              "dlq-source-topic": payload.topic,
            },
          },
        ],
      });
    } catch (dlqErr) {
      console.error(`[KafkaConnector] Failed to send to DLQ: ${dlqErr}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseMessage(payload: EachMessagePayload): ClusterReport {
    if (!payload.message.value) {
      routerErrorsTotal.inc({ type: "validation" });
      throw new Error("Empty message value");
    }
    try {
      return JSON.parse(payload.message.value.toString("utf-8")) as ClusterReport;
    } catch {
      routerErrorsTotal.inc({ type: "validation" });
      throw new Error("Invalid JSON in message");
    }
  }

  async shutdown(): Promise<void> {
    await this.consumer.disconnect();
    await this.producer.disconnect();
    this._ready = false;
  }
}
