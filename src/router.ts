import type {
  ClusterReport,
  RoutedJob,
  TargetPlatform,
  ContentFormat,
} from '@brand-os/contracts';
import { ConfigService } from './config';
import { PriorityScorer } from './priority';

const PLATFORMS: TargetPlatform[] = [
  'instagram',
  'linkedin',
  'youtube',
  'x',
  'tiktok',
  'douyin',
  'rednote',
];

export class Router {
  private cfg = ConfigService.instance!;
  private scorer = new PriorityScorer();

  async route(report: ClusterReport): Promise<RoutedJob[]> {
    const rule = this.cfg.getRoutingRules()[report.category];
    if (!rule) {
      console.warn(
        `[Router] No routing rule for category=${report.category} report=${report.id}`,
      );
      return [];
    }

    const allowed = PLATFORMS.filter(
      (p) => rule[p] === true && report.platform_flags[p] === true,
    );
    if (allowed.length === 0) {
      console.warn(
        `[Router] No routing target for report ${report.id} category=${report.category}`,
      );
      return [];
    }

    const priority = this.scorer.score(report.engagement);
    const formats = this.cfg.getFormatRules();
    const defaults = formats['default'] ?? {};
    const overrides = formats[report.category] ?? {};

    return allowed.map((platform) => ({
      id: `${report.id}:${platform}`,
      cluster_report: report,
      target_platform: platform,
      content_format: (overrides[platform] ?? defaults[platform]) as ContentFormat,
      priority,
      ab_variant: null,
      created_at: new Date().toISOString(),
    }));
  }
}
