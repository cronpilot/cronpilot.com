import {
  addContact,
  escapeHtml,
  page,
  requireEnv,
  verifyConfirmation,
} from '../lib.js';

const invalidLink = () => page(
  'Link expired',
  `<h1>This confirmation link has expired or isn't valid.</h1>
   <p>Confirmation links last 7 days. Join the waitlist again to get a new one.</p>
   <p><a href="/#cloud">Back to the waitlist</a></p>`,
  400,
);

/**
 * GET /api/waitlist/confirm: show a Confirm button. Opening the link doesn't
 * confirm on its own, because email security scanners open links too.
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const email = await verifyConfirmation(url.searchParams, env.WAITLIST_SIGNING_KEY || '');

  if (!email) {
    return invalidLink();
  }

  const hidden = ['email', 't', 'sig']
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(url.searchParams.get(name))}">`)
    .join('');

  return page(
    'Confirm your email',
    `<h1>One last click.</h1>
     <p>Press Confirm to add <strong>${escapeHtml(email)}</strong> to the Cron Pilot Cloud waitlist. We'll email you once, when it launches.</p>
     <form method="post">${hidden}<button type="submit">Confirm</button></form>
     <p style="margin:20px 0 0;font-size:14px">This extra step stops email security scanners, which open links automatically, from signing you up.</p>`,
  );
}

/**
 * POST /api/waitlist/confirm: the Confirm button. Adds the contact in Resend,
 * which records when consent was given.
 */
export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const email = await verifyConfirmation(form, env.WAITLIST_SIGNING_KEY || '');

  if (!email) {
    return invalidLink();
  }

  try {
    requireEnv(env, ['RESEND_API_KEY']);
    await addContact(env, email);
  } catch (error) {
    console.error('waitlist confirmation failed', error);

    return page(
      'Something went wrong',
      `<h1>We couldn't confirm your email just now.</h1>
       <p>Your link still works. Please try again in a minute.</p>`,
      502,
    );
  }

  return page(
    "You're on the waitlist",
    `<h1>You're on the waitlist.</h1>
     <p>We'll email <strong>${escapeHtml(email)}</strong> once, when Cron Pilot Cloud launches.</p>
     <p>Until then, the self-hosted version is on <a href="https://github.com/cronpilot/cronpilot">GitHub</a>.</p>`,
  );
}
