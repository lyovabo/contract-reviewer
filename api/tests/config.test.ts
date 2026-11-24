import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG_FILE, configFileFromEnv, loadConfig, parseConfig } from '../src/config';
import { ALL_DOCS, DEADLINE, DOC, LAWYER, LIMIT, T0, TEST_CONFIG, scriptedRng, setup } from './helpers';

const FAKE = TEST_CONFIG.fakeReviewer;

let ctx: ReturnType<typeof setup> | undefined;
let dir: string | undefined;
afterEach(() => {
  ctx?.server.close();
  ctx = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** TEST_CONFIG with one value changed, as plain JSON (so wrong types can be written too). */
function withChange(path: string, value: unknown): unknown {
  const copy = structuredClone(TEST_CONFIG) as unknown as Record<string, unknown>;
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce((node, key) => node[key] as Record<string, unknown>, copy);
  if (value === undefined) delete parent[last];
  else parent[last] = value;
  return copy;
}

describe('the settings file', () => {
  it('api/config.json is a valid settings file, and the tests run on its values', () => {
    expect(loadConfig(DEFAULT_CONFIG_FILE)).toEqual(TEST_CONFIG);
  });

  it('CONFIG_FILE picks another file', () => {
    expect(configFileFromEnv({})).toBe(DEFAULT_CONFIG_FILE);
    expect(configFileFromEnv({ CONFIG_FILE: '/srv/demo.json' })).toBe('/srv/demo.json');
  });

  it.each([
    ['reviewDeadlineMs', '60s', /reviewDeadlineMs must be a whole number from 1000 to 3600000 \(it is "60s"\)/],
    ['reviewDeadlineMs', 500, /reviewDeadlineMs must be a whole number from 1000 to 3600000/],
    ['reviewDeadlineMs', 2_147_483_648, /reviewDeadlineMs must be a whole number from 1000 to 3600000/],
    ['monthlyReviewLimit', 0, /monthlyReviewLimit must be a whole number of at least 1/],
    ['monthlyReviewLimit', 2.5, /monthlyReviewLimit/],
    ['sessionTtlMs', undefined, /sessionTtlMs must be a whole number from 3000 to 3600000 \(it is missing\)/],
    ['sessionTtlMs', 7_200_000, /sessionTtlMs must be a whole number from 3000 to 3600000/],
    ['reviewDeadlineMS', 60_000, /reviewDeadlineMS is not a setting/],
    ['fakeReviewer.speed', 2, /fakeReviewer\.speed is not a setting/],
    ['claudeReviewer.temperature', 0.5, /claudeReviewer\.temperature is not a setting/],
    ['fakeReviewer.normalMs.max', FAKE.normalMs.min - 1, new RegExp(`normalMs\\.max must be at least fakeReviewer\\.normalMs\\.min \\(${FAKE.normalMs.min}\\)`)],
    ['fakeReviewer.normalMs.max', DEADLINE, new RegExp(`normalMs\\.max must be below reviewDeadlineMs \\(${DEADLINE}\\)`)],
    ['fakeReviewer.slowMs.min', DEADLINE - 1, new RegExp(`slowMs\\.min must be at least reviewDeadlineMs \\(${DEADLINE}\\), so slow runs time out`)],
    ['fakeReviewer.slowMs.max', 4_000_000, /fakeReviewer\.slowMs\.max must be a whole number from 0 to 3600000/],
    ['reviewDeadlineMs', FAKE.slowMs.min + 1, new RegExp(`slowMs\\.min must be at least reviewDeadlineMs \\(${FAKE.slowMs.min + 1}\\)`)],
    ['fakeReviewer.outcomePercent.slow', FAKE.outcomePercent.slow + 1, /fakeReviewer\.outcomePercent must add up to 100/],
    ['claudeReviewer.effort', 'extreme', /claudeReviewer\.effort must be one of low, medium, high, xhigh, max/],
    ['claudeReviewer.thinking', 'off', /claudeReviewer\.thinking must be true or false/],
    ['claudeReviewer.tokenBudget', 500, /claudeReviewer\.tokenBudget must be a whole number of at least 5000/],
    ['claudeReviewer.model', '', /claudeReviewer\.model must be a model name/],
    ['claudeReviewer.maxTurns', 0, /claudeReviewer\.maxTurns must be a whole number of at least 1/],
    ['claudeReviewer.maxOutputTokens', 500, /claudeReviewer\.maxOutputTokens must be a whole number of at least 1000/],
  ])('refuses %s = %j at startup, naming the setting', (path, value, message) => {
    expect(() => parseConfig(withChange(path, value), 'config.json')).toThrow(message);
  });

  it('a missing or broken file stops the API with the file’s name', () => {
    const folder = mkdtempSync(join(tmpdir(), 'contract-reviewer-config-'));
    dir = folder;
    const broken = join(folder, 'broken.json');
    writeFileSync(broken, '{ "reviewDeadlineMs": ');
    expect(() => loadConfig(broken)).toThrow(`Could not read the settings file ${broken}`);
    expect(() => loadConfig(join(folder, 'missing.json'))).toThrow(/Could not read the settings file .*missing\.json/);
  });
});

describe('the rules follow the settings', () => {
  it('a 20-second deadline: a finding at 19,999 ms is kept, one at 20,000 ms is discarded and the review times out', async () => {
    ctx = setup({ config: { reviewDeadlineMs: 20_000 } });
    const id = await ctx.startReview(DOC.nda);
    expect((await ctx.review(id)).deadlineAt).toBe(new Date(T0 + 20_000).toISOString());

    ctx.time.setNow(T0 + 19_999);
    ctx.reviewer.finding(id, 0);
    ctx.time.setNow(T0 + 20_000);
    ctx.reviewer.finding(id, 1);
    ctx.reviewer.complete(id);

    const review = await ctx.review(id);
    expect(review).toMatchObject({ status: 'failed', failureReason: 'timeout' });
    expect(review.findings).toHaveLength(1);
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 0 });
  });

  it('a 20-second deadline, at exactly 20 s and before the timer runs: the credit is free, a completion or failure is a timeout, a retry is admitted', async () => {
    ctx = setup({ config: { reviewDeadlineMs: 20_000 } });
    const failing = await ctx.startReview(DOC.nda);
    await ctx.startReview(DOC.msa);
    const completing = await ctx.startReview(DOC.leaseNew);

    ctx.time.setNow(T0 + 19_999);
    expect(await ctx.plan()).toMatchObject({ reserved: 3 });
    ctx.time.setNow(T0 + 20_000);
    expect(ctx.time.pendingTimers()).toBe(3); // no deadline timer has run
    expect(await ctx.plan()).toMatchObject({ reserved: 0, available: LIMIT });

    ctx.reviewer.complete(completing);
    expect(await ctx.review(completing)).toMatchObject({ status: 'failed', failureReason: 'timeout' });
    ctx.reviewer.fail(failing);
    expect(await ctx.review(failing)).toMatchObject({ status: 'failed', failureReason: 'timeout' });
    expect(await ctx.plan()).toMatchObject({ used: 0 });
    expect((await ctx.requestReview(DOC.msa)).status).toBe(201); // the overdue one is expired first
  });

  it('a 20-second deadline: a restart at 19,999 ms interrupts the review, at 20,000 ms it is a timeout', async () => {
    for (const [elapsed, reason] of [[19_999, 'interrupted'], [20_000, 'timeout']] as const) {
      dir = mkdtempSync(join(tmpdir(), 'contract-reviewer-config-'));
      const dbPath = join(dir, 'reviews.db');
      const before = setup({ dbPath, deadlineTimers: false, config: { reviewDeadlineMs: 20_000 } });
      const id = await before.startReview(DOC.nda);
      before.server.close();

      ctx = setup({ dbPath, startMs: T0 + elapsed, config: { reviewDeadlineMs: 20_000 } });
      expect(ctx.server.repo.getReview(id)).toMatchObject({ status: 'failed', failure_reason: reason });
      ctx.server.close();
      ctx = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a 20-second deadline: the timer stores the timeout at 20 s, not later', async () => {
    ctx = setup({ config: { reviewDeadlineMs: 20_000 } });
    const id = await ctx.startReview(DOC.nda);

    ctx.time.advanceTo(T0 + 19_999);
    expect(ctx.storedStatus(id)).toBe('in_progress');
    ctx.time.advanceTo(T0 + 20_000);
    expect(ctx.storedStatus(id)).toBe('failed');
  });

  it('each review keeps the deadline it was requested with: a new setting changes only new reviews', async () => {
    dir = mkdtempSync(join(tmpdir(), 'contract-reviewer-config-'));
    const dbPath = join(dir, 'reviews.db');
    const before = setup({ dbPath, deadlineTimers: false });
    const finished = await before.startReview(DOC.nda);
    before.reviewer.complete(finished);
    const running = await before.startReview(DOC.msa);
    before.server.close();

    // Restarted halfway through the deadline with one a third as long: the running review is still
    // inside its own deadline, so the restart interrupts it instead of timing it out.
    const restartAt = T0 + Math.floor(DEADLINE / 2);
    const shorter = Math.floor(DEADLINE / 3);
    ctx = setup({ dbPath, startMs: restartAt, config: { reviewDeadlineMs: shorter } });
    expect(await ctx.review(finished)).toMatchObject({ deadlineAt: new Date(T0 + DEADLINE).toISOString() });
    expect(await ctx.review(running)).toMatchObject({ status: 'failed', failureReason: 'interrupted' });

    const fresh = await ctx.startReview(DOC.leaseNew);
    expect(await ctx.review(fresh)).toMatchObject({ deadlineAt: new Date(restartAt + shorter).toISOString() });
  });

  it('a limit of 2 reviews a month: the third request is refused with plan_exhausted', async () => {
    ctx = setup({ config: { monthlyReviewLimit: 2 } });
    await ctx.completeReviews([ALL_DOCS[0]!, ALL_DOCS[1]!]);

    const refused = await ctx.requestReview(ALL_DOCS[2]!);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'plan_exhausted', plan: { limit: 2, used: 2, available: 0 } });
  });

  it('a 5-second session lifetime: the lawyer is in use until 5 s after the last heartbeat, then free to take', async () => {
    ctx = setup({ config: { sessionTtlMs: 5_000 } });
    const claim = () => ctx!.http.post('/api/sessions').send({ lawyerId: LAWYER.elena });
    const elenaInUse = async () =>
      (await ctx!.http.get('/api/lawyers')).body.find((l: { id: string }) => l.id === LAWYER.elena).inUse;
    const first = await claim();
    expect(first.body.ttlMs).toBe(5_000);
    const heartbeat = () => ctx!.http.put('/api/sessions/current').set('Authorization', `Bearer ${first.body.token}`);

    ctx.time.setNow(T0 + 4_999);
    expect(await elenaInUse()).toBe(true);
    expect((await claim()).status).toBe(409);
    expect((await heartbeat()).status).toBe(200); // live until 4,999 + 5,000 ms

    ctx.time.setNow(T0 + 4_999 + 5_000);
    expect((await heartbeat()).status).toBe(401); // too late: the session has ended
    expect(await elenaInUse()).toBe(false);
    expect((await claim()).status).toBe(201); // another browser takes her
  });

  it('the fake reviewer runs on its settings: an always-normal 2-second run completes at 2 s', async () => {
    const fakeReviewer = {
      normalMs: { min: 2_000, max: 2_000 },
      slowMs: { min: 90_000, max: 90_000 },
      outcomePercent: { normal: 100, error: 0, slow: 0 },
    };
    ctx = setup({ useFakeReviewer: true, rng: scriptedRng(0.99, 0), config: { fakeReviewer } });
    const id = await ctx.startReview(DOC.nda);

    ctx.time.advanceTo(T0 + 1_999);
    expect(ctx.storedStatus(id)).toBe('in_progress');
    ctx.time.advanceTo(T0 + 2_000);
    expect(await ctx.review(id)).toMatchObject({ status: 'completed' });
    expect((await ctx.review(id)).findings).toHaveLength(3);
  });

  it('GET /api/settings gives the web app the values it shows and follows', async () => {
    ctx = setup({ config: { reviewDeadlineMs: 45_000, monthlyReviewLimit: 25, sessionTtlMs: 12_000 } });
    const res = await ctx.http.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reviewDeadlineMs: 45_000, monthlyReviewLimit: 25, sessionTtlMs: 12_000, reviewers: ['fake'] });
  });
});
