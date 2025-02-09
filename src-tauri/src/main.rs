#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{path::PathBuf, fs, sync::Mutex, fmt};
use directories::ProjectDirs;
use anyhow::{Context, Result};
use tauri::{Manager, State, Window};
use thiserror::Error;
use std::collections::HashMap;
use tokio::sync::broadcast;
use log::{info, error, warn, LevelFilter};
use std::process::Command;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, WebSocketStream, MaybeTlsStream};
use futures_util::{StreamExt, SinkExt};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct AppConfig {
    ae_path: Option<String>,
    resolve_path: Option<String>,
    theme: Option<String>,
    auto_reconnect: bool,
    log_level: String,
    bridge_port: u16,
}

#[derive(Error, Debug, Clone)]
enum BridgeError {
    #[error("WebSocket error: {0}")]
    WebSocket(String),
    
    #[error("Process error: {0}")]
    Process(String),
    
    #[error("Configuration error: {0}")]
    Config(String),
    
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("State error: {0}")]
    State(String),

    #[error("Initialization error: {0}")]
    Init(String),
}

impl From<BridgeError> for String {
    fn from(err: BridgeError) -> Self {
        err.to_string()
    }
}

impl From<tauri::Error> for BridgeError {
    fn from(err: tauri::Error) -> Self {
        BridgeError::Config(format!("Tauri error: {}", err))
    }
}

#[derive(Debug, Serialize)]
struct AppError {
    code: String,
    message: String,
    details: Option<String>,
}

impl AppError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            details: None,
        }
    }
}

#[derive(Clone, Serialize)]
struct LogEntry {
    level: String,
    message: String,
    timestamp: i64,
}

#[derive(Debug)]
struct BridgeProcess {
    process: Option<std::process::Child>,
    port: u16,
}

impl BridgeProcess {
    fn new(port: u16) -> Self {
        Self {
            process: None,
            port,
        }
    }

    fn start(&mut self) -> Result<(), BridgeError> {
        if self.is_running() {
            return Ok(());
        }

        let process = Command::new("node")
            .arg("bridge/server.js")
            .spawn()
            .map_err(|e| BridgeError::Process(format!("Failed to start bridge: {}", e)))?;

        self.process = Some(process);
        Ok(())
    }

    fn stop(&mut self) -> Result<(), BridgeError> {
        if let Some(mut process) = self.process.take() {
            process.kill()
                .map_err(|e| BridgeError::Process(format!("Failed to stop bridge: {}", e)))?;
        }
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.process.as_ref().map_or(false, |p| p.try_wait().ok().flatten().is_none())
    }
}

struct WebSocketClient {
    stream: Option<WebSocketStream<MaybeTlsStream<TcpStream>>>,
}

impl WebSocketClient {
    fn new() -> Self {
        Self { stream: None }
    }

    async fn connect(&mut self, url: &str) -> Result<(), BridgeError> {
        let (ws_stream, _) = connect_async(url)
            .await
            .map_err(|e| BridgeError::WebSocket(e.to_string()))?;
        self.stream = Some(ws_stream);
        Ok(())
    }

    async fn send_message(&mut self, message: &str) -> Result<(), BridgeError> {
        if let Some(stream) = &mut self.stream {
            stream.send(message.into())
                .await
                .map_err(|e| BridgeError::WebSocket(e.to_string()))
        } else {
            Err(BridgeError::WebSocket("WebSocket not connected".into()))
        }
    }

    async fn disconnect(&mut self) -> Result<(), String> {
        if let Some(stream) = &mut self.stream {
            stream.close(None).await
                .map_err(|e| format!("Failed to close connection: {}", e))?;
        }
        self.stream = None;
        Ok(())
    }

    async fn handle_messages(&mut self, window: Window) -> Result<(), String> {
        let Some(stream) = &mut self.stream else {
            return Err("WebSocket not connected".into());
        };

        while let Some(msg) = stream.next().await {
            match msg {
                Ok(msg) => {
                    if let Ok(text) = msg.to_text() {
                        window.emit("ws-message", text)
                            .map_err(|e| format!("Failed to emit message: {}", e))?;
                    }
                }
                Err(e) => {
                    return Err(format!("WebSocket error: {}", e));
                }
            }
        }
        Ok(())
    }
}

struct EnhancedBridgeState {
    process: Mutex<BridgeProcess>,
    connections: Mutex<HashMap<String, bool>>,
    log_tx: broadcast::Sender<LogEntry>,
    ws_client: Mutex<WebSocketClient>,
    config: Mutex<AppConfig>,
    monitor_handle: Mutex<Option<JoinHandle<()>>>,
}

impl AppConfig {
    fn validate(&self) -> Result<(), AppError> {
        if self.bridge_port < 1024 || self.bridge_port > 65535 {
            return Err(AppError::new(
                "INVALID_PORT",
                "Bridge port must be between 1024 and 65535"
            ));
        }

        if !["debug", "info", "warn", "error"].contains(&self.log_level.as_str()) {
            return Err(AppError::new(
                "INVALID_LOG_LEVEL",
                "Invalid log level specified"
            ));
        }

        Ok(())
    }
}

