# Architecture

Cabin is a Tauri 2 application with a React/TypeScript frontend and a Rust backend that performs SSH operations in-process.

## Frontend

`src/App.tsx` is intentionally thin and composes the main screens. `useCabinDashboard` owns server selection, refresh cycles, SSH credential state, service actions, log polling, and modal state. `useLogSearch` owns journal search/highlighting and keyboard navigation.

Visual features are colocated under `src/components`. Every component directory contains the component `.tsx` file and its matching `.css` file. Shared data contracts live in `src/types`, while pure systemd display helpers live in `src/utils`.

## Rust backend

`src-tauri/src/lib.rs` initializes Tauri, plugins, and the command handler. `commands.rs` contains the application boundary exposed to the frontend: server metadata, credential setup, service discovery, log retrieval, and service mutations. `ssh.rs` is the transport layer responsible for key parsing, authentication, command execution, and shell quoting.

## Remote model

For an allowed server, Cabin discovers immediate directories under `/opt`. A safe folder name such as `price-indexer` maps to `price-indexer.service`. The DigitalOcean helper directory is ignored. Service status is fetched with `systemctl show`; logs come from `journalctl`.

## Data flow

React invokes a narrow Tauri command -> the Rust command validates server/service/action inputs -> Rust loads local credentials -> `ssh.rs` opens an SSH session and executes the allowlisted command -> serialized data returns to React.

## Design goals

- Keep privileged behavior in Rust, not in the WebView.
- Keep the Tauri command surface small.
- Avoid arbitrary remote shell input from the frontend.
- Keep UI state and side effects outside presentational components.
- Preserve Android support without relying on a system `ssh` executable.
