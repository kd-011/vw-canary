# Limitations

## A PASS is about the CLI

vw-canary drives the official Bitwarden CLI, `@bitwarden/cli`. The browser extension, the desktop app, the mobile apps and the web vault are other programs. They call the same API, and they can fail on a pair where the CLI works.

So a PASS means the CLI flow worked for that pair. It does not mean every client works. These two reports describe browser extensions failing on versions where the CLI passes:

- [Vaultwarden discussion #7529](https://github.com/dani-garcia/vaultwarden/discussions/7529) (opened 2026-07-31, read 2026-11-03): Vaultwarden 1.37.1 with browser extension 2026.7.0 showed no vault contents until the extension was synced by hand. With the CLI, this pair passes.
- [Vaultwarden issue #7607](https://github.com/dani-garcia/vaultwarden/issues/7607) (opened 2026-08-20, read 2026-11-03): Vaultwarden 1.37.1 with browser extension 2026.8.0, where the UI stops rendering. A commenter's debug output shows `RangeError: invalid date` in the extension's policy code. With the CLI, this pair passes.

A FAIL shows that one official client could not do the flow against that server. It does not prove the extension fails on that pair too.

## What the flow does not touch

One account, one login item, no organisation. These are not tested:

- Organisations, collections, policies and sharing. The `RangeError` in #7607 came from policy handling, and the test account has no policies, which may be why the CLI missed it. I have not confirmed that.
- Attachments, Sends, folders and the other item types (cards, identities, secure notes, SSH keys).
- Two-factor login, SSO, emergency access, API keys and passkeys.
- Password changes, KDF changes and key rotation.
- Autofill and anything else that only exists in a UI.
- Argon2id. The test account uses PBKDF2-SHA256.

## How close it is to your server

The server is a default container with an empty SQLite database in memory and a brand new account. Your server has an old database, your settings and a reverse proxy.

- It can't see upgrade problems. Migrating a database from an older version is not tested, and neither are accounts created long ago.
- It can't see problems caused by your settings, your database type (MySQL, PostgreSQL) or your reverse proxy.
- It has no mail configured, so the verification flows that send mail don't run.

## No real server, on purpose

There is no flag to point it at a real server, and version 0.1 won't get one. It creates accounts and writes data, which is not something to do by accident to a server with real users on it. It does not read `~/.config/Bitwarden` or any other real vault. For the details see [how-it-works.md](how-it-works.md).

## The registration is my code

The bw CLI can't create accounts, so vw-canary registers the account itself using its own implementation of the key derivation and the request format. A future server could change that request. That shows up as an ERROR at the `register account` stage with exit 2, and the client is reported as not tested.

The account it creates is made the same way as a client's, as far as I can read from Vaultwarden's source, but it did not come from a Bitwarden client. A break that depends on how a real client set up an account would not show up.

## Other limits

- `kill -9` can't be cleaned up after. The container keeps running until you remove it: `docker ps --filter label=vw-canary`, then `docker rm -f <name>`. The temp dir stays under your system's temp directory, named `vw-canary-*`.
- It only runs the official `vaultwarden/server` image from Docker Hub, so forks and other registries are out.
- Client versions come from npm. A version that was never published to npm can't be tested, and a browser extension version with the same number can differ from the CLI.
- I develop and test it on Linux with Docker. Podman's Docker shim, macOS and Windows have not been tried.
- It does not verify the image or package beyond what Docker and npm do. See [SECURITY.md](../SECURITY.md).
- Pairs run one at a time, each with a fresh container, so a large grid is slow. About a minute a pair.
