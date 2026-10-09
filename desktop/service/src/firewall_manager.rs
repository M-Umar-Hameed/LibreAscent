use anyhow::{Context, Result};
use libreascent_shared::config::{BlockedAppRule, DesktopConfig, DNS_BYPASS_SEAL_RULE_NAMES};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Rules are identified by their DisplayName prefix, not a firewall group:
// `netsh advfirewall firewall add rule` has no group= parameter, and passing
// one makes netsh reject the entire command with exit code 1.
// reset_firewall_protection matches on this prefix for the same reason.
const FIREWALL_NAME_PREFIX: &str = "LibreAscent ";

// Public resolver IPs users commonly point apps/browsers at to bypass the local
// proxy. Quad9 is our own upstream (see dns.rs), reachable on :853, :443 and
// :53 so the proxy can fall back when DoT is dead; the exposure is the same on
// each port, since a local stub to Quad9 bypasses filtering over any of them.
const CLOUDFLARE_IPS: &str = "1.1.1.1,1.0.0.1,2606:4700:4700::1111,2606:4700:4700::1001";
const GOOGLE_IPS: &str = "8.8.8.8,8.8.4.4,2001:4860:4860::8888,2001:4860:4860::8844";
const OPENDNS_IPS: &str = "208.67.222.222,208.67.220.220,2620:119:35::35,2620:119:53::53";
const ADGUARD_IPS: &str = "94.140.14.14,94.140.15.15,2a10:50c0::ad1:ff,2a10:50c0::ad2:ff";

const QUAD9: [Ipv4Addr; 2] = [Ipv4Addr::new(9, 9, 9, 9), Ipv4Addr::new(149, 112, 112, 112)];

/// Every remote except Quad9's two IPv4 endpoints and [exempt]. Block rules
/// cannot carry an exception, so the blanket :53 seal is written as the ranges
/// around them.
fn remotes_except(exempt: &[Ipv4Addr]) -> String {
    let mut holes: Vec<u32> = QUAD9.iter().chain(exempt).map(|ip| u32::from(*ip)).collect();
    holes.sort_unstable();
    holes.dedup();
    let mut ranges = Vec::new();
    let mut start: u64 = 0;
    for hole in holes.into_iter().map(u64::from) {
        if hole > start {
            ranges.push(format!("{}-{}", ipv4(start), ipv4(hole - 1)));
        }
        start = hole + 1;
    }
    if start <= u64::from(u32::MAX) {
        ranges.push(format!("{}-255.255.255.255", ipv4(start)));
    }
    ranges.push("::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff".to_string());
    ranges.join(",")
}

fn ipv4(value: u64) -> Ipv4Addr {
    Ipv4Addr::from(value as u32)
}

const DNS_BYPASS_RULE_NAMES: [&str; 5] = [
    DNS_BYPASS_SEAL_RULE_NAMES[0],
    DNS_BYPASS_SEAL_RULE_NAMES[1],
    "LibreAscent Block DoH",
    "LibreAscent Block DoT",
    "LibreAscent Block DoQ",
];

#[derive(Debug, Clone, PartialEq, Eq)]
struct FirewallRuleSpec {
    name: String,
    args: Vec<String>,
}

/// `dns_enforced` must be true only when the local DNS proxy is up and the
/// system resolver is pinned to it (non-Flexible mode). When false, the DNS
/// bypass rules are removed so normal resolution keeps working through the
/// machine's real resolver. `vpn_dns` are a connected VPN app's resolvers,
/// left reachable on :53 because the VPN blocks every other DNS server.
pub fn ensure_firewall_protection(
    config: &DesktopConfig,
    runtime_app_paths: &[PathBuf],
    dns_enforced: bool,
    vpn_dns: &[Ipv4Addr],
) -> Result<()> {
    let mut specs = configured_app_rules(config);
    specs.extend(runtime_app_paths.iter().map(|path| app_rule_for_path(path)));

    if dns_enforced {
        specs.extend(dns_bypass_block_rules(vpn_dns));
    } else {
        for name in DNS_BYPASS_RULE_NAMES {
            delete_firewall_rule_by_name(name);
        }
    }

    for spec in dedupe_rules(specs) {
        replace_firewall_rule(&spec)?;
    }

    Ok(())
}

