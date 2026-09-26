import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { onRequestPost as signup } from '../src/routes/waitlist.js';
import { onRequestGet as showConfirm, onRequestPost as confirm } from '../src/routes/confirm.js';
import { confirmationUrl, verifyConfirmation } from '../src/lib.js';
import worker from '../src/worker.js';

const ORIGIN = 'https://www.cronpilot.com';
const env = {
  RESEND_API_KEY: 're_test',
  WAITLIST_SIGNING_KEY: 'test-signing-key',
  WAITLIST_FROM: 'Cron Pilot <waitlist@cronpilot.com>',
  RESEND_SEGMENT_ID: 'seg_123',
};

// Stand-in for Resend: records each call and answers with `respond`.
let calls;
let respond;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  respond = () => new Response('{"id":"x"}', { status: 200 });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return respond(url);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function post(body, headers = { Origin: ORIGIN }) {
  return new Request(`${ORIGIN}/api/waitlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function confirmForm(link) {
  const params = new URL(link).searchParams;
  return new Request(`${ORIGIN}/api/waitlist/confirm`, { method: 'POST', body: new URLSearchParams(params) });
}

describe('POST /api/waitlist', () => {
  it('emails a signed confirmation link and stores nothing yet', async () => {
    const response = await signup({ request: post({ email: '  Ada@Example.com ' }), env });

    assert.equal(response.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.deepEqual(calls[0].body.to, ['ada@example.com']);
    assert.equal(calls[0].body.from, env.WAITLIST_FROM);
    assert.match(calls[0].headers['Idempotency-Key'], /^waitlist-confirm-/);

    const link = calls[0].body.text.match(/https:\/\/\S+/)[0];
    assert.ok(link.startsWith(`${ORIGIN}/api/waitlist/confirm?`));
    assert.equal(await verifyConfirmation(new URL(link).searchParams, env.WAITLIST_SIGNING_KEY), 'ada@example.com');
  });

  it('rejects an invalid address without calling Resend', async () => {
    const response = await signup({ request: post({ email: 'not-an-email' }), env });

    assert.equal(response.status, 422);
    assert.equal(calls.length, 0);
  });

  it('quietly accepts a filled-in honeypot without sending anything', async () => {
    const response = await signup({ request: post({ email: 'bot@example.com', company: 'Spam Inc' }), env });

    assert.equal(response.status, 202);
    assert.equal(calls.length, 0);
  });

  it('refuses posts from other sites', async () => {
    const response = await signup({ request: post({ email: 'ada@example.com' }, { Origin: 'https://evil.example' }), env });

    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  });

  it('reports a failure when Resend rejects the email', async () => {
    respond = () => new Response('{"message":"nope"}', { status: 500 });

    const response = await signup({ request: post({ email: 'ada@example.com' }), env });

    assert.equal(response.status, 502);
  });

  it('reports a failure when it is not configured', async () => {
    const response = await signup({ request: post({ email: 'ada@example.com' }), env: {} });

    assert.equal(response.status, 502);
    assert.equal(calls.length, 0);
  });
});

describe('/api/waitlist/confirm', () => {
  it('shows a Confirm button instead of confirming when the link is opened', async () => {
    const link = await confirmationUrl(ORIGIN, 'ada@example.com', env.WAITLIST_SIGNING_KEY);

    const response = await showConfirm({ request: new Request(link), env });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /<form method="post">/);
    assert.match(html, /ada@example\.com/);
    assert.equal(calls.length, 0);
  });

  it('adds the contact to the segment when Confirm is pressed', async () => {
    const link = await confirmationUrl(ORIGIN, 'ada@example.com', env.WAITLIST_SIGNING_KEY);

    const response = await confirm({ request: confirmForm(link), env });

    assert.equal(response.status, 200);
    assert.match(await response.text(), /You're on the waitlist/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/contacts');
    assert.deepEqual(calls[0].body, { email: 'ada@example.com', unsubscribed: false, segments: ['seg_123'] });
  });

  it('treats an address that is already on the list as confirmed', async () => {
    respond = () => new Response('{"message":"Contact already exists"}', { status: 409 });
    const link = await confirmationUrl(ORIGIN, 'ada@example.com', env.WAITLIST_SIGNING_KEY);

    const response = await confirm({ request: confirmForm(link), env });

    assert.equal(response.status, 200);
  });

  it('rejects a link whose address was edited', async () => {
    const link = (await confirmationUrl(ORIGIN, 'ada@example.com', env.WAITLIST_SIGNING_KEY))
      .replace('ada%40example.com', 'eve%40example.com');

    for (const response of [
      await showConfirm({ request: new Request(link), env }),
      await confirm({ request: confirmForm(link), env }),
    ]) {
      assert.equal(response.status, 400);
    }
    assert.equal(calls.length, 0);
  });

  it('rejects a link signed with a different key', async () => {
    const link = await confirmationUrl(ORIGIN, 'ada@example.com', 'someone-elses-key');

    const response = await confirm({ request: confirmForm(link), env });

    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });

  it('rejects a link older than 7 days', async () => {
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    const link = await confirmationUrl(ORIGIN, 'ada@example.com', env.WAITLIST_SIGNING_KEY, eightDaysAgo);

    const response = await confirm({ request: confirmForm(link), env });

    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });

  it('escapes the address in the page it shows', async () => {
    const email = '"><script>x</script>@example.com';
    const link = await confirmationUrl(ORIGIN, email, env.WAITLIST_SIGNING_KEY);

    const html = await (await showConfirm({ request: new Request(link), env })).text();

    assert.doesNotMatch(html, /<script>x<\/script>/);
  });
});

describe('worker routing', () => {
  const assets = { fetch: async () => new Response('static file') };

  it('serves anything else from the static assets', async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/api/something-else`), { ...env, ASSETS: assets });

    assert.equal(await response.text(), 'static file');
  });

  it('routes the signup and confirm endpoints to their handlers', async () => {
    const signupResponse = await worker.fetch(post({ email: 'nope' }), { ...env, ASSETS: assets });
    const confirmResponse = await worker.fetch(new Request(`${ORIGIN}/api/waitlist/confirm`), { ...env, ASSETS: assets });

    assert.equal(signupResponse.status, 422);
    assert.equal(confirmResponse.status, 400);
  });

  it('rejects methods an endpoint does not handle', async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/api/waitlist`), { ...env, ASSETS: assets });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'POST');
  });
});
