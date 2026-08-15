use serde::Serialize;
use std::collections::HashMap;
use std::process::{Command, Output};

struct ServiceConfig {
    name: &'static str,
    unit: &'static str,
}

struct ServerConfig {
    id: &'static str,
    name: &'static str,
    host: &'static str,
    ssh_target: &'static str,
    services: &'static [ServiceConfig],
}

// Security fix: each server owns a separate service allowlist, preventing cross-server unit injection.
const RUST_SERVICES: &[ServiceConfig] = &[
    ServiceConfig {
        name: "exchange-positions",
        unit: "exchange-positions.service",
    },
    ServiceConfig {
        name: "lc_insiders",
        unit: "lc_insiders.service",
    },
    ServiceConfig {
        name: "telegram_sniper",
        unit: "telegram_sniper.service",
    },
    ServiceConfig {
        name: "terminal-backend",
        unit: "terminal-backend.service",
    },
    ServiceConfig {
        name: "tg_workers",
        unit: "tg_workers.service",
    },
    ServiceConfig {
        name: "yt_watcher",
        unit: "yt_watcher.service",
    },
];

// Feature: servers can be added before they have services, then populated through their own allowlist later.
const SERVERS: &[ServerConfig] = &[
    ServerConfig {
        id: "rust-services",
        name: "rust-services",
        host: "46.101.107.226",
        ssh_target: "root@46.101.107.226",
        services: RUST_SERVICES,
    },
    ServerConfig {
        id: "secondary",
        name: "secondary",
        host: "157.245.146.87",
        ssh_target: "root@157.245.146.87",
        services: &[],
    },
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    id: String,
    name: String,
    host: String,
    service_count: usize,
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

fn server_by_id(server_id: &str) -> Result<&'static ServerConfig, String> {
    SERVERS
        .iter()
        .find(|server| server.id == server_id)
        .ok_or_else(|| "This server is not allowed by the Cabin configuration.".to_string())
}

fn allowed_service(
    server: &'static ServerConfig,
    unit: &str,
) -> Result<&'static ServiceConfig, String> {
    server
        .services
        .iter()
        .find(|service| service.unit == unit)
        .ok_or_else(|| "This service is not allowed for the selected server.".to_string())
}

fn ssh_command(ssh_target: &str, remote_args: &[String]) -> Result<Output, String> {
    // Security fix: BatchMode prevents password prompts from freezing the desktop application.
    Command::new("ssh")
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=8",
            "-o",
            "StrictHostKeyChecking=yes",
            ssh_target,
        ])
        .args(remote_args)
        .output()
        .map_err(|error| format!("Could not start the local SSH client: {error}"))
}

fn checked_output(output: Output) -> Result<String, String> {
    if output.status.success() {
        String::from_utf8(output.stdout)
            .map_err(|_| "The server returned output that is not valid UTF-8.".to_string())
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if message.is_empty() {
            format!("The SSH command failed ({}).", output.status)
        } else {
            message
        })
    }
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
            service_count: server.services.len(),
        })
        .collect()
}

#[tauri::command]
async fn get_services(server_id: String) -> Result<Vec<ServiceStatus>, String> {
    let server = server_by_id(&server_id)?;
    // Feature: an intentionally empty server renders immediately without opening a pointless SSH connection.
    if server.services.is_empty() {
        return Ok(Vec::new());
    }

    // Performance feature: all service states on the selected server use one SSH connection per refresh.
    tauri::async_runtime::spawn_blocking(move || {
        let mut args = vec![
            "systemctl".to_string(),
            "show".to_string(),
            "--no-pager".to_string(),
            "--property=Id,Description,LoadState,ActiveState,SubState,ActiveEnterTimestamp,MainPID"
                .to_string(),
        ];
        args.extend(
            server
                .services
                .iter()
                .map(|service| service.unit.to_string()),
        );

        let raw = checked_output(ssh_command(server.ssh_target, &args)?)?;
        let parsed: HashMap<String, HashMap<&str, &str>> = raw
            .split("\n\n")
            .map(parse_properties)
            .filter_map(|properties| {
                let id = properties.get("Id")?.to_string();
                Some((id, properties))
            })
            .collect();

        Ok(server
            .services
            .iter()
            .map(|service| {
                let properties = parsed.get(service.unit);
                let value = |key: &str, fallback: &str| {
                    properties
                        .and_then(|item| item.get(key))
                        .copied()
                        .unwrap_or(fallback)
                        .to_string()
                };

                ServiceStatus {
                    name: service.name.to_string(),
                    unit: service.unit.to_string(),
                    description: value("Description", "No description"),
                    load_state: value("LoadState", "not-found"),
                    active_state: value("ActiveState", "unknown"),
                    sub_state: value("SubState", "unknown"),
                    active_since: value("ActiveEnterTimestamp", ""),
                    main_pid: value("MainPID", "0"),
                }
            })
            .collect())
    })
    .await
    .map_err(|error| format!("The status task did not complete: {error}"))?
}

#[tauri::command]
async fn get_logs(
    server_id: String,
    unit: String,
    lines: Option<u16>,
) -> Result<String, String> {
    let server = server_by_id(&server_id)?;
    let service = allowed_service(server, &unit)?;
    // Reliability fix: cap the requested line count so a large journal cannot exhaust app memory.
    let line_count = lines.unwrap_or(200).clamp(20, 500);
    let args = vec![
        "journalctl".to_string(),
        "--unit".to_string(),
        service.unit.to_string(),
        "--lines".to_string(),
        line_count.to_string(),
        "--no-pager".to_string(),
        "--output=short-iso".to_string(),
    ];

    tauri::async_runtime::spawn_blocking(move || {
        checked_output(ssh_command(server.ssh_target, &args)?)
    })
    .await
    .map_err(|error| format!("The log task did not complete: {error}"))?
}

#[tauri::command]
async fn service_action(
    server_id: String,
    unit: String,
    action: String,
) -> Result<String, String> {
    let server = server_by_id(&server_id)?;
    let service = allowed_service(server, &unit)?;
    // Security fix: actions are matched to literals instead of being forwarded as arbitrary input.
    let allowed_action = match action.as_str() {
        "start" => "start",
        "stop" => "stop",
        "restart" => "restart",
        _ => return Err("Unknown service action.".to_string()),
    };
    let args = vec![
        "systemctl".to_string(),
        allowed_action.to_string(),
        service.unit.to_string(),
    ];

    tauri::async_runtime::spawn_blocking(move || {
        checked_output(ssh_command(server.ssh_target, &args)?)?;
        Ok(format!(
            "{}: {allowed_action} completed successfully.",
            service.unit
        ))
    })
    .await
    .map_err(|error| format!("The service action did not complete: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Feature: expose only the narrow server, status, log, and action commands required by the UI.
        .invoke_handler(tauri::generate_handler![
            get_servers,
            get_services,
            get_logs,
            service_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
