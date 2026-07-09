mod config_loader;
mod dns;
mod updater;
mod service_manager;
mod dns_manager;
mod firewall_manager;
mod process_manager;

use anyhow::{bail, Result};
use libreascent_shared::config::default_config_path;

#[tokio::main]
async fn main() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();

    match args.first().map(String::as_str) {
        Some("check-domain") => {
            let Some(domain) = args.get(1) else {
                bail!("usage: libreascent-service check-domain <domain>");
            };
            let blocklist = config_loader::load_blocklist(&default_config_path());
            println!("{}", if blocklist.is_blocked(domain) { "blocked" } else { "allowed" });
        }
        Some("update-sources") => {
            updater::update_sources(&default_config_path()).await?;
        }
        Some("run-dns") => {
            dns::run_local_dns_proxy(default_config_path(), "127.0.0.1:53").await?;
        }

        Some("install") => {
            service_manager::install_service()?;
            println!("Service installed.");
        }
        Some("uninstall") => {
            service_manager::uninstall_service()?;
            println!("Service uninstalled.");
        }
        Some("start") => {
            service_manager::start_service()?;
            println!("Service started.");
        }
        Some("stop") => {
            service_manager::stop_service()?;
            println!("Service stopped.");
        }
        Some("set-dns") => {
            crate::dns_manager::log_tamper_event("Manual set-dns requested.");
            if !dns::local_dns_proxy_responds().await? {
                crate::dns_manager::log_tamper_event("set-dns failed: DNS proxy not responding.");
                bail!("local DNS proxy is not responding on 127.0.0.1:53; DNS was not changed");
            }
            dns_manager::set_system_dns("127.0.0.1")?;
            crate::dns_manager::log_tamper_event("Manual set-dns succeeded.");
            println!("System DNS set to 127.0.0.1.");
        }
        Some("reset-dns") => {
            dns_manager::reset_system_dns()?;
            println!("System DNS reset to DHCP.");
        }
        Some("block-apps") => {
            let config = libreascent_shared::config::load_or_create(&default_config_path())?;
            let mut sys = process_manager::create_system_handle();
            process_manager::check_and_block_apps(&mut sys, &config);
            // CLI app-block does not start the DNS proxy, so the bypass seal stays off.
            firewall_manager::ensure_firewall_protection(&config, &[], false)?;
        }
        Some("service-run") => {
            service_manager::run_service()?;
        }
        _ => {
            println!("usage:");
            println!("  libreascent-service check-domain <domain>");
            println!("  libreascent-service update-sources");
            println!("  libreascent-service run-dns");
            println!("  libreascent-service install");
            println!("  libreascent-service uninstall");
            println!("  libreascent-service set-dns");
            println!("  libreascent-service reset-dns");
            println!("  libreascent-service block-apps");
        }
    }

    Ok(())
}
