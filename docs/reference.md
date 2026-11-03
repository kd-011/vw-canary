# Reference

## Commands

| Command | What it does |
| --- | --- |
| `vw-canary check --server <version> --client <version> [--json]` | Test one pair and print a table of steps. |
| `vw-canary check --matrix --servers a,b --clients x,y [--json]` | Test every server with every client and print a grid. The word `check` is optional here. |
| `vw-canary demo [--json]` | Run the report against a bundled fake server and fake clients. No Docker, no npm, no network. It exits 1 because one pair breaks on purpose. |
| `vw-canary --version` | Print the version. |
| `vw-canary --help` | Print the usage. |

There is no option for a server address. See [limitations.md](limitations.md).

## Versions

`--server` and `--servers` take a tag of the `vaultwarden/server` image: a number like `1.37.1`, optionally with `-alpine`, or one of `latest`, `alpine`, `testing`, `latest-alpine`, `testing-alpine`. The moving tags are pulled fresh on every run, and the report shows which version the image says it is, for example `latest (1.37.5)`.

`--client` and `--clients` take a version of the `@bitwarden/cli` npm package: a number like `2026.7.0`, or `latest`. The report shows what `bw --version` printed.

Anything else is a usage error, so a version string can't add an argument to `docker` or `npm`, or name a different image or package.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Every pair passed. |
| 1 | At least one client flow failed, and everything was tested. |
| 2 | Bad usage, or something could not be tested: Docker missing, an image or package that does not exist, a server that did not start, a registration the server refused. This wins over 1. |
| 130, 143 | Interrupted with Ctrl-C or SIGTERM. The container and temp dirs were removed first. |

## Steps

Each pair gets a new container, a new account and a new client home. The steps run in order and stop at the first failure. The rest are reported as `SKIP`.

| Step | Commands | Fails when |
| --- | --- | --- |
| `config server` | `bw config server <url>` | It exits non-zero. |
| `login` | `bw login <email> --passwordenv ... --raw` | It exits non-zero or prints no session key. |
| `sync` | `bw sync` | It exits non-zero. |
| `create item` | `bw create item <encoded>` | It exits non-zero, does not print JSON, returns no id, or the fields it returns differ from what went in. |
| `sync again` | `bw sync --force` | It exits non-zero. `--force` makes the client download the vault even if the revision date has not changed. |
| `list and decrypt` | `bw list items` | It exits non-zero, the item is not in the list, or its name, notes, username, password or URI differ from what went in. |
| `edit item` | `bw edit item`, `bw sync --force`, `bw get item` | The edit fails, or the item read back after a forced sync does not have the new values. |
| `delete item` | `bw delete item`, `bw sync --force`, `bw list items` | The delete fails, or the item is still in the list after a forced sync. |

Exit 0 from the client is not enough for a step to pass. `bw list items` exiting 0 with an empty list is a failure, and an item whose name comes back as `[error: cannot decrypt]` is a failure.

Each client command has 180 seconds before it is killed and the step fails.

## What needs to be installed

`check` needs `docker` and `npm` on `PATH`. The first run of a version downloads the image and about 90 MB of npm packages into a temp dir. npm's own cache makes later runs of that version faster. One pair takes about a minute on my machine, nearly all of it `bw` starting up about twelve times.

`demo` needs only Node 22 or newer.

## Output

Progress lines go to stderr and the report goes to stdout. `--json` prints the document described in [json-schema.md](json-schema.md). Colour is on when stdout is a terminal and `NO_COLOR` is not set.
