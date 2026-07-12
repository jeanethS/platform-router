import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { ClusterReportSchema, TOPICS } from '@brand-os/contracts';
import { Router } from './router';
import {
  routerErrorsTotal,
  routerLatencyHistogram,
  routerPriorityHistogram,
  routerProcessedTotal,
} from './metrics';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const OUT_ATTEMPTS = 3;
const OUT_BACKOFF_MS = 500;

export class BusConnector {
  private connection: IORedis;
  private outQueue: Queue;
  private worker: Worker | null = null;
  private router = new Router();

  constructor(redisUrl: string = process.env.REDIS_URL ?? DEFAULT_REDIS_URL) {
    // BullMQ requires maxRetriesPerRequest: null on shared connections
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    // bullmq bundles its own ioredis; cast shared connection for type compat
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = this.connection as any;
    this.outQueue = new Queue(TOPICS.JOBS_ROUTED, { connection: conn });
  }

  start(): void {
    this.worker = new Worker(
      TOPICS.CLUSTERS_REPORTS,
      (job: Job) => this.process(job),
      { connection: this.connection as any },
    );
    this.worker.on('failed', (job, err) => {
      console.error(`[bus] job failed id=${job?.id ?? 'unknown'} error=${err.message}`);
    });
    console.log(`[bus] worker started queue=${TOPICS.CLUSTERS_REPORTS}`);
  }

  async process(job: Job): Promise<number> {
    const endTimer = routerLatencyHistogram.startTimer({ stage: 'route' });
    try {
      const parsed = ClusterReportSchema.safeParse(job.data);
      if (!parsed.success) {
        routerErrorsTotal.inc({ type: 'validation' });
        // retrying cannot fix bad data — fail permanently
        throw new UnrecoverableError(
          `invalid cluster_report: ${parsed.error.message}`,
        );
      }

      const routedJobs = await this.router.route(parsed.data);
      for (const routed of routedJobs) {
        await this.outQueue.add('routed_job', routed, {
          attempts: OUT_ATTEMPTS,
          backoff: { type: 'exponential', delay: OUT_BACKOFF_MS },
        });
        routerProcessedTotal.inc({ platform: routed.target_platform });
        routerPriorityHistogram.observe(routed.priority);
      }
      return routedJobs.length;
    } finally {
      endTimer();
    }
  }

  async shutdown(): Promise<void> {
    if (this.worker !== null) {
      await this.worker.close();
    }
    await this.outQueue.close();
    this.connection.disconnect();
  }
}
