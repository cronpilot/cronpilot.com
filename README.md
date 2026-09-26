# cronpilot.com

The landing page for Cron Pilot, deployed as a Cloudflare Worker with static assets. The page itself is static, with no
build step, no framework and no third-party requests (fonts are self-hosted). A few lines of Worker code handle the
Cloud waitlist.

```
public/                 the website Cloudflare serves as static files
  index.html            the whole page: HTML, CSS and JS inline
  404.html              served, with a 404 status, for missing pages
  assets/               screenshots, tour videos, logo mark, favicons, og.png, fonts/
src/worker.js           Worker entry point: routes /api/* to the waitlist handlers
src/routes/waitlist.js  POST /api/waitlist: sends the confirmation email
src/routes/confirm.js   GET/POST /api/waitlist/confirm: confirms and adds the contact
src/lib.js              shared waitlist logic
wrangler.jsonc          Worker config: assets, routing, plain variables
tests/                  node --test tests for the waitlist and routing
```

## Working on it

- **Run the site and the waitlist locally:** `npx wrangler dev`, with the two secrets below in a local `.dev.vars`
  file, which is git-ignored.
- **Preview just the page:** `php -S localhost:8000 -t public`. The form shows an error without the Worker. Set
  `WAITLIST_ENDPOINT = ''` in `public/index.html` to preview its states without a backend.
- **Tests:** `npm test` (Node 20+; no dependencies).

## How the waitlist works

Double opt-in, so only people who confirm end up on the list:

1. The form posts `{ email }` to **`POST /api/waitlist`**. It checks the address and the hidden honeypot field, then
   emails a confirmation link through Resend. **Nothing is stored at this point.**
2. The link carries the address and the time it was issued, signed with `WAITLIST_SIGNING_KEY`. It lasts 7 days and
   can't be forged or edited.
3. Opening the link shows a **Confirm** button rather than confirming straight away, because email security scanners
   open links automatically.
4. Pressing it creates the contact in Resend, in the waitlist segment. The contact's creation time records when
   consent was given.

## Deployment (Cloudflare Workers)

The Worker is connected to this repository with Workers Builds, which runs `npx wrangler deploy` on every push to
`main`. Build command: **empty**. Deploy command: **`npx wrangler deploy`**.

**Secrets** (Worker → Settings → Variables and Secrets → Add → type **Secret**):

| Name | Value |
|---|---|
| `RESEND_API_KEY` | A Resend API key with sending access for cronpilot.com and contact access |
| `WAITLIST_SIGNING_KEY` | A long random string, e.g. from `openssl rand -base64 32`. Changing it invalidates unconfirmed links. |

**Plain settings live in `wrangler.jsonc` under `vars`**, not the dashboard: `WAITLIST_FROM`, and `RESEND_SEGMENT_ID`
once the segment exists. `wrangler deploy` replaces the Worker's plain variables with the ones in the file, but it
leaves secrets alone.

**Branch builds:** Workers Builds can also build branches other than `main` as preview versions. Those use the same
secrets as production, so either keep that off (Settings → Build → Branch control) or remember that anyone who can
push a branch here can run code with the secrets. Pull requests from forks aren't built.

**Resend:** add `cronpilot.com` as a sending domain, and add the DNS records it lists in Cloudflare as DNS-only (grey
cloud), not proxied.

**Domains:** Worker → Settings → Domains & Routes → Add → **Custom domain**: `cronpilot.com`, then `www.cronpilot.com`.

**Cloudflare rules for the zone:**

- **Redirect to `www`:** `www.cronpilot.com` is the canonical address. Rules → Redirect Rules → the "Redirect from
  root to WWW" template sends `cronpilot.com` there with a 301.
- **Rate-limit the signup:** Security → WAF → Rate limiting rules, for example 5 requests per 10 seconds per IP on
  `/api/waitlist`. This stops the form being used to send lots of confirmation emails.

## Secrets

This repository is public. **Never commit API keys or credentials.** They live only in the Worker's secrets, and
locally in `.dev.vars`, which is git-ignored.

## Before launch

- **Star count:** set `SHOW_STAR_COUNT = true` in `public/index.html` to show GitHub stars in the header (one
  unauthenticated call to api.github.com).
- `public/assets/og.png` is the social card (1200×630) for HN, LinkedIn and Slack unfurls.

## Notes

- The name is written "Cron Pilot" everywhere. Only the domain, the GitHub org and paths use `cronpilot`.
- Light and dark follow the OS. The header button overrides that and remembers the choice in localStorage.
- `tour.mp4` and `tour-dark.mp4` (about 220 KB each) replace the 1.7 MB GIFs. Only the one matching the theme plays,
  only when scrolled into view, and never with reduced motion.
