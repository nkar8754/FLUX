# FLUX daily: deploy guide

What's here: `public/` is the site (page + shared rules), `src/worker.js` is the API, `schema.sql` is the database,
`tools/` makes the puzzles, `test/run.js` checks everything. You need Node.js 22+ and a free Cloudflare account.

## 0. Check it works on your machine
```
npm install
npm test          # should print "9 checks passed"
```

## 1. Try it locally first (optional but worth it)
Use today's date in US Eastern time (YYYY-MM-DD) as START below.
```
npx wrangler d1 execute flux --local --file=schema.sql
SEED_SALT=dev node tools/seed.js START 3 > seed.sql
npx wrangler d1 execute flux --local --file=seed.sql
npm run dev        # open the address it prints
```
Windows PowerShell: set the salt with `$env:SEED_SALT="dev"` on its own line, then run the node command.

## 2. Deploy
```
npx wrangler login                       # opens your browser, click Allow
npx wrangler d1 create flux              # prints a database_id
```
Paste that id into `wrangler.toml` where it says `REPLACE_WITH_YOUR_DATABASE_ID`, then:
```
npx wrangler d1 execute flux --remote --file=schema.sql
SEED_SALT=<a long random secret> node tools/seed.js START 60 > seed.sql
npx wrangler d1 execute flux --remote --file=seed.sql
npx wrangler deploy                      # prints your https://flux-daily.<you>.workers.dev address
```
- Save the salt in a password manager. Keep `seed.sql` private (it contains future puzzles). Both are in `.gitignore`.
- You never put the salt in Cloudflare: puzzles are generated on your computer, only the finished days are uploaded.

## 3. Keeping it running
- **Reseed before you run out of days** (every month or so): run the seed command again starting the day after your last seeded date. Existing days are never overwritten. If a day is missing, the site shows "Couldn't load today's puzzle".
- **Change the code:** edit, run `npm test`, then `npx wrangler deploy`.
- **Rollover time:** `ROLLOVER_TZ` in `wrangler.toml` (default Eastern; `"UTC"` for a global midnight). Change it before launch, not after.
- **Difficulty:** `BAND` at the top of `tools/generator.js`. It affects only days you seed afterwards.

## Things to know
- Check Cloudflare's current free-plan limits (Workers requests and CPU time, D1 reads and storage) before launch. The API does only small queries, but limits change.
- Scores are recomputed on the server from each player's move log, so edited browser data can't fake a score. Time is self-reported and only breaks ties.
- Players are anonymous browser ids: clearing storage or using another browser means another entry. Accounts come later if you want cross-device streaks.
- In the Cloudflare dashboard, add a rate-limiting rule on `/api/submit` once real traffic arrives.
