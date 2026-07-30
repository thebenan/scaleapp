# scaleapp

Add your recipes, scale them to any number of servings.

Live at [nomathrequired.netlify.app](https://nomathrequired.netlify.app)

## Run it locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

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

## Deploying

Netlify builds on every push to `main`. The footer shows the deployed commit and
how many recipes are stored on the device.
