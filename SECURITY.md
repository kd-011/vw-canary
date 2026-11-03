# Security

## Reporting a vulnerability

Please use GitHub private vulnerability reporting. Open the Security tab of this repository and choose "Report a vulnerability". The report stays private until a fix is out. Don't open a public issue for something exploitable.

Say what you ran, what you expected and what happened.

## What is in scope

vw-canary starts a Vaultwarden container and runs the Bitwarden CLI against it. It should never touch anything else. These are the areas worth a look:

- Anything that makes it talk to a server other than the container it started, on 127.0.0.1. There is no option for this and there should not be a way to get one by accident.
- Anything that lets the client see the caller's Bitwarden config, session or environment. The client runs with a private `HOME` and a short list of environment variables.
- A version argument that ends up as an extra `docker` or `npm` argument, or names a different image or package.
- The container publishing to anything but loopback, or writing to the host. It uses `-p 127.0.0.1::443` and `--tmpfs /data`.
- The container or a temp dir left behind after a normal exit, Ctrl-C or SIGTERM. A `kill -9` can't be cleaned up after, see [docs/limitations.md](docs/limitations.md).

## What it trusts

`check` runs the image from Docker Hub and the npm package you named, so it trusts both about as much as you would by installing them. npm install scripts are turned off. The image and the package are not verified beyond what Docker and npm do themselves.

## Supported versions

Only the latest release gets fixes. The project is small and has no runtime dependencies.
