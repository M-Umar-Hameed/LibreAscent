use anyhow::{Context, Result};
use libreascent_shared::config::{BlockedAppRule, DesktopConfig};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const FIREWALL_GROUP: &str = "LibreAscent";

// Public resolver IPs users commonly point apps/browsers at to bypass the local
// proxy. Quad9 is our own DoT upstream (see dns.rs), so it is kept reachable on
// :853 but still sealed on plaintext :53 and DoH :443.
const CLOUDFLARE_IPS: &str = "1.1.1.1,1.0.0.1,2606:4700:4700::1111,2606:4700:4700::1001";
const GOOGLE_IPS: &str = "8.8.8.8,8.8.4.4,2001:4860:4860::8888,2001:4860:4860::8844";
const QUAD9_IPS: &str = "9.9.9.9,149.112.112.112,2620:fe::fe,2620:fe::9";
const OPENDNS_IPS: &str = "208.67.222.222,208.67.220.220,2620:119:35::35,2620:119:53::53";
const ADGUARD_IPS: &str = "94.140.14.14,94.140.15.15,2a10:50c0::ad1:ff,2a10:50c0::ad2:ff";

const DNS_BYPASS_RULE_NAMES: [&str; 5] = [
    "LibreAscent Block Plaintext DNS UDP",
    "LibreAscent Block Plaintext DNS TCP",
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
/// machine's real resolver.
pub fn ensure_firewall_protection(
    config: &DesktopConfig,
    runtime_app_paths: &[PathBuf],
    dns_enforced: bool,
) -> Result<()> {
    let mut specs = configured_app_rules(config);
    specs.extend(runtime_app_paths.iter().map(|path| app_rule_for_path(path)));

    if dns_enforced {
        specs.extend(dns_bypass_block_rules());
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

pub fn reset_firewall_protection() -> Result<()> {
    // netsh `delete rule` has no group= filter, and netsh's group= does not
    // populate the RuleGroup that `Remove-NetFirewallRule -Group` matches. The
    // reliable key is the DisplayName (netsh name=), which every rule prefixes
    // with "LibreAscent ", so match that and remove the whole set at once.
    let mut command = Command::new("powershell");
    command.args([
        "-NoProfile",
        "-Command",
        "Get-NetFirewallRule -DisplayName 'LibreAscent*' -ErrorAction SilentlyContinue | \
         Remove-NetFirewallRule -ErrorAction SilentlyContinue",
    ]);

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
    let name = format!("LibreAscent Block App {}", stable_rule_key(&program));

    FirewallRuleSpec {
        name: name.clone(),
        args: vec![
            "advfirewall".to_string(),
            "firewall".to_string(),
            "add".to_string(),
            "rule".to_string(),
            format!("name={name}"),
            format!("group={FIREWALL_GROUP}"),
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
        format!("group={FIREWALL_GROUP}"),
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
// upstream leg is Quad9 DoT (:853), which is deliberately left reachable.
fn dns_bypass_block_rules() -> Vec<FirewallRuleSpec> {
    let all_resolvers =
        format!("{CLOUDFLARE_IPS},{GOOGLE_IPS},{QUAD9_IPS},{OPENDNS_IPS},{ADGUARD_IPS}");
    // Quad9 excluded: our proxy forwards to it over DoT/:853.
    let bypass_resolvers = format!("{CLOUDFLARE_IPS},{GOOGLE_IPS},{OPENDNS_IPS},{ADGUARD_IPS}");

    vec![
        dns_block_rule("LibreAscent Block Plaintext DNS UDP", "UDP", None, "53"),
        dns_block_rule("LibreAscent Block Plaintext DNS TCP", "TCP", None, "53"),
        dns_block_rule(
            "LibreAscent Block DoH",
            "TCP",
            Some(all_resolvers),
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
    fn plaintext_dns_block_applies_to_all_remotes() {
        let rules = dns_bypass_block_rules();

        for name in [
            "LibreAscent Block Plaintext DNS UDP",
            "LibreAscent Block Plaintext DNS TCP",
        ] {
            let rule = rules.iter().find(|r| r.name == name).expect("rule exists");
            // No remoteip scope: a blanket :53 seal so no resolver is reachable in the clear.
            assert!(remoteip_of(&rules, name).is_none());
            assert!(rule.args.contains(&"remoteport=53".to_string()));
            assert!(rule.args.contains(&"action=block".to_string()));
        }
    }

    #[test]
    fn dot_block_leaves_quad9_reachable_but_doh_block_seals_it() {
        let rules = dns_bypass_block_rules();

        // Proxy upstream is Quad9 DoT; it must survive the :853 seal.
        let dot = remoteip_of(&rules, "LibreAscent Block DoT").expect("DoT rule exists");
        assert!(!dot.contains("9.9.9.9"), "Quad9 DoT must stay reachable: {dot}");
        assert!(dot.contains("1.1.1.1"), "Cloudflare DoT must be blocked: {dot}");

        // But Quad9 DoH (:443) is a bypass path and must be blocked.
        let doh = remoteip_of(&rules, "LibreAscent Block DoH").expect("DoH rule exists");
        assert!(doh.contains("9.9.9.9"), "Quad9 DoH must be blocked: {doh}");
    }

    #[test]
    fn dns_bypass_rule_names_match_deletion_list() {
        let rules = dns_bypass_block_rules();
        let names: Vec<&str> = rules.iter().map(|rule| rule.name.as_str()).collect();
        assert_eq!(names, super::DNS_BYPASS_RULE_NAMES.to_vec());
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

}
