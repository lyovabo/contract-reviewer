import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSamples, parseContract } from '../src/db/seed';
import { checkFinding } from '../src/reviewer/check-finding';
import {
  REPORT_FINDING_TOOL,
  createClaudeReviewer,
  type ClaudeApi,
  type ClaudeSettings,
} from '../src/reviewer/claude-reviewer';
import { reviewerFromEnv } from '../src/reviewer/config';
import type { ReviewJob, ReviewerListener } from '../src/reviewer/port';
import { DEADLINE, DOC, LAWYER, SAMPLES_DIR, T0, TEST_CONFIG, VirtualTime, ms, setup } from './helpers';

/** Claude's settings in api/config.json: every test below that does not set its own uses these. */
const CLAUDE = TEST_CONFIG.claudeReviewer;

// No test here calls the real API: Claude is replaced by a script of turns.

const CONTRACT = `## 8. Liability

8.1 The Supplier's total liability shall not exceed the fees paid in the month preceding the claim.

## 12. Changes

12.3 The Supplier may modify the features of the Service
from time to time without notice.`;

const JOB: ReviewJob = {
  document: { title: 'SaaS subscription agreement', type: 'saas', client: 'Harrowgate Retail Group plc (the Customer)' },
  text: CONTRACT,
  script: [],
};

const CAP = {
  clause: '8.1',
  title: 'Liability capped at one month of fees',
  severity: 'high',
  excerpt: "The Supplier's total liability shall not exceed the fees paid in the month preceding the claim.",
  explanation: 'An outage could cost far more. Ask for 12 months of fees.',
};
const CHANGES = {
  clause: '12.3',
  title: 'Service can change without notice',
  severity: 'medium',
  excerpt: 'The Supplier may modify the features of the Service from time to time without notice.',
  explanation: 'Features could disappear mid-term. Require notice of material changes.',
};

let nextId = 0;
const call = (input: object) =>
  ({ type: 'tool_use', id: `toolu_${++nextId}`, name: 'report_finding', input }) as Anthropic.ToolUseBlock;
const say = (text: string) => ({ type: 'text', text, citations: null }) as Anthropic.TextBlock;

type Turn =
  | { blocks: Anthropic.ContentBlock[]; stop: Anthropic.StopReason; outputTokens?: number }
  | { blocks: Anthropic.ContentBlock[]; hang: true } // streams its blocks, then never finishes
  | { error: Error };

/**
 * Stands in for the SDK: each request plays the next scripted turn. Every request counts as
 * `inputTokens` input tokens, and each turn bills `outputTokens` (default 300) output tokens.
 */
function scriptedClaude(turns: Turn[], { inputTokens = 1_000 } = {}) {
  const requests: { params: Anthropic.MessageStreamParams; signal: AbortSignal }[] = [];
  const counted: Anthropic.MessageCountTokensParams[] = [];
  const api: ClaudeApi = {
    async countTokens(params) {
      counted.push(structuredClone(params));
      return { input_tokens: inputTokens };
    },
    stream(params, { signal }) {
      requests.push({ params: structuredClone(params), signal });
      const turn = turns[requests.length - 1];
      const listeners: ((block: Anthropic.ContentBlock) => void)[] = [];
      return {
        on(_event, listener) {
          listeners.push(listener);
        },
        async finalMessage() {
          await Promise.resolve();
          if (!turn) throw new Error('no more scripted turns');
          if ('error' in turn) throw turn.error;
          for (const block of turn.blocks) listeners.forEach((listener) => listener(block));
          if ('hang' in turn) {
            return new Promise<never>((_, reject) =>
              signal.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError())),
            );
          }
          return {
            id: `msg_${requests.length}`,
            type: 'message',
            role: 'assistant',
            model: params.model,
            content: turn.blocks,
            stop_reason: turn.stop,
            stop_sequence: null,
            usage: { input_tokens: inputTokens, output_tokens: turn.outputTokens ?? 300 },
          } as unknown as Anthropic.Message;
        },
      };
    },
  };
  return { api, requests, counted };
}

function recorder() {
  const events: string[] = [];
  const listener: ReviewerListener = {
    onFinding: (_id, position, finding) => events.push(`finding ${position}: ${finding.title}`),
    onCompleted: () => events.push('completed'),
    onFailed: (_id, message) => events.push(`failed: ${message}`),
  };
  return { listener, events };
}

