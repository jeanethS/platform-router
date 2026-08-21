# Analytics Ingestor (MEASURE & RECYCLE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the `publish → analytics → semantic-graph → platform-router` loop by completing the already-scaffolded (but dead/mocked) analytics subsystem in `publish-queue`, and making `platform-router` read the result back to weight routing priority.

**Architecture:** No new repo. `publish-queue`'s existing `AnalyticsModule` (`AnalyticsCollectorService`, `PerformanceScorerService`) gets wired live and its adapters get real API calls instead of `Math.random()`. A new `HistoricalPerformanceService` rolls up engagement-rate-by-reach per `ClusterCategory` into Redis (`historical_performance:<category>`), which `platform-router`'s `PriorityScorer` reads back to blend into its priority score. The existing (already-computed, currently unused) `comparison.percentile` from `PerformanceScorerService.calculateScore` drives an automatic recycle trigger: top-10th-percentile artifacts get enqueued onto a new `RECYCLE_CANDIDATES` topic.

**Tech Stack:** TypeScript, NestJS + BullMQ + Prisma/Postgres (`publish-queue`), plain BullMQ + ioredis (`platform-router`), `@brand-os/contracts` (pnpm workspace package, source at `infra-social/contracts`), Jest.

**Spec:** `platform-router/docs/superpowers/specs/2026-08-20-analytics-ingestor-design.md`

## Global Constraints

- No new repo — all work lands in `infra-social/contracts`, `publish/publish-queue`, `platform-router`.
- v1 platforms: `instagram` and `linkedin` only. Other `AdapterFactory` platforms (`youtube`, `x`, `tiktok`, `douyin`, `rednote`) are untouched.
- No new HTTP client dependency — use global `fetch` (Node 20+, already the house pattern in `pendpost.client.ts`).
- No new Redis client dependency in either repo — `ioredis` is already a dependency in both `publish-queue` and `platform-router`.
- Contract changes go in `infra-social/contracts/src/`, then `npm run build` there — the pnpm workspace symlinks `dist/` into consumers, so no manual copying.
- Every new/changed service follows the existing plain-Jest-mock testing style already used in each repo (`publish-queue`: manual object mocks, no `@nestjs/testing` TestingModule; `platform-router`: `jest.mock('../src/config', ...)`).
- `ContentArtifact.category` starts out null for all existing rows and stays null until whatever future work creates `ContentArtifact` rows populates it — every task that reads `category` must treat null as "insufficient data, skip" rather than throwing.

---

### Task 1: Add `RECYCLE_CANDIDATES` topic to contracts

**Files:**
- Modify: `infra-social/contracts/src/topics.ts`
- Test: `infra-social/contracts/tests/topics.test.ts`

**Interfaces:**
- Produces: `TOPICS.RECYCLE_CANDIDATES` (string constant `'recycle.candidates'`), consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Add to `infra-social/contracts/tests/topics.test.ts`:

```ts
  it('defines the recycle candidates topic', () => {
    expect(TOPICS.RECYCLE_CANDIDATES).toBe('recycle.candidates');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra-social/contracts && npx vitest run tests/topics.test.ts`
Expected: FAIL — `TOPICS.RECYCLE_CANDIDATES` is `undefined`

- [ ] **Step 3: Add the topic**

In `infra-social/contracts/src/topics.ts`, add one line inside the `TOPICS` const:

```ts
  ARTIFACTS_READY: 'artifacts.ready',
  RECYCLE_CANDIDATES: 'recycle.candidates',
```

- [ ] **Step 4: Run test to verify it passes, then rebuild the package**

Run: `cd infra-social/contracts && npx vitest run tests/topics.test.ts && npm run build`
Expected: test PASSES, `npm run build` succeeds (compiles `dist/`)

- [ ] **Step 5: Commit**

```bash
git add infra-social/contracts/src/topics.ts infra-social/contracts/tests/topics.test.ts infra-social/contracts/dist
git commit -m "feat(contracts): add RECYCLE_CANDIDATES topic"
```

---

### Task 2: Add `category` column to `ContentArtifact`

**Files:**
- Modify: `publish/publish-queue/prisma/schema.prisma`
- Create: `publish/publish-queue/prisma/migrations/<timestamp>_add_content_artifact_category/migration.sql` (generated)

**Interfaces:**
- Produces: `ContentArtifact.category: string | null` on the Prisma client, consumed by Task 7.

- [ ] **Step 1: Add the field to the schema**

In `publish/publish-queue/prisma/schema.prisma`, inside `model ContentArtifact`, add after the `platform` line:

```prisma
  platform         String // instagram, linkedin, youtube, x, tiktok, douyin, rednote
  category         String? // ClusterCategory from @brand-os/contracts (tech, robotics, culture, biz, cn, meta, local_services) — set by the artifact-creation path once that's wired; null until then
```

- [ ] **Step 2: Generate and run the migration**

Run: `cd publish/publish-queue && npx prisma migrate dev --name add_content_artifact_category`
Expected: creates a new folder under `prisma/migrations/` with a `migration.sql` doing `ALTER TABLE "ContentArtifact" ADD COLUMN "category" TEXT;`, applies it to the dev DB, regenerates the Prisma client.

- [ ] **Step 3: Verify the client picked it up**