/// PowerShell used to remove every LibreAscent rule. Extracted so the string is
/// testable: a stray escape here silently breaks cleanup with no error surfaced,
/// since the caller ignores the exit status.
fn reset_command() -> String {
    format!(
        "Get-NetFirewallRule -DisplayName '{FIREWALL_NAME_PREFIX}*' -ErrorAction SilentlyContinue |          Remove-NetFirewallRule -ErrorAction SilentlyContinue"
    )
}

pub fn reset_firewall_protection() -> Result<()> {
    // netsh `delete rule` has no group= filter, and netsh's group= does not
    // populate the RuleGroup that `Remove-NetFirewallRule -Group` matches. The
    // reliable key is the DisplayName (netsh name=), which every rule prefixes
    // with "LibreAscent ", so match that and remove the whole set at once.
    let mut command = Command::new("powershell");
    let remove = reset_command();
    command.args(["-NoProfile", "-Command", &remove]);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let _ = command.status().context("failed to reset LibreAscent firewall rules")?;
    Ok(())
}

fn delete_firewall_rule_by_name(name: &str) {
    let mut delete = Command::new("netsh");
    delete.args([
        "advfirewall",
        "firewall",
        "delete",
        "rule",
        &format!("name={name}"),
    ]);

    #[cfg(windows)]
    delete.creation_flags(CREATE_NO_WINDOW);

    let _ = delete.status();
}

fn replace_firewall_rule(spec: &FirewallRuleSpec) -> Result<()> {
    delete_firewall_rule_by_name(&spec.name);

    let mut add = Command::new("netsh");
    add.args(&spec.args);

    #[cfg(windows)]
    add.creation_flags(CREATE_NO_WINDOW);

    let status = add
        .status()
        .with_context(|| format!("failed to add firewall rule {}", spec.name))?;

    if !status.success() {
        anyhow::bail!(
            "netsh failed with exit code {:?} while adding firewall rule {}",
            status.code(),
            spec.name
        );
    }

    Ok(())
}

fn configured_app_rules(config: &DesktopConfig) -> Vec<FirewallRuleSpec> {
    config
        .blocked_apps
        .iter()
        .filter_map(app_rule_from_config)
        .collect()
}

fn app_rule_from_config(rule: &BlockedAppRule) -> Option<FirewallRuleSpec> {
    rule.full_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .map(|path| app_rule_for_path(Path::new(path)))
}

fn app_rule_for_path(path: &Path) -> FirewallRuleSpec {
    let program = path.to_string_lossy().to_string();
    let name = format!("{FIREWALL_NAME_PREFIX}Block App {}", stable_rule_key(&program));

    FirewallRuleSpec {
        name: name.clone(),
        args: vec![
            "advfirewall".to_string(),
            "firewall".to_string(),
            "add".to_string(),
            "rule".to_string(),
            format!("name={name}"),
            "dir=out".to_string(),
            "action=block".to_string(),
            "profile=any".to_string(),
            "enable=yes".to_string(),
            "protocol=any".to_string(),
            format!("program={program}"),
        ],
    }
}

fn dns_block_rule(
    name: &str,
    protocol: &str,
    remoteip: Option<String>,
    remoteport: &str,
) -> FirewallRuleSpec {
    let mut args = vec![
        "advfirewall".to_string(),
        "firewall".to_string(),
        "add".to_string(),
        "rule".to_string(),
        format!("name={name}"),
        "dir=out".to_string(),
        "action=block".to_string(),
        "profile=any".to_string(),
        "enable=yes".to_string(),
        format!("protocol={protocol}"),
        format!("remoteport={remoteport}"),
    ];
    if let Some(ip) = remoteip {
        args.push(format!("remoteip={ip}"));
    }
    FirewallRuleSpec {
        name: name.to_string(),
        args,
    }
}

