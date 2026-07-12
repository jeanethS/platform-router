jest.mock('../src/config', () => ({
  ConfigService: {
    instance: {
      getRoutingRules: () => ({
        tech: { instagram: true, linkedin: true, youtube: true, x: true, tiktok: true, douyin: false, rednote: false },
        cn: { instagram: false, linkedin: false, youtube: true, x: false, tiktok: true, douyin: true, rednote: true },
      }),
      getFormatRules: () => ({
        default: { instagram: 'carousel', linkedin: 'carousel', youtube: 'long_video', x: 'thread', tiktok: 'short_video', douyin: 'short_video', rednote: 'note' },
        tech: { youtube: 'short_video' },
      }),
      getPriorityConfig: () => ({
        weights: { likes: 0.2, shares: 0.3, comments: 0.25, views: 0.15 },
        max_score: 100,
      }),
    },
  },
}));

import { Router } from '../src/router';
import type { ClusterReport } from '@brand-os/contracts';

function makeReport(overrides: Partial<ClusterReport>): ClusterReport {
  return {
    id: 'r1',
    cluster_label: 'test cluster',
    category: 'tech',
    signal_ids: ['s1', 's2', 's3'],
    key_insights: ['i1'],
    hooks: { pain_point: 'p', agitate: 'a', solution: 's', hot_take: 'h' },
    data_points: [],
    platform_flags: { instagram: true, linkedin: true, youtube: true, x: true, tiktok: true, douyin: true, rednote: true },
    speculative_edges: [],
    graph_svg_url: null,
    generated_at: '2026-07-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('Router', () => {
  const router = new Router();

  it('emits one job per platform allowed by routing rules AND platform_flags', async () => {
    const jobs = await router.route(makeReport({}));
    const platforms = jobs.map((j) => j.target_platform).sort();
    // tech rule allows instagram/linkedin/youtube/x/tiktok; flags allow all 7 -> intersection
    expect(platforms).toEqual(['instagram', 'linkedin', 'tiktok', 'x', 'youtube']);
  });

  it('platform_flags veto rule-allowed platforms', async () => {
    const jobs = await router.route(
      makeReport({
        platform_flags: { instagram: false, linkedin: true, youtube: false, x: true, tiktok: false, douyin: true, rednote: true },
      }),
    );
    const platforms = jobs.map((j) => j.target_platform).sort();
    expect(platforms).toEqual(['linkedin', 'x']);
  });

  it('returns empty array for a category with no routing rule', async () => {
    const jobs = await router.route(makeReport({ category: 'meta' }));
    expect(jobs).toEqual([]);
  });

  it('returns empty array when flags veto everything', async () => {
    const jobs = await router.route(
      makeReport({
        platform_flags: { instagram: false, linkedin: false, youtube: false, x: false, tiktok: false, douyin: false, rednote: false },
      }),
    );
    expect(jobs).toEqual([]);
  });

  it('applies per-category format override, defaults elsewhere', async () => {
    const jobs = await router.route(makeReport({}));
    const byPlatform = Object.fromEntries(jobs.map((j) => [j.target_platform, j.content_format]));
    expect(byPlatform['youtube']).toBe('short_video'); // tech override
    expect(byPlatform['instagram']).toBe('carousel'); // default
    expect(byPlatform['x']).toBe('thread'); // default
  });

  it('sets id, ab_variant, priority, and embeds the report', async () => {
    const report = makeReport({ engagement: { views: 0, likes: 0, shares: 0, comments: 0, signal_count: 0 } });
    const jobs = await router.route(report);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.id).toBe(`${report.id}:${job.target_platform}`);
      expect(job.ab_variant).toBeNull();
      expect(job.priority).toBe(5); // signal_count 0 -> neutral
      expect(job.cluster_report).toEqual(report);
      expect(typeof job.created_at).toBe('string');
    }
  });
});
