# How it works

## The throwaway server

```sh
docker create --rm --name vw-canary-<random> --label vw-canary=1 \
  -p 127.0.0.1::443 --tmpfs /data \
  -e SIGNUPS_ALLOWED=true -e ROCKET_PORT=443 \
  -e 'ROCKET_TLS={certs="/tmp/cert.pem",key="/tmp/key.pem"}' \
  vaultwarden/server:<version>
```

`-p 127.0.0.1::443` asks Docker for a random free port on loopback. vw-canary reads it back with `docker port` and refuses to carry on if the answer is anything but one `127.0.0.1:<port>` line. `--tmpfs /data` means the database lives in memory and nothing lands on the host. The certificate files are put in with `docker cp` before `docker start`, which avoids a bind mount and the root-owned files that come with one.

When the checks finish, or on Ctrl-C or SIGTERM, it runs `docker rm -f` and deletes its temp dir.

## Why TLS

`bw` refuses to send requests over plain http: "Insecure URL not allowed. All URLs must use HTTPS." So the server has to speak TLS, even on loopback. Node can sign but has no way to write an X.509 certificate, so `src/cert.mjs` builds one by hand: P-256, valid for two days, with `127.0.0.1` as its only name. A new one is made for each server. The client is told to trust it with `NODE_EXTRA_CA_CERTS`, and it is the only extra certificate it trusts. Certificate checking stays on.

## The account

`bw` can't create accounts, so vw-canary does what a client does at sign-up, with `node:crypto`:

1. Master key: PBKDF2-SHA256 of the password, salted with the lowercased email, 600,000 rounds.
2. Password hash for the server: one more PBKDF2 round of the master key, salted with the password.
3. Stretched key: HKDF-Expand of the master key with the info strings `enc` and `mac`.
4. User key: 64 random bytes, encrypted with the stretched key as a type 2 EncString, which is `2.<iv>|<ciphertext>|<mac>` in base64, using AES-256-CBC and HMAC-SHA256.
5. An RSA-2048 key pair. The private key is encrypted with the user key in the same format.

Then it posts these to the server. Current servers want `POST /identity/accounts/register/send-verification-email` first, which answers with a token when mail is off, then `POST /identity/accounts/register/finish`. A server without that first route gets `POST /identity/accounts/register` with the same fields. The email ends in `.invalid` and the password is random for each pair.

If the server refuses, the result is an ERROR with exit 2, because the client was never tested.

## The client

`npm install --prefix <temp dir> --ignore-scripts @bitwarden/cli@<version>`. It installs once per version per run.

The client runs with a private `HOME`, `XDG_CONFIG_HOME`, `TMPDIR` and `BITWARDENCLI_APPDATA_DIR`. From the caller's environment it gets only `PATH`, `LANG`, `LC_ALL` and `TZ`, so `BW_SESSION`, `NODE_OPTIONS`, `NODE_TLS_REJECT_UNAUTHORIZED` and proxy settings in your shell don't reach it. Each command runs in its own process group, so a timeout kills everything it started. The password goes in through `--passwordenv` and the session through `BW_SESSION`, so neither shows in `ps`.

The steps and what makes each one fail are in [reference.md](reference.md#steps).

## The demo

`src/stub/server.mjs` is a real HTTPS server with just enough of the API: prelogin, register, token, sync and ciphers. `src/stub/fake-bw.mjs` takes the same arguments as `bw`, and does real key derivation and real encryption, and only the ciphertext crosses the wire. They run through the same flow and report code as a real check, so a real failure prints in the same format.

The break in the demo is made up. `stub-b` serves the cipher list under a new field name and `fake-old` only knows the old one, so sync succeeds and the vault comes back empty with no error.
