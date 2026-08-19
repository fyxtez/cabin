mod ssh;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri_plugin_store::StoreExt;

const DEFAULT_SSH_PORT: u16 = 22;

struct ServiceConfig {
    name: String,
    unit: String,
}

struct ServerConfig {
    id: &'static str,
    name: &'static str,
    host: &'static str,
}

// Feature: only server connection metadata stays in code; services are discovered from /opt on every refresh.
const SERVERS: &[ServerConfig] = &[
    ServerConfig {
        id: "rust-services",
        name: "rust-services",
        host: "46.101.107.226",
    },
    ServerConfig {
        id: "secondary",
        name: "secondary",
        host: "157.245.146.87",
    },
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    id: String,
    name: String,
    host: String,
    service_count: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    name: String,
    unit: String,
    description: String,
    load_state: String,
    active_state: String,
    sub_state: String,
    active_since: String,
    main_pid: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshCredentials {
    username: String,
    private_key: String,
}

fn server_by_id(server_id: &str) -> Result<&'static ServerConfig, String> {
    SERVERS
        .iter()
        .find(|server| server.id == server_id)
        .ok_or_else(|| "This server is not allowed by the Cabin configuration.".to_string())
}

fn credential_key(server_id: &str) -> String {
    format!("ssh:{server_id}")
}

fn load_credentials(app: &tauri::AppHandle, server_id: &str) -> Result<SshCredentials, String> {
    // Mobile feature: credentials live in the app store because Android cannot reuse ~/.ssh from the desktop.
    let store = app.store("cabin-ssh.json").map_err(|error| error.to_string())?;
    let value = store.get(credential_key(server_id)).ok_or_else(|| {
        "SSH is not configured for this server. Open SSH settings and add your private key.".to_string()
    })?;
    serde_json::from_value(value.clone()).map_err(|error| format!("Saved SSH settings are invalid: {error}"))
}

async fn run_remote(
    app: &tauri::AppHandle,
    server: &ServerConfig,
    command: String,
) -> Result<String, String> {
    let credentials = load_credentials(app, server.id)?;
    ssh::run_command(
        server.host,
        DEFAULT_SSH_PORT,
        &credentials.username,
        &credentials.private_key,
        &command,
    )
    .await
    .map_err(|error| error.to_string())
}

fn is_safe_service_name(name: &str) -> bool {
    // Security fix: discovered folder names are restricted before they can become shell/systemd arguments.
    !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || b"._@-".contains(&character))
}

async fn discover_services(
    app: &tauri::AppHandle,
    server: &ServerConfig,
) -> Result<Vec<ServiceConfig>, String> {
    // Auto-discovery feature: immediate /opt directories map to <folder>.service; DigitalOcean's own directory is ignored.
    let raw = run_remote(
        app,
        server,
        "find /opt -mindepth 1 -maxdepth 1 -type d -printf '%f\\n'".to_string(),
    )
    .await?;
    let mut services = raw
        .lines()
        .map(str::trim)
        .filter(|name| *name != "digitalocean" && is_safe_service_name(name))
        .map(|name| ServiceConfig {
            name: name.to_string(),
            unit: format!("{name}.service"),
        })
        .collect::<Vec<_>>();
    services.sort_by(|left, right| left.name.cmp(&right.name));
    services.dedup_by(|left, right| left.name == right.name);
    Ok(services)
}

fn service_name_from_unit(unit: &str) -> Result<&str, String> {
    // Security fix: only canonical <safe-folder>.service units can be mapped back to a path under /opt.
    let name = unit
        .strip_suffix(".service")
        .filter(|name| *name != "digitalocean" && is_safe_service_name(name))
        .ok_or_else(|| "This is not a valid auto-discovered Cabin service.".to_string())?;
    Ok(name)
}

fn parse_properties(block: &str) -> HashMap<&str, &str> {
    block
        .lines()
        .filter_map(|line| line.split_once('='))
        .collect()
}

#[tauri::command]
fn get_servers() -> Vec<ServerInfo> {
    // Feature: expose only display-safe server metadata; SSH usernames and targets remain in Rust.
    SERVERS
        .iter()
        .map(|server| ServerInfo {
            id: server.id.to_string(),
            name: server.name.to_string(),
            host: server.host.to_string(),
            // Auto-discovery feature: the UI fills this count after its first authenticated server refresh.
            service_count: None,
        })
        .collect()
}

#[tauri::command]
async fn has_ssh_credentials(app: tauri::AppHandle, server_id: String) -> Result<bool, String> {
    server_by_id(&server_id)?;
    let store = app.store("cabin-ssh.json").map_err(|error| error.to_string())?;
    Ok(store.get(credential_key(&server_id)).is_some())
}

