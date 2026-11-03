# Changelog

Notable changes are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## 0.1.0

First release.

- `check` starts a throwaway Vaultwarden container on 127.0.0.1, registers a throwaway account and runs the Bitwarden CLI through login, sync, create, sync, list and decrypt, edit and delete. It prints a table of steps with the first real error.
- `check --matrix` runs every server with every client and prints a grid.
- `demo` runs the same report against a bundled fake server and fake clients, with no Docker and no network.
- `--json` output with a documented schema, and exit codes 0, 1 and 2.
- No dependencies. Needs Node 22 or newer, and Docker and npm for `check`.
