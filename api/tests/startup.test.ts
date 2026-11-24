import { spawn, spawnSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG_FILE, type AppConfig } from '../src/config';
import type { ClaudeApi } from '../src/reviewer/claude-reviewer';
import { claudeReviewerFactory, startupSettings } from '../src/startup';
import { DOC, T0, TEST_CONFIG, VirtualTime } from './helpers';

// What main.ts and scripts/show-request.ts do at startup. No test calls the real Claude API.

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const TSX = join(API_DIR, 'node_modules', '.bin', 'tsx');

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** Writes a settings file: TEST_CONFIG with a 20-second deadline and other Claude limits. */
function shortConfigFile(changes: (config: AppConfig) => void = () => {}): string {
  dir = mkdtempSync(join(tmpdir(), 'contract-reviewer-startup-'));
  const config = structuredClone(TEST_CONFIG);
  config.reviewDeadlineMs = 20_000;
  config.fakeReviewer.normalMs = { min: 2_000, max: 10_000 };
  config.fakeReviewer.slowMs = { min: 20_000, max: 40_000 };
  config.claudeReviewer = { ...config.claudeReviewer, model: 'claude-sonnet-5-5', maxTurns: 2, maxOutputTokens: 4_000 };
  changes(config);
  const path = join(dir, 'short.json');
  writeFileSync(path, JSON.stringify(config));
  return path;
}

/** A Claude stand-in whose one call never ends until it is aborted. */
function hangingClaude() {
  const signals: AbortSignal[] = [];
  const api: ClaudeApi = {
    countTokens: async () => ({ input_tokens: 1_000 }),
    stream(_params, { signal }) {
      signals.push(signal);
      return {
        on: () => undefined,
        finalMessage: () =>
          new Promise<Anthropic.Message>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      };
    },
  };
  return { api, signals };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A port nothing is listening on right now. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createNetServer().listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

describe('reading the settings at startup', () => {
  it('reads api/config.json unless CONFIG_FILE names another file', () => {
    expect(startupSettings({})).toMatchObject({ configFile: DEFAULT_CONFIG_FILE, config: TEST_CONFIG, reviewer: { kind: 'fake' } });

    const file = shortConfigFile();
    const settings = startupSettings({ CONFIG_FILE: file });
    expect(settings.configFile).toBe(file);
    expect(settings.config.reviewDeadlineMs).toBe(20_000);
  });

  it('takes Claude’s settings from the file, with the REVIEWER_* variables on top', () => {
    const file = shortConfigFile();
    const { reviewer } = startupSettings({ CONFIG_FILE: file, ANTHROPIC_API_KEY: 'sk-ant-dummy', REVIEWER_EFFORT: 'high' });
    expect(reviewer).toEqual({
      kind: 'claude',
      ...TEST_CONFIG.claudeReviewer,
      model: 'claude-sonnet-5-5', // from the file
      maxTurns: 2,
      maxOutputTokens: 4_000,
      effort: 'high', // from REVIEWER_EFFORT
    });
  });

  it('offers Claude only when an API key is set, and only then makes a Claude client', () => {
    let made = 0;
    const deps = { api: () => (made++, hangingClaude().api), scheduler: new VirtualTime(T0) };
    expect(claudeReviewerFactory(startupSettings({}), deps)).toBeUndefined();
    expect(made).toBe(0);
    expect(claudeReviewerFactory(startupSettings({ ANTHROPIC_API_KEY: 'sk-ant-dummy' }), deps)).toBeTypeOf('function');
    expect(made).toBe(1);
  });

  it('gives the Claude reviewer the file’s deadline: its API call is stopped at 20 s', async () => {
    const claude = hangingClaude();
    const time = new VirtualTime(T0);
    const settings = startupSettings({ CONFIG_FILE: shortConfigFile(), ANTHROPIC_API_KEY: 'sk-ant-dummy' });
    const factory = claudeReviewerFactory(settings, { api: () => claude.api, scheduler: time })!;
    const reviewer = factory({ onFinding: () => {}, onCompleted: () => {}, onFailed: () => {} });

    reviewer.start('r1', { document: { title: 'NDA', type: 'nda', client: null }, text: 'Contract text.', script: [] });
    await settle();
    time.advanceBy(19_999);
    expect(claude.signals[0]!.aborted).toBe(false);
    time.advanceBy(1);
    expect(claude.signals[0]!.aborted).toBe(true);
  });
});

describe('the scripts themselves', () => {
  // A real key in the shell is never passed on: each test sets its own (a dummy one, or none).
  const childEnv = (env: Record<string, string>) => ({ ...process.env, ANTHROPIC_API_KEY: '', ...env });
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(TSX, args, { cwd: API_DIR, env: childEnv(env), encoding: 'utf8', timeout: 20_000 });

  it('show-request prints the request with the settings file’s model and output cap', () => {
    const result = run(['scripts/show-request.ts', DOC.nda], { CONFIG_FILE: shortConfigFile(), REVIEWER_MODEL: '' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 4_000 });
  }, 30_000);

  it('the API started with an API key offers both AIs; without one, only the simulated one', async () => {
    dir = mkdtempSync(join(tmpdir(), 'contract-reviewer-startup-'));
    // A dummy key: the API only makes a Claude client here, and nothing is ever sent to Claude.
    const offered = async (env: Record<string, string>) => {
      const port = await freePort();
      const api = spawn(TSX, ['src/main.ts'], {
        cwd: API_DIR,
        env: childEnv({ ...env, PORT: String(port), DB_PATH: join(dir!, `${port}.db`) }),
      });
      try {
        await new Promise<void>((resolve, reject) => {
          api.stdout.on('data', (chunk: Buffer) => chunk.toString().includes('listening on') && resolve());
          api.on('exit', (code) => reject(new Error(`the API exited with ${code}`)));
        });
        return (await (await fetch(`http://localhost:${port}/api/settings`)).json()).reviewers;
      } finally {
        api.kill();
      }
    };
    expect(await offered({ ANTHROPIC_API_KEY: 'sk-ant-dummy' })).toEqual(['fake', 'claude']);
    expect(await offered({ ANTHROPIC_API_KEY: '' })).toEqual(['fake']);
    expect(await offered({ ANTHROPIC_API_KEY: '', REVIEWER: 'claude' })).toEqual(['fake']); // no key, no Claude
  }, 30_000);

  it('the API stops at startup on a wrong setting, naming it, before it opens the database', () => {
    const file = shortConfigFile((config) => {
      config.fakeReviewer.slowMs.min = 19_999;
    });
    const dbPath = join(dir!, 'never.db');
    const result = run(['src/main.ts'], { CONFIG_FILE: file, DB_PATH: dbPath, PORT: '0' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('fakeReviewer.slowMs.min must be at least reviewDeadlineMs (20000)');
    expect(existsSync(dbPath)).toBe(false);
  }, 30_000);
});
