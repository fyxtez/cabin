mod commands;
mod ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // Architecture: Tauri wiring stays in lib.rs while command implementation lives in commands.rs.
        .invoke_handler(tauri::generate_handler![
            commands::get_servers,
            commands::has_ssh_credentials,
            commands::save_ssh_credentials,
            commands::get_services,
            commands::get_logs,
            commands::service_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