/** Lets every pending promise settle (the scripted client only ever waits on microtasks). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function run(
  turns: Turn[],
  job: ReviewJob = JOB,
  opts: { settings?: Partial<ClaudeSettings>; inputTokens?: number; deadlineMs?: number } = {},
) {
  const claude = scriptedClaude(turns, { inputTokens: opts.inputTokens });
  const { listener, events } = recorder();
  const time = new VirtualTime(T0);
  const reviewer = createClaudeReviewer(listener, {
    api: claude.api,
    scheduler: time,
    settings: { ...TEST_CONFIG.claudeReviewer, ...opts.settings },
    deadlineMs: opts.deadlineMs ?? TEST_CONFIG.reviewDeadlineMs,
  });
  reviewer.start('r1', job);
  return { ...claude, events, time, reviewer };
}

/** The tool results the reviewer sent back, at the end of a request's messages. */
const toolResultsOf = (request: { params: Anthropic.MessageStreamParams }) =>
  request.params.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];

describe('Claude reviewer', () => {
  it('asks the configured model, at its effort and thinking setting, to report each finding through one tool call', async () => {
    const { requests } = run([{ blocks: [say('No issues.')], stop: 'end_turn' }]);
    await settle();

    const { params } = requests[0]!;
    expect(params.model).toBe(CLAUDE.model);
    expect(params.thinking).toEqual(CLAUDE.thinking ? { type: 'adaptive' } : { type: 'disabled' });
    expect(params.output_config).toEqual({ effort: CLAUDE.effort });
    expect(params.max_tokens).toBe(CLAUDE.maxOutputTokens);
    expect(params.tools).toEqual([REPORT_FINDING_TOOL]);
    expect(REPORT_FINDING_TOOL.eager_input_streaming).toBe(true);
    // Claude is told whose side it is on, and the contract goes in as data, inside tags the
    // system prompt tells it not to obey.
    expect(params.messages[0]!.content).toContain("The firm's client: Harrowgate Retail Group plc (the Customer)");
    expect(params.messages[0]!.content).toContain(`<contract>\n${CONTRACT}\n</contract>`);
  });

  it('says so when the client is not known, and the system prompt then falls back to a rule', async () => {
    const { requests } = run([{ blocks: [], stop: 'end_turn' }], { ...JOB, document: { ...JOB.document, client: null } });
    await settle();
    expect(requests[0]!.params.messages[0]!.content).toContain("The firm's client: not named");
    expect(requests[0]!.params.system).toMatch(/If no client is named/);
  });

  it('streams each valid finding as its call completes, acknowledges it, and completes when Claude is done', async () => {
    const first = call(CAP);
    const second = call(CHANGES);
    const { events, requests } = run([
      { blocks: [say('Two issues.'), first, second], stop: 'tool_use' },
      { blocks: [say('Done.')], stop: 'end_turn' },
    ]);
    await settle();

    expect(events).toEqual([
      'finding 0: Liability capped at one month of fees',
      'finding 1: Service can change without notice',
      'completed',
    ]);
    expect(toolResultsOf(requests[1]!)).toEqual([
      { type: 'tool_result', tool_use_id: first.id, content: 'Recorded.' },
      { type: 'tool_result', tool_use_id: second.id, content: 'Recorded.' },
    ]);
  });

  it('rejects a misquote, a bad field or a repeat, tells Claude why, and keeps positions contiguous', async () => {
    const misquote = call({ ...CAP, excerpt: 'The Supplier is liable for nothing.' });
    const badSeverity = call({ ...CHANGES, severity: 'critical' });
    const { events, requests } = run([
      { blocks: [misquote, badSeverity], stop: 'tool_use' },
      { blocks: [call(CAP), call(CAP)], stop: 'tool_use' }, // corrected, then repeated
      { blocks: [say('Done.')], stop: 'end_turn' },
    ]);
    await settle();

    expect(events).toEqual(['finding 0: Liability capped at one month of fees', 'completed']);
    const [quoteResult, severityResult] = toolResultsOf(requests[1]!);
    expect(quoteResult).toMatchObject({ tool_use_id: misquote.id, is_error: true, content: expect.stringMatching(/word for word/) });
    expect(severityResult).toMatchObject({ tool_use_id: badSeverity.id, is_error: true, content: expect.stringMatching(/severity/) });
    expect(toolResultsOf(requests[2]!).map((r) => r.content)).toEqual([
      'Recorded.',
      expect.stringMatching(/already reported/),
    ]);
  });

  it.each([
    ['refuses', [{ blocks: [], stop: 'refusal' }], 'Claude declined to review this document'],
    ['is cut off at the output limit', [{ blocks: [], stop: 'max_tokens' }], 'The answer was cut off at the output limit'],
    ['cannot be reached', [{ error: new Error('socket hang up') }], 'socket hang up'],
    [
      'never stops calling the tool',
      Array.from({ length: CLAUDE.maxTurns }, () => ({ blocks: [call({ ...CAP, severity: 'x' })], stop: 'tool_use' })),
      `Still reporting after ${CLAUDE.maxTurns} turns`,
    ],
  ] as [string, Turn[], string][])('fails the review when Claude %s', async (_case, turns, message) => {
    const { events } = run(turns);
    await settle();
    expect(events).toEqual([`failed: ${message}`]);
  });

  it(`stops its API call at the deadline (${ms(DEADLINE)} ms) and reports nothing: the domain records the timeout`, async () => {
    const { events, requests, time } = run([{ blocks: [call(CAP)], hang: true }]);
    await settle();
    expect(events).toEqual(['finding 0: Liability capped at one month of fees']);

    time.advanceBy(DEADLINE - 1);
    expect(requests[0]!.signal.aborted).toBe(false);
    time.advanceBy(1);
    expect(requests[0]!.signal.aborted).toBe(true);
    await settle();
    expect(events).toEqual(['finding 0: Liability capped at one month of fees']);
  });

  it('takes its deadline, turn limit and output cap from the settings', async () => {
    const slow = run([{ blocks: [call(CAP)], hang: true }], JOB, { deadlineMs: 20_000 });
    await settle();
    slow.time.advanceBy(19_999);
    expect(slow.requests[0]!.signal.aborted).toBe(false);
    slow.time.advanceBy(1);
    expect(slow.requests[0]!.signal.aborted).toBe(true);

    const looping = run(
      Array.from({ length: 2 }, () => ({ blocks: [call({ ...CAP, severity: 'x' })], stop: 'tool_use' as const })),
      JOB,
      { settings: { maxTurns: 2, maxOutputTokens: 2_000 } },
    );
    await settle();
    expect(looping.events).toEqual(['failed: Still reporting after 2 turns']);
    expect(looping.requests.map((r) => r.params.max_tokens)).toEqual([2_000, 2_000]);
  });

  it('stop() aborts every running review, silently', async () => {
    const { events, requests, reviewer } = run([{ blocks: [], hang: true }, { blocks: [], hang: true }]);
    reviewer.start('r2', JOB);
    await settle();

    reviewer.stop();
    await settle();
    expect(requests.map((r) => r.signal.aborted)).toEqual([true, true]);
    expect(events).toEqual([]);
  });

  it('refuses to start a document that has no contract text, before calling the API', () => {
    const claude = scriptedClaude([]);
    const reviewer = createClaudeReviewer(recorder().listener, {
      api: claude.api,
      scheduler: new VirtualTime(T0),
      settings: TEST_CONFIG.claudeReviewer,
      deadlineMs: TEST_CONFIG.reviewDeadlineMs,
    });
    expect(() => reviewer.start('r1', { ...JOB, text: null })).toThrow(/no contract text/);
    expect(claude.requests).toEqual([]);
  });
});

