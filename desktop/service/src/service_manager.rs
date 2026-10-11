use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tokio::sync::oneshot;
use windows_service::{
    define_windows_service,
    service::{
        ServiceAccess, ServiceAction, ServiceActionType, ServiceControl, ServiceControlAccept,
        ServiceErrorControl, ServiceExitCode, ServiceFailureActions, ServiceFailureResetPeriod,
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

    // try_send, not blocking_send: the SCM calls this on the dispatcher thread,
    // which sits inside main's tokio runtime, and blocking there panics across
    // the FFI boundary and aborts the process with no cleanup. A full channel
    // already holds an event that ends the loop, so dropping this one is fine.
    let event_handler = move |control_event| -> ServiceControlHandlerResult {
        match control_event {
            ServiceControl::Stop => {
                let _ = control_tx.try_send(ServiceEvent::StopRequested);
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Shutdown => {
                let _ = control_tx.try_send(ServiceEvent::ShutdownRequested);
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };

    let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;

    // Installs from older builds have no failure actions, so set them on every
    // start rather than only at install.
    if let Err(e) = ensure_restart_on_crash() {
        crate::dns_manager::log_tamper_event(&format!("Could not set restart-on-crash: {e}"));
    }

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
    let proxy_died = rt.block_on(async {
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

        // Only once the proxy answers: fetching the sources needs DNS, and
        // system DNS is this proxy. The file watcher in dns picks the result up.
        if dns_proxy_ready {
            tokio::spawn(async {
                let path = libreascent_shared::config::default_config_path();
                crate::updater::update_if_stale(&path).await;
            });
        }

        if dns_proxy_ready {
            let config_path = libreascent_shared::config::default_config_path();
            if let Ok(config) = libreascent_shared::config::load_or_create(&config_path) {
                if config.control_mode != libreascent_shared::config::ControlMode::Flexible {
                    let _ = crate::dns_manager::enforce_system_dns("127.0.0.1");

                    // Locked promises friction, not an outage: when every upstream
                    // tier is dead the pin is released until one answers again.
                    // Hardcore stays pinned, since a user could otherwise make the
                    // outage themselves (filtered hotspot, router rule) to free DNS.
                    let fail_open =
                        config.control_mode == libreascent_shared::config::ControlMode::Locked;
                    enforce_task = Some(tokio::spawn(async move {
                        let mut interval = tokio::time::interval(Duration::from_secs(2));
                        let mut released = false;
                        let mut last_probe = Instant::now();
                        loop {
                            interval.tick().await;
                            if fail_open && crate::dns::UPSTREAM_DOWN.load(Ordering::Relaxed) {
                                if !released {
                                    crate::dns_manager::log_tamper_event(
                                        "Upstream unreachable for 60s in Locked mode: releasing the DNS pin until it answers again.",
                                    );
                                    let _ = crate::dns_manager::reset_system_dns();
                                    released = true;
                                }
                                // Nothing reaches the proxy while released, so ask
                                // the upstream directly.
                                if last_probe.elapsed() >= Duration::from_secs(30) {
                                    last_probe = Instant::now();
                                    crate::dns::upstream_probe().await;
                                }
                                continue;
                            }
                            if released {
                                crate::dns_manager::log_tamper_event(
                                    "Upstream answered again: re-pinning DNS.",
                                );
                                released = false;
                            }
                            // While the network's own DNS stands in, the proxy
                            // stops trying the filtered tiers, so check them here.
                            // Spawned: a dead tier costs its timeout, and the pin
                            // below must keep its 2s cadence.
                            if crate::dns::router_fallback_active()
                                && last_probe.elapsed() >= Duration::from_secs(30)
                            {
                                last_probe = Instant::now();
                                tokio::spawn(crate::dns::upstream_probe());
                            }
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
            // A failed netsh run pauses enforcement instead of latching it off
            // until restart: one bad rule used to silently disable every rule,
            // bypass guard included, for the rest of the session.
            let mut firewall_failed_at: Option<Instant> = None;
            let mut last_dns_enforced: Option<bool> = None;
            let mut last_vpn_dns: Option<Vec<std::net::Ipv4Addr>> = None;
            let mut last_open_dns: Option<Vec<std::net::Ipv4Addr>> = None;
            let mut stale_rules_removed = false;
            // One PowerShell run per lookup, so cached while the fallback is wanted.
            let mut router_dns: Option<(Vec<std::net::Ipv4Addr>, Instant)> = None;
            // ~150 reg.exe runs per write, so only on a config change or as a
            // slow repair pass, not on every firewall refresh.
            let mut last_policy: Option<(String, Instant)> = None;

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

                    // Only seal DNS bypass paths when the proxy is up and the
                    // system resolver is pinned to it. In Flexible mode DNS is
                    // not redirected, so sealing :53 would break resolution, and
                    // Locked drops the seal while the pin is released (see the
                    // enforce task above).
                    let dns_enforced = dns_proxy_ready_for_firewall
                        && config.control_mode != libreascent_shared::config::ControlMode::Flexible
                        && !(config.control_mode == libreascent_shared::config::ControlMode::Locked
                            && crate::dns::UPSTREAM_DOWN.load(Ordering::Relaxed));
                    let firewall_paused = firewall_failed_at
                        .is_some_and(|at| at.elapsed() < Duration::from_secs(600));
                    // A VPN app's resolver has to stay reachable: it blocks
                    // every other DNS server, this proxy included, and the
                    // browser blocker takes over domain checks meanwhile.
                    let vpn_dns = if dns_enforced {
                        crate::dns_manager::vpn_dns_servers()
                    } else {
                        Vec::new()
                    };
                    let vpn_changed = last_vpn_dns.as_ref() != Some(&vpn_dns);

                    // Last resort once every filtered upstream is down: the
                    // network's own resolver, cut out of the :53 seal only for as
                    // long as the proxy needs it. The blocklist still runs first.
                    let router = if dns_enforced && crate::dns::router_fallback_wanted() {
                        if router_dns
                            .as_ref()
                            .is_none_or(|(_, at)| at.elapsed() >= Duration::from_secs(60))
                        {
                            router_dns = Some((crate::dns_manager::router_dns_servers(), Instant::now()));
                        }
                        router_dns.as_ref().map(|(ips, _)| ips.clone()).unwrap_or_default()
                    } else {
                        router_dns = None;
                        Vec::new()
                    };
                    let mut open_dns = vpn_dns.clone();
                    open_dns.extend(router.iter().filter(|ip| !vpn_dns.contains(ip)));
                    let open_changed = last_open_dns.as_ref() != Some(&open_dns);
                    if router.is_empty() {
                        crate::dns::set_router_fallback(&[]);
                    }

                    if !firewall_paused
                        && (!newly_blocked_paths.is_empty()
                            || last_dns_enforced != Some(dns_enforced)
                            || vpn_changed
                            || open_changed
                            || last_firewall_refresh.elapsed() >= Duration::from_secs(60))
                    {
                        if vpn_changed && !vpn_dns.is_empty() {
                            crate::dns_manager::log_tamper_event(&format!(
                                "VPN resolver {vpn_dns:?} in use: DNS opened to it, browser blocker checks domains."
                            ));
                        }
                        match crate::firewall_manager::ensure_firewall_protection(
                            &config,
                            &runtime_blocked_paths,
                            dns_enforced,
                            &open_dns,
                        ) {
                            Ok(kept) => {
                                if !stale_rules_removed {
                                    crate::firewall_manager::remove_stale_rules(&kept);
                                    stale_rules_removed = true;
                                }
                                firewall_failed_at = None;
                                last_dns_enforced = Some(dns_enforced);
                                last_vpn_dns = Some(vpn_dns.clone());
                                last_open_dns = Some(open_dns.clone());
                                // Only now: before the seal opens, every query
                                // to the router would fail and count against it.
                                crate::dns::set_router_fallback(&router);
                            }
                            Err(e) => {
                                crate::dns_manager::log_tamper_event(&format!(
                                    "Firewall enforcement failed, retrying in 10 minutes: {e}"
                                ));
                                firewall_failed_at = Some(Instant::now());
                            }
                        }

                        // Browser DoH and VPN extensions both bypass the proxy
                        // entirely and cannot be sealed by IP, so shut them off
                        // by policy whenever DNS is enforced. Logged but not
                        // latched: unlike the firewall this is idempotent and
                        // safe to retry each pass.
                        if dns_enforced && !vpn_dns.is_empty() {
                            crate::dns_manager::remove_nrpt();
                        } else if dns_enforced {
                            if let Err(e) = crate::dns_manager::ensure_nrpt("127.0.0.1") {
                                crate::dns_manager::log_tamper_event(&format!(
                                    "Failed to add name resolution policy: {e}"
                                ));
                            }
                        }
                        if dns_enforced {
                            let snapshot = serde_json::to_string(&config).unwrap_or_default();
                            let due = last_policy.as_ref().is_none_or(|(written, at)| {
                                *written != snapshot || at.elapsed() >= Duration::from_secs(600)
                            });
                            if due {
                                match crate::browser_policy::enforce_browser_policy(&config) {
                                    Ok(()) => last_policy = Some((snapshot, Instant::now())),
                                    Err(e) => crate::dns_manager::log_tamper_event(&format!(
                                        "Failed to apply browser lockdown policy: {e}"
                                    )),
                                }
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

        // The resets below run dozens of netsh/reg/PowerShell children. Without
        // a wait hint the SCM kills the process 5s into a shutdown, and the
        // firewall seal then outlives the reboot with no proxy behind it.
        let _ = status_handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::StopPending,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::from_secs(60),
            process_id: None,
        });

        // Stop all background tasks before resetting DNS
        if let Some(handle) = enforce_task {
            handle.abort();
        }
        blocker_task.abort();
        dns_task.abort();

        // Reset system DNS on stop, unless Hardcore. A proxy that died is the
        // exception in every mode: a pin with nothing behind it protects
        // nothing and only takes the machine offline.
        let config_path = libreascent_shared::config::default_config_path();
        let config = libreascent_shared::config::load_or_create(&config_path).ok();
        let is_hardcore = config
            .map(|c| c.control_mode == libreascent_shared::config::ControlMode::Hardcore)
            .unwrap_or(false);
        let proxy_died = matches!(event, Some(ServiceEvent::DnsProxyStopped));

        if !is_hardcore || proxy_died {
            let _ = crate::dns_manager::reset_system_dns();
            let _ = crate::firewall_manager::reset_firewall_protection();
            crate::browser_policy::reset_browser_policy();
            if is_hardcore {
                crate::dns_manager::log_tamper_event(
                    "DNS proxy stopped in Hardcore mode: DNS and firewall reset so the machine keeps a resolver. Protection resumes when the service restarts.",
                );
            }
        } else if matches!(event, Some(ServiceEvent::ShutdownRequested)) {
            crate::dns_manager::log_tamper_event(
                "Service shutdown requested in Hardcore mode. DNS NOT reset.",
            );
        } else {
            crate::dns_manager::log_tamper_event(
                "Service stopped in Hardcore mode. DNS NOT reset.",
            );
        }
        proxy_died
    });

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        // Non-zero so the SCM's failure actions bring the proxy back; a clean
        // exit here left the machine unprotected until the next reboot.
        exit_code: if proxy_died {
            ServiceExitCode::ServiceSpecific(1)
        } else {
            ServiceExitCode::Win32(0)
        },
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
    // The service is installed either way, and sets this again on every start.
    if let Err(e) = ensure_restart_on_crash() {
        crate::dns_manager::log_tamper_event(&format!("Could not set restart-on-crash: {e}"));
    }

    Ok(())
}

/// A crash used to leave the pin, NRPT rule and seal in place with nothing
/// answering behind them until the next reboot. Applies only to crashes: a stop
/// through the SCM is a clean exit and stays stopped.
fn ensure_restart_on_crash() -> anyhow::Result<()> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    // SC_ACTION_RESTART is refused without START on the handle.
    let service = manager.open_service(
        SERVICE_NAME,
        ServiceAccess::CHANGE_CONFIG | ServiceAccess::START,
    )?;
    let restart = || ServiceAction {
        action_type: ServiceActionType::Restart,
        delay: Duration::from_secs(2),
    };
    service.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(3600)),
        reboot_msg: None,
        command: None,
        actions: Some(vec![restart(), restart(), restart()]),
    })?;
    // A proxy that cannot bind ends the service with an error exit, not a
    // crash; this makes the SCM retry that too.
    service.set_failure_actions_on_non_crash_failures(true)?;
    Ok(())
}

pub fn uninstall_service() -> anyhow::Result<()> {
    let removed = (|| -> anyhow::Result<()> {
        let manager =
            ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
        let service = manager.open_service(
            SERVICE_NAME,
            ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE,
        )?;

        if service.query_status()?.current_state != ServiceState::Stopped {
            println!("Stopping service before uninstall...");
            let _ = service.stop();
        }
        for _ in 0..30 {
            if service.query_status()?.current_state == ServiceState::Stopped {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }

        service.delete()?;
        Ok(())
    })();

    // After the stop, so the enforce loops cannot re-apply what is being undone,
    // and unconditional, since a Hardcore stop leaves everything in place on
    // purpose. Leaving DoH disabled machine-wide after uninstall would be a
    // surprise.
    let _ = crate::dns_manager::reset_system_dns();
    let _ = crate::firewall_manager::reset_firewall_protection();
    crate::browser_policy::reset_browser_policy();
    removed
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

/// Repair runs this without friction in every mode, so it must never leave the
/// service down: a start issued while the old process is still stopping fails.
pub fn restart_service() -> anyhow::Result<()> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(
        SERVICE_NAME,
        ServiceAccess::STOP | ServiceAccess::START | ServiceAccess::QUERY_STATUS,
    )?;

    if service.query_status()?.current_state != ServiceState::Stopped {
        let _ = service.stop();
    }
    // As long as the 60s stop wait hint: outside Hardcore the stop resets DNS,
    // firewall and browser policy, and that alone outlasted the old 15s.
    for _ in 0..120 {
        if service.query_status()?.current_state == ServiceState::Stopped {
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    service.start(&Vec::<OsString>::new())?;
    Ok(())
}

/// Recover Internet: brings the connection back without lowering protection,
/// so the UI runs it without friction in every mode. The restart rebuilds the
/// proxy's upstreams and re-applies the pin, NRPT rule, seal and policies.
/// Releasing is left to the service: if its proxy cannot bind it releases DNS
/// itself, and releasing from here while it starts would undo what it applies.
pub async fn recover() -> anyhow::Result<()> {
    crate::dns_manager::recover_network();
    restart_service()?;

    for _ in 0..15 {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if crate::dns::local_dns_proxy_responds().await.unwrap_or(false) {
            crate::dns_manager::log_tamper_event("Recover Internet: DNS proxy answering.");
            return Ok(());
        }
    }
    anyhow::bail!("the DNS proxy did not answer after the restart")
}