#[tauri::command]
async fn save_ssh_credentials(
    app: tauri::AppHandle,
    server_id: String,
    credentials: SshCredentials,
) -> Result<(), String> {
    let server = server_by_id(&server_id)?;
    if credentials.username.trim().is_empty() || credentials.private_key.trim().is_empty() {
        return Err("Username and private key are required.".to_string());
    }
    // Simplification feature: Cabin always uses the standard SSH port 22, matching the user's deployment convention.
    ssh::run_command(
        server.host,
        DEFAULT_SSH_PORT,
        credentials.username.trim(),
        credentials.private_key.trim(),
        "true",
    )
    .await
    .map_err(|error| error.to_string())?;
    let store = app.store("cabin-ssh.json").map_err(|error| error.to_string())?;
    store.set(
        credential_key(&server_id),
        serde_json::to_value(credentials).map_err(|error| error.to_string())?,
    );
    store.save().map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_services(app: tauri::AppHandle, server_id: String) -> Result<Vec<ServiceStatus>, String> {
    let server = server_by_id(&server_id)?;
    let services = discover_services(&app, server).await?;
    // Auto-discovery feature: a server with no eligible /opt folders renders as an empty server.
    if services.is_empty() {
        return Ok(Vec::new());
    }

    // Performance feature: all discovered service states use one additional SSH connection per refresh.
    let units = services.iter().map(|service| ssh::shell_quote(&service.unit)).collect::<Vec<_>>().join(" ");
    let command = format!("systemctl show --no-pager --property=Id,Description,LoadState,ActiveState,SubState,ActiveEnterTimestamp,MainPID {units}");
    let raw = run_remote(&app, server, command).await?;
    let parsed: HashMap<String, HashMap<&str, &str>> = raw
        .split("\n\n")
        .map(parse_properties)
        .filter_map(|properties| {
            let id = properties.get("Id")?.to_string();
            Some((id, properties))
        })
        .collect();

    Ok(services
        .iter()
        .map(|service| {
                let properties = parsed.get(&service.unit);
                let value = |key: &str, fallback: &str| {
                    properties
                        .and_then(|item| item.get(key))
                        .copied()
                        .unwrap_or(fallback)
                        .to_string()
                };

                ServiceStatus {
                    name: service.name.clone(),
                    unit: service.unit.clone(),
                    description: value("Description", "No description"),
                    load_state: value("LoadState", "not-found"),
                    active_state: value("ActiveState", "unknown"),
                    sub_state: value("SubState", "unknown"),
                    active_since: value("ActiveEnterTimestamp", ""),
                    main_pid: value("MainPID", "0"),
                }
        })
        .collect())
}

#[tauri::command]
async fn get_logs(
    app: tauri::AppHandle,
    server_id: String,
    unit: String,
    lines: Option<u16>,
) -> Result<String, String> {
    let server = server_by_id(&server_id)?;
    let service_name = service_name_from_unit(&unit)?;
    // Reliability fix: cap the requested line count so a large journal cannot exhaust app memory.
    let line_count = lines.unwrap_or(200).clamp(20, 500);
    // Performance and security fix: verify the /opt folder and fetch logs in one SSH connection.
    let command = format!(
        "test -d {} && journalctl --unit {} --lines {} --no-pager --output=short-iso",
        ssh::shell_quote(&format!("/opt/{service_name}")),
        ssh::shell_quote(&unit),
        line_count
    );
    run_remote(&app, server, command).await
}

#[tauri::command]
async fn service_action(
    app: tauri::AppHandle,
    server_id: String,
    unit: String,
    action: String,
) -> Result<String, String> {
    let server = server_by_id(&server_id)?;
    let service_name = service_name_from_unit(&unit)?;
    // Security fix: actions are matched to literals instead of being forwarded as arbitrary input.
    let allowed_action = match action.as_str() {
        "start" => "start",
        "stop" => "stop",
        "restart" => "restart",
        _ => return Err("Unknown service action.".to_string()),
    };
    // Performance and security fix: verify the discovered folder and perform the action in one SSH connection.
    let command = format!(
        "test -d {} && systemctl {allowed_action} {}",
        ssh::shell_quote(&format!("/opt/{service_name}")),
        ssh::shell_quote(&unit)
    );
    run_remote(&app, server, command).await?;
    Ok(format!("{unit}: {allowed_action} completed successfully."))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // Feature: expose only the narrow server, status, log, and action commands required by the UI.
        .invoke_handler(tauri::generate_handler![
            get_servers,
            has_ssh_credentials,
            save_ssh_credentials,
            get_services,
            get_logs,
            service_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
