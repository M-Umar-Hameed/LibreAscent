use std::ffi::OsString;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::sync::oneshot;
use windows_service::{
    define_windows_service,
    service::{
        ServiceAccess, ServiceControl, ServiceControlAccept, ServiceErrorControl, ServiceExitCode,
        ServiceInfo, ServiceStartType, ServiceState, ServiceStatus, ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_manager::{ServiceManager, ServiceManagerAccess},
};

pub const SERVICE_NAME: &str = "LibreAscentService";
pub const SERVICE_DISPLAY_NAME: &str = "LibreAscent Background Service";

define_windows_service!(ffi_service_main, libre_ascent_service_main);

enum ServiceEvent {
    StopRequested,
    ShutdownRequested,
    DnsProxyStopped,
}

fn format_app_block_message(path: &std::path::Path) -> String {
    format!("block:app:{}", path.display())
}

pub fn run_service() -> anyhow::Result<()> {
    windows_service::service_dispatcher::start(SERVICE_NAME, ffi_service_main)?;
    Ok(())
}

fn libre_ascent_service_main(_arguments: Vec<OsString>) {
    if let Err(e) = run_service_loop() {
        crate::dns_manager::log_tamper_event(&format!("Service loop failed: {e}"));
    }
}

fn run_service_loop() -> anyhow::Result<()> {
    crate::dns_manager::log_tamper_event("Service starting...");
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let control_tx = tx.clone();

    let event_handler = move |control_event| -> ServiceControlHandlerResult {
        match control_event {
            ServiceControl::Stop => {
                let _ = control_tx.blocking_send(ServiceEvent::StopRequested);
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Shutdown => {
                let _ = control_tx.blocking_send(ServiceEvent::ShutdownRequested);
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };

    let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async {
        let config_path = libreascent_shared::config::default_config_path();
        let (ready_tx, ready_rx) = oneshot::channel();
        let dns_exit_tx = tx.clone();

        let dns_task = tokio::spawn(async move {
            let result = crate::dns::run_local_dns_proxy_with_ready(
                config_path.clone(),
                "127.0.0.1:53",
                Some(ready_tx),
            )
            .await;

            if let Err(e) = result {
                crate::dns_manager::log_tamper_event(&format!("DNS proxy stopped with error: {e}"));
            } else {
                crate::dns_manager::log_tamper_event("DNS proxy stopped gracefully.");
            }
            let _ = dns_exit_tx.send(ServiceEvent::DnsProxyStopped).await;
        });

        let mut enforce_task = None;
        let dns_proxy_ready = matches!(ready_rx.await, Ok(Ok(())));
        if dns_proxy_ready {
            let config_path = libreascent_shared::config::default_config_path();
            if let Ok(config) = libreascent_shared::config::load_or_create(&config_path) {
                if config.control_mode != libreascent_shared::config::ControlMode::Flexible {
                    let _ = crate::dns_manager::enforce_system_dns("127.0.0.1");

                    enforce_task = Some(tokio::spawn(async move {
                        let mut interval = tokio::time::interval(Duration::from_secs(2));
                        loop {
                            interval.tick().await;
                            if let Err(e) = crate::dns_manager::enforce_system_dns("127.0.0.1") {
                                crate::dns_manager::log_tamper_event(&format!(
                                    "DNS enforcement failed: {e}"
                                ));
                            }
                        }
                    }));
                } else {
                    crate::dns_manager::log_tamper_event("Flexible mode active. Automatic DNS enforcement skipped.");
                }
            }
        } else {
            crate::dns_manager::log_tamper_event(
                "DNS proxy did not start. DNS settings were not changed.",
            );
        }

        // Start App blocker
        let dns_proxy_ready_for_firewall = dns_proxy_ready;
        let blocker_task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            let broadcast_socket = tokio::net::UdpSocket::bind("127.0.0.1:0").await.ok();
            let mut sys = crate::process_manager::create_system_handle();
            let mut runtime_blocked_paths: Vec<PathBuf> = Vec::new();
            let mut last_firewall_refresh = Instant::now() - Duration::from_secs(60);
            let mut firewall_enforcement_failed = false;

            loop {
                interval.tick().await;
                let config_path = libreascent_shared::config::default_config_path();
                if let Ok(config) = libreascent_shared::config::load_or_create(&config_path) {
                    let blocked_paths = crate::process_manager::check_and_block_apps(&mut sys, &config);
                    let mut newly_blocked_paths = Vec::new();

                    for path in blocked_paths {
                        if !runtime_blocked_paths.contains(&path) {
                            newly_blocked_paths.push(path.clone());
                            runtime_blocked_paths.push(path);
                        }
                    }

                    if !firewall_enforcement_failed
                        && (!newly_blocked_paths.is_empty()
                        || last_firewall_refresh.elapsed() >= Duration::from_secs(60)
                        )
                    {
                        // Only seal DNS bypass paths when the proxy is up and the
                        // system resolver is pinned to it. In Flexible mode DNS is
                        // not redirected, so sealing :53 would break resolution.
                        let dns_enforced = dns_proxy_ready_for_firewall
                            && config.control_mode
                                != libreascent_shared::config::ControlMode::Flexible;
                        if let Err(e) = crate::firewall_manager::ensure_firewall_protection(
                            &config,
                            &runtime_blocked_paths,
                            dns_enforced,
                        ) {
                            crate::dns_manager::log_tamper_event(&format!(
                                "Firewall enforcement disabled until service restart after failure: {e}"
                            ));
                            firewall_enforcement_failed = true;
                        }

                        // Browser DoH bypasses the proxy entirely and cannot be
                        // sealed by IP, so disable it by policy whenever DNS is
                        // enforced. Logged but not latched: unlike the firewall
                        // this is idempotent and safe to retry each pass.
                        if dns_enforced {
                            if let Err(e) = crate::browser_policy::enforce_doh_disabled() {
                                crate::dns_manager::log_tamper_event(&format!(
                                    "Failed to disable browser DoH by policy: {e}"
                                ));
                            }
                        }
                        last_firewall_refresh = Instant::now();
                    }

                    if !newly_blocked_paths.is_empty() {
                        if let Some(ref socket) = broadcast_socket {
                            for path in &newly_blocked_paths {
                                let message = format_app_block_message(path);
                                crate::dns_manager::log_tamper_event(&format!(
                                    "Blocked app: {}",
                                    path.display()
                                ));
                                let _ = socket.send_to(message.as_bytes(), "127.0.0.1:13370").await;
                            }
                        }
                    }
                }
            }
        });

        // Wait for stop signal or DNS proxy failure. The service must not keep
        // enforcing 127.0.0.1 when the local DNS proxy is gone.
        let event = rx.recv().await;

        // Stop all background tasks before resetting DNS
        if let Some(handle) = enforce_task {
            handle.abort();
        }
        blocker_task.abort();
        dns_task.abort();

        // Reset system DNS on stop, unless Hardcore
        let config_path = libreascent_shared::config::default_config_path();
        let config = libreascent_shared::config::load_or_create(&config_path).ok();
        let is_hardcore = config
            .map(|c| c.control_mode == libreascent_shared::config::ControlMode::Hardcore)
            .unwrap_or(false);

        if !is_hardcore {
            let _ = crate::dns_manager::reset_system_dns();
            let _ = crate::firewall_manager::reset_firewall_protection();
            crate::browser_policy::reset_doh_policy();
        } else if matches!(event, Some(ServiceEvent::DnsProxyStopped)) {
            crate::dns_manager::log_tamper_event(
                "DNS proxy stopped in Hardcore mode. DNS NOT reset.",
            );
        } else if matches!(event, Some(ServiceEvent::ShutdownRequested)) {
            crate::dns_manager::log_tamper_event(
                "Service shutdown requested in Hardcore mode. DNS NOT reset.",
            );
        } else {
            crate::dns_manager::log_tamper_event(
                "Service stopped in Hardcore mode. DNS NOT reset.",
            );
        }
    });

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn app_block_message_includes_blocked_path() {
        let message =
            super::format_app_block_message(std::path::Path::new(r"C:\Apps\Browser\browser.exe"));

        assert_eq!(message, r"block:app:C:\Apps\Browser\browser.exe");
    }
}

pub fn install_service() -> anyhow::Result<()> {
    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    )?;
    let exe_path = std::env::current_exe()?;

    let info = ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(SERVICE_DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: exe_path,
        launch_arguments: vec![OsString::from("service-run")],
        dependencies: Vec::new(),
        account_name: None,
        account_password: None,
    };

    let _service = manager.create_service(&info, ServiceAccess::QUERY_STATUS)?;

    Ok(())
}

pub fn uninstall_service() -> anyhow::Result<()> {
    let _ = crate::dns_manager::reset_system_dns();
    let _ = crate::firewall_manager::reset_firewall_protection();
    // Leaving DoH disabled machine-wide after uninstall would be a surprise.
    crate::browser_policy::reset_doh_policy();

    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(
        SERVICE_NAME,
        ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE,
    )?;

    let status = service.query_status()?;
    if status.current_state != ServiceState::Stopped {
        println!("Stopping service before uninstall...");
        let _ = service.stop();
        // Give it a moment to stop
        std::thread::sleep(Duration::from_secs(2));
    }

    service.delete()?;
    let _ = crate::dns_manager::reset_system_dns();
    Ok(())
}

pub fn start_service() -> anyhow::Result<()> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(SERVICE_NAME, ServiceAccess::START)?;
    service.start(&Vec::<OsString>::new())?;
    Ok(())
}

pub fn stop_service() -> anyhow::Result<()> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(
        SERVICE_NAME,
        ServiceAccess::STOP | ServiceAccess::QUERY_STATUS,
    )?;
    service.stop()?;
    Ok(())
}
