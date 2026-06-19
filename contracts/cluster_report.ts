export interface EngagementMetrics {
  likes: number;
  shares: number;
  comments: number;
  views: number;
  watch_time_seconds?: number;
}

export interface ClusterReport {
  id: string;
  category_tags: string[];
  content: string;
  engagement_metrics: EngagementMetrics;
  created_at: string;
}
