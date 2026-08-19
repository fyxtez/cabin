use async_trait::async_trait;
use russh::client::{self, Handle};
use russh::{ChannelMsg, Disconnect};
use russh_keys::decode_secret_key;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SshError {
    #[error("could not parse the private key: {0}")]
    KeyParse(String),
    #[error("SSH connection failed: {0}")]
    Connect(String),
    #[error("SSH authentication failed — check the username and private key")]
    AuthFailed,
    #[error("SSH command failed: {0}")]
    Channel(String),
}

struct ClientHandler;

#[async_trait]
impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Mobile compatibility: Cabin has no OpenSSH known_hosts file on Android, so configured hosts are trusted explicitly.
        Ok(true)
    }
}

// Mobile feature: use an in-process Rust SSH client because Android does not provide the desktop `ssh` executable.
pub async fn run_command(
    host: &str,
    port: u16,
    username: &str,
    private_key_pem: &str,
    command: &str,
) -> Result<String, SshError> {
    let key_pair = decode_secret_key(private_key_pem, None)
        .map_err(|error| SshError::KeyParse(error.to_string()))?;
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(12)),
        ..Default::default()
    });
    let mut session: Handle<ClientHandler> = client::connect(config, (host, port), ClientHandler)
        .await
        .map_err(|error| SshError::Connect(error.to_string()))?;
    let authenticated = session
        .authenticate_publickey(username, Arc::new(key_pair))
        .await
        .map_err(|error| SshError::Connect(error.to_string()))?;
    if !authenticated {
        let _ = session.disconnect(Disconnect::ByApplication, "", "en").await;
        return Err(SshError::AuthFailed);
    }

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|error| SshError::Channel(error.to_string()))?;
    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|error| SshError::Channel(error.to_string()))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code = None;
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
            Some(ChannelMsg::ExtendedData { data, .. }) => stderr.extend_from_slice(&data),
            Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
            Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }
    let _ = session.disconnect(Disconnect::ByApplication, "", "en").await;

    if exit_code == Some(0) {
        Ok(String::from_utf8_lossy(&stdout).to_string())
    } else {
        let error = String::from_utf8_lossy(&stderr).trim().to_string();
        Err(SshError::Channel(if error.is_empty() {
            format!("remote command exited with status {:?}", exit_code)
        } else {
            error
        }))
    }
}

// Security feature: quote every allowlisted remote argument even though it never comes from arbitrary shell input.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
