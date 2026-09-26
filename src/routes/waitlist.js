import {
  confirmationUrl,
  isValidEmail,
  json,
  normalizeEmail,
  requireEnv,
  sendConfirmationEmail,
} from '../lib.js';

/**
 * POST /api/waitlist: send a confirmation email to the address the form
 * submitted. The address isn't stored until it's confirmed.
 */
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);

  // Only the site's own form may post here, so other pages can't use this to
  // send confirmation emails to arbitrary addresses.
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) {
    return json({ error: 'Forbidden' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send JSON: { "email": "..." }' }, 400);
  }

  // The form's hidden "company" field is a honeypot. Pretend it worked so
  // bots don't learn to leave it empty.
  if (body.company) {
    return json({ ok: true }, 202);
  }

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return json({ error: 'Enter a valid email address.' }, 422);
  }

  try {
    requireEnv(env, ['RESEND_API_KEY', 'WAITLIST_SIGNING_KEY', 'WAITLIST_FROM']);
    const link = await confirmationUrl(url.origin, email, env.WAITLIST_SIGNING_KEY);
    await sendConfirmationEmail(env, email, link);
  } catch (error) {
    console.error('waitlist signup failed', error);

    return json({ error: 'Could not send the confirmation email.' }, 502);
  }

  return json({ ok: true }, 202);
}
