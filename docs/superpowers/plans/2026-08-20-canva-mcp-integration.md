# Canva MCP Carousel Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Canva-rendered carousel path, selected via `content_format: "carousel_canva"` in `platform-router`, that produces a standard `ContentArtifact` after a human edits/approves the design in Canva via Telegram.

**Architecture:** `content_format` (already the mechanism `platform-router` uses to pick a downstream generator) gets a new value, `carousel_canva`. A new service, `canva-connector`, consumes the same `jobs.routed` BullMQ queue as `carousel-studio`, filters for `content_format === 'carousel_canva'`, creates a Canva design via the Canva Connect REST API, and messages a Telegram bot with an edit link. On `/approve`, it exports the design, downloads the images, builds a `ContentArtifact`, and pushes it to the existing `artifacts.ready` queue — same contract, same queue, as every other path.

**Tech Stack:** TypeScript, Node >=20 (native `fetch`), BullMQ + ioredis, zod, Jest, `node-telegram-bot-api` (already used in `postiz-app` for the same purpose — reuse it).

**Spec:** `docs/superpowers/specs/2026-08-20-canva-mcp-integration-design.md` (this repo, `platform-router`).

## Global Constraints

- `content_artifact` schema is exactly `infra-social/contracts/src/content_artifact.ts` — do not add fields. `type` must be `'carousel'` (no new `canva_design` variant — that idea from an earlier draft of the spec is superseded; the real `ContentArtifact.type` enum is fixed and this plan does not touch it).
- `RoutedJob` payload on the `jobs.routed` queue is the full `@brand-os/contracts` `RoutedJob` object (verified in `platform-router/src/bus.ts`), not a flattened event — `canva-connector` consumes it as-is.
- No fallback to Carousel Studio on Canva failure (per spec's "Manejo de errores" — content isn't 1:1 interchangeable).
- No polling for "design finished" — human confirms explicitly via Telegram `/approve` (per spec).
- Reuse `node-telegram-bot-api` (already a dependency in `postiz-app/package.json`) rather than adding a different Telegram library.
- All new/changed contract fields must round-trip through zod schemas — every `@brand-os/contracts` type has a matching `*.zod.ts` schema; keep that pairing.

---

### Task 1: Add `carousel_canva` to the `ContentFormat` contract

**Files:**
- Modify: `infra-social/contracts/src/routed_job.ts`
- Modify: `infra-social/contracts/src/schemas/routed_job.zod.ts`
- Test: `infra-social/contracts/tests/routed_job.test.ts`

**Interfaces:**
- Produces: `ContentFormat` union now includes `'carousel_canva'`; `RoutedJobSchema` accepts it.

- [ ] **Step 1: Write the failing test**

Add to `infra-social/contracts/tests/routed_job.test.ts` (inside the existing `describe('RoutedJobSchema', ...)` block, after the `'accepts content_format voice_memo'` test):

```ts
  it('accepts content_format carousel_canva', () => {
    expect(RoutedJobSchema.parse({ ...valid, content_format: 'carousel_canva' })).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `infra-social/contracts/`): `npx vitest run tests/routed_job.test.ts`
Expected: FAIL — `content_format: 'carousel_canva'` rejected by the current enum.

- [ ] **Step 3: Update the type and schema**

In `infra-social/contracts/src/routed_job.ts`, change:

```ts
export type ContentFormat =
  | 'carousel'
  | 'short_video'
  | 'long_video'
  | 'thread'
  | 'note'
  | 'audio_note'
  | 'broadcast'
  | 'voice_memo';
```

to:

```ts
export type ContentFormat =
  | 'carousel'
  | 'carousel_canva'
  | 'short_video'
  | 'long_video'
  | 'thread'
  | 'note'
  | 'audio_note'
  | 'broadcast'
  | 'voice_memo';
```

In `infra-social/contracts/src/schemas/routed_job.zod.ts`, change:

```ts
  content_format: z.enum(['carousel', 'short_video', 'long_video', 'thread', 'note', 'audio_note', 'broadcast', 'voice_memo']),
```

to:

```ts
  content_format: z.enum(['carousel', 'carousel_canva', 'short_video', 'long_video', 'thread', 'note', 'audio_note', 'broadcast', 'voice_memo']),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/routed_job.test.ts`
Expected: PASS (all cases, including the new one).

- [ ] **Step 5: Build the package so file-linked consumers pick up the new type**

Run: `npm run build` (from `infra-social/contracts/`)

- [ ] **Step 6: Commit**

```bash
cd /Users/jeanhrdz/BrandOss/infra-social/contracts
git add src/routed_job.ts src/schemas/routed_job.zod.ts tests/routed_job.test.ts dist/
git commit -m "feat: add carousel_canva content_format"
```

---

### Task 2: Route a category to the Canva path via `formats.yaml`

**Files:**
- Modify: `platform-router/src/rules/formats.yaml`
- Test: `platform-router/tests/router.test.ts`

**Interfaces:**
- Consumes: `ContentFormat` from Task 1 (`carousel_canva` now valid).
- Produces: `Router.route()` emits a `RoutedJob` with `content_format: 'carousel_canva'` for `category: 'meta'`, `platform: 'linkedin'`.

`platform-router`'s `Router` (`src/router.ts:54`) already reads whatever string is in `formats.yaml` — no code change needed there, only config + a regression test.

- [ ] **Step 1: Read the existing router test file to match its fixture style**

Run: `sed -n '1,40p' platform-router/tests/router.test.ts` to confirm the `ClusterReport` fixture shape used there (mirrors `tests/bus.test.ts`'s `makeReport()`).

- [ ] **Step 2: Write the failing test**

Add to `platform-router/tests/router.test.ts`:

```ts
  it('routes meta/linkedin to carousel_canva per formats.yaml override', async () => {
    const report = makeReport({ category: 'meta', platform_flags: { ...baseFlags, linkedin: true } });
    const router = new Router();
    const jobs = await router.route(report);
    const linkedinJob = jobs.find((j) => j.target_platform === 'linkedin');
    expect(linkedinJob?.content_format).toBe('carousel_canva');
  });
