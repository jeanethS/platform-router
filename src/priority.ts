import type IORedis from 'ioredis';
import { ConfigService } from './config';
import type { ClusterEngagement } from '@brand-os/contracts';

/** Neutral midpoint used when a report carries no engagement data. */
const NEUTRAL_PRIORITY = 5;
/** Minimum samples before historical performance is trusted enough to blend in. */
const MIN_HISTORICAL_SAMPLE_SIZE = 3;
/** ponytail: magic ceiling on engagement-rate-by-reach used to scale it to 1-10; revisit once real category averages are observed. */
const MAX_HISTORICAL_ENGAGEMENT_RATE = 0.2;
const HISTORICAL_WEIGHT = 0.3;

export class PriorityScorer {
  constructor(private redis?: IORedis) {}

  async score(engagement: ClusterEngagement | undefined, category?: string): Promise<number> {
    if (engagement === undefined || engagement.signal_count === 0) {
      console.warn('[PriorityScorer] no engagement data; using neutral priority');
      return NEUTRAL_PRIORITY;
    }

    const config = ConfigService.instance!.getPriorityConfig() as {
      weights: Record<string, number>;
      max_score: number;
    };
    const { weights, max_score } = config;

    if (max_score === 0) {
      return 1;
    }

    const raw =
      engagement.likes * (weights['likes'] ?? 0) +
      engagement.shares * (weights['shares'] ?? 0) +
      engagement.comments * (weights['comments'] ?? 0) +
      engagement.views * (weights['views'] ?? 0);

    const baseScore = Math.min(10, Math.max(1, Math.round((raw / max_score) * 10)));

    const historical = await this.getHistoricalScore(category);
    if (historical === null) {
      return baseScore;
    }

    return Math.min(10, Math.max(1, Math.round(baseScore * (1 - HISTORICAL_WEIGHT) + historical * HISTORICAL_WEIGHT)));
  }

  private async getHistoricalScore(category: string | undefined): Promise<number | null> {
    if (category === undefined || this.redis === undefined) {
      return null;
    }

    const fields = await this.redis.hgetall(`historical_performance:${category}`);
    const sampleSize = fields.sample_size ? Number(fields.sample_size) : 0;
    if (sampleSize < MIN_HISTORICAL_SAMPLE_SIZE || !fields.avg) {
      return null;
    }

    const avg = Number(fields.avg);
    return Math.min(10, Math.max(1, Math.round((avg / MAX_HISTORICAL_ENGAGEMENT_RATE) * 10)));
  }
}
