# Security Policy

Cabin is an administrative client: it can connect to remote servers and start, stop, or restart systemd services. Treat a Cabin installation as privileged software.

## Supported versions

Security fixes are maintained on the latest release only.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose credentials, remote hosts, or privileged command execution. Contact the maintainer privately with a concise reproduction, affected version, and impact.

## Current security model

- Remote service actions are restricted to `start`, `stop`, and `restart` literals.
- Auto-discovered service names are validated before they are used as systemd or shell arguments.
- Remote arguments are shell-quoted before execution.
- Log reads are capped to prevent unexpectedly large journal responses.
- SSH credentials are validated with a real connection before they are saved.

## Important limitations

Cabin currently stores the SSH username and private key through `tauri-plugin-store`. That storage should be considered **local application storage, not an encrypted secret vault**. Use a dedicated key with the minimum privileges required and protect the device account appropriately.

The in-process SSH client currently accepts the server public key presented during connection instead of validating it against a pinned fingerprint or `known_hosts` database. This improves Android portability but leaves the connection vulnerable to a man-in-the-middle attack on an untrusted network. Host-key pinning is the highest-priority security hardening item for a production deployment.

The current Tauri configuration also has CSP disabled. Re-enable and test an explicit Content Security Policy before distributing Cabin broadly.

## Public repository hygiene

Do not commit private keys, passwords, `.env` files, production-only hostnames, or other infrastructure secrets. Review configured server addresses before publishing a fork.
