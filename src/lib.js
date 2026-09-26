// Shared logic for the Cron Pilot Cloud waitlist's double opt-in.
//
// 1. POST /api/waitlist sends a confirmation email. Nothing is stored yet, so
//    an address nobody confirms never reaches the list.
// 2. The email links to /api/waitlist/confirm with the address, the time it
//    was issued and an HMAC signature, so the link can't be forged or edited.
// 3. Opening the link shows a Confirm button rather than confirming straight
//    away, because email security scanners open links automatically.
// 4. Pressing it creates the contact in Resend, which records when consent
//    was given.
//
// Environment:
//   RESEND_API_KEY        secret   Resend API key (Worker > Settings > Variables and Secrets)
//   WAITLIST_SIGNING_KEY  secret   random string used to sign confirmation links (same place)
//   WAITLIST_FROM         plain    in wrangler.jsonc, e.g. "Cron Pilot <waitlist@cronpilot.com>"
//   RESEND_SEGMENT_ID     plain    in wrangler.jsonc, optional: Resend segment to add contacts to

const RESEND_API = 'https://api.resend.com';
const LINK_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidEmail(email) {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

// --- Signed confirmation links ---------------------------------------------

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function signedPayload(email, issuedAt) {
  return new TextEncoder().encode(`${email}|${issuedAt}`);
}

export async function confirmationUrl(origin, email, secret, issuedAt = Math.floor(Date.now() / 1000)) {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), signedPayload(email, issuedAt));
  const params = new URLSearchParams({ email, t: String(issuedAt), sig: toBase64Url(signature) });

  return `${origin}/api/waitlist/confirm?${params}`;
}

/**
 * Check a confirmation link's parameters. Returns the email when the link is
 * genuine and unexpired, or null.
 */
export async function verifyConfirmation(params, secret, now = Math.floor(Date.now() / 1000)) {
  const email = normalizeEmail(params.get('email'));
  const issuedAt = Number(params.get('t'));
  const signature = params.get('sig');

  if (!isValidEmail(email) || !Number.isInteger(issuedAt) || !signature) {
    return null;
  }

  if (issuedAt > now + 60 || now - issuedAt > LINK_LIFETIME_SECONDS) {
    return null;
  }

  let signatureBytes;
  try {
    signatureBytes = fromBase64Url(signature);
  } catch {
    return null;
  }

  // subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), signatureBytes, signedPayload(email, issuedAt));

  return valid ? email : null;
}

// --- Resend -----------------------------------------------------------------

async function resend(env, path, body, headers = {}) {
  return fetch(`${RESEND_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export async function sendConfirmationEmail(env, email, link) {
  const response = await resend(env, '/emails', {
    from: env.WAITLIST_FROM,
    to: [email],
    subject: 'Confirm your spot on the Cron Pilot Cloud waitlist',
    text: [
      'Thanks for your interest in Cron Pilot Cloud.',
      '',
      'Confirm your email to join the waitlist:',
      link,
      '',
      "We'll only email you about the Cloud launch. If you didn't ask to join, ignore this email and you won't be added.",
      '',
      '— Peter Meth, Cron Pilot · https://cronpilot.com',
    ].join('\n'),
    html: confirmationEmailHtml(link),
  }, {
    // A retried request within a day sends one email, not two.
    'Idempotency-Key': `waitlist-confirm-${await sha256(link)}`,
  });

  if (!response.ok) {
    throw new Error(`Resend rejected the confirmation email: HTTP ${response.status}`);
  }
}

export async function addContact(env, email) {
  const body = { email, unsubscribed: false };
  if (env.RESEND_SEGMENT_ID) {
    body.segments = [env.RESEND_SEGMENT_ID];
  }

  const response = await resend(env, '/contacts', body);

  if (response.ok) {
    return;
  }

  // Confirming twice, or confirming an address already on the list, is fine.
  const details = await response.text();
  if ((response.status === 409 || response.status === 422) && /already exists/i.test(details)) {
    return;
  }

  throw new Error(`Resend rejected the contact: HTTP ${response.status}`);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));

  return toBase64Url(digest);
}

// --- Responses ---------------------------------------------------------------

export function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function page(title, bodyHtml, status = 200) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Cron Pilot</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: light dark; --bg: #faf8f4; --ink: #17162b; --muted: #5c5a70; --accent: #f4400d; --card: #fff; --line: #e7e2d8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d0c17; --ink: #f3f1ea; --muted: #a7a4b8; --card: #17162b; --line: #2a2840; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 460px; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 32px; }
  h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 12px; }
  p { margin: 0 0 16px; color: var(--muted); }
  strong { color: var(--ink); word-break: break-all; }
  button { font: inherit; font-weight: 600; background: var(--accent); color: #fff; border: 0; border-radius: 10px; padding: 12px 20px; cursor: pointer; }
  a { color: var(--accent); }
</style>
</head>
<body><main>${bodyHtml}</main></body>
</html>`;

  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function confirmationEmailHtml(link) {
  const href = escapeHtml(link);

  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#faf8f4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#17162b">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e7e2d8;border-radius:14px;padding:32px">
    <p style="margin:0 0 16px;font-size:16px">Thanks for your interest in <strong>Cron Pilot Cloud</strong>.</p>
    <p style="margin:0 0 24px;font-size:16px">Confirm your email to join the waitlist:</p>
    <p style="margin:0 0 24px"><a href="${href}" style="display:inline-block;background:#f4400d;color:#fff;text-decoration:none;font-weight:600;border-radius:10px;padding:12px 20px">Confirm my email</a></p>
    <p style="margin:0 0 16px;font-size:14px;color:#5c5a70">We'll only email you about the Cloud launch. If you didn't ask to join, ignore this email and you won't be added.</p>
    <p style="margin:0;font-size:13px;color:#5c5a70">Peter Meth, Cron Pilot · <a href="https://cronpilot.com" style="color:#f4400d">cronpilot.com</a></p>
  </div>
</body></html>`;
}
