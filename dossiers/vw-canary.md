---
slug: vw-canary
name: vw-canary
repo: .
status: active
last_verified: 2026-11-03
tags: [cli, node, vaultwarden, bitwarden]
---

A command line tool that tests one Bitwarden CLI version against one Vaultwarden version in a throwaway container. These claims are the README's main promises, each tied to the code that keeps it.

## Features

- Runs on Node 22 or newer and installs one command, `vw-canary`. <!-- src: package.json:12, package.json:14 -->
- Has no runtime or development dependencies, only Node built-ins. <!-- src: package.json -->
- Takes only version-shaped server and client arguments, so nothing can name another server, image or package. <!-- src: src/cli.mjs:31-32 -->
- A step fails on a non-zero exit, and also when the item is missing from the list, which catches an empty vault with exit 0. <!-- src: src/flow.mjs:115-117 -->
- The second sync is forced, so the list shows what the server holds. <!-- src: src/flow.mjs:111 -->
- `error` beats `fail` in the overall status, exit 2 over exit 1. <!-- src: src/report.mjs:58-59 -->
- The JSON document carries `schema_version` 1. <!-- src: src/report.mjs:76 -->

## Architecture

- The container publishes only on loopback, keeps its data in tmpfs, and anything else from `docker port` is refused. <!-- src: src/server.mjs:75-76, src/server.mjs:88 -->
- Every API request goes through a guard that allows only https on 127.0.0.1. <!-- src: src/register.mjs:7 -->
- The client gets a private home and only the listed environment variables from the caller. <!-- src: src/client.mjs:7, src/client.mjs:25 -->
- npm install scripts are off when the client is installed. <!-- src: src/client.mjs:38 -->
- The certificate has 127.0.0.1 as its only name, since `bw` refuses plain http. <!-- src: src/cert.mjs:41 -->
- The account is registered with `node:crypto`: 600,000 PBKDF2 rounds and an RSA-2048 key pair. <!-- src: src/crypto.mjs:42, src/crypto.mjs:46 -->
- Servers without the verification route get the older register route. <!-- src: src/register.mjs:51 -->
- Ctrl-C and SIGTERM run the cleanup first and exit 130 and 143. <!-- src: src/cleanup.mjs:18-20 -->

## Deploy

- CI runs `node --test` on Node 22 and 24 for every pull request and once a week. <!-- src: .github/workflows/ci.yml:10, .github/workflows/ci.yml:24, .github/workflows/ci.yml:33 -->
- Dependabot opens grouped weekly updates for GitHub Actions and qualifying ones merge automatically once CI is green. <!-- src: .github/dependabot.yml, .github/scripts/automerge-eligible.mjs -->

<!-- auto:start -->
- package: vw-canary 0.1.0
- npm scripts (1): test
<!-- auto:end -->
