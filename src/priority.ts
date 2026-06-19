import { ConfigService } from './config';

export interface EngagementMetrics {
  likes: number;
  shares: number;
  comments: number;
  views: number;
  watch_time_seconds?: number;
}

export class PriorityScorer {
  score(metrics: EngagementMetrics): number {
    const config = ConfigService.instance!.getPriorityConfig() as {
      weights: Record<string, number>;
      max_score: number;
    };
    const { weights, max_score } = config;

    if (max_score === 0) {
      return 1;
    }

    const raw =
      (metrics.likes ?? 0) * (weights['likes'] ?? 0) +
      (metrics.shares ?? 0) * (weights['shares'] ?? 0) +
      (metrics.comments ?? 0) * (weights['comments'] ?? 0) +
      (metrics.views ?? 0) * (weights['views'] ?? 0) +
      ((metrics.watch_time_seconds ?? 0) * (weights['watch_time_seconds'] ?? 0));

    const scaled = Math.min(10, Math.max(1, Math.round((raw / max_score) * 10)));

    return scaled;
  }
}
