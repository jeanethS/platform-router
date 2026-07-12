import { ConfigService } from './config';
import type { ClusterEngagement } from '@brand-os/contracts';

/** Neutral midpoint used when a report carries no engagement data. */
const NEUTRAL_PRIORITY = 5;

export class PriorityScorer {
  score(engagement: ClusterEngagement | undefined): number {
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

    return Math.min(10, Math.max(1, Math.round((raw / max_score) * 10)));
  }
}
