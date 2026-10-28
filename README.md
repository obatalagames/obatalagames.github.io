# ChestPlayer GitHub Pages files

Upload the contents of this folder to the root of a GitHub Pages repository.
The public site is intentionally segmented:

- `index.html` — lightweight landing page and login router;
- `dashboard.html` — authenticated games, deposits, wallet, gifts, and recording controls;
- `onboarding.html` — first-wallet setup and required Terms/Privacy acceptance;
- `faq.html`, `support.html`, `termsofuse.html`, and `privacypolicy.html` — player-facing pages;

Keep the player pages and their public JS/CSS modules together in this
directory. The private operator console is intentionally not included in this
MVP. Payout decisions are handled manually in Supabase using the `withdrawals`
table. The `CNAME` file configures `chestplayer.us` as the primary custom
domain.

This build is configured for the single public backend gateway
`https://edge.chestplayer.us`. The segmented Workers are reached only through
Cloudflare Service Bindings behind that gateway.

The page is only the browser UI. Authentication, matches, clocks, answer
validation, balances, deposits, withdrawals, recording review, and logs are
handled by the Cloudflare Worker and Supabase.

