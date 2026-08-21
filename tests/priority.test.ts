jest.mock('../src/config', () => ({
  ConfigService: {
    instance: {
      getPriorityConfig: () => ({
        weights: { likes: 0.2, shares: 0.3, comments: 0.25, views: 0.15 },
        max_score: 100,
      }),
    },
  },
}));

import { PriorityScorer } from '../src/priority';
import type { ClusterEngagement } from '@brand-os/contracts';

function eng(overrides: Partial<ClusterEngagement>): ClusterEngagement {
  return { views: 0, likes: 0, shares: 0, comments: 0, signal_count: 1, ...overrides };
}

function mockRedis(fields: Record<string, string> | null) {
  return {
    hgetall: jest.fn().mockResolvedValue(fields ?? {}),
  } as any;
}

describe('PriorityScorer', () => {
  const scorer = new PriorityScorer();

  it('returns neutral 5 when engagement is undefined', async () => {
    await expect(scorer.score(undefined)).resolves.toBe(5);
  });

  it('returns neutral 5 when signal_count is 0', async () => {
    await expect(scorer.score(eng({ views: 999, signal_count: 0 }))).resolves.toBe(5);
  });

  it('clamps zero engagement to 1', async () => {
    await expect(scorer.score(eng({}))).resolves.toBe(1);
  });

  it('clamps very high engagement to 10', async () => {
    await expect(
      scorer.score(eng({ views: 10000, likes: 10000, shares: 10000, comments: 10000 })),
    ).resolves.toBe(10);
  });

  it('computes weighted score for known input', async () => {
    // raw = 10*0.2 + 5*0.3 + 4*0.25 + 100*0.15 = 2 + 1.5 + 1 + 15 = 19.5
    // scaled = round((19.5/100)*10) = round(1.95) = 2
    await expect(scorer.score(eng({ likes: 10, shares: 5, comments: 4, views: 100 }))).resolves.toBe(2);
  });

  it('returns an integer', async () => {
    expect(Number.isInteger(await scorer.score(eng({ likes: 33, views: 77 })))).toBe(true);
  });

  it('guards against max_score = 0 by returning 1', async () => {
    jest.resetModules();
    jest.doMock('../src/config', () => ({
      ConfigService: {
        instance: {
          getPriorityConfig: () => ({
            weights: { likes: 0.2, shares: 0.3, comments: 0.25, views: 0.15 },
            max_score: 0,
          }),
        },
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PriorityScorer: ZeroMaxScorer } = require('../src/priority');
    const zeroScorer = new ZeroMaxScorer();
    await expect(zeroScorer.score(eng({ likes: 50, views: 200 }))).resolves.toBe(1);
  });

  it('falls back to 0 when weight keys are missing from config', async () => {
    jest.resetModules();
    jest.doMock('../src/config', () => ({
      ConfigService: {
        instance: {
          getPriorityConfig: () => ({
            weights: { likes: 0.5, shares: 0.5 },
            max_score: 100,
          }),
        },
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PriorityScorer: PartialWeightsScorer } = require('../src/priority');
    const partialScorer = new PartialWeightsScorer();
    await expect(partialScorer.score(eng({ likes: 10, shares: 10 }))).resolves.toBe(1);
  });

  it('falls back to 0 for all missing weight keys', async () => {
    jest.resetModules();
    jest.doMock('../src/config', () => ({
      ConfigService: {
        instance: {
          getPriorityConfig: () => ({
            weights: { views: 0.5 },
            max_score: 100,
          }),
        },
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PriorityScorer: OnlyViewsScorer } = require('../src/priority');
    const onlyViewsScorer = new OnlyViewsScorer();
    await expect(onlyViewsScorer.score(eng({ likes: 10, shares: 10 }))).resolves.toBe(1);
  });

  it('ignores historical data with sample_size below the minimum', async () => {
    const scorerWithRedis = new PriorityScorer(mockRedis({ avg: '0.5', sample_size: '2' }));
    await expect(
      scorerWithRedis.score(eng({ likes: 10, shares: 5, comments: 4, views: 100 }), 'tech'),
    ).resolves.toBe(2);
  });

  it('blends in historical performance once sample_size meets the minimum', async () => {
    // base = 2 (as above). historical avg 0.5 engagement-rate-by-reach -> scaled to 10 (well above MAX_HISTORICAL_ENGAGEMENT_RATE)
    // blended = round(2*0.7 + 10*0.3) = round(1.4 + 3) = round(4.4) = 4
    const scorerWithRedis = new PriorityScorer(mockRedis({ avg: '0.5', sample_size: '3' }));
    await expect(
      scorerWithRedis.score(eng({ likes: 10, shares: 5, comments: 4, views: 100 }), 'tech'),
    ).resolves.toBe(4);
  });

  it('falls back to base score when category is undefined', async () => {
    const scorerWithRedis = new PriorityScorer(mockRedis({ avg: '0.5', sample_size: '10' }));
    await expect(
      scorerWithRedis.score(eng({ likes: 10, shares: 5, comments: 4, views: 100 }), undefined),
    ).resolves.toBe(2);
  });

  it('falls back to base score when no redis client is provided', async () => {
    await expect(
      scorer.score(eng({ likes: 10, shares: 5, comments: 4, views: 100 }), 'tech'),
    ).resolves.toBe(2);
  });
});