```

(Adjust to whatever local helper names — `makeReport`/`baseFlags` — the existing file already defines; do not invent new ones if equivalents exist.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- router.test.ts`
Expected: FAIL — `formats.yaml` has no `meta` override yet, so `content_format` falls back to default (`carousel`).

- [ ] **Step 4: Add the config override**

In `platform-router/src/rules/formats.yaml`, add a new top-level section (after `local_services:`):

```yaml
meta:
  linkedin: carousel_canva
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- router.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/rules/formats.yaml tests/router.test.ts
git commit -m "feat: route meta/linkedin carousels through Canva path"
```

---

### Task 3: `canva-connector` scaffold + Canva Connect API client

**Files:**
- Create: `canva-connector/package.json`
- Create: `canva-connector/tsconfig.json`
- Create: `canva-connector/jest.config.js`
- Create: `canva-connector/src/canva/client.ts`
- Test: `canva-connector/tests/canva-client.test.ts`

**Interfaces:**
- Produces:
  - `class CanvaClient { constructor(opts: { baseUrl: string; accessToken: string }); createFromTemplate(brandTemplateId: string, autofillData: Record<string, { type: 'text'; text: string }>): Promise<{ designId: string; editUrl: string }>; exportDesign(designId: string): Promise<string[]> }`

- [ ] **Step 1: Scaffold `package.json`**

```json
{
  "name": "canva-connector",
  "version": "1.0.0",
  "private": true,
  "description": "Optional Canva-rendered carousel path: creates a Canva design from routed_job data, waits for human edit + Telegram approval, exports and emits a ContentArtifact.",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "jest",
    "start": "node -r ts-node/register src/index.ts"
  },
  "dependencies": {
    "@brand-os/contracts": "file:../infra-social/contracts",
    "bullmq": "^5.80.2",
    "ioredis": "^5.10.1",
    "node-telegram-bot-api": "^0.66.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "@types/node-telegram-bot-api": "^0.64.7",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Scaffold `tsconfig.json`** (mirrors `carousel-studio/tsconfig.json` conventions)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Scaffold `jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
};
```

- [ ] **Step 4: Install dependencies**

Run: `cd canva-connector && npm install`

- [ ] **Step 5: Write the failing test for `createFromTemplate`**

Create `canva-connector/tests/canva-client.test.ts`:

```ts
import { CanvaClient } from '../src/canva/client';

describe('CanvaClient.createFromTemplate', () => {
  const client = new CanvaClient({ baseUrl: 'https://api.canva.com', accessToken: 'tok123' });

  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockReset();
  });

  it('posts autofill request and returns designId + editUrl', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        job: { id: 'job1', status: 'success', result: { design: { id: 'design1', urls: { edit_url: 'https://canva.com/design/design1/edit' } } } },
      }),
    });

    const result = await client.createFromTemplate('tmpl1', { headline: { type: 'text', text: 'Hello' } });

    expect(result).toEqual({ designId: 'design1', editUrl: 'https://canva.com/design/design1/edit' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.canva.com/rest/v1/autofills',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
      }),
    );
  });

  it('throws when the autofill job does not report success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ job: { id: 'job1', status: 'failed', error: { message: 'bad template' } } }),
    });

    await expect(client.createFromTemplate('tmpl1', {})).rejects.toThrow('bad template');
  });

  it('throws on non-ok HTTP response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });

    await expect(client.createFromTemplate('tmpl1', {})).rejects.toThrow('Canva autofill request failed: 401 Unauthorized');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- canva-client.test.ts`
Expected: FAIL — `src/canva/client.ts` doesn't exist yet.

- [ ] **Step 7: Implement `CanvaClient.createFromTemplate`**

Create `canva-connector/src/canva/client.ts`:

```ts
export interface CanvaAutofillField {
  type: 'text';
  text: string;
}

export interface CanvaClientOptions {
  baseUrl: string;
  accessToken: string;
}

export class CanvaClient {
  private baseUrl: string;
  private accessToken: string;

  constructor(opts: CanvaClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.accessToken = opts.accessToken;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  async createFromTemplate(
    brandTemplateId: string,
    autofillData: Record<string, CanvaAutofillField>,
  ): Promise<{ designId: string; editUrl: string }> {
    const res = await fetch(`${this.baseUrl}/rest/v1/autofills`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ brand_template_id: brandTemplateId, data: autofillData }),
    });

    if (!res.ok) {
      throw new Error(`Canva autofill request failed: ${res.status} ${res.statusText}`);
    }

    const body = await res.json();
    if (body.job.status !== 'success') {
      throw new Error(body.job.error?.message ?? `Canva autofill job did not succeed: status=${body.job.status}`);
    }

    return {
      designId: body.job.result.design.id,
      editUrl: body.job.result.design.urls.edit_url,
    };
  }

  async exportDesign(_designId: string): Promise<string[]> {
    throw new Error('not implemented yet');
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- canva-client.test.ts`
Expected: PASS for the three `createFromTemplate` tests.

- [ ] **Step 9: Write the failing test for `exportDesign`**

Append to `canva-connector/tests/canva-client.test.ts`:

```ts
describe('CanvaClient.exportDesign', () => {
  const client = new CanvaClient({ baseUrl: 'https://api.canva.com', accessToken: 'tok123' });

  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockReset();
  });

  it('posts export request and returns image URLs on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ job: { id: 'exp1', status: 'success', urls: ['https://export.canva.com/slide1.png', 'https://export.canva.com/slide2.png'] } }),
    });

    const urls = await client.exportDesign('design1');

    expect(urls).toEqual(['https://export.canva.com/slide1.png', 'https://export.canva.com/slide2.png']);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.canva.com/rest/v1/exports',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when export job fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ job: { id: 'exp1', status: 'failed', error: { message: 'export error' } } }),
    });

    await expect(client.exportDesign('design1')).rejects.toThrow('export error');
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npm test -- canva-client.test.ts`
Expected: FAIL — `exportDesign` currently throws `'not implemented yet'`.

- [ ] **Step 11: Implement `exportDesign`**

Replace the `exportDesign` method body in `canva-connector/src/canva/client.ts`:

```ts
  async exportDesign(designId: string): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/rest/v1/exports`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ design_id: designId, format: { type: 'png' } }),
    });

    if (!res.ok) {
      throw new Error(`Canva export request failed: ${res.status} ${res.statusText}`);
    }

    const body = await res.json();
    if (body.job.status !== 'success') {
      throw new Error(body.job.error?.message ?? `Canva export job did not succeed: status=${body.job.status}`);
    }

    return body.job.urls;
  }
```

