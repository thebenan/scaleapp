# scaleapp

Add your recipes, scale them to any number of servings.

Live at [nomathrequired.netlify.app](https://nomathrequired.netlify.app)

Sign in with a passphrase to get your own cookbook, synced across your devices
and usable offline. You can publish a copy of a recipe so anyone can read it
without signing in.

Each person's recipes are stored under their own key, so two people can share a
browser without seeing each other's cookbooks. Recipes saved before signing in
stay separate unless you choose to add them to an account.

## Run it locally

```sh
node tests/devserver.mjs 8000   # then open http://localhost:8000
```

Serves the files and a working `/api`, using the same `api/core.mjs` the deployed
function runs, backed by an in-memory store. No npm, no `netlify dev`. Data is
discarded when the process stops.

Test passphrases: `test-passphrase` (person `tester`, admin) and
`other-passphrase` (person `other`). Override with `AUTH_TOKENS` and `ADMIN_USER`.

`python3 -m http.server 8000` also works if you don't need `/api`.

The service worker does not register on localhost, because its cache name comes
from the deploy-time build id and would serve stale files after every edit. Add
`?sw=1` to the URL to test offline behaviour.

## Tests

```sh
./tests/run.sh              # all cases
./tests/run.sh identity     # just the ones matching "identity"
```

Needs `python3` and Chrome. Each case is injected into the real `index.html` and
run in headless Chrome, so the tests drive the actual app.

To add one, drop `<name>.test.js` into `tests/cases/` (plus an optional
`<name>.seed.js` that runs first, to set up `localStorage`). Inside a case:

- `check(label, condition, detail)` — record a result
- `await waitFor(predicate)` — poll for something async; don't use `setTimeout`,
  it races and makes the test flaky

## Run tests before every push

```sh
git config core.hooksPath .githooks
```

One-time, per clone. Skips itself if Chrome isn't installed; bypass with
`git push --no-verify`. GitHub Actions runs the same suite on every push.

## How it fits together

| File | Role |
|---|---|
| `storage.js` | recipes, migrations, persistence. Knows nothing about the DOM |
| `sync.js` | pull/push, conflict resolution, offline outbox, publishing |
| `format.js` | amounts as a cook would write them (`1½ cup`, not `1.50`) |
| `script.js` | all the UI |
| `api/core.mjs` | server logic. No Netlify imports, so it runs anywhere |
| `netlify/functions/api.mjs` | thin adapter: Netlify Blobs + env vars |
| `tests/devserver.mjs` | the same core with an in-memory store |

Moving off Netlify means rewriting `netlify/functions/api.mjs` only.

### Server configuration

Two environment variables, set in the Netlify UI and never committed:

- `AUTH_TOKENS` — `{"benan":"a-long-passphrase","alice":"another-one"}`.
  One entry per person; each secret must be 8+ characters. Parsed per request,
  so adding or rotating somebody takes effect without a redeploy.
- `ADMIN_USER` — the one person who may also remove anyone else's published
  recipe, e.g. `benan`.

`package.json` exists only so Netlify can install `@netlify/blobs` when bundling
the function. The frontend still ships raw, unbundled files.

## Deploying

Netlify builds on every push to `main`. The footer shows the deployed commit and
how many recipes are stored on the device.



