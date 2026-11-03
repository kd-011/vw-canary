# Contributing

Bug reports and fixes are welcome, and so are new steps in the client flow.

## Ground rules

- Node 22, ES modules, no npm dependencies. Use `node:` built-ins and call the real tools (`docker`, `npm`, `bw`).
- It talks to the container it started on 127.0.0.1 and nothing else. There is no flag to point it at a real server. Open an issue first if you want one. A change near that line needs a test that goes red when the guard is weakened.
- The client never sees the caller's Bitwarden config or session. Same rule about the test.
- Error text shown to the user is the tool's real error, with the throwaway password and session redacted.
- A broken client must come out as a FAIL (exit 1), and something vw-canary could not do must come out as an ERROR (exit 2). Mixing them up tells people their client is broken when it wasn't tested.
- A claim about a Vaultwarden or Bitwarden version in the docs needs a link and the date you checked it, or a run you did yourself.

## Running the tests

```sh
node --test                       # everything
node --test test/flow.test.mjs    # one file while you work
```

`test/real.test.mjs` runs a real Vaultwarden container and the real Bitwarden CLI. It skips itself when Docker or the npm registry is not available. Everything else runs against the bundled stub with a fake `docker` and `npm` on `PATH`.

`node scripts/make-hero.mjs` regenerates the README image and the social preview. It needs a Chromium-family browser.

## Sign-off (DCO)

There is no CLA. Certify the [Developer Certificate of Origin](https://developercertificate.org/) by signing off each commit:

```sh
git commit -s -m "Fix the matrix column width"
```

That adds a `Signed-off-by:` line with your git name and email.

## Dependency updates and CI

Dependabot proposes GitHub Actions updates weekly. Patch and minor updates, and any update to an action from the `actions/` organisation, merge on their own once the required checks pass. Other major updates wait for a person. CI runs `node --test` on Node 22 and 24, and once a week so the badge shows the current state of `main`.

A weekly job checks the links in the docs and runs `dossier-scribe check` against this repository's dossier in `dossiers/`. If a cited file changed, it opens one issue. To clear it, re-read the cited files, fix any claims that are no longer true, run `dossier-scribe pin` and commit the dossier and lock.

## Pull requests

Keep them small, add or update a test, and update the README when behaviour changes. Plain imperative commit messages are fine.