- [ ] **Step 12: Run all client tests to verify they pass**

Run: `npm test -- canva-client.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 13: Commit**

```bash
cd /Users/jeanhrdz/BrandOss/canva-connector
git init -q
git add package.json tsconfig.json jest.config.js src/canva/client.ts tests/canva-client.test.ts
git commit -m "feat: scaffold canva-connector with Canva Connect API client"
```

(This is the first commit in this new repo — subsequent tasks assume `canva-connector/.git` exists.)

---

### Task 4: BullMQ worker — consume `jobs.routed`, filter, create Canva design, persist pending state

**Files:**
- Create: `canva-connector/src/state/pendingStore.ts`
- Create: `canva-connector/src/worker.ts`
- Test: `canva-connector/tests/pendingStore.test.ts`
- Test: `canva-connector/tests/worker.test.ts`

**Interfaces:**
- Consumes: `CanvaClient` from Task 3 (`createFromTemplate`, `exportDesign`).
- Consumes: `RoutedJob`, `TOPICS` from `@brand-os/contracts`.
- Produces:
  - `interface PendingCanvaJob { routedJobId: string; designId: string; editUrl: string; telegramChatId: number | null; routedJob: RoutedJob }`
  - `class PendingStore { constructor(redis: IORedis); save(entry: PendingCanvaJob): Promise<void>; get(routedJobId: string): Promise<PendingCanvaJob | null>; delete(routedJobId: string): Promise<void> }`
  - `class CanvaWorker { constructor(opts: { redisUrl: string; canvaClient: CanvaClient; brandTemplateId: string; onDesignCreated: (entry: PendingCanvaJob) => Promise<void> }); start(): void; shutdown(): Promise<void> }` — `onDesignCreated` is the hook Task 5's Telegram bot plugs into (keeps the worker ignorant of Telegram).

- [ ] **Step 1: Write the failing test for `PendingStore`**

Create `canva-connector/tests/pendingStore.test.ts`:

```ts
const mockHset = jest.fn();
const mockHget = jest.fn();
const mockHdel = jest.fn();
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
  hset: mockHset,
  hget: mockHget,
  hdel: mockHdel,
})));

import IORedis from 'ioredis';
import { PendingStore, type PendingCanvaJob } from '../src/state/pendingStore';

