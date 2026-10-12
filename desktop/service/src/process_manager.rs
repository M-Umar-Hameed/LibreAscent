use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
use libreascent_shared::config::{ControlMode, DesktopConfig};
use std::path::PathBuf;

/// Install folders of VPN and anti-censorship clients. An installed client can
/// connect straight to its servers by IP, past every DNS list, and takes DNS
/// over once connected.
const VPN_PATH_MARKERS: &[&str] = &[
    r"\nordvpn", r"\expressvpn", r"\surfshark", r"\cyberghost", r"\private internet access",
    r"\mullvad vpn", r"\windscribe", r"\hotspot shield", r"\tunnelbear", r"\ipvanish",
    r"\purevpn", r"\vyprvpn", r"\hide.me vpn", r"\atlas vpn", r"\urban vpn", r"\betternet",
    r"\psiphon", r"\zenmate", r"\touchvpn", r"\openvpn", r"\wireguard\", r"\softether",
    r"\cloudflare warp", r"\tor browser", r"\hola", r"\ultrasurf", r"\x-vpn", r"\turbo vpn",
    r"\planet vpn", r"\vpn unlimited", r"\avast secureline", r"\avg secure vpn", r"\norton vpn",
    r"\kaspersky vpn", r"\bitdefender vpn", r"\mcafee vpn",
];
/// The same clients when run from somewhere else, portable copies included.
const VPN_EXE_NAMES: &[&str] = &[
    "openvpn.exe", "openvpn-gui.exe", "openvpnconnect.exe", "wireguard.exe", "tor.exe",
    "psiphon3.exe", "warp-svc.exe", "v2ray.exe", "xray.exe", "sing-box.exe", "hysteria.exe",
    "nordvpn.exe", "expressvpn.exe", "windscribe.exe", "surfshark.exe", "mullvad vpn.exe",
];
/// The user's own VPN. Proton bundles openvpn.exe, so it is exempt by folder.
const ALLOWED_VPN_MARKERS: &[&str] = &[r"\proton\"];

pub fn check_and_block_apps(sys: &mut System, config: &DesktopConfig) -> Vec<PathBuf> {
    if config.blocked_apps.is_empty() && config.control_mode == ControlMode::Flexible {
        return Vec::new();
    }

    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut blocked_paths = Vec::new();

    for (pid, process) in sys.processes() {
        let exe_name = process.name().to_string_lossy().to_lowercase();
        let exe_path = process.exe().map(|path| path.to_string_lossy().to_string());

        if should_block_process(&exe_name, exe_path.as_deref(), config) {
            println!("Blocking app: {} (PID: {:?})", exe_name, pid);
            if let Some(path) = process.exe() {
                blocked_paths.push(path.to_path_buf());
            }
            let _ = process.kill();
        }
    }

    blocked_paths.sort();
    blocked_paths.dedup();
    blocked_paths
}

pub fn create_system_handle() -> System {
    System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()))
}

fn should_block_process(exe_name: &str, exe_path: Option<&str>, config: &DesktopConfig) -> bool {
    let exe_name = exe_name.to_lowercase();
    let exe_path = exe_path.map(|path| path.to_lowercase());

    config.blocked_apps.iter().any(|rule| {
        executable_matches(&exe_name, exe_path.as_deref(), &rule.executable.to_lowercase())
    }) || (config.control_mode != ControlMode::Flexible && is_vpn_client(&exe_name, exe_path.as_deref()))
}

fn is_vpn_client(exe_name: &str, exe_path: Option<&str>) -> bool {
    if exe_path.is_some_and(|path| ALLOWED_VPN_MARKERS.iter().any(|m| path.contains(m))) {
        return false;
    }
    VPN_EXE_NAMES.contains(&exe_name)
        || exe_path.is_some_and(|path| VPN_PATH_MARKERS.iter().any(|m| path.contains(m)))
}

fn executable_matches(exe_name: &str, exe_path: Option<&str>, rule_exe: &str) -> bool {
    exe_name == rule_exe
        || exe_name == format!("{rule_exe}.exe")
        || exe_path
            .map(|path| path.contains(rule_exe))
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use libreascent_shared::config::default_config;

    #[test]
    fn allows_cloudflare_warp_unless_user_configured_it() {
        let config = default_config();

        assert!(!should_block_process(
            "warp-svc.exe",
            Some(r"C:\Program Files\Cloudflare\Cloudflare WARP\warp-svc.exe"),
            &config,
        ));
    }

    #[test]
    fn locked_and_hardcore_block_installed_vpns_but_not_proton() {
        let mut config = default_config();
        for mode in [ControlMode::Locked, ControlMode::Hardcore] {
            config.control_mode = mode.clone();
            for (name, path) in [
                ("nordvpn.exe", r"C:\Program Files\NordVPN\NordVPN.exe"),
                ("nordvpn-service.exe", r"C:\Program Files\NordVPN\nordvpn-service.exe"),
                ("openvpn.exe", r"C:\Program Files\OpenVPN\bin\openvpn.exe"),
                ("wireguard.exe", r"C:\Program Files\WireGuard\wireguard.exe"),
                ("warp-svc.exe", r"C:\Program Files\Cloudflare\Cloudflare WARP\warp-svc.exe"),
                ("tor.exe", r"C:\Users\A\Desktop\Tor Browser\Browser\TorBrowser\Tor\tor.exe"),
                ("psiphon3.exe", r"C:\Users\A\Downloads\psiphon3.exe"),
            ] {
                assert!(should_block_process(name, Some(path), &config), "{mode:?} must block {path}");
            }
            for (name, path) in [
                ("openvpn.exe", r"C:\Program Files\Proton\VPN\v5.1.8\Resources\openvpn.exe"),
                ("protonvpn.client.exe", r"C:\Program Files\Proton\VPN\v5.1.8\ProtonVPN.Client.exe"),
                ("protonvpn.wireguardservice.exe", r"C:\Program Files\Proton\VPN\v5.1.8\ProtonVPN.WireGuardService.exe"),
                ("cloudflared.exe", r"C:\Program Files (x86)\cloudflared\cloudflared.exe"),
                ("chrome.exe", r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            ] {
                assert!(!should_block_process(name, Some(path), &config), "{mode:?} must allow {path}");
            }
        }
    }

    #[test]
    fn allows_unconfigured_normal_process() {
        let config = default_config();

        assert!(!should_block_process("notepad.exe", None, &config));
    }
}
