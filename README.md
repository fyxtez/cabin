# Cabin

Cabin is a desktop and Android control room for managing systemd services over SSH. It is built with **Tauri 2, Rust, React, and TypeScript** and uses an in-process Rust SSH client, so the app does not depend on a platform-installed `ssh` executable.

The app discovers deployed services from immediate directories under `/opt`, maps each safe `<folder>` name to `<folder>.service`, shows systemd state and journal output, and exposes explicit start, stop, and restart controls.

## Highlights

- Desktop and Android support from one Tauri codebase.
- In-process SSH transport implemented in Rust.
- Automatic `/opt` service discovery with input validation.
- Batched `systemctl show` status refreshes.
- Journal viewer with search, match navigation, and live polling.
- Five-minute automatic shutdown for live log polling with a visible resettable timer.
- Per-server local SSH credential setup and connection validation.
- Responsive control-room UI for desktop and narrow mobile screens.

## How service discovery works

Cabin lists immediate directories under `/opt`. Valid directory names are mapped to a systemd unit of the same name. For example:

```text
/opt/price-indexer  ->  price-indexer.service
```

`/opt/digitalocean` is ignored. Folder names are validated before they can be used in remote shell or systemd arguments. Adding or removing an eligible deployed folder is picked up on the next refresh without changing frontend code.

## Development

### Prerequisites

Install Node.js, Rust, and the official Tauri 2 system prerequisites for your platform.

```bash
npm install
npm run tauri dev
```

A production frontend build can be checked with:

```bash
npm run build
```

The Rust backend can be checked independently with:

```bash
cd src-tauri
cargo check
```

## Desktop build

On Debian/Ubuntu:

```bash
npm install
npm run tauri build -- --bundles deb
sudo apt install ./src-tauri/target/release/bundle/deb/*.deb
```

## Android

After installing the Tauri Android prerequisites:

```bash
npm install
npm run tauri android init
npm run tauri android dev
npm run tauri android build -- --apk
```

Install the generated APK with ADB if desired:

```bash
adb install -r path/to/app-universal-release.apk
```

## SSH setup

On first launch, open **SSH settings** for each configured server and provide a username plus an unencrypted OpenSSH private key. Cabin tests the connection before saving the credential data to local app storage on that device. SSH uses the standard port `22`.

For production usage, prefer a dedicated SSH key with only the privileges Cabin requires.

## Security

Cabin performs privileged remote operations, so its trust boundaries matter. Service names and actions are constrained before remote execution, but two limitations are important today: local credential storage is not an encrypted secret vault, and SSH host keys are currently accepted without fingerprint/`known_hosts` verification for Android portability.

Read [`SECURITY.md`](SECURITY.md) before deploying or distributing the app. Do not publish real private keys or other infrastructure secrets.

## Repository documents

- [`SECURITY.md`](SECURITY.md) — security model, limitations, and vulnerability reporting.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module boundaries and data flow.
- [`LICENSE`](LICENSE) — MIT license.

## License

MIT © 2026 Fyxtez
