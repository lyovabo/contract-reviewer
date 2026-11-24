import { afterEach, describe, expect, it } from 'vitest';
import { DOC, LAWYER, SESSION_TTL, T0, setup } from './helpers';

let ctx: ReturnType<typeof setup>;
afterEach(() => ctx?.server.close());

const claim = (lawyerId: string) => ctx.http.post('/api/sessions').send({ lawyerId });
const heartbeat = (token: string) => ctx.http.put('/api/sessions/current').set('Authorization', `Bearer ${token}`);
const requestAs = (token: string | null, body: object = {}) => {
  const req = ctx.http.post(`/api/documents/${DOC.nda}/reviews`);
  return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
};

describe('one live session per lawyer', () => {
  it('while a lawyer is in use in one browser, nobody else can take them; other lawyers stay free', async () => {
    ctx = setup();
    expect((await claim(LAWYER.elena)).status).toBe(201);

    const second = await claim(LAWYER.elena);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('lawyer_in_use');
    expect((await claim(LAWYER.priya)).status).toBe(201);

    const lawyers = (await ctx.http.get('/api/lawyers')).body;
    const inUse = Object.fromEntries(lawyers.map((l: { id: string; inUse: boolean }) => [l.id, l.inUse]));
    expect(inUse).toEqual({
      [LAWYER.elena]: true,
      [LAWYER.priya]: true,
      [LAWYER.tomas]: false,
      [LAWYER.jonas]: false,
      [LAWYER.amelie]: false,
      [LAWYER.kofi]: false,
    });
  });

  it('two browsers taking the same lawyer at the same moment: exactly one gets the session', async () => {
    ctx = setup();
    const [a, b] = await Promise.all([claim(LAWYER.kofi), claim(LAWYER.kofi)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('a review request needs a live session, and the requester is always that session’s lawyer', async () => {
    ctx = setup();
    const none = await requestAs(null, { requestedBy: LAWYER.elena });
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('session_required');
    expect((await requestAs('made-up-token')).body.error.code).toBe('session_expired');

    // Priya's session cannot request as Elena, whatever the body claims.
    const priya = (await claim(LAWYER.priya)).body.token;
    const res = await requestAs(priya, { requestedBy: LAWYER.elena });
    expect(res.status).toBe(201);
    expect(res.body.requestedBy).toBe(LAWYER.priya);
  });

  it(`a session ends ${SESSION_TTL / 1000}s after its last sign of life; heartbeats keep it alive`, async () => {
    ctx = setup();
    const token = (await claim(LAWYER.elena)).body.token;

    const heartbeatAt = T0 + SESSION_TTL - 1;
    ctx.time.setNow(heartbeatAt);
    expect((await claim(LAWYER.elena)).status).toBe(409);
    expect((await heartbeat(token)).status).toBe(200); // live while now < heartbeatAt + SESSION_TTL

    ctx.time.setNow(heartbeatAt + SESSION_TTL - 1);
    expect((await claim(LAWYER.elena)).status).toBe(409);

    ctx.time.setNow(heartbeatAt + SESSION_TTL); // a whole lifetime of silence: the browser is gone
    expect((await heartbeat(token)).status).toBe(401);
    const someoneElse = await claim(LAWYER.elena);
    expect(someoneElse.status).toBe(201);
    expect((await requestAs(token)).body.error.code).toBe('session_expired'); // the old token is dead
    expect((await requestAs(someoneElse.body.token)).status).toBe(201);
  });

  it('switching lawyer releases the session at once', async () => {
    ctx = setup();
    const token = (await claim(LAWYER.elena)).body.token;
    expect((await ctx.http.delete('/api/sessions/current').set('Authorization', `Bearer ${token}`)).status).toBe(204);
    expect((await claim(LAWYER.elena)).status).toBe(201);
    expect((await heartbeat(token)).status).toBe(401);
  });
});
