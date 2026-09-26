# cronpilot.com

Static landing page for Cron Pilot. No build step, no framework, no third-party requests (fonts are self-hosted).

```
index.html            the whole page: HTML, CSS and JS inline
assets/               screenshots, tour video, logo mark, favicons, og.png, fonts/
```

Preview locally: `php -S localhost:8000` (or any static server) in this folder.

## Before launch

- **Waitlist endpoint**: set `WAITLIST_ENDPOINT` at the bottom of `index.html`. The form POSTs JSON `{ "email": "..." }`
  and treats any 2xx as success. Most providers (Buttondown, ConvertKit, Formspree) accept this or need a one-line
  change to the `fetch` call. While empty, the form runs in preview mode; an address containing `fail` shows the error state.
- **Maintainer photo**: replace the `PM` initials in the "Why I built it" section (look for the TODO comment).
- **Star count**: set `SHOW_STAR_COUNT = true` to show GitHub stars in the header (one unauthenticated call to api.github.com).
- `assets/og.png` is the social card (1200x630) for HN, LinkedIn, Slack unfurls.

## Notes

- Name is written "Cron Pilot" everywhere; only the domain, GitHub org and paths use `cronpilot`.
- Light/dark follows the OS; the header button overrides and remembers the choice in localStorage.
- `tour.mp4` and `tour-dark.mp4` (about 220 KB each) replace the 1.7 MB GIFs. Only the one matching the theme plays, only when scrolled into view, and never with reduced motion.

## Secrets

This repository is public. Never commit API keys or credentials. The waitlist's newsletter API key lives only in the
server-side function's environment, and deploys get short-lived AWS credentials through GitHub OIDC rather than stored
keys.
