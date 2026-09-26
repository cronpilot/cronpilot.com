# cronpilot.com

The landing page for Cron Pilot, hosted on Cloudflare Pages. The page itself is static, with no build step, no framework
and no third-party requests (fonts are self-hosted). One Pages Function handles the Cloud waitlist.

```
public/                     the website Cloudflare serves
  index.html                the whole page: HTML, CSS and JS inline
  assets/                   screenshots, tour videos, logo mark, favicons, og.png, fonts/
functions/api/waitlist.js           POST /api/waitlist: sends the confirmation email
functions/api/waitlist/confirm.js   GET/POST /api/waitlist/confirm: confirms and adds the contact
lib/waitlist.js             shared waitlist logic (not served)
tests/                      node --test tests for the waitlist
```

## Working on it

- **Preview the page:** `php -S localhost:8000 -t public` (or any static server). The waitlist form needs the
  functions, so it shows an error here. Set `WAITLIST_ENDPOINT = ''` in `public/index.html` to preview the form's
  states without a backend.
- **Run the page and the functions together:** `npx wrangler pages dev public` with the variables below in a local
  `.dev.vars` file (git-ignored).
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

## Deployment (Cloudflare Pages)

Pages deploys `main` automatically and builds a preview for every pull request.

**Project settings:** framework preset **None**, build command **empty**, build output directory **`public`**,
production branch **`main`**.

**Variables and Secrets** (Settings → Variables and Secrets). Set them for **Production only**, so preview builds
can't send email or add contacts:

| Name | Type | Value |
|---|---|---|
| `RESEND_API_KEY` | Secret | A Resend API key with sending access for cronpilot.com and contact access |
| `WAITLIST_SIGNING_KEY` | Secret | A long random string, e.g. from `openssl rand -base64 32`. Changing it invalidates unconfirmed links. |
| `WAITLIST_FROM` | Plain text | `Cron Pilot <waitlist@cronpilot.com>` |
| `RESEND_SEGMENT_ID` | Plain text | The ID of the "Cloud waitlist" segment in Resend (optional) |

**Resend:** add `cronpilot.com` as a sending domain and add the DNS records it lists in Cloudflare. The records should
be DNS-only (grey cloud), not proxied.

**Cloudflare rules for the zone:**

- **Redirect `www`:** Rules → Redirect Rules → the "Redirect from WWW to root" template.
- **Rate-limit the signup:** Security → WAF → Rate limiting rules, for example 5 requests per 10 seconds per IP on
  `/api/waitlist`. This stops the form being used to send lots of confirmation emails.

## Secrets

This repository is public. **Never commit API keys or credentials.** They live only in the Pages project's
Variables and Secrets, and locally in `.dev.vars`, which is git-ignored.

## Before launch

- **Star count:** set `SHOW_STAR_COUNT = true` in `public/index.html` to show GitHub stars in the header (one
  unauthenticated call to api.github.com).
- `public/assets/og.png` is the social card (1200×630) for HN, LinkedIn and Slack unfurls.

## Notes

- The name is written "Cron Pilot" everywhere. Only the domain, the GitHub org and paths use `cronpilot`.
- Light and dark follow the OS. The header button overrides that and remembers the choice in localStorage.
- `tour.mp4` and `tour-dark.mp4` (about 220 KB each) replace the 1.7 MB GIFs. Only the one matching the theme plays,
  only when scrolled into view, and never with reduced motion.
