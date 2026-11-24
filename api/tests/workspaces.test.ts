import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/connection';
import { ALL_DOCS, DEADLINE, DOC, LAWYER, LIMIT, WORKSPACE, docsFor, setup } from './helpers';

let ctx: ReturnType<typeof setup>;
let dir: string | undefined;
afterEach(() => {
  ctx?.server.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const OTHER = { id: 'ws-other', name: 'Other workspace' };
const OTHER_DOC = 'doc-other';
const MARCO = 'lawyer-marco';

/** A second workspace: Elena is a member of both, Marco only of this one. It owns one document. */
function addOtherWorkspace(db: Db) {
  db.prepare(`INSERT INTO workspaces (id, name) VALUES (?, ?)`).run(OTHER.id, OTHER.name);
  db.prepare(`INSERT INTO lawyers (id, name, title) VALUES (?, 'Marco Rossi', 'Associate')`).run(MARCO);
  const member = db.prepare(`INSERT INTO workspace_members (workspace_id, lawyer_id) VALUES (?, ?)`);
  member.run(OTHER.id, MARCO);
  member.run(OTHER.id, LAWYER.elena);
  db.prepare(
    `INSERT INTO documents (id, workspace_id, title, type, pages, uploaded_at, uploaded_by)
     VALUES (?, ?, 'Lease — Corso Como 5, Milan', 'lease', 12, '2026-10-01T09:00:00Z', ?)`,
  ).run(OTHER_DOC, OTHER.id, MARCO);
}

describe('workspaces own documents and their plan', () => {
  it('every sample document belongs to the one seeded workspace, shared by the three lawyers', async () => {
    ctx = setup();
    const lawyers = (await ctx.http.get('/api/lawyers')).body;
    for (const lawyer of lawyers) expect(lawyer.workspaces).toEqual([{ id: WORKSPACE, name: 'Firm workspace' }]);

    const workspace = (await ctx.http.get(`/api/workspaces/${WORKSPACE}`)).body;
    expect(workspace.members.map((m: { id: string }) => m.id).sort()).toEqual(Object.values(LAWYER).sort());
    expect(await ctx.documents()).toHaveLength(20);
    expect((await ctx.http.get(`/api/documents/${DOC.nda}`)).body.workspace).toEqual({
      id: WORKSPACE,
      name: 'Firm workspace',
    });
  });

  it('a lawyer can belong to several workspaces; each lists only its own documents', async () => {
    ctx = setup();
    addOtherWorkspace(ctx.server.db);

    const lawyers = (await ctx.http.get('/api/lawyers')).body;
    const elena = lawyers.find((l: { id: string }) => l.id === LAWYER.elena);
    expect(elena.workspaces.map((w: { id: string }) => w.id).sort()).toEqual([WORKSPACE, OTHER.id].sort());

    expect((await ctx.documents()).map((d: { id: string }) => d.id)).not.toContain(OTHER_DOC);
    const other = (await ctx.http.get(`/api/workspaces/${OTHER.id}/documents`)).body;
    expect(other.map((d: { id: string }) => d.id)).toEqual([OTHER_DOC]);
  });

  it('the monthly plan is per workspace: one using all its reviews does not block another', async () => {
    ctx = setup();
    addOtherWorkspace(ctx.server.db);
    await ctx.completeReviews(docsFor(LIMIT));
    expect((await ctx.requestReview(ALL_DOCS[10]!)).body.error.code).toBe('plan_exhausted');

    expect((await ctx.http.get(`/api/workspaces/${OTHER.id}/plan`)).body).toMatchObject({
      workspaceId: OTHER.id,
      used: 0,
      available: LIMIT,
    });
    expect((await ctx.requestReview(OTHER_DOC, MARCO)).status).toBe(201);
    expect(await ctx.plan()).toMatchObject({ used: LIMIT, reserved: 0 }); // untouched by the other workspace
  });

  it('only members of the owning workspace can request a review', async () => {
    ctx = setup();
    addOtherWorkspace(ctx.server.db);

    const outsider = await ctx.requestReview(DOC.nda, MARCO);
    expect(outsider.status).toBe(403);
    expect(outsider.body.error.code).toBe('not_a_member');
    expect(await ctx.plan()).toMatchObject({ reserved: 0 });

    expect((await ctx.requestReview(OTHER_DOC, LAWYER.elena)).status).toBe(201); // member of both
    expect((await ctx.requestReview(DOC.nda, LAWYER.elena)).status).toBe(201);
  });

  it('404s on an unknown workspace', async () => {
    ctx = setup();
    for (const path of ['', '/plan', '/documents']) {
      const res = await ctx.http.get(`/api/workspaces/nope${path}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('workspace_not_found');
    }
  });
});

describe('a database created by an older version', () => {
  it('gains the ownership, deadline and reviewer columns on start, and keeps its reviews', async () => {
    dir = mkdtempSync(join(tmpdir(), 'contract-reviewer-legacy-'));
    const dbPath = join(dir, 'contract-reviewer.db');
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE lawyers (id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL);
      CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, pages INTEGER NOT NULL,
        uploaded_at TEXT NOT NULL, uploaded_by TEXT NOT NULL REFERENCES lawyers(id), supersedes TEXT REFERENCES documents(id));
      CREATE TABLE reviews (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id),
        requested_by TEXT NOT NULL REFERENCES lawyers(id), requested_at_ms INTEGER NOT NULL, status TEXT NOT NULL,
        finished_at_ms INTEGER, failure_reason TEXT);
      INSERT INTO lawyers VALUES ('${LAWYER.elena}', 'Elena Marsh', 'Partner');
      INSERT INTO documents VALUES ('${DOC.nda}', 'NDA', 'nda', 5, '2026-09-02T09:14:00Z', '${LAWYER.elena}', NULL);
      INSERT INTO reviews VALUES ('old-review', '${DOC.nda}', '${LAWYER.elena}', ${Date.UTC(2026, 10, 2)}, 'completed',
        ${Date.UTC(2026, 10, 2) + Math.min(20_000, DEADLINE - 1)}, NULL);
    `);
    legacy.close();

    ctx = setup({ dbPath, config: { reviewDeadlineMs: 45_000 } });
    expect((await ctx.http.get(`/api/documents/${DOC.nda}`)).body.workspace.id).toBe(WORKSPACE);
    expect(await ctx.documents()).toHaveLength(20);
    expect(await ctx.plan()).toMatchObject({ used: 1 }); // the November review still counts
    expect(await ctx.review('old-review')).toMatchObject({
      status: 'completed',
      reviewer: 'fake', // from before the AI was chosen per review
      deadlineAt: new Date(Date.UTC(2026, 10, 2) + 45_000).toISOString(), // filled in from the setting
    });
  });
});
