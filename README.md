# ChestPlayer auth-only frontend

This folder is the first clean frontend slice: a small home page and a MetaMask sign-in page. It does not include terms, privacy, onboarding, deposits, games, or payout UI yet.

Files:

- `index.html` — landing page and signed-in/signed-out state.
- `login.html` — MetaMask sign-in page.
- `auth.js` — Supabase Web3 sign-in plus Auth Worker session verification.
- `auth-config.js` — public browser configuration only.
- `index.js` and `login.js` — page-specific UI.
- `auth-pages.css` — shared styling.

For GitHub Pages, copy these files into the published site folder. Keep the existing `CNAME` file at the repository root. The browser must be opened at `https://chestplayer.us` (or the exact custom domain being used), not inside an iframe or masked redirect.

In Supabase Auth URL Configuration, keep the site URL as `https://chestplayer.us` and allow the login page, for example:

```text
https://chestplayer.us/**
```

The Auth Worker must allow the browser origin `https://chestplayer.us`. The public key in `auth-config.js` is safe to expose; never put a service-role key or Worker secret in the GitHub Pages files.
