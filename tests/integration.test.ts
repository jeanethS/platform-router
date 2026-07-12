import * as path from 'node:path';
import { ConfigService } from '../src/config';
import { Router } from '../src/router';
import type { ClusterReport } from '@brand-os/contracts';

describe('integration: real rules -> router -> priority', () => {
  beforeAll(() => {
    new ConfigService(path.resolve(__dirname, '../src/rules'));
  });

  function makeReport(overrides: Partial<ClusterReport>): ClusterReport {
    return {
      id: 'int-1',
      cluster_label: 'integration cluster',
      category: 'tech',
      signal_ids: ['s1', 's2', 's3'],
      key_insights: ['i'],
      hooks: { pain_point: 'p', agitate: 'a', solution: 's', hot_take: 'h' },
      data_points: [],
      platform_flags: { instagram: true, linkedin: true, youtube: true, x: true, tiktok: true, douyin: true, rednote: true },
      speculative_edges: [],
      graph_svg_url: null,
      generated_at: '2026-07-11T00:00:00.000Z',
      engagement: { views: 5000, likes: 400, shares: 120, comments: 80, signal_count: 3 },
      ...overrides,
    };
  }

  it('routes a tech report through the real YAML rules with engagement priority', async () => {
    const router = new Router();
    const jobs = await router.route(makeReport({}));
    const platforms = jobs.map((j) => j.target_platform).sort();
    // routing.yaml tech row: instagram/linkedin/youtube/x/tiktok true; flags all true
    expect(platforms).toEqual(['instagram', 'linkedin', 'tiktok', 'x', 'youtube']);
    for (const job of jobs) {
      // raw = 400*0.2 + 120*0.3 + 80*0.25 + 5000*0.15 = 80+36+20+750 = 886
      // scaled = round((886/100)*10) = 89 -> clamp 10
      expect(job.priority).toBe(10);
      expect(job.ab_variant).toBeNull();
      expect(['carousel', 'long_video', 'thread', 'short_video', 'note']).toContain(job.content_format);
    }
  });

  it('cn report with cn-only flags routes to cn platforms', async () => {
    const router = new Router();
    const jobs = await router.route(
      makeReport({
        category: 'cn',
        platform_flags: { instagram: false, linkedin: false, youtube: false, x: false, tiktok: false, douyin: true, rednote: true },
      }),
    );
    const platforms = jobs.map((j) => j.target_platform).sort();
    expect(platforms).toEqual(['douyin', 'rednote']);
  });

  it('report without engagement gets neutral priority 5', async () => {
    const router = new Router();
    const base = makeReport({});
    delete (base as { engagement?: unknown }).engagement;
    const jobs = await router.route(base);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]?.priority).toBe(5);
  });
});