// Seals every DNS bypass path around the local proxy. Loopback traffic
// (client -> 127.0.0.1:53) is exempt from Windows Firewall, so blocking
// plaintext :53 to all remotes does not touch the proxy itself. The proxy's
// upstream legs all go to Quad9 (:853, :443, :53), which stays reachable.
fn dns_bypass_block_rules(vpn_dns: &[Ipv4Addr]) -> Vec<FirewallRuleSpec> {
    // Quad9 excluded: our proxy forwards to it.
    let bypass_resolvers = format!("{CLOUDFLARE_IPS},{GOOGLE_IPS},{OPENDNS_IPS},{ADGUARD_IPS}");
    let plaintext = remotes_except(vpn_dns);

    vec![
        dns_block_rule(
            DNS_BYPASS_SEAL_RULE_NAMES[0],
            "UDP",
            Some(plaintext.clone()),
            "53",
        ),
        dns_block_rule(
            DNS_BYPASS_SEAL_RULE_NAMES[1],
            "TCP",
            Some(plaintext),
            "53",
        ),
        dns_block_rule(
            "LibreAscent Block DoH",
            "TCP",
            Some(bypass_resolvers.clone()),
            "443",
        ),
        dns_block_rule(
            "LibreAscent Block DoT",
            "TCP",
            Some(bypass_resolvers.clone()),
            "853",
        ),
        dns_block_rule("LibreAscent Block DoQ", "UDP", Some(bypass_resolvers), "853"),
    ]
}

fn dedupe_rules(specs: Vec<FirewallRuleSpec>) -> Vec<FirewallRuleSpec> {
    let mut seen = std::collections::HashSet::new();
    specs
        .into_iter()
        .filter(|spec| seen.insert(spec.name.clone()))
        .collect()
}

