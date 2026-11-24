import { Router, type Request, type Response } from 'express';
import type { ReviewService } from '../domain/review-service';
import type { SessionService } from '../domain/sessions';
import { REVIEWER_KINDS, type ReviewerKind } from '../domain/types';

function sendError(res: Response, status: number, code: string, message: string, extra: object = {}) {
  res.status(status).json({ error: { code, message, ...extra } });
}

/** The session token from `Authorization: Bearer <token>`, if any. */
function bearerToken(req: Request): string | null {
  const match = /^Bearer (.+)$/.exec(req.get('authorization') ?? '');
  return match?.[1] ?? null;
}

/** Thin HTTP layer: parse, call the domain, map results to status codes. No rules live here. */
export function apiRouter(service: ReviewService, sessions: SessionService): Router {
  const router = Router();

  // The settings the web app shows and follows, from config.json.
  router.get('/settings', (_req, res) => {
    res.json({
      reviewDeadlineMs: service.reviewDeadlineMs,
      monthlyReviewLimit: service.monthlyReviewLimit,
      sessionTtlMs: sessions.ttlMs,
      reviewers: service.availableReviewers,
    });
  });

  router.get('/lawyers', (_req, res) => {
    const inUse = sessions.lawyersInUse();
    res.json(service.listLawyers().map((lawyer) => ({ ...lawyer, inUse: inUse.has(lawyer.id) })));
  });

  // Sessions: one live session per lawyer (see domain/sessions.ts).
  router.post('/sessions', (req, res) => {
    const lawyerId: unknown = req.body?.lawyerId;
    if (typeof lawyerId !== 'string' || lawyerId === '') {
      return sendError(res, 400, 'invalid_request', 'lawyerId is required');
    }
    const result = sessions.claim(lawyerId);
    if (result.ok) return res.status(201).json({ ...result, ttlMs: sessions.ttlMs });
    if (result.error === 'unknown_lawyer') return sendError(res, 400, result.error, 'No such lawyer');
    return sendError(res, 409, result.error, 'This lawyer is being used in another browser right now', {
      ttlMs: sessions.ttlMs,
    });
  });

  router.put('/sessions/current', (req, res) => {
    const token = bearerToken(req);
    const lawyerId = token ? sessions.touch(token) : null;
    if (!lawyerId) return sendError(res, 401, 'session_expired', 'This session has ended');
    res.json({ lawyerId, ttlMs: sessions.ttlMs });
  });

  router.delete('/sessions/current', (req, res) => {
    const token = bearerToken(req);
    if (token) sessions.release(token);
    res.status(204).end();
  });

  // Workspace-scoped reads: documents and the monthly plan belong to a workspace.
  router.get('/workspaces/:id', (req, res) => {
    const workspace = service.getWorkspace(req.params.id);
    if (!workspace) return sendError(res, 404, 'workspace_not_found', 'No such workspace');
    res.json(workspace);
  });

  router.get('/workspaces/:id/plan', (req, res) => {
    const plan = service.getPlan(req.params.id);
    if (!plan) return sendError(res, 404, 'workspace_not_found', 'No such workspace');
    res.json(plan);
  });

  router.get('/workspaces/:id/documents', (req, res) => {
    const documents = service.listDocuments(req.params.id);
    if (!documents) return sendError(res, 404, 'workspace_not_found', 'No such workspace');
    res.json(documents);
  });

  router.get('/documents/:id', (req, res) => {
    const document = service.getDocument(req.params.id);
    if (!document) return sendError(res, 404, 'document_not_found', 'No such document');
    res.json(document);
  });

  // The document's review history: every review, newest first, compared with the one before.
  router.get('/documents/:id/reviews', (req, res) => {
    const history = service.getReviewHistory(req.params.id);
    if (!history) return sendError(res, 404, 'document_not_found', 'No such document');
    res.json(history);
  });

  router.post('/documents/:id/reviews', (req, res) => {
    // The requester is whoever holds the session; any requestedBy in the body is ignored, so
    // nobody can request a review as a lawyer who is being used in another browser.
    const token = bearerToken(req);
    if (!token) return sendError(res, 401, 'session_required', 'Choose who you are before requesting a review');
    const requestedBy = sessions.touch(token);
    if (!requestedBy) return sendError(res, 401, 'session_expired', 'This session has ended; choose who you are again');

    // The AI the lawyer chose for this review: the simulated one unless they asked for Claude.
    const reviewer: unknown = req.body?.reviewer === undefined ? 'fake' : req.body.reviewer;
    if (!REVIEWER_KINDS.includes(reviewer as ReviewerKind)) {
      return sendError(res, 400, 'invalid_request', 'reviewer must be "fake" or "claude"');
    }

    const result = service.requestReview(req.params.id, requestedBy, reviewer as ReviewerKind);
    if (result.ok) return res.status(201).json(result.review);

    switch (result.error) {
      case 'document_not_found':
        return sendError(res, 404, result.error, 'No such document');
      case 'unknown_lawyer':
        return sendError(res, 400, result.error, 'requestedBy is not a known lawyer');
      case 'not_a_member':
        return sendError(res, 403, result.error, 'Only members of the workspace that owns this document can request a review');
      case 'reviewer_unavailable':
        return sendError(res, 409, result.error, 'Claude is not available: the server has no Anthropic API key (ANTHROPIC_API_KEY)');
      case 'review_in_progress':
        return sendError(res, 409, result.error, 'A review of this document is already in progress', {
          reviewId: result.reviewId,
        });
      case 'plan_exhausted':
        return sendError(res, 409, result.error, 'All reviews included in this month’s plan have been used', {
          plan: result.plan,
          resetsAt: result.plan.resetsAt,
        });
      case 'slots_reserved':
        return sendError(
          res,
          409,
          result.error,
          'The remaining credits are held by reviews in progress; they free up if those reviews fail',
          { plan: result.plan, resetsAt: result.plan.resetsAt },
        );
    }
  });

  router.get('/reviews/:id', (req, res) => {
    const review = service.getReview(req.params.id);
    if (!review) return sendError(res, 404, 'review_not_found', 'No such review');
    res.json(review);
  });

  return router;
}