describe('Claude reviewer token budget', () => {
  it('counts each request exactly as it will be sent, before sending it', async () => {
    const { requests, counted } = run([{ blocks: [call(CAP)], stop: 'tool_use' }, { blocks: [say('Done.')], stop: 'end_turn' }]);
    await settle();
    expect(counted).toHaveLength(2);
    counted.forEach((params, turn) => {
      const { max_tokens: _cap, ...sent } = requests[turn]!.params;
      expect(params).toEqual(sent);
    });
  });

  it('refuses a contract too long for the budget, without a paid call', async () => {
    const tooLong = CLAUDE.tokenBudget - 500; // with the 2% padding and 1,000 tokens to answer in, it cannot fit
    const { events, requests, counted } = run([], JOB, { inputTokens: tooLong });
    await settle();
    expect(events).toEqual([
      `failed: The contract is too long for the token budget: ${tooLong} input tokens, budget ${CLAUDE.tokenBudget}`,
    ]);
    expect(counted).toHaveLength(1); // counting is free
    expect(requests).toEqual([]);
  });

  it("caps each call's output at what is left, and stops before a call that would not fit", async () => {
    const { events, requests } = run(
      [{ blocks: [call(CAP)], stop: 'tool_use', outputTokens: 3_000 }],
      JOB,
      { settings: { tokenBudget: 6_000, maxOutputTokens: 8_000 }, inputTokens: 1_000 },
    );
    await settle();
    // 6,000 budget - 1,020 for the padded input count = 4,980 left to answer in.
    expect(requests[0]!.params.max_tokens).toBe(4_980);
    // After 4,000 used, the next turn's 1,020 input would leave 980: not enough room, so no call.
    expect(requests).toHaveLength(1);
    expect(events).toEqual([
      'finding 0: Liability capped at one month of fees',
      'failed: Stopped at the token budget: 4000 of 6000 tokens used',
    ]);
  });

  it('reports an answer cut off at a lowered cap as the budget, not the output limit', async () => {
    const { events } = run([{ blocks: [], stop: 'max_tokens' }], JOB, { settings: { tokenBudget: 6_000, maxOutputTokens: 8_000 } });
    await settle();
    expect(events).toEqual(['failed: Stopped at the token budget of 6000 tokens']);
  });
});

