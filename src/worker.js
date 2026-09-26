// Entry point for the cronpilot.com Worker.
//
// Cloudflare serves everything in public/ directly. Only requests matching
// run_worker_first in wrangler.jsonc (/api/*) reach this code.

import * as confirm from './routes/confirm.js';
import * as waitlist from './routes/waitlist.js';

const routes = {
  '/api/waitlist': { POST: waitlist.onRequestPost },
  '/api/waitlist/confirm': { GET: confirm.onRequestGet, POST: confirm.onRequestPost },
};

export default {
  async fetch(request, env) {
    const route = routes[new URL(request.url).pathname];

    if (!route) {
      return env.ASSETS.fetch(request);
    }

    const handler = route[request.method];

    if (!handler) {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: Object.keys(route).join(', ') },
      });
    }

    return handler({ request, env });
  },
};