impl EnhancedBridgeState {
    fn new() -> Self {
        let (log_tx, _) = broadcast::channel(100);
        Self {
            process: Mutex::new(BridgeProcess::new(3000)),
            connections: Mutex::new(HashMap::new()),
            log_tx,
            ws_client: Mutex::new(WebSocketClient::new()),
            config: Mutex::new(AppConfig {
                bridge_port: 3000,
                log_level: "info".to_string(),
                ..Default::default()
            }),
            monitor_handle: Mutex::new(None),
        }
    }

    fn log(&self, level: &str, message: &str) {
        let entry = LogEntry {
            level: level.to_string(),
            message: message.to_string(),
            timestamp: chrono::Utc::now().timestamp(),
        };
        let _ = self.log_tx.send(entry);
    }

    fn handle_error(&self, error: BridgeError) {
        let error_msg = error.to_string();
        error!("{}", error_msg);
        self.log("error", &error_msg);
    }

    async fn try_operation<F, T>(&self, operation: F) -> BridgeResult<T>
    where
        F: std::future::Future<Output = BridgeResult<T>>,
    {
        match operation.await {
            Ok(result) => Ok(result),
            Err(e) => {
                self.handle_error(e.clone());
                Err(e)
            }
        }
    }

    async fn initialize(&self) -> BridgeResult<()> {
        self.try_operation(async {
            self.log("info", "Initializing bridge state");
            let config = self.config.lock()
                .map_err(|_| BridgeError::State("Failed to lock config".into()))?;
            
            if let Err(e) = config.validate() {
                return Err(BridgeError::Init(format!("Invalid configuration: {}", e.message)));
            }

            let mut connections = self.connections.lock()
                .map_err(|_| BridgeError::State("Failed to lock connections".into()))?;
            connections.insert("ae".to_string(), false);
            connections.insert("resolve".to_string(), false);
            connections.insert("bridge".to_string(), false);

            Ok(())
        }).await
    }

    async fn monitor_bridge(&self, window: Window) {
        let running = Arc::new(AtomicBool::new(true));
        let r = running.clone();

        let handle = tokio::spawn(async move {
            while running.load(Ordering::SeqCst) {
                let status = self.check_bridge_status().await;
                window.emit("bridge-health", status)
                    .unwrap_or_else(|e| error!("Failed to emit bridge health: {}", e));
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });

        *self.monitor_handle.lock().unwrap() = Some(handle);
    }

    async fn check_bridge_status(&self) -> HashMap<String, bool> {
        let mut status = HashMap::new();
        let process = self.process.lock().unwrap();
        status.insert("process".to_string(), process.is_running());
        
        let connections = self.connections.lock().unwrap();
        for (key, value) in connections.iter() {
            status.insert(key.clone(), *value);
        }
        status
    }

    async fn shutdown(&self) -> Result<(), BridgeError> {
        self.log("info", "Initiating shutdown sequence");
        
        if let Some(handle) = self.monitor_handle.lock().unwrap().take() {
            handle.abort();
        }

        let mut ws_client = self.ws_client.lock().unwrap();
        if let Err(e) = ws_client.disconnect().await {
            self.log("error", &format!("WebSocket disconnect error: {}", e));
        }

        let mut process = self.process.lock().unwrap();
        process.stop()?;

        Ok(())
    }

}

#[tauri::command]
async fn shutdown_bridge(
    window: Window,
    state: State<'_, EnhancedBridgeState>
) -> Result<(), BridgeError> {
    match timeout(Duration::from_secs(5), state.shutdown()).await {
        Ok(result) => result,
        Err(_) => {
            state.log("warn", "Shutdown timed out, forcing exit");
            Ok(())
        }
    }
}

// Config management
#[tauri::command]
async fn load_config() -> Result<AppConfig, BridgeError> {
    let config_path = get_config_path()?;
    if !config_path.exists() {
        return Ok(AppConfig::default());
    }
    
    fs::read_to_string(&config_path)
        .map_err(|e| BridgeError::Io(e))
        .and_then(|content| {
            serde_json::from_str(&content)
                .map_err(|e| BridgeError::Config(format!("Invalid config: {}", e)))
        })
}

#[tauri::command]
async fn save_config(config: AppConfig) -> Result<(), BridgeError> {
    let config_path = get_config_path()?;
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| BridgeError::Config(format!("Serialization failed: {}", e)))?;
    
    fs::create_dir_all(config_path.parent().unwrap())
        .and_then(|_| fs::write(&config_path, content))
        .map_err(BridgeError::Io)
}

// Bridge management
#[tauri::command]
async fn start_bridge(
    window: Window,
    state: State<'_, EnhancedBridgeState>
) -> Result<(), String> {
    let mut process = state.process.lock().unwrap();
    process.start()?;
    
    let mut connections = state.connections.lock().unwrap();
    connections.insert("bridge".into(), true);
    
    state.log("info", "Bridge started successfully");
    window.emit("bridge-status", true)
        .map_err(|e| format!("Failed to emit: {}", e))
}

