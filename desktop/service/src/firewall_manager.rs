use anyhow::{Context, Result};
use libreascent_shared::config::{BlockedAppRule, DesktopConfig};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const FIREWALL_GROUP: &str = "LibreAscent";
const CLOUDFLARE_DNS_IPS: &str = "1.1.1.1,1.0.0.1,2606:4700:4700::1111,2606:4700:4700::1001";

#[derive(Debug, Clone, PartialEq, Eq)]
struct FirewallRuleSpec {
    name: String,
    args: Vec<String>,
}

pub fn ensure_firewall_protection(config: &DesktopConfig, runtime_app_paths: &[PathBuf]) -> Result<()> {
    let mut specs = cloudflare_dns_block_rules();
    specs.extend(configured_app_rules(config));
    specs.extend(runtime_app_paths.iter().map(|path| app_rule_for_path(path)));

    for spec in dedupe_rules(specs) {
        replace_firewall_rule(&spec)?;
    }

    Ok(())
}

pub fn reset_firewall_protection() -> Result<()> {
    let mut command = Command::new("netsh");
    command.args([
        "advfirewall",
        "firewall",
        "delete",
        "rule",
        &format!("group={FIREWALL_GROUP}"),
    ]);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let _ = command.status().context("failed to reset LibreAscent firewall rules")?;
    Ok(())
}

fn replace_firewall_rule(spec: &FirewallRuleSpec) -> Result<()> {
    let mut delete = Command::new("netsh");
    delete.args([
        "advfirewall",
        "firewall",
        "delete",
        "rule",
        &format!("name={}", spec.name),
    ]);

    #[cfg(windows)]
    delete.creation_flags(CREATE_NO_WINDOW);

    let _ = delete.status();

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

fn cloudflare_dns_block_rules() -> Vec<FirewallRuleSpec> {
    [
        ("UDP", "53,853,443"),
        ("TCP", "53,853,443"),
    ]
    .into_iter()
    .map(|(protocol, ports)| {
        let name = format!("LibreAscent Block Cloudflare DNS {protocol}");
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
                format!("protocol={protocol}"),
                format!("remoteip={CLOUDFLARE_DNS_IPS}"),
                format!("remoteport={ports}"),
            ],
        }
    })
    .collect()
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

    #[test]
    fn cloudflare_dns_rules_block_udp_and_tcp_escape_paths() {
        let rules = cloudflare_dns_block_rules();

        assert!(rules.iter().any(|rule| {
            rule.name == "LibreAscent Block Cloudflare DNS UDP"
                && rule.args.contains(&"protocol=UDP".to_string())
                && rule.args.contains(&"remoteport=53,853,443".to_string())
                && rule.args.contains(&format!("remoteip={CLOUDFLARE_DNS_IPS}"))
        }));
        assert!(rules.iter().any(|rule| {
            rule.name == "LibreAscent Block Cloudflare DNS TCP"
                && rule.args.contains(&"protocol=TCP".to_string())
        }));
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
    fn cloudflare_dns_rule_names_are_stable_for_status_checks() {
        let rules = cloudflare_dns_block_rules();
        let names = rules
            .iter()
            .map(|rule| rule.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "LibreAscent Block Cloudflare DNS UDP",
                "LibreAscent Block Cloudflare DNS TCP"
            ]
        );
    }
}
