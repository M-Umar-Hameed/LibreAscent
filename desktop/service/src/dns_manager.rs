use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use anyhow::{Result, Context, anyhow};
use std::fs::OpenOptions;
use std::io::Write;
use chrono::Local;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// netsh's `name="..."`, passed verbatim. As a normal argument Rust escapes the
/// quotes, and an interface name with a space ("Ethernet 4") then matches
/// nothing while netsh still exits 0.
fn name_arg(command: &mut Command, interface: &str) {
    #[cfg(windows)]
    command.raw_arg(format!("name=\"{interface}\""));
    #[cfg(not(windows))]
    command.arg(format!("name={interface}"));
}

pub fn set_system_dns(addr: &str) -> Result<()> {
    let interfaces = get_managed_interfaces()?;
    for interface in interfaces {
        log_tamper_event(&format!("Setting DNS for interface {} to {}", interface, addr));
        let mut command = Command::new("netsh");
        command.args(&["interface", "ipv4", "set", "dnsservers"]);
        name_arg(&mut command, &interface);
        command.args(&["static", addr, "primary"]);

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

const NRPT_COMMENT: &str = "LibreAscent";
const NRPT_KEY: &str = r"HKLM\SYSTEM\CurrentControlSet\Services\Dnscache\Parameters\DnsPolicyConfig";

/// A name resolution policy sending every name to the proxy. It outranks any
/// adapter's DNS, so a VPN app that sets its own resolver still resolves
/// through the blocklist while its tunnel carries the traffic. A company VPN's
/// own rules for its internal names are more specific and still win.
pub fn ensure_nrpt(addr: &str) -> Result<()> {
    if nrpt_present() {
        return Ok(());
    }
    log_tamper_event(&format!("Adding name resolution policy: all names to {addr}."));
    let status = powershell(&format!(
        "Add-DnsClientNrptRule -Namespace '.' -NameServers '{addr}' -Comment '{NRPT_COMMENT}'"
    ))
    .status()
    .context("failed to add NRPT rule")?;
    if !status.success() {
        return Err(anyhow!("Add-DnsClientNrptRule failed with exit code {:?}", status.code()));
    }
    Ok(())
}

/// IPv4 resolvers of the VPN adapters, which the proxy leaves alone. A VPN app
/// such as Proton blocks every DNS server but its own, this proxy included.
pub fn vpn_dns_servers() -> Vec<std::net::Ipv4Addr> {
    let mut command = Command::new("netsh");
    command.args(&["interface", "ipv4", "show", "dnsservers"]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    match command.output() {
        Ok(output) => parse_vpn_dns(&String::from_utf8_lossy(&output.stdout)),
        Err(_) => Vec::new(),
    }
}

fn parse_vpn_dns(output: &str) -> Vec<std::net::Ipv4Addr> {
    let mut servers = Vec::new();
    for section in output.split("Configuration for interface \"").skip(1) {
        let Some((name, body)) = section.split_once('"') else {
            continue;
        };
        if is_managed_dns_interface(name) {
            continue;
        }
        for token in body.split_whitespace() {
            if let Ok(ip) = token.parse::<std::net::Ipv4Addr>() {
                if !ip.is_loopback() && !servers.contains(&ip) {
                    servers.push(ip);
                }
            }
        }
    }
    servers
}

/// The resolvers DHCP handed each connected adapter (the router, as a rule).
/// The adapters themselves are pinned to 127.0.0.1, so these are read from the
/// lease in the registry; the gateway stands in when the lease names none.
pub fn router_dns_servers() -> Vec<std::net::Ipv4Addr> {
    let script = r#"Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object { $p = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$($_.InterfaceGuid)" -ErrorAction SilentlyContinue; $dns = if ($p.DhcpNameServer) { $p.DhcpNameServer } else { $p.DhcpDefaultGateway -join ' ' }; "$($_.Name)|$dns" }"#;
    match powershell(script).output() {
        Ok(output) => parse_router_dns(&String::from_utf8_lossy(&output.stdout)),
        Err(_) => Vec::new(),
    }
}

fn parse_router_dns(output: &str) -> Vec<std::net::Ipv4Addr> {
    let mut servers = Vec::new();
    for line in output.lines() {
        let Some((name, dns)) = line.trim().split_once('|') else {
            continue;
        };
        // VPN adapters are handled by the VPN handover.
        if !is_managed_dns_interface(name) {
            continue;
        }
        for token in dns.split(|c: char| c.is_whitespace() || c == ',') {
            if let Ok(ip) = token.parse::<std::net::Ipv4Addr>() {
                if !ip.is_loopback() && !ip.is_unspecified() && !servers.contains(&ip) {
                    servers.push(ip);
                }
            }
        }
    }
    servers
}

/// The network side of Recover Internet. A Network Reset, or a user chasing
/// an outage, can leave the wired or Wi-Fi adapter disabled, and after a router
/// restart the lease can be refused until the adapter asks again.
pub fn recover_network() {
    log_tamper_event("Recover Internet: re-enabling adapters, renewing leases, flushing DNS.");
    let _ = powershell(
        "Get-NetAdapter -Physical | Where-Object AdminStatus -eq 'Down' | Enable-NetAdapter -Confirm:$false",
    )
    .status();
    // An adapter just enabled needs a moment before it can ask for a lease.
    std::thread::sleep(std::time::Duration::from_secs(5));
    // Physical adapters only: renewing a VPN's virtual adapter can drop its
    // tunnel. An adapter with no DHCP server answering holds a renew for about
    // a minute.
    run_with_timeout(
        &mut powershell(
            "Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object { ipconfig /renew $_.Name }",
        ),
        std::time::Duration::from_secs(45),
    );
    run_with_timeout(Command::new("ipconfig").arg("/flushdns"), std::time::Duration::from_secs(15));
}

fn run_with_timeout(command: &mut Command, limit: std::time::Duration) {
    command
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let Ok(mut child) = command.spawn() else {
        return;
    };
    let deadline = std::time::Instant::now() + limit;
    while std::time::Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    let _ = child.kill();
}

pub fn remove_nrpt() {
    if !nrpt_present() {
        return;
    }
    let _ = powershell(&format!(
        "Get-DnsClientNrptRule | Where-Object Comment -eq '{NRPT_COMMENT}' | Remove-DnsClientNrptRule -Force"
    ))
    .status();
}

fn nrpt_present() -> bool {
    let mut command = Command::new("reg");
    command.args(&["query", NRPT_KEY, "/s", "/f", NRPT_COMMENT, "/d"]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.output().map(|o| o.status.success()).unwrap_or(false)
}

fn powershell(script: &str) -> Command {
    let mut command = Command::new("powershell");
    command.args(&["-NoProfile", "-NonInteractive", "-Command", script]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

pub fn reset_system_dns() -> Result<()> {
    log_tamper_event("Resetting system DNS to DHCP/Automatic (IPv4 and IPv6).");
    remove_nrpt();
    
    // IPv4
    if let Ok(interfaces) = get_connected_interfaces() {
        for interface in interfaces {
            if is_loopback_interface(&interface) {
                continue;
            }
            let mut command = Command::new("netsh");
            command.args(&["interface", "ipv4", "set", "dnsservers"]);
            name_arg(&mut command, &interface);
            command.arg("dhcp");

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
            command.args(&["interface", "ipv6", "set", "dnsservers"]);
            name_arg(&mut command, &interface);
            command.arg("dhcp");

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

    // Flush DNS cache
    let mut flush_command = Command::new("ipconfig");
    flush_command.arg("/flushdns");

    #[cfg(windows)]
    flush_command.creation_flags(CREATE_NO_WINDOW);

    let _ = flush_command.status();

    Ok(())
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

    #[test]
    fn vpn_resolvers_come_only_from_vpn_adapters() {
        let output = "\nConfiguration for interface \"ProtonVPN\"\n    Statically Configured DNS Servers:    10.2.0.1\n    Register with which suffix:           Primary only\n\nConfiguration for interface \"Ethernet\"\n    Statically Configured DNS Servers:    127.0.0.1\n    Register with which suffix:           Primary only\n\nConfiguration for interface \"Loopback Pseudo-Interface 1\"\n    Statically Configured DNS Servers:    None\n";
        assert_eq!(super::parse_vpn_dns(output), vec![std::net::Ipv4Addr::new(10, 2, 0, 1)]);
    }

    #[test]
    fn router_resolvers_come_from_connected_non_vpn_leases() {
        let output = "Ethernet 2|10.123.21.96\r\nWi-Fi|192.168.1.1 8.8.8.8\r\nProtonVPN|10.2.0.1\r\nEthernet|\r\nvEthernet (WSL)|172.20.0.1\r\nEthernet 3|10.123.21.96, 127.0.0.1\r\n";
        assert_eq!(
            super::parse_router_dns(output),
            [[10, 123, 21, 96], [192, 168, 1, 1], [8, 8, 8, 8], [172, 20, 0, 1]]
                .map(std::net::Ipv4Addr::from)
                .to_vec()
        );
    }
}