fn stable_rule_key(input: &str) -> String {
    input
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use libreascent_shared::config::{default_config, BlockedAppRule};

    fn remoteip_of<'a>(rules: &'a [FirewallRuleSpec], name: &str) -> Option<&'a String> {
        rules
            .iter()
            .find(|rule| rule.name == name)
            .and_then(|rule| rule.args.iter().find(|arg| arg.starts_with("remoteip=")))
    }

    #[test]
    fn plaintext_dns_block_covers_every_remote_except_quad9() {
        let rules = dns_bypass_block_rules(&[]);

        for name in [
            "LibreAscent Block Plaintext DNS UDP",
            "LibreAscent Block Plaintext DNS TCP",
        ] {
            let rule = rules.iter().find(|r| r.name == name).expect("rule exists");
            assert!(rule.args.contains(&"remoteport=53".to_string()));
            assert!(rule.args.contains(&"action=block".to_string()));
            // The ranges must run edge to edge with only Quad9's two addresses
            // missing, or a public resolver becomes reachable in the clear.
            let remoteip = remoteip_of(&rules, name).expect("scoped to all but Quad9");
            assert_eq!(
                remoteip,
                "remoteip=0.0.0.0-9.9.9.8,9.9.9.10-149.112.112.111,149.112.112.113-255.255.255.255,::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
            );
        }
    }

    #[test]
    fn quad9_stays_reachable_on_every_proxy_upstream_port() {
        // The proxy falls back DoT -> DoH -> UDP, all to Quad9 (dns.rs); a seal
        // on any of those ports would cut the fallback it exists to provide.
        let rules = dns_bypass_block_rules(&[]);

        for name in ["LibreAscent Block DoT", "LibreAscent Block DoH", "LibreAscent Block DoQ"] {
            let scope = remoteip_of(&rules, name).expect("rule is scoped");
            assert!(!scope.contains("9.9.9.9"), "{name} must leave Quad9 reachable: {scope}");
            assert!(scope.contains("1.1.1.1"), "{name} must still seal Cloudflare: {scope}");
            assert!(scope.contains("8.8.8.8"), "{name} must still seal Google: {scope}");
        }
    }

    #[test]
    fn dns_bypass_rule_names_match_deletion_list() {
        let rules = dns_bypass_block_rules(&[]);
        let names: Vec<&str> = rules.iter().map(|rule| rule.name.as_str()).collect();
        assert_eq!(names, super::DNS_BYPASS_RULE_NAMES.to_vec());
    }

    #[test]
    fn reset_command_is_well_formed_powershell() {
        let cmd = reset_command();
        assert!(
            !cmd.contains('\\'),
            "a literal backslash breaks the PowerShell command: {cmd}"
        );
        assert!(cmd.contains("Get-NetFirewallRule -DisplayName 'LibreAscent *'"));
        assert!(cmd.contains("| "), "pipe must survive the line continuation: {cmd}");
        assert!(cmd.contains("Remove-NetFirewallRule"));
    }

    #[test]
    fn no_rule_passes_group_to_netsh() {
        // `netsh advfirewall firewall add rule` has no group= parameter. Passing
        // one makes netsh reject the whole command with exit code 1, which sets
        // firewall_enforcement_failed and disables every rule until restart. That
        // shipped, so the bypass guard read Missing on every run and no app rule
        // was ever created either.
        let mut specs = dns_bypass_block_rules(&[]);
        specs.push(app_rule_for_path(Path::new(r"C:\app.exe")));

        for spec in specs {
            assert!(
                !spec.args.iter().any(|arg| arg.starts_with("group=")),
                "rule {} passes group= to netsh, which rejects it",
                spec.name
            );
            assert!(
                spec.name.starts_with(FIREWALL_NAME_PREFIX),
                "rule {} must carry the prefix reset_firewall_protection matches on",
                spec.name
            );
        }
    }

    #[test]
    fn seal_rules_use_shared_bypass_guard_names() {
        let rules = dns_bypass_block_rules(&[]);
        let names: Vec<&str> = rules.iter().map(|r| r.name.as_str()).collect();
        for seal in DNS_BYPASS_SEAL_RULE_NAMES {
            assert!(names.contains(&seal), "missing seal rule {seal}");
        }
    }

    #[test]
    fn blocked_app_with_full_path_gets_protocol_agnostic_outbound_rule() {
        let mut config = default_config();
        config.blocked_apps = vec![BlockedAppRule {
            name: "Cloudflare WARP".to_string(),
            executable: "Cloudflare WARP.exe".to_string(),
            full_path: Some(r"C:\Program Files\Cloudflare\Cloudflare WARP\Cloudflare WARP.exe".to_string()),
        }];

        let rules = configured_app_rules(&config);

        assert_eq!(rules.len(), 1);
        assert!(rules[0].args.contains(&"protocol=any".to_string()));
        assert!(rules[0].args.contains(&"dir=out".to_string()));
        assert!(rules[0].args.iter().any(|arg| arg.starts_with("program=C:\\Program Files\\Cloudflare")));
    }

    #[test]
    fn blocked_app_without_full_path_does_not_create_invalid_program_rule() {
        let mut config = default_config();
        config.blocked_apps = vec![BlockedAppRule {
            name: "Cloudflare WARP".to_string(),
            executable: "Cloudflare WARP.exe".to_string(),
            full_path: None,
        }];

        assert!(configured_app_rules(&config).is_empty());
    }


    #[test]
    fn a_vpn_resolver_is_cut_out_of_the_plaintext_seal() {
        assert_eq!(
            remotes_except(&[]),
            "0.0.0.0-9.9.9.8,9.9.9.10-149.112.112.111,149.112.112.113-255.255.255.255,::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
        );
        assert_eq!(
            remotes_except(&[Ipv4Addr::new(10, 2, 0, 1)]),
            "0.0.0.0-9.9.9.8,9.9.9.10-10.2.0.0,10.2.0.2-149.112.112.111,149.112.112.113-255.255.255.255,::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
        );
    }
}
