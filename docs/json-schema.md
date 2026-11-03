# JSON output

`vw-canary check --json` and `vw-canary demo --json` print one JSON document on stdout. Progress lines go to stderr, so stdout is safe to pipe. `schema_version` goes up when a field is removed or changes meaning. New fields can appear without it changing.

```json
{
  "schema_version": 1,
  "tool": { "name": "vw-canary", "version": "0.1.0" },
  "mode": "check",
  "status": "fail",
  "exit_code": 1,
  "summary": { "total": 1, "passed": 0, "failed": 1, "errors": 0 },
  "results": [
    {
      "server": { "requested": "latest", "resolved": "1.37.5", "image": "vaultwarden/server:latest" },
      "client": { "requested": "2026.10.1", "resolved": "2026.10.1", "package": "@bitwarden/cli@2026.10.1" },
      "status": "fail",
      "duration_ms": 41210,
      "steps": [
        { "name": "config server", "status": "pass", "duration_ms": 3600, "error": null },
        {
          "name": "login",
          "status": "fail",
          "duration_ms": 5100,
          "error": {
            "message": "bw login exited 1: Username or password is incorrect. Try again",
            "command": "bw login canary@vw-canary.invalid --passwordenv VW_CANARY_PASSWORD --raw",
            "exit_code": 1,
            "stdout": "",
            "stderr": "Username or password is incorrect. Try again"
          }
        },
        { "name": "sync", "status": "skip", "duration_ms": 0, "error": null }
      ],
      "first_failure": { "step": "login", "message": "bw login exited 1: Username or password is incorrect. Try again" },
      "error": null,
      "server_log": "[2026-11-03 13:04:08.374][response][INFO] (login) POST /identity/connect/token => 400 Bad Request"
    }
  ]
}
```

The values above are shortened by hand to show the shape.

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `schema_version` | number | 1 |
| `tool` | object | `name` is always `vw-canary`, `version` is the tool's version. |
| `mode` | string | `check`, `matrix` or `demo`. |
| `status` | string | `pass`, `fail` or `error`. `error` wins over `fail`, because a run with a cell that could not be tested is not complete. |
| `exit_code` | number | The exit code of this run: 0 for `pass`, 1 for `fail`, 2 for `error`. |
| `summary` | object | Counts of results: `total`, `passed`, `failed`, `errors`. |
| `results` | array | One entry per server and client pair, in the order given. |

A usage error (bad flag, bad version string) prints to stderr, exits 2 and prints no JSON. Nothing ran.

## Each result

| Field | Type | Meaning |
| --- | --- | --- |
| `server` | object | `requested` is what you passed. `resolved` is the version from the image's `org.opencontainers.image.version` label, or `requested` when there is no such label, or null if the server never started. `image` is the image reference. |
| `client` | object | `requested` is what you passed. `resolved` is what `bw --version` printed, or null if it never ran. `package` is the npm package spec. |
| `status` | string | `pass`: every step passed. `fail`: a step failed. `error`: the flow did not finish starting, so the client was not tested. |
| `duration_ms` | number | Wall time for this pair, including the install if it happened here. |
| `steps` | array | The eight steps in order. Empty when `status` is `error`. |
| `first_failure` | object or null | `step` and `message` of the failing step. Null unless `status` is `fail`. |
| `error` | object or null | `stage` and `message`. Null unless `status` is `error`. |
| `server_log` | string or null | The last 12 lines of the container's log, read before it was removed. Null unless `status` is `fail`, and null in the demo. |

`stage` is one of `docker`, `install client`, `start server`, `register account` or `client flow`.

## Each step

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | `config server`, `login`, `sync`, `create item`, `sync again`, `list and decrypt`, `edit item`, `delete item`. |
| `status` | string | `pass`, `fail` or `skip`. Everything after the first failure is `skip`. |
| `duration_ms` | number | 0 for a skipped step. |
| `error` | object or null | Set only when `status` is `fail`. |

## A step's error

| Field | Type | Meaning |
| --- | --- | --- |
| `message` | string | The text the report prints: the command, its exit code and the client's own words, without stack frames. Lines over 400 characters are cut. |
| `command` | string | The `bw` command, with the encoded item shortened. |
| `exit_code` | number or null | Null when the client was killed at the timeout or never started. It can be 0: an empty vault with exit 0 is a failure. |
| `stdout` | string | Raw output of the client. |
| `stderr` | string | Raw output of the client, with stack frames. |

The throwaway password and session key are replaced with `[redacted]` in all of these.