Run: `cd publish/publish-queue && npx tsc --noEmit`
Expected: no type errors (confirms `@prisma/client`'s `ContentArtifact` type now includes `category: string | null`)

- [ ] **Step 4: Commit**

```bash
git add publish/publish-queue/prisma/schema.prisma publish/publish-queue/prisma/migrations
git commit -m "feat(publish-queue): add nullable category column to ContentArtifact"
```

---

### Task 3: Extend the `Analytics` interface with METER signal metrics

**Files:**
- Modify: `publish/publish-queue/src/adapters/platform.interface.ts`

**Interfaces:**
- Produces: `Analytics` now carries `saves: number | null`, `watchTimeSeconds: number | null`, `engagementRateByReach: number | null`, `followerGrowthRate: number | null`, `ctr: number | null`, consumed by Tasks 4, 5, 7, 8.
- Existing fields (`views`, `likes`, `comments`, `shares`, `engagementRate`, `reach`, `impressions`, `collectedAt`) are unchanged — additive only, so `PerformanceScorerService` (Task 8's caller) keeps compiling untouched.

- [ ] **Step 1: Extend the interface**

In `publish/publish-queue/src/adapters/platform.interface.ts`, change:

```ts
export interface Analytics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number;
  reach?: number;
  impressions?: number;
  collectedAt: Date;
}
```

to:

```ts
export interface Analytics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number;
  reach?: number;
  impressions?: number;
  collectedAt: Date;
  /** METER signal metrics — null when the platform/media type doesn't expose the metric */
  saves: number | null;
  watchTimeSeconds: number | null;
  engagementRateByReach: number | null;
  followerGrowthRate: number | null;
  ctr: number | null;
}
```

- [ ] **Step 2: Run the existing test suite to see what breaks**

Run: `cd publish/publish-queue && npx jest src/analytics`
Expected: FAIL — `performance-scorer.service.spec.ts` builds `Analytics` object literals missing the 5 new required fields (TS compile error under `ts-jest`)

- [ ] **Step 3: Fix the existing test fixtures**

In `publish/publish-queue/src/analytics/performance-scorer.service.spec.ts`, add the 5 new fields to both `analytics` object literals (the one in `'should calculate score for Instagram analytics'` and the one in `'should apply platform-specific weights'`):

```ts
      const analytics = {
        views: 1000,
        likes: 100,
        comments: 20,
        shares: 10,
        engagementRate: 13,
        collectedAt: new Date(),
        saves: null,
        watchTimeSeconds: null,
        engagementRateByReach: null,
        followerGrowthRate: null,
        ctr: null,
      };
```

(same five added to the second literal, keeping `shares: 50, engagementRate: 17`)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd publish/publish-queue && npx jest src/analytics`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add publish/publish-queue/src/adapters/platform.interface.ts publish/publish-queue/src/analytics/performance-scorer.service.spec.ts
git commit -m "feat(publish-queue): extend Analytics with METER signal metrics"
```

---

### Task 4: Real Instagram Graph API analytics

**Files:**
- Modify: `publish/publish-queue/src/adapters/platforms/instagram.adapter.ts`
- Test: `publish/publish-queue/src/adapters/platforms/instagram.adapter.spec.ts` (new)

**Interfaces:**
- Consumes: `Analytics` from Task 3.
- Produces: `InstagramAdapter.pullAnalytics(externalId: string): Promise<Analytics>` now makes real Instagram Graph API calls instead of `Math.random()`. Reads config `INSTAGRAM_ACCESS_TOKEN` (required) via a `ConfigService` now injected into the constructor.

- [ ] **Step 1: Write the failing test**

Create `publish/publish-queue/src/adapters/platforms/instagram.adapter.spec.ts`:

```ts
import { InstagramAdapter } from './instagram.adapter';

const mockConfig = {
  get: jest.fn((key: string, defaultValue?: string) => {
    if (key === 'INSTAGRAM_ACCESS_TOKEN') return 'test-token';
    return defaultValue;
  }),
} as any;

describe('InstagramAdapter.pullAnalytics', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches likes/comments and insights, maps to Analytics', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ like_count: 120, comments_count: 8, media_type: 'IMAGE' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { name: 'reach', values: [{ value: 900 }] },
            { name: 'saved', values: [{ value: 40 }] },
            { name: 'total_interactions', values: [{ value: 168 }] },
          ],
        }),
      });

    const adapter = new InstagramAdapter(mockConfig);
    const analytics = await adapter.pullAnalytics('ig-media-123');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/ig-media-123?fields=like_count,comments_count,media_type&access_token=test-token'),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/ig-media-123/insights?metric=reach,saved,total_interactions&access_token=test-token'),
    );

    expect(analytics.likes).toBe(120);
    expect(analytics.comments).toBe(8);
    expect(analytics.reach).toBe(900);
    expect(analytics.saves).toBe(40);
    expect(analytics.views).toBe(0);
    expect(analytics.watchTimeSeconds).toBeNull();
    expect(analytics.engagementRateByReach).toBeCloseTo((120 + 8 + 40) / 900, 5);
  });

  it('adds video_views and video_view_total_time for VIDEO/REELS media', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ like_count: 50, comments_count: 3, media_type: 'VIDEO' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { name: 'reach', values: [{ value: 500 }] },
            { name: 'saved', values: [{ value: 10 }] },
            { name: 'total_interactions', values: [{ value: 63 }] },
            { name: 'video_views', values: [{ value: 480 }] },
            { name: 'ig_reels_video_view_total_time', values: [{ value: 3600 }] },
          ],
        }),
      });

    const adapter = new InstagramAdapter(mockConfig);
    const analytics = await adapter.pullAnalytics('ig-reel-456');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        '/ig-reel-456/insights?metric=reach,saved,total_interactions,video_views,ig_reels_video_view_total_time&access_token=test-token',
      ),
    );
    expect(analytics.views).toBe(480);
    expect(analytics.watchTimeSeconds).toBe(3600);
  });

  it('throws when the base fields call is not ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: 'bad token' } }) });

    const adapter = new InstagramAdapter(mockConfig);
    await expect(adapter.pullAnalytics('ig-media-123')).rejects.toThrow(/bad token/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd publish/publish-queue && npx jest src/adapters/platforms/instagram.adapter.spec.ts`
Expected: FAIL — `InstagramAdapter` constructor doesn't take a config arg, `pullAnalytics` still returns `Math.random()` data, `global.fetch` never called.

- [ ] **Step 3: Implement**

Replace the whole file `publish/publish-queue/src/adapters/platforms/instagram.adapter.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { PlatformAdapter, PublishResult, Analytics, PlatformLimits } from '../platform.interface';
import { ContentArtifact } from '@prisma/client';

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';

interface InsightValue {
  name: string;
  values: { value: number }[];
}

export class InstagramAdapter implements PlatformAdapter {
  readonly platform = 'instagram';

  private readonly limits: PlatformLimits = {
    maxCaptionLength: 2200,
    maxHashtags: 30,
    maxImages: 10,
    supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'mp4'],
  };

  constructor(private readonly config: ConfigService) {}

  async publish(artifact: ContentArtifact): Promise<PublishResult> {
    // Mock implementation - replace with actual Instagram Graph API call
    // In production: POST to https://graph.facebook.com/v18.0/{ig-user-id}/media

    const externalId = `ig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      externalId,
      platform: this.platform,
      url: `https://instagram.com/p/${externalId}`,
      publishedAt: new Date(),
    };
  }

  async pullAnalytics(externalId: string): Promise<Analytics> {
    const token = this.requiredToken();

    const baseUrl = `${GRAPH_API_BASE}/${externalId}?fields=like_count,comments_count,media_type&access_token=${token}`;
    const baseRes = await fetch(baseUrl);
    const baseJson = await baseRes.json();
    if (!baseRes.ok) {
      throw new Error(`instagram: failed to fetch base fields — ${baseJson?.error?.message ?? baseRes.status}`);
    }

    const isVideo = baseJson.media_type === 'VIDEO' || baseJson.media_type === 'REELS';
    const metrics = isVideo
      ? ['reach', 'saved', 'total_interactions', 'video_views', 'ig_reels_video_view_total_time']
      : ['reach', 'saved', 'total_interactions'];

    const insightsUrl = `${GRAPH_API_BASE}/${externalId}/insights?metric=${metrics.join(',')}&access_token=${token}`;
    const insightsRes = await fetch(insightsUrl);
    const insightsJson = await insightsRes.json();
    if (!insightsRes.ok) {
      throw new Error(`instagram: failed to fetch insights — ${insightsJson?.error?.message ?? insightsRes.status}`);
    }

    const byName = new Map<string, number>(
      (insightsJson.data as InsightValue[]).map((m) => [m.name, m.values[0]?.value ?? 0]),
    );

    const likes = baseJson.like_count ?? 0;
    const comments = baseJson.comments_count ?? 0;
    const saves = byName.get('saved') ?? 0;
    const reach = byName.get('reach') ?? 0;
    const views = byName.get('video_views') ?? 0;
    const totalInteractions = byName.get('total_interactions') ?? likes + comments + saves;

    return {
      views,
      likes,
      comments,
      shares: 0, // Instagram Graph API does not expose share count for organic posts
      engagementRate: reach > 0 ? (totalInteractions / reach) * 100 : 0,
      reach,
      saves,
      watchTimeSeconds: isVideo ? byName.get('ig_reels_video_view_total_time') ?? null : null,
      engagementRateByReach: reach > 0 ? totalInteractions / reach : null,
      followerGrowthRate: null, // requires a separate account-level insights call, out of scope for a single-post pull
      ctr: null, // Instagram organic posts don't expose click-through rate
      collectedAt: new Date(),
    };
  }

  private requiredToken(): string {
    const token = this.config.get<string>('INSTAGRAM_ACCESS_TOKEN');
    if (!token) {
      throw new Error('instagram: missing INSTAGRAM_ACCESS_TOKEN');
    }
    return token;
  }

  validateArtifact(artifact: ContentArtifact): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const files = artifact.files as any[];

    if (!files || files.length === 0) {
      errors.push('At least one file is required');
    }

    if (files && files.length > this.limits.maxImages) {
      errors.push(`Maximum ${this.limits.maxImages} images allowed`);
    }

    if (artifact.hashtags && artifact.hashtags.length > this.limits.maxHashtags) {
      errors.push(`Maximum ${this.limits.maxHashtags} hashtags allowed`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  truncateCaption(caption: string): string {
    if (caption.length <= this.limits.maxCaptionLength) {
      return caption;
    }
    return caption.substring(0, this.limits.maxCaptionLength - 3) + '...';
  }
}
```

- [ ] **Step 4: Update `AdapterFactory` to pass `ConfigService`**

In `publish/publish-queue/src/adapters/adapter.factory.ts`, change:

```ts
    this.adapters.set('instagram', new InstagramAdapter());
```

to:

```ts
    this.adapters.set('instagram', new InstagramAdapter(this.configService));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd publish/publish-queue && npx jest src/adapters/platforms/instagram.adapter.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add publish/publish-queue/src/adapters/platforms/instagram.adapter.ts publish/publish-queue/src/adapters/platforms/instagram.adapter.spec.ts publish/publish-queue/src/adapters/adapter.factory.ts
git commit -m "feat(publish-queue): real Instagram Graph API analytics"
```

---

### Task 5: Real LinkedIn API analytics

**Files:**
- Modify: `publish/publish-queue/src/adapters/platforms/linkedin.adapter.ts`
- Test: `publish/publish-queue/src/adapters/platforms/linkedin.adapter.spec.ts` (new)

**Interfaces:**
- Consumes: `Analytics` from Task 3.
- Produces: `LinkedInAdapter.pullAnalytics(externalId: string): Promise<Analytics>` — real LinkedIn Organization Share Statistics call. `externalId` is expected to be a full share URN (e.g. `urn:li:share:1234567`). Reads config `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_ORG_URN` (both required) via injected `ConfigService`.

- [ ] **Step 1: Write the failing test**

Create `publish/publish-queue/src/adapters/platforms/linkedin.adapter.spec.ts`:

```ts
import { LinkedInAdapter } from './linkedin.adapter';

const mockConfig = {
  get: jest.fn((key: string, defaultValue?: string) => {
    if (key === 'LINKEDIN_ACCESS_TOKEN') return 'test-token';
    if (key === 'LINKEDIN_ORG_URN') return 'urn:li:organization:9999';
    return defaultValue;
  }),
} as any;

describe('LinkedInAdapter.pullAnalytics', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches organizationalEntityShareStatistics and maps to Analytics', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        elements: [
          {
            totalShareStatistics: {
              impressionCount: 4000,
              uniqueImpressionsCount: 3000,
              shareCount: 12,
              likeCount: 90,
              commentCount: 15,
              clickCount: 60,
            },
          },
        ],
      }),
    });

    const adapter = new LinkedInAdapter(mockConfig);
    const analytics = await adapter.pullAnalytics('urn:li:share:1234567');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'organizationalEntity=urn%3Ali%3Aorganization%3A9999&shares%5B0%5D=urn%3Ali%3Ashare%3A1234567',
      ),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }),
    );

    expect(analytics.likes).toBe(90);
    expect(analytics.comments).toBe(15);
    expect(analytics.shares).toBe(12);
    expect(analytics.impressions).toBe(4000);
    expect(analytics.reach).toBe(3000);
    expect(analytics.ctr).toBeCloseTo(60 / 4000, 5);
    expect(analytics.saves).toBeNull();
    expect(analytics.watchTimeSeconds).toBeNull();
    expect(analytics.engagementRateByReach).toBeCloseTo((90 + 15 + 12) / 3000, 5);
  });

  it('returns zeroed analytics when elements array is empty', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ elements: [] }) });

    const adapter = new LinkedInAdapter(mockConfig);
    const analytics = await adapter.pullAnalytics('urn:li:share:1234567');

    expect(analytics.likes).toBe(0);
    expect(analytics.engagementRateByReach).toBeNull();
  });

  it('throws when the API call is not ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: 'expired token' }) });

    const adapter = new LinkedInAdapter(mockConfig);
    await expect(adapter.pullAnalytics('urn:li:share:1234567')).rejects.toThrow(/expired token/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd publish/publish-queue && npx jest src/adapters/platforms/linkedin.adapter.spec.ts`
Expected: FAIL — constructor signature mismatch, `pullAnalytics` still random, `fetch` never called.

- [ ] **Step 3: Implement**

Replace the whole file `publish/publish-queue/src/adapters/platforms/linkedin.adapter.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { PlatformAdapter, PublishResult, Analytics, PlatformLimits } from '../platform.interface';
import { ContentArtifact } from '@prisma/client';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

export class LinkedInAdapter implements PlatformAdapter {
  readonly platform = 'linkedin';

  private readonly limits: PlatformLimits = {
    maxCaptionLength: 3000,
    maxHashtags: 10,
    maxImages: 9,
    supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'mp4'],
  };

  constructor(private readonly config: ConfigService) {}

  async publish(artifact: ContentArtifact): Promise<PublishResult> {
    // Mock implementation - replace with actual LinkedIn API call
    // POST https://api.linkedin.com/v2/ugcPosts

    const externalId = `li_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      externalId,
      platform: this.platform,
      url: `https://linkedin.com/feed/update/urn:li:activity:${externalId}`,
      publishedAt: new Date(),
    };
  }

  async pullAnalytics(externalId: string): Promise<Analytics> {
    const token = this.config.get<string>('LINKEDIN_ACCESS_TOKEN');
    if (!token) {
      throw new Error('linkedin: missing LINKEDIN_ACCESS_TOKEN');
    }
    const orgUrn = this.config.get<string>('LINKEDIN_ORG_URN');
    if (!orgUrn) {
      throw new Error('linkedin: missing LINKEDIN_ORG_URN');
    }

    const url =
      `${LINKEDIN_API_BASE}/organizationalEntityShareStatistics` +
      `?q=organizationalEntity&organizationalEntity=${encodeURIComponent(orgUrn)}` +
      `&shares[0]=${encodeURIComponent(externalId)}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`linkedin: failed to fetch share statistics — ${json?.message ?? res.status}`);
    }

    const stats = json.elements?.[0]?.totalShareStatistics;
    if (!stats) {
      return {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        engagementRate: 0,
        reach: 0,
        impressions: 0,
        saves: null,
        watchTimeSeconds: null,
        engagementRateByReach: null,
        followerGrowthRate: null,
        ctr: null,
        collectedAt: new Date(),
      };
    }

    const likes = stats.likeCount ?? 0;
    const comments = stats.commentCount ?? 0;
    const shares = stats.shareCount ?? 0;
    const impressions = stats.impressionCount ?? 0;
    const reach = stats.uniqueImpressionsCount ?? 0;
    const clicks = stats.clickCount ?? 0;
    const totalInteractions = likes + comments + shares;

    return {
      views: impressions,
      likes,
      comments,
      shares,
      engagementRate: impressions > 0 ? (totalInteractions / impressions) * 100 : 0,
      reach,
      impressions,
      saves: null, // LinkedIn has no save concept
      watchTimeSeconds: null, // not exposed by organizationalEntityShareStatistics
      engagementRateByReach: reach > 0 ? totalInteractions / reach : null,
      followerGrowthRate: null, // requires a separate organizationalEntityFollowerStatistics call, out of scope for a single-post pull
      ctr: impressions > 0 ? clicks / impressions : null,
      collectedAt: new Date(),
    };
  }

  validateArtifact(artifact: ContentArtifact): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const files = artifact.files as any[];

    if (!files || files.length === 0) {
      errors.push('At least one file is required');
    }

    if (files && files.length > this.limits.maxImages) {
      errors.push(`Maximum ${this.limits.maxImages} images allowed`);
    }

    if (artifact.hashtags && artifact.hashtags.length > this.limits.maxHashtags) {
      errors.push(`Maximum ${this.limits.maxHashtags} hashtags allowed`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  truncateCaption(caption: string): string {
    if (caption.length <= this.limits.maxCaptionLength) {
      return caption;
    }
    return caption.substring(0, this.limits.maxCaptionLength - 3) + '...';
  }
}
```

- [ ] **Step 4: Update `AdapterFactory` to pass `ConfigService`**

In `publish/publish-queue/src/adapters/adapter.factory.ts`, change:

```ts
    this.adapters.set('linkedin', new LinkedInAdapter());
```

to:

```ts
    this.adapters.set('linkedin', new LinkedInAdapter(this.configService));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd publish/publish-queue && npx jest src/adapters/platforms/linkedin.adapter.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add publish/publish-queue/src/adapters/platforms/linkedin.adapter.ts publish/publish-queue/src/adapters/platforms/linkedin.adapter.spec.ts publish/publish-queue/src/adapters/adapter.factory.ts
git commit -m "feat(publish-queue): real LinkedIn API analytics"
```

---

### Task 6: Wire `scheduleAnalyticsCollection` into the publish flow

**Files:**
- Modify: `publish/publish-queue/src/scheduler/publish-queue.service.ts`
- Modify: `publish/publish-queue/src/scheduler/scheduler.module.ts`
- Test: `publish/publish-queue/src/scheduler/publish-queue.service.spec.ts`

**Interfaces:**
- Consumes: `AnalyticsCollectorService.scheduleAnalyticsCollection(artifactId: string, platform: string, externalId: string): Promise<Job>` (already exists, currently uncalled).
- Produces: nothing new — closes the existing dead-code path.

- [ ] **Step 1: Write the failing test**

In `publish/publish-queue/src/scheduler/publish-queue.service.spec.ts`, add `mockAnalyticsCollector` to the top-level `let` declarations, initialize it in `beforeEach`, and pass it into the `service = new PublishQueueService(...)` call:

```ts
  let mockAnalyticsCollector: any;
```

```ts
    mockAnalyticsCollector = {
      scheduleAnalyticsCollection: jest.fn().mockResolvedValue({}),
    };
```

```ts
    service = new PublishQueueService(
      mockConfig,
      mockPrisma,
      mockAdapterFactory,
      mockNotification,
      mockAnalyticsCollector,
    );
```

Then add a new test in the `describe('PublishQueueService', ...)` block (find the block that tests `processJob` success — if none exists yet, add this describe block; if `processJob` is private, call it via `(service as any).processJob(...)` matching how the file already accesses private members, or via the existing public entry point the file uses to trigger it):

```ts
  describe('processJob analytics scheduling', () => {
    it('schedules analytics collection after a real publish', async () => {
      const artifact = createMockArtifact({ status: 'approved' });
      mockPrisma.contentArtifact.findUnique.mockResolvedValue(artifact);
      mockAdapterFactory.publish.mockResolvedValue({
        externalId: 'urn:li:share:1234567',
        platform: 'linkedin',
        publishedAt: new Date(),
      });

      await (service as any).processJob({
        data: { artifactId: artifact.id, platform: 'linkedin' },
      });

      expect(mockAnalyticsCollector.scheduleAnalyticsCollection).toHaveBeenCalledWith(
        artifact.id,
        'linkedin',
        'urn:li:share:1234567',
      );
    });

    it('does NOT schedule analytics collection for a handoff (draft) publish', async () => {
      const artifact = createMockArtifact({ status: 'approved' });
      mockPrisma.contentArtifact.findUnique.mockResolvedValue(artifact);
      mockAdapterFactory.publish.mockResolvedValue({
        externalId: 'taisly:dry-run:test-artifact-1',
        platform: 'instagram',
        publishedAt: new Date(),
        handoff: true,
      });

      await (service as any).processJob({
        data: { artifactId: artifact.id, platform: 'instagram' },
      });

      expect(mockAnalyticsCollector.scheduleAnalyticsCollection).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd publish/publish-queue && npx jest src/scheduler/publish-queue.service.spec.ts`
Expected: FAIL — `PublishQueueService` constructor takes 4 args, test passes 5; `mockAnalyticsCollector.scheduleAnalyticsCollection` never called.

- [ ] **Step 3: Inject `AnalyticsCollectorService` and call it after a real publish**

In `publish/publish-queue/src/scheduler/publish-queue.service.ts`, update the import block:

```ts
import { PrismaService } from '../prisma/prisma.service';
import { AdapterFactory } from '../adapters/adapter.factory';
import { NotificationService } from '../adapters/notification.service';
import { AnalyticsCollectorService } from '../analytics/analytics-collector.service';
import { ContentArtifact } from '@prisma/client';
```

Update the constructor:

```ts
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
    private notificationService: NotificationService,
    private analyticsCollector: AnalyticsCollectorService,
  ) {
```

In `processJob`, in the `else` branch that sets `status: 'published'` (the non-handoff case), after the `prisma.contentArtifact.update` call and before `notificationService.notifyPublishSuccess`, add:

```ts
        await this.analyticsCollector.scheduleAnalyticsCollection(
          artifactId,
          platform,
          result.externalId,
        );
```

- [ ] **Step 4: Wire the module dependency**

In `publish/publish-queue/src/scheduler/scheduler.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PublishQueueService } from './publish-queue.service';
import { SchedulingOptimizerService } from './scheduling-optimizer.service';
import { AdaptersModule } from '../adapters/adapters.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AdaptersModule, AnalyticsModule],
  providers: [PublishQueueService, SchedulingOptimizerService],
  exports: [PublishQueueService, SchedulingOptimizerService],
})
export class SchedulerModule {}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd publish/publish-queue && npx jest src/scheduler/publish-queue.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add publish/publish-queue/src/scheduler/publish-queue.service.ts publish/publish-queue/src/scheduler/scheduler.module.ts publish/publish-queue/src/scheduler/publish-queue.service.spec.ts
git commit -m "feat(publish-queue): schedule analytics collection after real publish"
```

---

### Task 7: `HistoricalPerformanceService` — roll up engagement-rate-by-reach per category into Redis

**Files:**
- Create: `publish/publish-queue/src/analytics/historical-performance.service.ts`
- Create: `publish/publish-queue/src/analytics/historical-performance.service.spec.ts`
- Modify: `publish/publish-queue/src/analytics/analytics.module.ts`

**Interfaces:**
- Produces: `HistoricalPerformanceService.record(category: string, engagementRateByReach: number): Promise<void>` — writes/updates a Redis hash `historical_performance:<category>` with fields `avg` (string, running average), `sample_size` (string, count), `updated_at` (ISO string). Consumed by Task 8 (writer) and Task 9 (reader, cross-repo).

- [ ] **Step 1: Write the failing test**

Create `publish/publish-queue/src/analytics/historical-performance.service.spec.ts`:

```ts
import { HistoricalPerformanceService } from './historical-performance.service';

const mockHget = jest.fn();
const mockHset = jest.fn().mockResolvedValue(undefined);
const mockQuit = jest.fn().mockResolvedValue(undefined);

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    hget: mockHget,
    hset: mockHset,
    quit: mockQuit,
  })),
);

const mockConfig = {
  get: jest.fn((key: string, defaultValue?: string) => defaultValue),
} as any;

describe('HistoricalPerformanceService.record', () => {
  let service: HistoricalPerformanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HistoricalPerformanceService(mockConfig);
  });

  it('initializes avg/sample_size for a category with no prior data', async () => {
    mockHget.mockImplementation((key: string, field: string) => {
      if (field === 'avg') return Promise.resolve(null);
      if (field === 'sample_size') return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await service.record('tech', 0.08);

    expect(mockHset).toHaveBeenCalledWith(
      'historical_performance:tech',
      expect.objectContaining({ avg: '0.08', sample_size: '1' }),
    );
  });

  it('computes a running average when prior data exists', async () => {
    mockHget.mockImplementation((key: string, field: string) => {
      if (field === 'avg') return Promise.resolve('0.1');
      if (field === 'sample_size') return Promise.resolve('4');
      return Promise.resolve(null);
    });

    await service.record('tech', 0.2);

    // newAvg = (0.1*4 + 0.2) / 5 = 0.6/5 = 0.12
    const call = mockHset.mock.calls[0][1];
    expect(call.sample_size).toBe('5');
    expect(Number(call.avg)).toBeCloseTo(0.12, 5);
  });

  it('does nothing when engagementRateByReach is null', async () => {
    await service.record('tech', null);
    expect(mockHset).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd publish/publish-queue && npx jest src/analytics/historical-performance.service.spec.ts`
Expected: FAIL — module `./historical-performance.service` does not exist.

- [ ] **Step 3: Implement**

Create `publish/publish-queue/src/analytics/historical-performance.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

@Injectable()
export class HistoricalPerformanceService {
  private readonly logger = new Logger(HistoricalPerformanceService.name);
  private readonly redis: IORedis;

  constructor(private configService: ConfigService) {
    const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
    const redisPort = parseInt(this.configService.get<string>('REDIS_PORT', '6379'), 10);
    this.redis = new IORedis({ host: redisHost, port: redisPort });
  }

  /**
   * Rolls engagementRateByReach into the category's running average.
   * ponytail: read-then-write is not atomic under concurrent writers for the
   * same category — fine at current publish volume, move to a Lua script or
   * WATCH/MULTI if throughput makes the race matter.
   */
  async record(category: string | null, engagementRateByReach: number | null): Promise<void> {
    if (category === null || engagementRateByReach === null) {
      return;
    }

    const key = `historical_performance:${category}`;
    const [prevAvgRaw, prevCountRaw] = await Promise.all([
      this.redis.hget(key, 'avg'),
      this.redis.hget(key, 'sample_size'),
    ]);

    const prevAvg = prevAvgRaw !== null ? Number(prevAvgRaw) : 0;
    const prevCount = prevCountRaw !== null ? Number(prevCountRaw) : 0;
    const newCount = prevCount + 1;
    const newAvg = (prevAvg * prevCount + engagementRateByReach) / newCount;

    await this.redis.hset(key, {
      avg: String(newAvg),
      sample_size: String(newCount),
      updated_at: new Date().toISOString(),
    });

    this.logger.log(`historical_performance updated category=${category} avg=${newAvg} sample_size=${newCount}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
```

- [ ] **Step 4: Register in `AnalyticsModule`**

In `publish/publish-queue/src/analytics/analytics.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AnalyticsCollectorService } from './analytics-collector.service';
import { PerformanceScorerService } from './performance-scorer.service';
import { HistoricalPerformanceService } from './historical-performance.service';
import { AdaptersModule } from '../adapters/adapters.module';

@Module({
  imports: [AdaptersModule],
  providers: [AnalyticsCollectorService, PerformanceScorerService, HistoricalPerformanceService],
  exports: [AnalyticsCollectorService, PerformanceScorerService, HistoricalPerformanceService],
})
export class AnalyticsModule {}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd publish/publish-queue && npx jest src/analytics/historical-performance.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add publish/publish-queue/src/analytics/historical-performance.service.ts publish/publish-queue/src/analytics/historical-performance.service.spec.ts publish/publish-queue/src/analytics/analytics.module.ts
git commit -m "feat(publish-queue): HistoricalPerformanceService rolls up engagement rate by category"
```

---

### Task 8: Wire scoring + historical rollup + recycle enqueue into `AnalyticsCollectorService`

**Files:**
- Modify: `publish/publish-queue/src/analytics/analytics-collector.service.ts`
- Test: `publish/publish-queue/src/analytics/analytics-collector.service.spec.ts` (new — none exists today)

**Interfaces:**
- Consumes: `PerformanceScorerService.calculateScore(artifactId, platform, analytics): Promise<PerformanceScore>` (existing), `HistoricalPerformanceService.record(category, engagementRateByReach)` (Task 7).
- Produces: on every successful `collectAnalytics`, enqueues a job on `TOPICS.RECYCLE_CANDIDATES` (Task 1) when `comparison.percentile >= RECYCLE_PERCENTILE_THRESHOLD` (config, default `90`).

- [ ] **Step 1: Write the failing test**

Create `publish/publish-queue/src/analytics/analytics-collector.service.spec.ts`:

```ts
const mockQueueAdd = jest.fn().mockResolvedValue({});
const mockWorkerOn = jest.fn();
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: mockQueueAdd })),
  Worker: jest.fn().mockImplementation(() => ({ on: mockWorkerOn })),
}));