describe('PendingStore', () => {
  const redis = new IORedis();
  const store = new PendingStore(redis as never);

  const entry: PendingCanvaJob = {
    routedJobId: 'job1',
    designId: 'design1',
    editUrl: 'https://canva.com/design/design1/edit',
    telegramChatId: null,
    routedJob: { id: 'job1' } as never,
  };

  beforeEach(() => {
    mockHset.mockReset();
    mockHget.mockReset();
    mockHdel.mockReset();
  });

  it('save() writes a JSON-serialized entry under the routedJobId key', async () => {
    await store.save(entry);
    expect(mockHset).toHaveBeenCalledWith('canva:pending', 'job1', JSON.stringify(entry));
  });

  it('get() returns the parsed entry when present', async () => {
    mockHget.mockResolvedValue(JSON.stringify(entry));
    const result = await store.get('job1');
    expect(result).toEqual(entry);
  });

  it('get() returns null when absent', async () => {
    mockHget.mockResolvedValue(null);
    const result = await store.get('missing');
    expect(result).toBeNull();
  });

  it('delete() removes the entry', async () => {
    await store.delete('job1');
    expect(mockHdel).toHaveBeenCalledWith('canva:pending', 'job1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pendingStore.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `PendingStore`**

Create `canva-connector/src/state/pendingStore.ts`:

```ts
import type IORedis from 'ioredis';
import type { RoutedJob } from '@brand-os/contracts';

const REDIS_KEY = 'canva:pending';

export interface PendingCanvaJob {
  routedJobId: string;
  designId: string;
  editUrl: string;
  telegramChatId: number | null;
  routedJob: RoutedJob;
}

export class PendingStore {
  constructor(private redis: IORedis) {}

  async save(entry: PendingCanvaJob): Promise<void> {
    await this.redis.hset(REDIS_KEY, entry.routedJobId, JSON.stringify(entry));
  }

  async get(routedJobId: string): Promise<PendingCanvaJob | null> {
    const raw = await this.redis.hget(REDIS_KEY, routedJobId);
    return raw ? (JSON.parse(raw) as PendingCanvaJob) : null;
  }

  async delete(routedJobId: string): Promise<void> {
    await this.redis.hdel(REDIS_KEY, routedJobId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pendingStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `CanvaWorker`**

Create `canva-connector/tests/worker.test.ts` (mirrors `platform-router/tests/bus.test.ts`'s mocking style):

```ts
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerOn = jest.fn();
const mockWorkerCtor = jest.fn().mockImplementation(() => ({ close: mockWorkerClose, on: mockWorkerOn }));
jest.mock('bullmq', () => ({ Worker: mockWorkerCtor }));

const mockDisconnect = jest.fn();
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ disconnect: mockDisconnect })));

const mockSave = jest.fn();
jest.mock('../src/state/pendingStore', () => ({
  PendingStore: jest.fn().mockImplementation(() => ({ save: mockSave })),
}));

import { CanvaWorker } from '../src/worker';
import { TOPICS, type RoutedJob } from '@brand-os/contracts';

function makeJob(contentFormat: string): RoutedJob {
  return {
    id: 'job1',
    cluster_report: {
      id: 'c1', cluster_label: 'l', category: 'meta', signal_ids: [],
      key_insights: ['insight one'],
      hooks: { pain_point: 'p', agitate: 'a', solution: 's', hot_take: 'h' },
      data_points: [],
      platform_flags: { instagram: false, linkedin: true, youtube: false, x: false, tiktok: false, douyin: false, rednote: false, whatsapp: false, whatsapp_status: false },
      speculative_edges: [], graph_svg_url: null, generated_at: '2026-08-20T00:00:00.000Z',
    },
    target_platform: 'linkedin',
    content_format: contentFormat as never,
    priority: 5,
    ab_variant: null,
    created_at: '2026-08-20T00:00:00.000Z',
  };
}

describe('CanvaWorker', () => {
  const canvaClient = { createFromTemplate: jest.fn(), exportDesign: jest.fn() };
  const onDesignCreated = jest.fn();

  beforeEach(() => {
    mockWorkerCtor.mockClear();
    mockSave.mockReset();
    canvaClient.createFromTemplate.mockReset();
    onDesignCreated.mockReset();
  });

  it('starts a worker on the jobs.routed queue', () => {
    const worker = new CanvaWorker({ redisUrl: 'redis://mock', canvaClient: canvaClient as never, brandTemplateId: 'tmpl1', onDesignCreated });
    worker.start();
    expect(mockWorkerCtor).toHaveBeenCalledWith(TOPICS.JOBS_ROUTED, expect.any(Function), expect.any(Object));
  });

  it('ignores jobs whose content_format is not carousel_canva', async () => {
    const worker = new CanvaWorker({ redisUrl: 'redis://mock', canvaClient: canvaClient as never, brandTemplateId: 'tmpl1', onDesignCreated });
    worker.start();
    const handler = mockWorkerCtor.mock.calls[0]![1] as (job: { data: RoutedJob }) => Promise<void>;
    await handler({ data: makeJob('carousel') });
    expect(canvaClient.createFromTemplate).not.toHaveBeenCalled();
  });

  it('creates a Canva design, saves pending state, and calls onDesignCreated for matching jobs', async () => {
    canvaClient.createFromTemplate.mockResolvedValue({ designId: 'design1', editUrl: 'https://canva.com/design/design1/edit' });
    const worker = new CanvaWorker({ redisUrl: 'redis://mock', canvaClient: canvaClient as never, brandTemplateId: 'tmpl1', onDesignCreated });
    worker.start();
    const handler = mockWorkerCtor.mock.calls[0]![1] as (job: { data: RoutedJob }) => Promise<void>;
    const routedJob = makeJob('carousel_canva');

    await handler({ data: routedJob });

    expect(canvaClient.createFromTemplate).toHaveBeenCalledWith('tmpl1', expect.objectContaining({
      hot_take: { type: 'text', text: 'h' },
    }));
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      routedJobId: 'job1', designId: 'design1', editUrl: 'https://canva.com/design/design1/edit', telegramChatId: null,
    }));
    expect(onDesignCreated).toHaveBeenCalledWith(expect.objectContaining({ routedJobId: 'job1', designId: 'design1' }));
  });

  it('shutdown() closes the worker and redis connection', async () => {
    const worker = new CanvaWorker({ redisUrl: 'redis://mock', canvaClient: canvaClient as never, brandTemplateId: 'tmpl1', onDesignCreated });
    worker.start();
    await worker.shutdown();
    expect(mockWorkerClose).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- worker.test.ts`
Expected: FAIL — `src/worker.ts` doesn't exist.

- [ ] **Step 7: Implement `CanvaWorker`**

Create `canva-connector/src/worker.ts`:

```ts
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { TOPICS, type RoutedJob } from '@brand-os/contracts';
import { PendingStore, type PendingCanvaJob } from './state/pendingStore';
import type { CanvaClient, CanvaAutofillField } from './canva/client';

export interface CanvaWorkerOptions {
  redisUrl: string;
  canvaClient: CanvaClient;
  brandTemplateId: string;
  onDesignCreated: (entry: PendingCanvaJob) => Promise<void>;
}

function toAutofillData(job: RoutedJob): Record<string, CanvaAutofillField> {
  const { hooks, key_insights, cluster_label } = job.cluster_report;
  return {
    cluster_label: { type: 'text', text: cluster_label },
    pain_point: { type: 'text', text: hooks.pain_point },
    agitate: { type: 'text', text: hooks.agitate },
    solution: { type: 'text', text: hooks.solution },
    hot_take: { type: 'text', text: hooks.hot_take },
    key_insight_1: { type: 'text', text: key_insights[0] ?? '' },
  };
}

export class CanvaWorker {
  private connection: IORedis;
  private worker: Worker | null = null;
  private store: PendingStore;

  constructor(private opts: CanvaWorkerOptions) {
    this.connection = new IORedis(opts.redisUrl, { maxRetriesPerRequest: null });
    this.store = new PendingStore(this.connection);
  }

  start(): void {
    this.worker = new Worker(
      TOPICS.JOBS_ROUTED,
      (job: Job) => this.process(job.data as RoutedJob),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, err) => {
      console.error(`[canva-worker] job failed id=${job?.id ?? 'unknown'} error=${err.message}`);
    });
  }

  async process(routedJob: RoutedJob): Promise<void> {
    if (routedJob.content_format !== 'carousel_canva') {
      return;
    }

    const { designId, editUrl } = await this.opts.canvaClient.createFromTemplate(
      this.opts.brandTemplateId,
      toAutofillData(routedJob),
    );

    const entry: PendingCanvaJob = {
      routedJobId: routedJob.id,
      designId,
      editUrl,
      telegramChatId: null,
      routedJob,
    };

    await this.store.save(entry);
    await this.opts.onDesignCreated(entry);
  }

  async shutdown(): Promise<void> {
    if (this.worker !== null) {
      await this.worker.close();
    }
    this.connection.disconnect();
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- worker.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 9: Commit**

```bash
git add src/state/pendingStore.ts src/worker.ts tests/pendingStore.test.ts tests/worker.test.ts
git commit -m "feat: consume jobs.routed, create Canva design, persist pending state"
```

---

### Task 5: Telegram bot — send edit link, `/approve` with confirmation, export → build `ContentArtifact` → publish

**Files:**
- Create: `canva-connector/src/artifact/buildArtifact.ts`
- Create: `canva-connector/src/telegram/bot.ts`
- Test: `canva-connector/tests/buildArtifact.test.ts`
- Test: `canva-connector/tests/telegram-bot.test.ts`

**Interfaces:**
- Consumes: `PendingCanvaJob` from Task 4, `CanvaClient.exportDesign` from Task 3, `ContentArtifact`/`ContentArtifactSchema`/`TOPICS` from `@brand-os/contracts`.
- Produces:
  - `function buildContentArtifact(routedJob: RoutedJob, imagePaths: string[]): ContentArtifact`
  - `class CanvaTelegramBot { constructor(opts: { token: string; pendingStore: PendingStore; canvaClient: CanvaClient; artifactsQueue: Queue; downloadImages: (urls: string[], designId: string) => Promise<string[]> }); notifyDesignReady(entry: PendingCanvaJob, chatId: number): Promise<void>; handleApprove(chatId: number, routedJobId: string, confirmed: boolean): Promise<void> }`

- [ ] **Step 1: Write the failing test for `buildContentArtifact`**

Create `canva-connector/tests/buildArtifact.test.ts`:

```ts
import { buildContentArtifact } from '../src/artifact/buildArtifact';
import { ContentArtifactSchema, type RoutedJob } from '@brand-os/contracts';

function makeRoutedJob(): RoutedJob {
  return {
    id: 'job1',
    cluster_report: {
      id: 'c1', cluster_label: 'AI agents in CDMX', category: 'meta', signal_ids: [],
      key_insights: ['insight one'],
      hooks: { pain_point: 'p', agitate: 'a', solution: 's', hot_take: 'Robots are coming' },
      data_points: [],
      platform_flags: { instagram: false, linkedin: true, youtube: false, x: false, tiktok: false, douyin: false, rednote: false, whatsapp: false, whatsapp_status: false },
      speculative_edges: [], graph_svg_url: null, generated_at: '2026-08-20T00:00:00.000Z',
    },
    target_platform: 'linkedin',
    content_format: 'carousel_canva',
    priority: 5,
    ab_variant: null,
    created_at: '2026-08-20T00:00:00.000Z',
  };
}

describe('buildContentArtifact', () => {
  it('builds a valid ContentArtifact from a routed job and local image paths', () => {
    const artifact = buildContentArtifact(makeRoutedJob(), ['/out/canva_design1/slide_01.png', '/out/canva_design1/slide_02.png']);

    expect(() => ContentArtifactSchema.parse(artifact)).not.toThrow();
    expect(artifact.routed_job_id).toBe('job1');
    expect(artifact.type).toBe('carousel');
    expect(artifact.platform).toBe('linkedin');
    expect(artifact.files).toEqual([
      { path: '/out/canva_design1/slide_01.png', mime: 'image/png' },
      { path: '/out/canva_design1/slide_02.png', mime: 'image/png' },
    ]);
    expect(artifact.caption).toBe('Robots are coming');
    expect(artifact.status).toBe('draft');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- buildArtifact.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `buildContentArtifact`**

Create `canva-connector/src/artifact/buildArtifact.ts`:

```ts
import * as crypto from 'node:crypto';
import type { ContentArtifact, RoutedJob } from '@brand-os/contracts';

export function buildContentArtifact(routedJob: RoutedJob, imagePaths: string[]): ContentArtifact {
  return {
    id: crypto.randomUUID(),
    routed_job_id: routedJob.id,
    type: 'carousel',
    platform: routedJob.target_platform,
    files: imagePaths.map((path) => ({ path, mime: 'image/png' })),
    caption: routedJob.cluster_report.hooks.hot_take,
    hashtags: [],
    scheduled_at: null,
    status: 'draft',
    review: { agent_inbox_id: null, approved_by: null, approved_at: null, edits: null },
    analytics: { views: null, engagement: null, collected_at: null },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- buildArtifact.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `CanvaTelegramBot`**

Create `canva-connector/tests/telegram-bot.test.ts`:

```ts
const mockSendMessage = jest.fn();
const mockOnText = jest.fn();
jest.mock('node-telegram-bot-api', () => jest.fn().mockImplementation(() => ({
  sendMessage: mockSendMessage,
  onText: mockOnText,
})));

import { CanvaTelegramBot } from '../src/telegram/bot';
import type { PendingCanvaJob } from '../src/state/pendingStore';
import type { RoutedJob } from '@brand-os/contracts';

function makeEntry(): PendingCanvaJob {
  return {
    routedJobId: 'job1',
    designId: 'design1',
    editUrl: 'https://canva.com/design/design1/edit',
    telegramChatId: null,
    routedJob: {
      id: 'job1',
      cluster_report: {
        id: 'c1', cluster_label: 'l', category: 'meta', signal_ids: [], key_insights: [],
        hooks: { pain_point: 'p', agitate: 'a', solution: 's', hot_take: 'Robots are coming' },
        data_points: [], platform_flags: { instagram: false, linkedin: true, youtube: false, x: false, tiktok: false, douyin: false, rednote: false, whatsapp: false, whatsapp_status: false },
        speculative_edges: [], graph_svg_url: null, generated_at: '2026-08-20T00:00:00.000Z',
      },
      target_platform: 'linkedin', content_format: 'carousel_canva', priority: 5, ab_variant: null, created_at: '2026-08-20T00:00:00.000Z',
    } as RoutedJob,
  };
}

describe('CanvaTelegramBot', () => {
  const pendingStore = { get: jest.fn(), save: jest.fn(), delete: jest.fn() };
  const canvaClient = { createFromTemplate: jest.fn(), exportDesign: jest.fn() };
  const artifactsQueue = { add: jest.fn() };
  const downloadImages = jest.fn();

  function makeBot() {
    return new CanvaTelegramBot({
      token: 'tok',
      pendingStore: pendingStore as never,
      canvaClient: canvaClient as never,
      artifactsQueue: artifactsQueue as never,
      downloadImages,
    });
  }

  beforeEach(() => {
    pendingStore.get.mockReset();
    pendingStore.save.mockReset();
    pendingStore.delete.mockReset();
    canvaClient.exportDesign.mockReset();
    artifactsQueue.add.mockReset();
    downloadImages.mockReset();
    mockSendMessage.mockReset();
    mockOnText.mockReset();
  });

  it('notifyDesignReady sends the edit_url and records the chat id', async () => {
    const bot = makeBot();
    const entry = makeEntry();

    await bot.notifyDesignReady(entry, 42);

    expect(mockSendMessage).toHaveBeenCalledWith(42, expect.stringContaining(entry.editUrl));
    expect(pendingStore.save).toHaveBeenCalledWith(expect.objectContaining({ ...entry, telegramChatId: 42 }));
  });

  it('registers an /approve handler that asks for confirmation when "confirm" is missing', () => {
    makeBot();
    const [, handler] = mockOnText.mock.calls[0]!;
    handler({ chat: { id: 42 } }, ['/approve job1', 'job1', undefined]);
    expect(mockSendMessage).toHaveBeenCalledWith(42, expect.stringContaining('/approve job1 confirm'));
  });

  it('registers an /approve handler that calls handleApprove when "confirm" is present', async () => {
    const entry = makeEntry();
    pendingStore.get.mockResolvedValue(entry);
    canvaClient.exportDesign.mockResolvedValue(['https://export.canva.com/s1.png']);
    downloadImages.mockResolvedValue(['/out/canva_design1/slide_01.png']);

    makeBot();
    const [, handler] = mockOnText.mock.calls[0]!;
    await handler({ chat: { id: 42 } }, ['/approve job1 confirm', 'job1', ' confirm']);

    expect(canvaClient.exportDesign).toHaveBeenCalledWith('design1');
    expect(artifactsQueue.add).toHaveBeenCalled();
  });

  it('handleApprove without confirmation does nothing', async () => {
    const bot = makeBot();
    await bot.handleApprove(42, 'job1', false);
    expect(pendingStore.get).not.toHaveBeenCalled();
    expect(canvaClient.exportDesign).not.toHaveBeenCalled();
  });

  it('handleApprove with confirmation exports, downloads, builds artifact, publishes, and clears pending state', async () => {
    const entry = makeEntry();
    pendingStore.get.mockResolvedValue(entry);
    canvaClient.exportDesign.mockResolvedValue(['https://export.canva.com/s1.png']);
    downloadImages.mockResolvedValue(['/out/canva_design1/slide_01.png']);

    const bot = makeBot();
    await bot.handleApprove(42, 'job1', true);

    expect(canvaClient.exportDesign).toHaveBeenCalledWith('design1');
    expect(downloadImages).toHaveBeenCalledWith(['https://export.canva.com/s1.png'], 'design1');
    expect(artifactsQueue.add).toHaveBeenCalledWith(
      'content_artifact',
      expect.objectContaining({ routed_job_id: 'job1', type: 'carousel', files: [{ path: '/out/canva_design1/slide_01.png', mime: 'image/png' }] }),
    );
    expect(pendingStore.delete).toHaveBeenCalledWith('job1');
  });

  it('handleApprove for unknown routedJobId does nothing', async () => {
    pendingStore.get.mockResolvedValue(null);
    const bot = makeBot();
    await bot.handleApprove(42, 'missing', true);
    expect(canvaClient.exportDesign).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- telegram-bot.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Implement `CanvaTelegramBot`**

Create `canva-connector/src/telegram/bot.ts`:

```ts
import TelegramBot from 'node-telegram-bot-api';
import type { Queue } from 'bullmq';
import { TOPICS } from '@brand-os/contracts';
import type { PendingStore, PendingCanvaJob } from '../state/pendingStore';
import type { CanvaClient } from '../canva/client';
import { buildContentArtifact } from '../artifact/buildArtifact';

export interface CanvaTelegramBotOptions {
  token: string;
  pendingStore: PendingStore;
  canvaClient: CanvaClient;
  artifactsQueue: Queue;
  downloadImages: (urls: string[], designId: string) => Promise<string[]>;
}

export class CanvaTelegramBot {
  private bot: TelegramBot;

  constructor(private opts: CanvaTelegramBotOptions) {
    this.bot = new TelegramBot(opts.token, { polling: true });
    this.bot.onText(/^\/approve (\S+)( confirm)?$/, (msg, match) => {
      const routedJobId = match?.[1];
      const confirmed = Boolean(match?.[2]);
      if (!routedJobId) {
        return;
      }
      if (!confirmed) {
        void this.bot.sendMessage(msg.chat.id, `¿Ya terminaste de editar en Canva? Si sí, mandá: /approve ${routedJobId} confirm`);
        return;
      }
      void this.handleApprove(msg.chat.id, routedJobId, true);
    });
  }

  async notifyDesignReady(entry: PendingCanvaJob, chatId: number): Promise<void> {
    await this.bot.sendMessage(
      chatId,
      `Diseño Canva listo para editar: ${entry.editUrl}\n\nCuando termines, mandá /approve ${entry.routedJobId}`,
    );
    await this.opts.pendingStore.save({ ...entry, telegramChatId: chatId });
  }

  async handleApprove(chatId: number, routedJobId: string, confirmed: boolean): Promise<void> {
    if (!confirmed) {
      return;
    }

    const entry = await this.opts.pendingStore.get(routedJobId);
    if (!entry) {
      return;
    }

    const exportUrls = await this.opts.canvaClient.exportDesign(entry.designId);
    const imagePaths = await this.opts.downloadImages(exportUrls, entry.designId);
    const artifact = buildContentArtifact(entry.routedJob, imagePaths);

    await this.opts.artifactsQueue.add('content_artifact', artifact);
    await this.opts.pendingStore.delete(routedJobId);
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- telegram-bot.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 9: Commit**

```bash
git add src/artifact/buildArtifact.ts src/telegram/bot.ts tests/buildArtifact.test.ts tests/telegram-bot.test.ts
git commit -m "feat: Telegram approve flow — export, build artifact, publish to artifacts.ready"
```

---

### Task 6: Bootstrap, image download helper, env config, setup docs

**Files:**
- Create: `canva-connector/src/download/downloadImages.ts`
- Create: `canva-connector/src/index.ts`
- Create: `canva-connector/.env.example`
- Create: `canva-connector/README.md`
- Test: `canva-connector/tests/downloadImages.test.ts`

**Interfaces:**
- Produces: `function downloadImages(urls: string[], designId: string): Promise<string[]>` — the concrete implementation passed as `CanvaTelegramBot`'s `downloadImages` option in `index.ts`.

- [ ] **Step 1: Write the failing test for `downloadImages`**

Create `canva-connector/tests/downloadImages.test.ts`:

```ts
import * as fs from 'node:fs/promises';
import { downloadImages } from '../src/download/downloadImages';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

describe('downloadImages', () => {
  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockReset();
    (fs.mkdir as jest.Mock).mockClear();
    (fs.writeFile as jest.Mock).mockClear();
  });

  it('downloads each URL and writes numbered PNGs under output/canva_<designId>/', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });

    const paths = await downloadImages(['https://export.canva.com/a.png', 'https://export.canva.com/b.png'], 'design1');

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('canva_design1'), { recursive: true });
    expect(paths).toEqual([
      expect.stringContaining('canva_design1/slide_01.png'),
      expect.stringContaining('canva_design1/slide_02.png'),
    ]);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  it('throws if a download fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
    await expect(downloadImages(['https://export.canva.com/a.png'], 'design1')).rejects.toThrow('Failed to download image: 404 Not Found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- downloadImages.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `downloadImages`**

Create `canva-connector/src/download/downloadImages.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function downloadImages(urls: string[], designId: string): Promise<string[]> {
  const outputDir = path.join(process.cwd(), 'output', `canva_${designId}`);
  await fs.mkdir(outputDir, { recursive: true });

  const paths: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const res = await fetch(urls[i]!);
    if (!res.ok) {
      throw new Error(`Failed to download image: ${res.status} ${res.statusText}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const outputPath = path.join(outputDir, `slide_${String(i + 1).padStart(2, '0')}.png`);
    await fs.writeFile(outputPath, buffer);
    paths.push(outputPath);
  }
  return paths;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- downloadImages.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the bootstrap entrypoint**

Create `canva-connector/src/index.ts`:

```ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { TOPICS } from '@brand-os/contracts';
import { CanvaClient } from './canva/client';
import { CanvaWorker } from './worker';
import { CanvaTelegramBot } from './telegram/bot';
import { PendingStore } from './state/pendingStore';
import { downloadImages } from './download/downloadImages';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function bootstrap() {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const canvaClient = new CanvaClient({
    baseUrl: process.env.CANVA_API_BASE_URL ?? 'https://api.canva.com',
    accessToken: requiredEnv('CANVA_ACCESS_TOKEN'),
  });

  const pendingStore = new PendingStore(connection);
  const artifactsQueue = new Queue(TOPICS.ARTIFACTS_READY, { connection });

  const telegramBot = new CanvaTelegramBot({
    token: requiredEnv('TELEGRAM_BOT_TOKEN'),
    pendingStore,
    canvaClient,
    artifactsQueue,
    downloadImages,
  });

  const reviewChatId = Number(requiredEnv('TELEGRAM_REVIEW_CHAT_ID'));

  const worker = new CanvaWorker({
    redisUrl,
    canvaClient,
    brandTemplateId: requiredEnv('CANVA_BRAND_TEMPLATE_ID'),
    onDesignCreated: (entry) => telegramBot.notifyDesignReady(entry, reviewChatId),
  });

  worker.start();
  return { worker, telegramBot };
}

if (require.main === module) {
  bootstrap();
}
```

- [ ] **Step 6: Create `.env.example`**

```
REDIS_URL=redis://localhost:6379
CANVA_API_BASE_URL=https://api.canva.com
CANVA_ACCESS_TOKEN=
CANVA_BRAND_TEMPLATE_ID=
TELEGRAM_BOT_TOKEN=
TELEGRAM_REVIEW_CHAT_ID=
```

- [ ] **Step 7: Write `README.md` setup instructions**

```markdown
# canva-connector

Optional Canva-rendered carousel path for the Brand OS pipeline. Consumes
`jobs.routed` (BullMQ), filters `content_format === 'carousel_canva'`,
creates a Canva design from a Brand Template, notifies a reviewer on
Telegram with an edit link, and on `/approve <routed_job_id>` exports the
design and publishes a standard `ContentArtifact` to `artifacts.ready`.

See `docs/superpowers/specs/2026-08-20-canva-mcp-integration-design.md`
in `platform-router` for the full design.

## Setup

1. Register an app in the [Canva Connect API developer portal](https://www.canva.com/developers/) and note the access token (OAuth flow / refresh token management is out of scope for this service's first slice — a long-lived token is acceptable to start).
2. Create at least one Brand Template in Canva with text placeholders named: `cluster_label`, `pain_point`, `agitate`, `solution`, `hot_take`, `key_insight_1`. Note its template ID.
3. Create a Telegram bot via [@BotFather](https://t.me/BotFather), note the token.
4. Get the chat ID that should receive review messages (send the bot a message, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`).
5. Copy `.env.example` to `.env` and fill in `CANVA_ACCESS_TOKEN`, `CANVA_BRAND_TEMPLATE_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_REVIEW_CHAT_ID`.
6. In `platform-router/src/rules/formats.yaml`, route a category/platform pair to `carousel_canva` (already done for `meta`/`linkedin` — add more as needed).
7. `npm install && npm run build && npm start`.
```

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS, all tests across `canva-client`, `pendingStore`, `worker`, `buildArtifact`, `telegram-bot`, `downloadImages`.

- [ ] **Step 9: Commit**

```bash
git add src/download/downloadImages.ts src/index.ts .env.example README.md tests/downloadImages.test.ts
git commit -m "feat: wire bootstrap entrypoint, image download, and setup docs"
```

---

## Manual verification (not automated — requires real Canva/Telegram credentials)

After Task 6, with real credentials in `.env`:

1. Publish a `cluster_report` with `category: 'meta'` onto `clusters.reports` (or run `platform-router` against a fixture) so it reaches `jobs.routed` with `content_format: 'carousel_canva'` for `linkedin`.
2. Confirm `canva-connector` creates a Canva design and the configured Telegram chat receives the edit link.
3. Open the edit link, make a change in Canva.
4. Send `/approve <routed_job_id>` — bot asks to confirm; send `/approve <routed_job_id> confirm`.
5. Confirm images land in `canva-connector/output/canva_<designId>/` and a `content_artifact` message appears on the `artifacts.ready` queue (`redis-cli xrange` or a BullMQ inspector).
