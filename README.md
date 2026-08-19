# Cabin

Desktop and Android systemd service control room built with Tauri, React, and an in-process Rust SSH client.

Cabin automatically discovers immediate directories in `/opt` and maps each `<folder>` to `<folder>.service`. The `/opt/digitalocean` directory is ignored, and discovered names are validated before being used as systemd units. Add or remove a deployed project folder, press refresh, and Cabin updates without a code change.

## Desktop

```bash
npm install
npx tauri dev
npx tauri build --bundles deb
sudo apt install ./src-tauri/target/release/bundle/deb/*.deb
```

## Android

Install the Tauri Android prerequisites, then run:

```bash
npm install
npx tauri android init
npx tauri android dev
npx tauri android build --apk
```

On first launch, open **SSH settings** for each server and paste an unencrypted OpenSSH private key. Cabin tests the connection before saving the credentials locally on that device. The same settings screen is available on desktop, so Cabin no longer depends on a system-installed `ssh` executable.