#[tauri::command]
async fn stop_bridge(
    window: Window,
    state: State<'_, EnhancedBridgeState>
) -> Result<(), String> {
    let mut process = state.process.lock().unwrap();
    process.stop()?;
    
    let mut connections = state.connections.lock().unwrap();
    connections.insert("bridge".into(), false);
    
    state.log("info", "Bridge stopped successfully");
    window.emit("bridge-status", false)
        .map_err(|e| format!("Failed to emit: {}", e))
}

#[tauri::command]
async fn subscribe_to_logs(
    window: Window,
    state: State<'_, EnhancedBridgeState>
) -> Result<(), BridgeError> {
    let mut rx = state.log_tx.subscribe();
    tauri::async_runtime::spawn(async move {
        while let Ok(entry) = rx.recv().await {
            if let Err(e) = window.emit("log-entry", entry) {
                error!("Failed to emit log entry: {}", e);
            }
        }
    });
    Ok(())
}

// Helper functions
fn get_config_path() -> Result<PathBuf, BridgeError> {
    ProjectDirs::from("com", "conectify", "app")
        .map(|dirs| dirs.config_dir().join("config.json"))
        .ok_or_else(|| BridgeError::Config("Failed to get config directory".into()))
}

fn validate_ae_executable(path: &PathBuf) -> Result<bool, BridgeError> {
    if path.is_file() && path.extension().map_or(false, |ext| ext == "exe" || ext == "app") {
        Ok(true)
    } else {
        Ok(false)
    }
}

fn validate_resolve_executable(path: &PathBuf) -> Result<bool, BridgeError> {
    if path.is_file() && path.extension().map_or(false, |ext| ext == "exe" || ext == "app") {
        Ok(true)
    } else {
        Ok(false)
    }
}


// Path validation
#[tauri::command]
async fn validate_path(path: String, app_type: String) -> Result<bool, BridgeError> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Ok(false);
    }

    match app_type.as_str() {
        "ae" => validate_ae_executable(&path),
        "resolve" => validate_resolve_executable(&path),
        _ => Err(BridgeError::Config("Invalid app type".into()))
    }
}

// Legacy commands
#[tauri::command]
async fn select_file() -> Result<String, BridgeError> {
    tauri::api::dialog::blocking::FileDialogBuilder::new()
        .pick_file()
        .ok_or_else(|| BridgeError::Config("No file selected".into()))
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn quit_app(app_handle: tauri::AppHandle, state: State<'_, EnhancedBridgeState>) -> Result<(), BridgeError> {
    // Attempt graceful shutdown before quitting
    if let Err(e) = state.shutdown().await {
        error!("Shutdown error during quit: {}", e);
    }
    app_handle.exit(0);
    Ok(())
}

// Add result type alias for consistent error handling
type BridgeResult<T> = Result<T, BridgeError>;

#[tauri::command]
async fn connect_bridge(
    window: Window,
    state: State<'_, EnhancedBridgeState>
) -> Result<(), BridgeError> {
    let config = state.config.lock().unwrap();
    let port = config.bridge_port;
    let url = format!("ws://localhost:{}", port);
    
    let mut ws_client = state.ws_client.lock().unwrap();
    ws_client.connect(&url).await?;
    
    // Start message handling
    let window_clone = window.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = ws_client.handle_messages(window_clone).await {
            error!("WebSocket message handling error: {}", e);
        }
    });
    
    // Start bridge monitoring
    state.monitor_bridge(window).await;
    
    state.log("info", &format!("Connected to bridge on port {}", port));
    Ok(())
}

#[tauri::command]
async fn send_bridge_message(
    message: String,
    state: State<'_, EnhancedBridgeState>
) -> Result<(), String> {
    let mut ws_client = state.ws_client.lock().unwrap();
    ws_client.send_message(&message).await
}

#[tauri::command]
async fn get_bridge_status(
    state: State<'_, EnhancedBridgeState>
) -> Result<HashMap<String, bool>, String> {
    Ok(state.connections.lock().unwrap().clone())
}


fn setup_window_events(window: Window, state: State<EnhancedBridgeState>) -> BridgeResult<()> {
    let state_clone = state.inner().clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            let state = state_clone.clone();
            if let Err(e) = tauri::async_runtime::block_on(state.shutdown()) {
                error!("Shutdown error: {}", e);
            }
        }
    });
    Ok(())
}


fn main() {
    env_logger::Builder::from_default_env()
        .filter_level(LevelFilter::Info)
        .init();

    let state = EnhancedBridgeState::new();
    
    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            let window = app.get_window("main").unwrap();
            let state = app.state::<EnhancedBridgeState>();
            
            #[cfg(debug_assertions)]
            window.open_devtools();

            if let Err(e) = setup_window_events(window.clone(), state.clone()) {
                error!("Failed to setup window events: {}", e);
            }

            if let Err(e) = tauri::async_runtime::block_on(state.initialize()) {
                error!("Failed to initialize state: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            start_bridge,
            stop_bridge,
            validate_path,
            select_file,
            quit_app,
            subscribe_to_logs,
            connect_bridge,
            send_bridge_message,
            get_bridge_status,
            shutdown_bridge
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}