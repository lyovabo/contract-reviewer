import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './connection';
import type { Finding, Lawyer } from '../domain/types';

export interface SampleDocument {
  id: string;
  title: string;
  type: string;
  pages: number;
  uploadedAt: string;
  uploadedBy: string;
  supersedes: string | null;
  findings: Finding[];
  /** The contract text, from contracts/<id>.md next to documents.json; null if there is none. */
  text?: string | null;
  /** The party the firm acts for, from the `client:` line of that file's front matter. */
  client?: string | null;
}

export interface Samples {
  lawyers: Lawyer[];
  documents: SampleDocument[];
}

export function loadSamples(dir: string): Samples {
  const read = (name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const contract = (id: string) => {
    const path = join(dir, 'contracts', `${id}.md`);
    return existsSync(path) ? parseContract(readFileSync(path, 'utf8')) : { client: null, text: null };
  };
  const documents: SampleDocument[] = read('documents.json');
  return {
    lawyers: read('lawyers.json'),
    documents: documents.map((doc) => ({ ...doc, ...contract(doc.id) })),
  };
}

/** Splits a contract file into its front matter's `client:` line and the contract text. */
export function parseContract(file: string): { client: string | null; text: string } {
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(file);
  if (!frontMatter) return { client: null, text: file };
  const client = /^client:[ \t]*(.+)$/m.exec(frontMatter[1]!)?.[1]?.trim() || null;
  return { client, text: file.slice(frontMatter[0].length).trimStart() };
}

/**
 * The brief describes ONE workspace shared by the firm's lawyers, and the sample files have no
 * workspace of their own. It is modeled explicitly so that documents are owned by a workspace and
 * a lawyer can belong to several; the sample data seeds this single one.
 */
export const SAMPLE_WORKSPACE = { id: '5d0c6a52-8e1f-4b3a-9c7d-2e4f6a8b0c13', name: 'Firm workspace' };

/**
 * Idempotent seed: upserts the workspace, lawyers (all members of it), documents (all owned by
 * it), each document's findings script, and its contract text and client. Never touches reviews, so
 * restarting the API keeps every review and its findings.
 */
export function seed(db: Db, samples: Samples): void {
  const upsertWorkspace = db.prepare(
    `INSERT INTO workspaces (id, name) VALUES (@id, @name) ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
  );
  const upsertLawyer = db.prepare(
    `INSERT INTO lawyers (id, name, title) VALUES (@id, @name, @title)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, title = excluded.title`,
  );
  const addMember = db.prepare(
    `INSERT INTO workspace_members (workspace_id, lawyer_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
  );
  // Two passes for documents: `supersedes` can point at a document seeded later in the file.
  const upsertDocument = db.prepare(
    `INSERT INTO documents (id, workspace_id, title, type, pages, uploaded_at, uploaded_by)
     VALUES (@id, @workspaceId, @title, @type, @pages, @uploadedAt, @uploadedBy)
     ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, title = excluded.title,
       type = excluded.type, pages = excluded.pages, uploaded_at = excluded.uploaded_at,
       uploaded_by = excluded.uploaded_by`,
  );
  const setSupersedes = db.prepare(`UPDATE documents SET supersedes = ? WHERE id = ?`);
  const clearScript = db.prepare(`DELETE FROM document_findings WHERE document_id = ?`);
  const setContract = db.prepare(
    `INSERT INTO document_contracts (document_id, client, body) VALUES (@id, @client, @text)
     ON CONFLICT (document_id) DO UPDATE SET client = excluded.client, body = excluded.body`,
  );
  const clearContract = db.prepare(`DELETE FROM document_contracts WHERE document_id = ?`);
  const insertScriptLine = db.prepare(
    `INSERT INTO document_findings (document_id, position, clause, title, severity, excerpt, explanation)
     VALUES (@documentId, @position, @clause, @title, @severity, @excerpt, @explanation)`,
  );

  db.transaction(() => {
    upsertWorkspace.run(SAMPLE_WORKSPACE);
    for (const lawyer of samples.lawyers) {
      upsertLawyer.run(lawyer);
      addMember.run(SAMPLE_WORKSPACE.id, lawyer.id);
    }
    for (const doc of samples.documents) upsertDocument.run({ ...doc, workspaceId: SAMPLE_WORKSPACE.id });
    for (const doc of samples.documents) {
      setSupersedes.run(doc.supersedes, doc.id);
      clearScript.run(doc.id);
      doc.findings.forEach((finding, position) =>
        insertScriptLine.run({ documentId: doc.id, position, ...finding }),
      );
      if (doc.text) setContract.run({ id: doc.id, client: doc.client ?? null, text: doc.text });
      else clearContract.run(doc.id);
    }
  })();
}