describe('Claude reviewer behind the API', () => {
  let ctx: ReturnType<typeof setup>;
  afterEach(() => ctx?.server.close());

  it('when a lawyer chooses it: admitted, streamed, completed and charged like any review, on the seeded contract text', async () => {
    const nda = loadSamples(SAMPLES_DIR).documents.find((d) => d.id === DOC.nda)!;
    const finding = nda.findings[0]!;
    const claude = scriptedClaude([
      { blocks: [call(finding)], stop: 'tool_use' },
      { blocks: [say('Done.')], stop: 'end_turn' },
    ]);
    ctx = setup({
      claudeReviewerFactory: (time) => (listener) =>
        createClaudeReviewer(listener, {
          api: claude.api,
          scheduler: time,
          settings: TEST_CONFIG.claudeReviewer,
          deadlineMs: TEST_CONFIG.reviewDeadlineMs,
        }),
    });

    const id = await ctx.startReview(DOC.nda, LAWYER.elena, 'claude');
    await settle();

    const review = await ctx.review(id);
    expect(review).toMatchObject({ status: 'completed', reviewer: 'claude' });
    expect(review.findings).toMatchObject([{ position: 0, title: finding.title, excerpt: finding.excerpt }]);
    expect((await ctx.plan()).used).toBe(1);
    const prompt = claude.requests[0]!.params.messages[0]!.content as string;
    expect(prompt).toContain("The firm's client: Norrvik Automation Ltd (the Recipient)");
    expect(prompt).toContain(`<contract>\n${nda.text}\n</contract>`);
    expect(nda.text).toMatch(/^# Non-disclosure agreement/); // the front matter is not part of the contract
  });
});

describe('checking a reported finding', () => {
  it('accepts a faithful quote despite curly quotes and line breaks', () => {
    expect(checkFinding(CHANGES, CONTRACT).ok).toBe(true); // the contract breaks this sentence over two lines
    expect(checkFinding({ ...CAP, excerpt: 'The Supplier’s total liability shall not exceed' }, CONTRACT).ok).toBe(true);
  });

  it('accepts something the contract leaves out, with no clause and no excerpt', () => {
    const result = checkFinding({ ...CAP, clause: null, excerpt: '  ' }, CONTRACT);
    expect(result).toEqual({ ok: true, finding: { ...CAP, clause: null, excerpt: null } });
  });

  it.each([
    ['not an object', 'just text', /object/],
    ['no title', { ...CAP, title: ' ' }, /title/],
    ['an unknown severity', { ...CAP, severity: 'critical' }, /severity/],
    ['a clause that is not text', { ...CAP, clause: 8.1 }, /clause/],
    ['an overlong explanation', { ...CAP, explanation: 'x'.repeat(1_201) }, /explanation/],
    ['an excerpt the contract does not contain', { ...CAP, excerpt: 'The Supplier has no liability.' }, /word for word/],
  ])('rejects %s', (_case, input, reason) => {
    expect(checkFinding(input, CONTRACT)).toEqual({ ok: false, reason: expect.stringMatching(reason) });
  });

  it('accepts every scripted sample finding against its document: the fake and Claude see the same contracts', () => {
    const { documents } = loadSamples(SAMPLES_DIR);
    for (const doc of documents) {
      expect(doc.text, doc.title).toBeTruthy();
      for (const finding of doc.findings) {
        expect(checkFinding(finding, doc.text!), `${doc.title}: ${finding.title}`).toEqual({ ok: true, finding });
      }
    }
  });
});

describe('sample contract files', () => {
  it('name the firm\'s client, a party to the contract, in their front matter', () => {
    for (const doc of loadSamples(SAMPLES_DIR).documents) {
      const name = doc.client?.split(' (')[0];
      expect(name, doc.title).toBeTruthy();
      expect(doc.text, doc.title).toContain(name);
    }
  });

  it('split into the client line and the contract text; a file without front matter is all text', () => {
    expect(parseContract('---\nclient: Calder Packaging Ltd (the Buyer)\n---\n\n# Supply agreement\n')).toEqual({
      client: 'Calder Packaging Ltd (the Buyer)',
      text: '# Supply agreement\n',
    });
    expect(parseContract('# Supply agreement\n---\n')).toEqual({ client: null, text: '# Supply agreement\n---\n' });
    expect(parseContract('---\ntitle: x\n---\nBody')).toEqual({ client: null, text: 'Body' });
  });
});

describe('choosing the reviewer', () => {
  const settings = TEST_CONFIG.claudeReviewer;

  const KEY = { ANTHROPIC_API_KEY: 'sk-ant-test' }; // never sent anywhere: nothing here calls Claude

  it('offers Claude only when an API key is set; a blank key counts as none, and REVIEWER no longer matters', () => {
    expect(reviewerFromEnv({}, settings)).toEqual({ kind: 'fake' });
    expect(reviewerFromEnv({ ANTHROPIC_API_KEY: '  ' }, settings)).toEqual({ kind: 'fake' });
    expect(reviewerFromEnv({ REVIEWER: 'claude' }, settings)).toEqual({ kind: 'fake' });
    expect(reviewerFromEnv({ ...KEY, REVIEWER: 'fake' }, settings)).toMatchObject({ kind: 'claude' });
  });

  it('takes Claude settings from the config file, and the variables override them', () => {
    expect(reviewerFromEnv(KEY, settings)).toEqual({ kind: 'claude', ...settings });
    expect(
      reviewerFromEnv(
        {
          ...KEY,
          REVIEWER_MODEL: 'claude-sonnet-5-5',
          REVIEWER_EFFORT: 'high',
          REVIEWER_THINKING: 'on',
          REVIEWER_TOKEN_BUDGET: '12000',
        },
        settings,
      ),
    ).toEqual({
      kind: 'claude',
      ...settings,
      model: 'claude-sonnet-5-5',
      effort: 'high',
      thinking: true,
      tokenBudget: 12_000,
    });
  });

  it.each([
    [{ ...KEY, REVIEWER_EFFORT: 'extreme' }, /REVIEWER_EFFORT/],
    [{ ...KEY, REVIEWER_THINKING: 'yes' }, /REVIEWER_THINKING/],
    [{ ...KEY, REVIEWER_TOKEN_BUDGET: 'lots' }, /REVIEWER_TOKEN_BUDGET/],
    [{ REVIEWER_TOKEN_BUDGET: '500' }, /REVIEWER_TOKEN_BUDGET/], // checked even without a key
  ])('refuses %o at startup', (env, message) => {
    expect(() => reviewerFromEnv(env, settings)).toThrow(message);
  });
});
