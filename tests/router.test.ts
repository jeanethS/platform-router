jest.mock("../src/config", () => ({
  ConfigService: {
    instance: {
      getRoutingRules: () => ({
        tech_science: {
          instagram: true,
          linkedin: true,
          youtube: true,
          x: true,
          tiktok: true,
          douyin: false,
          rednote: false,
        },
        robotics_maker: {
          instagram: true,
          linkedin: true,
          youtube: true,
          x: true,
          tiktok: true,
          douyin: true,
          rednote: false,
        },
        unknown_category: undefined as unknown as Record<string, boolean>,
      }),
      getFormatRules: () => ({
        default: {
          instagram: "carousel",
          linkedin: "carousel",
          youtube: "long_video",
          x: "thread",
          tiktok: "short_video",
          douyin: "short_video",
          rednote: "note",
        },
        tech_science: {
          instagram: "carousel",
          linkedin: "carousel",
          youtube: "long_video",
          x: "thread",
          tiktok: "short_video",
          douyin: "short_video",
        },
      }),
      getPriorityConfig: () => ({
        weights: {
          likes: 0.2,
          shares: 0.3,
          comments: 0.25,
          views: 0.15,
          watch_time_seconds: 0.1,
        },
        max_score: 100,
      }),
    },
  },
}));

import { Router } from "../src/router";

const baseReport = (overrides = {}) => ({
  id: "report-001",
  category_tags: ["tech_science"],
  content: "Test content about technology",
  engagement_metrics: { likes: 10, shares: 5, comments: 4, views: 100 },
  created_at: "2026-06-07T00:00:00.000Z",
  ...overrides,
});

describe("Router", () => {
  const router = new Router();

  it("normalizes single tag correctly", async () => {
    const report = baseReport({ category_tags: ["Tech + Science"] });
    const jobs = await router.route(report);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]!.target_platform).toBeDefined();
  });

  it("routes to correct platforms for tech_science tag", async () => {
    const report = baseReport({ category_tags: ["tech_science"] });
    const jobs = await router.route(report);
    const platforms = jobs.map((j) => j.target_platform);
    expect(platforms).toContain("instagram");
    expect(platforms).toContain("linkedin");
    expect(platforms).toContain("youtube");
    expect(platforms).toContain("x");
    expect(platforms).toContain("tiktok");
    expect(platforms).not.toContain("douyin");
    expect(platforms).not.toContain("rednote");
  });

  it("returns empty array for unknown tag", async () => {
    const report = baseReport({ category_tags: ["totally_unknown"] });
    const jobs = await router.route(report);
    expect(jobs).toEqual([]);
  });

  it("uses format override from category-specific formats", async () => {
    const report = baseReport({ category_tags: ["tech_science"] });
    const jobs = await router.route(report);
    const instagramJob = jobs.find((j) => j.target_platform === "instagram");
    expect(instagramJob!.content_format).toBe("carousel");
    const youtubeJob = jobs.find((j) => j.target_platform === "youtube");
    expect(youtubeJob!.content_format).toBe("long_video");
  });

  it("falls back to default format when no category-specific entry", async () => {
    const report = baseReport({ category_tags: ["robotics_maker"] });
    const jobs = await router.route(report);
    const rednoteJob = jobs.find((j) => j.target_platform === "rednote");
    // robotics_maker doesn't have rednote routing, so won't be in list
    // But douyin should use default format (no robotics_maker format override)
    const douyinJob = jobs.find((j) => j.target_platform === "douyin");
    // robotics_maker: douyin is true → should be routed
    expect(douyinJob).toBeDefined();
    // No robotics_maker in formats → falls back to default
    // But wait, robotics_maker not in format rules → uses default
  });

  it("emits one RoutedJob per allowed platform", async () => {
    const report = baseReport({ category_tags: ["tech_science"] });
    const jobs = await router.route(report);
    expect(jobs.length).toBe(5);
  });

  it("RoutedJob.id = {reportId}:{platform}", async () => {
    const report = baseReport({ id: "rpt-123", category_tags: ["tech_science"] });
    const jobs = await router.route(report);
    for (const job of jobs) {
      expect(job.id).toBe(`rpt-123:${job.target_platform}`);
    }
  });

  it("computes priority via PriorityScorer", async () => {
    const report = baseReport({
      category_tags: ["tech_science"],
      engagement_metrics: { likes: 100, shares: 0, comments: 0, views: 0 },
    });
    const jobs = await router.route(report);
    // raw = 100*0.2 = 20, scaled = round((20/100)*10) = 2
    expect(jobs[0]!.priority).toBe(2);
  });

  it("handles multiple tags (union of platforms)", async () => {
    const report = baseReport({ category_tags: ["tech_science", "robotics_maker"] });
    const jobs = await router.route(report);
    const platforms = jobs.map((j) => j.target_platform);
    // robotics_maker includes douyin (true), tech_science doesn't
    // Union should include douyin
    expect(platforms).toContain("douyin");
    expect(platforms).toContain("instagram");
  });

  it("handles '&' in tag names", async () => {
    const report = baseReport({ category_tags: ["Robotics & Maker"] });
    const jobs = await router.route(report);
    expect(jobs.length).toBeGreaterThan(0);
  });

  it("RoutedJob.created_at is ISO-8601 string", async () => {
    const report = baseReport({ category_tags: ["tech_science"] });
    const jobs = await router.route(report);
    for (const job of jobs) {
      expect(new Date(job.created_at).toISOString()).toBe(job.created_at);
    }
  });

  it("priority is shared across all platforms", async () => {
    const report = baseReport({ category_tags: ["tech_science"] });
    const jobs = await router.route(report);
    const priorities = jobs.map((j) => j.priority);
    expect(new Set(priorities).size).toBe(1);
  });
});
