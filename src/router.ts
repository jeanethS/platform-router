import { ClusterReport } from "../contracts/cluster_report";
import { RoutedJob, Platform, ContentFormat } from "../contracts/routed_job";
import { ConfigService } from "./config";
import { PriorityScorer } from "./priority";

const PLATFORMS: Platform[] = [
  "instagram",
  "linkedin",
  "youtube",
  "x",
  "tiktok",
  "douyin",
  "rednote",
  "whatsapp",
  "whatsapp_status",
];

export class Router {
  private cfg = ConfigService.instance!;
  private scorer = new PriorityScorer();

  async route(report: ClusterReport): Promise<RoutedJob[]> {
    const jobs: RoutedJob[] = [];

    const canonicalTags = report.category_tags.map((t) => this.normalizeTag(t));

    const allowedPlatforms = new Set<Platform>();
    const formatOverrides: Partial<Record<Platform, ContentFormat>> = {};

    for (const tag of canonicalTags) {
      const rule = this.cfg.getRoutingRules()[tag];
      if (!rule) continue;

      for (const platform of PLATFORMS) {
        if (rule[platform] === true) {
          allowedPlatforms.add(platform);
        }
      }

      const fmt = this.cfg.getFormatRules()[tag];
      if (fmt) {
        for (const platform of PLATFORMS) {
          const val = fmt[platform];
          if (val) {
            formatOverrides[platform] = val as ContentFormat;
          }
        }
      }
    }

    if (allowedPlatforms.size === 0) {
      console.warn(
        `[Router] No routing target for report ${report.id} tags=${report.category_tags}`,
      );
      return jobs;
    }

    const priority = this.scorer.score(report.engagement_metrics);
    const defaults = this.cfg.getFormatRules()["default"] ?? {};

    for (const platform of Array.from(allowedPlatforms)) {
      const format: ContentFormat =
        formatOverrides[platform] ?? (defaults[platform] as ContentFormat);

      const job: RoutedJob = {
        id: `${report.id}:${platform}`,
        cluster_report: report,
        target_platform: platform,
        content_format: format,
        priority,
        created_at: new Date().toISOString(),
      };
      jobs.push(job);
    }

    return jobs;
  }

  private normalizeTag(tag: string): string {
    return tag
      .trim()
      .toLowerCase()
      .replace(/[ +&]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
  }
}
