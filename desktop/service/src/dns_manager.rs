use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use anyhow::{Result, Context, anyhow};
use std::fs::OpenOptions;
use std::io::Write;
use chrono::Local;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn set_system_dns(addr: &str) -> Result<()> {
    let interfaces = get_managed_interfaces()?;
    for interface in interfaces {
        log_tamper_event(&format!("Setting DNS for interface {} to {}", interface, addr));
        let mut command = Command::new("netsh");
        command.args(&["interface", "ipv4", "set", "dnsservers", &format!("name=\"{}\"", interface), "static", addr, "primary"]);

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let status = command.status()
            .with_context(|| format!("failed to set DNS for {}", interface))?;
        
        if !status.success() {
            return Err(anyhow!("netsh failed with exit code {:?} for {}", status.code(), interface));
        }
    }
    Ok(())
}

pub fn enforce_system_dns(addr: &str) -> Result<bool> {
    if is_dns_set_correctly(addr)? {
        return Ok(false);
    }

    log_tamper_event(&format!("DNS settings not protected. Restoring to {addr}."));
    set_system_dns(addr)?;
    Ok(true)
}

pub fn log_tamper_event(message: &str) {
    let path = libreascent_shared::config::default_config_path().parent().unwrap().join("tamper.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let now = Local::now();
        let _ = writeln!(file, "[{}] {}", now.format("%Y-%m-%d %H:%M:%S"), message);
    }
}

pub fn reset_system_dns() -> Result<()> {
    log_tamper_event("Resetting system DNS to DHCP/Automatic (IPv4 and IPv6).");
    
    // IPv4
    if let Ok(interfaces) = get_connected_interfaces() {
        for interface in interfaces {
            if is_loopback_interface(&interface) {
                continue;
            }
            let mut command = Command::new("netsh");
            command.args(&["interface", "ipv4", "set", "dnsservers", &format!("name=\"{}\"", interface), "dhcp"]);

            #[cfg(windows)]
            command.creation_flags(CREATE_NO_WINDOW);

            let _ = command.status();
        }
    }

    // IPv6
    if let Ok(interfaces) = get_connected_interfaces_ipv6() {
        for interface in interfaces {
            if is_loopback_interface(&interface) {
                continue;
            }
            let mut command = Command::new("netsh");
            command.args(&["interface", "ipv6", "set", "dnsservers", &format!("name=\"{}\"", interface), "dhcp"]);

            #[cfg(windows)]
            command.creation_flags(CREATE_NO_WINDOW);

            let _ = command.status();
        }
    }

    // broad PowerShell reset
    let mut ps_command = Command::new("powershell");
    ps_command.args(&["-NoProfile", "-Command", "Get-NetAdapter | where {$_.Status -eq 'Up'} | Set-DnsClientServerAddress -ResetServerAddresses"]);

    #[cfg(windows)]
    ps_command.creation_flags(CREATE_NO_WINDOW);

    let _ = ps_command.status();

    flush_dns_cache();

    Ok(())
}

/// Windows answers from its own cache without asking the proxy, so a domain
/// already visited stays reachable after it becomes blocked. Best effort: a
/// failed flush is not worth failing the caller over.
pub fn flush_dns_cache() {
    let mut flush_command = Command::new("ipconfig");
    flush_command.arg("/flushdns");

    #[cfg(windows)]
    flush_command.creation_flags(CREATE_NO_WINDOW);

    let _ = flush_command.status();
}

pub fn is_dns_set_correctly(addr: &str) -> Result<bool> {
    let mut command = Command::new("netsh");
    command.args(&["interface", "ipv4", "show", "dnsservers"]);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output()
        .context("failed to show DNS servers")?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let connected = get_managed_interfaces()?;
    for interface in connected {
        if !stdout.contains(&format!("Configuration for interface \"{}\"", interface)) {
            return Ok(false);
        }

        if !interface_dns_section_contains(&stdout, &interface, addr) {
            return Ok(false);
        }
    }

    Ok(true)
}

fn get_managed_interfaces() -> Result<Vec<String>> {
    Ok(get_connected_interfaces()?
        .into_iter()
        .filter(|name| is_managed_dns_interface(name))
        .collect())
}

fn get_connected_interfaces() -> Result<Vec<String>> {
    let mut command = Command::new("netsh");
    command.args(&["interface", "ipv4", "show", "interfaces"]);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output()
        .context("failed to list interfaces")?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_connected_interfaces(&stdout))
}

fn parse_connected_interfaces(output: &str) -> Vec<String> {
    let mut interfaces = Vec::new();

    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 && parts[3].eq_ignore_ascii_case("connected") {
            // Format: Idx Met MTU State Name. Join name because VPN adapters can have spaces.
            interfaces.push(parts[4..].join(" "));
        }
    }

    interfaces
}

fn is_loopback_interface(name: &str) -> bool {
    name.to_ascii_lowercase().contains("loopback")
}

fn is_managed_dns_interface(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    let unmanaged_markers = [
        "loopback",
        "cloudflare",
        "warp",
        "wireguard",
        "wintun",
        "tailscale",
        "zerotier",
        "proton",
        "nordlynx",
        "openvpn",
        "tap-windows",
        "vpn",
    ];

    !unmanaged_markers
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn interface_dns_section_contains(output: &str, interface: &str, addr: &str) -> bool {
    let header = format!("Configuration for interface \"{}\"", interface);
    let Some(start) = output.find(&header) else {
        return false;
    };

    let rest = &output[start + header.len()..];
    let next_section = rest
        .find("Configuration for interface \"")
        .unwrap_or(rest.len());
    rest[..next_section].contains(addr)
}

fn get_connected_interfaces_ipv6() -> Result<Vec<String>> {
    let mut command = Command::new("netsh");
    command.args(&["interface", "ipv6", "show", "interfaces"]);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output()
        .context("failed to list ipv6 interfaces")?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_connected_interfaces(&stdout))
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_connected_interfaces_with_spaces() {
        let output = r#"

Idx     Met         MTU          State                Name
---  ----------  ----------  ------------  ---------------------------
 13          25        1500  connected     Ethernet
 22          35        1280  connected     Cloudflare WARP
  1          75  4294967295  connected     Loopback Pseudo-Interface 1
 17          25        1500  disconnected  Wi-Fi
"#;

        let interfaces = super::parse_connected_interfaces(output);

        assert_eq!(
            interfaces,
            vec![
                "Ethernet".to_string(),
                "Cloudflare WARP".to_string(),
                "Loopback Pseudo-Interface 1".to_string()
            ]
        );
    }

    #[test]
    fn managed_dns_interfaces_exclude_vpn_and_tunnel_adapters() {
        assert!(super::is_managed_dns_interface("Ethernet"));
        assert!(super::is_managed_dns_interface("Wi-Fi"));

        assert!(!super::is_managed_dns_interface("CloudflareWARP"));
        assert!(!super::is_managed_dns_interface("Cloudflare WARP"));
        assert!(!super::is_managed_dns_interface("WireGuard Tunnel"));
        assert!(!super::is_managed_dns_interface("Tailscale"));
        assert!(!super::is_managed_dns_interface("ProtonVPN"));
        assert!(!super::is_managed_dns_interface("OpenVPN TAP-Windows6"));
        assert!(!super::is_managed_dns_interface("Loopback Pseudo-Interface 1"));
    }
}