import { TOPICS } from '@brand-os/contracts';
import { AnalyticsCollectorService } from './analytics-collector.service';

const mockConfig = {
  get: jest.fn((key: string, defaultValue?: string) => {
    if (key === 'RECYCLE_PERCENTILE_THRESHOLD') return '90';
    return defaultValue;
  }),
} as any;

function makeAnalytics(overrides = {}) {
  return {
    views: 1000,
    likes: 100,
    comments: 10,
    shares: 5,
    engagementRate: 11.5,
    reach: 900,
    saves: 20,
    watchTimeSeconds: null,
    engagementRateByReach: 0.15,
    followerGrowthRate: null,
    ctr: null,
    collectedAt: new Date(),
    ...overrides,
  };
}

describe('AnalyticsCollectorService.collectAnalytics', () => {
  let service: AnalyticsCollectorService;
  let mockPrisma: any;
  let mockAdapterFactory: any;
  let mockScorer: any;
  let mockHistorical: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma = {
      contentArtifact: {
        findUnique: jest.fn().mockResolvedValue({ id: 'a1', category: 'tech' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mockAdapterFactory = { pullAnalytics: jest.fn().mockResolvedValue(makeAnalytics()) };
    mockScorer = {
      calculateScore: jest.fn().mockResolvedValue({
        score: 92,
        breakdown: { viewsScore: 1, engagementScore: 1, platformBonus: 0 },
        comparison: { vs30DayAvg: 10, trend: 'up', percentile: 95 },
      }),
    };
    mockHistorical = { record: jest.fn().mockResolvedValue(undefined) };

    service = new AnalyticsCollectorService(mockConfig, mockPrisma, mockAdapterFactory, mockScorer, mockHistorical);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('records historical performance for the artifact category', async () => {
    await service.collectNow('a1', 'instagram', 'ig-media-1');
    expect(mockHistorical.record).toHaveBeenCalledWith('tech', 0.15);
  });

  it('enqueues a recycle candidate when percentile meets the threshold', async () => {
    await service.collectNow('a1', 'instagram', 'ig-media-1');
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'candidate',
      expect.objectContaining({ artifactId: 'a1', platform: 'instagram', percentile: 95 }),
    );
  });

  it('does NOT enqueue a recycle candidate below the threshold', async () => {
    mockScorer.calculateScore.mockResolvedValue({
      score: 40,
      breakdown: { viewsScore: 1, engagementScore: 1, platformBonus: 0 },
      comparison: { vs30DayAvg: -5, trend: 'down', percentile: 40 },
    });

    await service.collectNow('a1', 'instagram', 'ig-media-1');
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('does NOT enqueue a recycle candidate when comparison is undefined (insufficient sample)', async () => {
    mockScorer.calculateScore.mockResolvedValue({
      score: 40,
      breakdown: { viewsScore: 1, engagementScore: 1, platformBonus: 0 },
      comparison: undefined,
    });

    await service.collectNow('a1', 'instagram', 'ig-media-1');
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd publish/publish-queue && npx jest src/analytics/analytics-collector.service.spec.ts`
Expected: FAIL — constructor signature mismatch (currently takes `configService, prisma, adapterFactory`, not `scorer, historical`), `mockHistorical.record`/`mockQueueAdd` never called.

- [ ] **Step 3: Implement**

In `publish/publish-queue/src/analytics/analytics-collector.service.ts`:

Update imports:

```ts
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { TOPICS } from '@brand-os/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterFactory } from '../adapters/adapter.factory';
import { Analytics } from '../adapters/platform.interface';
import { PerformanceScorerService } from './performance-scorer.service';
import { HistoricalPerformanceService } from './historical-performance.service';
```

Update the constructor and add the recycle queue + threshold:

```ts
  private recycleQueue: Queue;
  private readonly recyclePercentileThreshold: number;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
    private scorer: PerformanceScorerService,
    private historicalPerformance: HistoricalPerformanceService,
  ) {
    const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
    const redisPort = parseInt(this.configService.get<string>('REDIS_PORT', '6379'), 10);

    this.connection = {
      host: redisHost,
      port: redisPort,
    };

    this.collectionDelayHours = parseInt(
      this.configService.get<string>('ANALYTICS_COLLECTION_DELAY_HOURS', '6'),
      10
    );

    this.recyclePercentileThreshold = parseInt(
      this.configService.get<string>('RECYCLE_PERCENTILE_THRESHOLD', '90'),
      10,
    );
  }
```

In `onModuleInit`, after `this.analyticsQueue = new Queue(...)`, add:

```ts
    this.recycleQueue = new Queue(TOPICS.RECYCLE_CANDIDATES, { connection: this.connection });
```

In `onModuleDestroy`, add `await this.recycleQueue?.close();` alongside the existing closes.

In `collectAnalytics`, after the existing `await this.prisma.contentArtifact.update({ ... data: { analytics: mergedAnalytics } });` block and before `return analytics;`, add:

```ts
      const score = await this.scorer.calculateScore(artifactId, platform, analytics);
      await this.historicalPerformance.record(artifact.category, analytics.engagementRateByReach);

      if (score.comparison && score.comparison.percentile >= this.recyclePercentileThreshold) {
        await this.recycleQueue.add('candidate', {
          artifactId,
          platform,
          category: artifact.category,
          score: score.score,
          percentile: score.comparison.percentile,
        });
        this.logger.log(
          `Recycle candidate: artifact ${artifactId} at percentile ${score.comparison.percentile}`,
        );
      }
```

(`artifact` is already in scope in `collectAnalytics` from the existing `const artifact = await this.prisma.contentArtifact.findUnique(...)` call above it.)

Also add a `collectNow` pass-through already exists — no change needed there, it already calls `collectAnalytics`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd publish/publish-queue && npx jest src/analytics/analytics-collector.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Run the full analytics test suite for regressions**

Run: `cd publish/publish-queue && npx jest src/analytics`
Expected: all PASS (Task 3's fixture fix, Task 7's new spec, this task's new spec)

- [ ] **Step 6: Commit**

```bash
git add publish/publish-queue/src/analytics/analytics-collector.service.ts publish/publish-queue/src/analytics/analytics-collector.service.spec.ts
git commit -m "feat(publish-queue): score analytics, roll up historical performance, enqueue recycle candidates"
```

---

### Task 9: `platform-router` reads `historical_performance:<category>` into priority scoring

**Files:**
- Modify: `platform-router/src/priority.ts`
- Modify: `platform-router/src/router.ts`
- Modify: `platform-router/src/bus.ts`
- Modify: `platform-router/tests/priority.test.ts`

**Interfaces:**
- Consumes: Redis hash `historical_performance:<category>` (fields `avg`, `sample_size`) written by Task 7/8 in `publish-queue`.
- Produces: `PriorityScorer.score(engagement, category, redis)` is now `async`, returns `Promise<number>`; `Router.route(report)` awaits it — its own signature (`Promise<RoutedJob[]>`) is unchanged.

- [ ] **Step 1: Write the failing tests**

Rewrite `platform-router/tests/priority.test.ts`:

```ts
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
  it('returns neutral 5 when engagement is undefined', async () => {
    const scorer = new PriorityScorer(mockRedis(null));
    await expect(scorer.score(undefined, 'tech')).resolves.toBe(5);
  });

  it('returns neutral 5 when signal_count is 0', async () => {
    const scorer = new PriorityScorer(mockRedis(null));
    await expect(scorer.score(eng({ views: 999, signal_count: 0 }), 'tech')).resolves.toBe(5);
  });

  it('clamps zero engagement to 1 with no historical data', async () => {
    const scorer = new PriorityScorer(mockRedis(null));
    await expect(scorer.score(eng({}), 'tech')).resolves.toBe(1);
  });

  it('clamps very high engagement to 10', async () => {
    const scorer = new PriorityScorer(mockRedis(null));
    await expect(
      scorer.score(eng({ views: 10000, likes: 10000, shares: 10000, comments: 10000 }), 'tech'),
    ).resolves.toBe(10);
  });

  it('computes weighted score for known input with no historical data', async () => {
    // raw = 10*0.2 + 5*0.3 + 4*0.25 + 100*0.15 = 2 + 1.5 + 1 + 15 = 19.5
    // scaled = round((19.5/100)*10) = round(1.95) = 2
    const scorer = new PriorityScorer(mockRedis(null));
    await expect(
      scorer.score(eng({ likes: 10, shares: 5, comments: 4, views: 100 }), 'tech'),
    ).resolves.toBe(2);
  });

  it('ignores historical data with sample_size below the minimum', async () => {
    const scorer = new PriorityScorer(mockRedis({ avg: '0.5', sample_size: '2' }));
    await expect(scorer.score(eng({ likes: 10, shares: 5, comments: 4, views: 100 }), 'tech')).resolves.toBe(2);
  });

  it('blends in historical performance once sample_size meets the minimum', async () => {
    // base = 2 (as above). historical avg 0.5 engagement-rate-by-reach -> scaled to 10 (well above MAX_HISTORICAL_ENGAGEMENT_RATE)
    // blended = round(2*0.7 + 10*0.3) = round(1.4 + 3) = round(4.4) = 4
    const scorer = new PriorityScorer(mockRedis({ avg: '0.5', sample_size: '3' }));
    await expect(
      scorer.score(eng({ likes: 10, shares: 5, comments: 4, views: 100 }), 'tech'),
    ).resolves.toBe(4);
  });

  it('falls back to base score when category is undefined', async () => {
    const scorer = new PriorityScorer(mockRedis({ avg: '0.5', sample_size: '10' }));
    await expect(scorer.score(eng({ likes: 10, shares: 5, comments: 4, views: 100 }), undefined)).resolves.toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd platform-router && npx jest tests/priority.test.ts`
Expected: FAIL — `PriorityScorer` constructor takes no args, `.score()` returns a plain number not a Promise.

- [ ] **Step 3: Implement `PriorityScorer`**

Replace `platform-router/src/priority.ts`:

```ts
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
```

- [ ] **Step 4: Update `Router` to await the score and pass `category`**

In `platform-router/src/router.ts`, change the constructor and call site:

```ts
import type IORedis from 'ioredis';
```

```ts
export class Router {
  private cfg = ConfigService.instance!;
  private scorer: PriorityScorer;

  constructor(redis?: IORedis) {
    this.scorer = new PriorityScorer(redis);
  }

  async route(report: ClusterReport): Promise<RoutedJob[]> {
```

Change:

```ts
    const priority = this.scorer.score(report.engagement);
```

to:

```ts
    const priority = await this.scorer.score(report.engagement, report.category);
```

- [ ] **Step 5: Pass the shared Redis connection from `BusConnector`**

In `platform-router/src/bus.ts`, change:

```ts
  private router = new Router();
```

to (inside the constructor body, after `this.connection` is created, since `router` needs the same connection instance):

```ts
  private router: Router;
```

and in the constructor:

```ts
  constructor(redisUrl: string = process.env.REDIS_URL ?? DEFAULT_REDIS_URL) {
    // BullMQ requires maxRetriesPerRequest: null on shared connections
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.outQueue = new Queue(TOPICS.JOBS_ROUTED, { connection: this.connection });
    this.router = new Router(this.connection);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd platform-router && npx jest tests/priority.test.ts tests/router.test.ts tests/integration.test.ts`
Expected: PASS (check `router.test.ts`/`integration.test.ts` don't construct `new Router()` with an assumption of sync `.score()` — if they do, update those call sites/mocks the same way as `priority.test.ts`)

- [ ] **Step 7: Commit**

```bash
git add platform-router/src/priority.ts platform-router/src/router.ts platform-router/src/bus.ts platform-router/tests/priority.test.ts
git commit -m "feat(platform-router): blend historical performance by category into priority score"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage:** platform scope (IG+LinkedIn, Task 4/5), discovery via `publish-queue` DB (Task 6 reuses existing `contentArtifact.findUnique`, no new discovery mechanism needed since the collector is now triggered inline at publish time rather than by a separate cron scan), METER metrics (Task 3), historical_performance loop closure (Task 7-9), recycle threshold (Task 8, reusing existing `comparison.percentile`) — all covered. Cron/repeat-job cadence from the original spec is superseded by the simpler inline `scheduleAnalyticsCollection` delay-job already present in the existing code (Task 6) — no separate cron task needed.
- **Placeholder scan:** no TBD/TODO left in any task; every step has runnable code.
- **Type consistency:** `Analytics.engagementRateByReach`/`saves`/`watchTimeSeconds`/`followerGrowthRate`/`ctr` (Task 3) used identically in Tasks 4, 5, 7, 8. `HistoricalPerformanceService.record(category, engagementRateByReach)` signature (Task 7) matches its Task 8 call site. `PriorityScorer.score(engagement, category)` (Task 9) matches `Router`'s call site.
