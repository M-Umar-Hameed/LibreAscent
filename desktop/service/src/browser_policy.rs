//! Disables DNS-over-HTTPS in the major browsers via Windows policy.
//!
//! Sealing DoH by IP does not work: the resolver addresses in firewall_manager
//! (1.1.1.1, 8.8.8.8, ...) are the plaintext/DoT endpoints, while a browser's
//! DoH endpoint is a separate hostname on the provider's CDN. Firefox's default
//! resolves to 172.64.41.4 and 162.159.61.4, neither of which is in any seal
//! list, so DoH sailed straight past the firewall and the local proxy never saw
//! the query. CDN ranges also rotate, so chasing them is unwinnable.
//!
//! Policy keys are the enforceable answer: the browser disables the feature
//! itself, the setting greys out, and it survives restarts.

use anyhow::{Context, Result};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A single registry value to write under HKLM.
pub struct PolicyValue {
    pub key: &'static str,
    pub name: &'static str,
    pub kind: &'static str,
    pub data: &'static str,
}

/// Policy values that turn DoH off. Chromium-family browsers share the
/// DnsOverHttpsMode string; Firefox uses a dedicated key, where Locked also
/// removes the control from the UI so it cannot be switched back on.
pub fn doh_policy_values() -> Vec<PolicyValue> {
    vec![
        PolicyValue {
            key: r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS",
            name: "Enabled",
            kind: "REG_DWORD",
            data: "0",
        },
        PolicyValue {
            key: r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS",
            name: "Locked",
            kind: "REG_DWORD",
            data: "1",
        },
        PolicyValue {
            key: r"HKLM\SOFTWARE\Policies\Google\Chrome",
            name: "DnsOverHttpsMode",
            kind: "REG_SZ",
            data: "off",
        },
        PolicyValue {
            key: r"HKLM\SOFTWARE\Policies\Microsoft\Edge",
            name: "DnsOverHttpsMode",
            kind: "REG_SZ",
            data: "off",
        },
        PolicyValue {
            key: r"HKLM\SOFTWARE\Policies\BraveSoftware\Brave",
            name: "DnsOverHttpsMode",
            kind: "REG_SZ",
            data: "off",
        },
    ]
}

fn reg_command(args: &[&str]) -> Command {
    let mut command = Command::new("reg");
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

/// Write every DoH-disabling policy value. Missing browsers are not a problem:
/// the key is created regardless and the browser reads it if it is ever
/// installed.
pub fn enforce_doh_disabled() -> Result<()> {
    for value in doh_policy_values() {
        let status = reg_command(&[
            "add", value.key, "/v", value.name, "/t", value.kind, "/d", value.data, "/f",
        ])
        .status()
        .with_context(|| format!("failed to run reg add for {}\\{}", value.key, value.name))?;

        if !status.success() {
            anyhow::bail!(
                "reg add failed with exit code {:?} for {}\\{}",
                status.code(),
                value.key,
                value.name
            );
        }
    }
    Ok(())
}

/// Remove the policy values so uninstalling does not leave DoH permanently
/// disabled. Failures are ignored: a key that is already absent is success.
pub fn reset_doh_policy() {
    for value in doh_policy_values() {
        let _ = reg_command(&["delete", value.key, "/v", value.name, "/f"]).status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_policy_targets_hklm_and_disables_doh() {
        let values = doh_policy_values();
        assert!(!values.is_empty());
        for value in &values {
            assert!(
                value.key.starts_with(r"HKLM\SOFTWARE\Policies\"),
                "policy must live under the machine policy hive: {}",
                value.key
            );
            match value.kind {
                "REG_DWORD" => assert!(
                    value.data.parse::<u32>().is_ok(),
                    "DWORD data must be numeric: {}",
                    value.data
                ),
                "REG_SZ" => assert_eq!(
                    value.data, "off",
                    "the Chromium DnsOverHttpsMode value that disables DoH is \"off\""
                ),
                other => panic!("unexpected registry type {other}"),
            }
        }
    }

    #[test]
    fn firefox_doh_is_disabled_and_locked() {
        let values = doh_policy_values();
        let firefox: Vec<_> = values
            .iter()
            .filter(|v| v.key.contains("Mozilla"))
            .collect();
        // Enabled=0 alone leaves the toggle switchable in the UI; Locked=1 is
        // what makes it stick.
        assert!(firefox.iter().any(|v| v.name == "Enabled" && v.data == "0"));
        assert!(firefox.iter().any(|v| v.name == "Locked" && v.data == "1"));
    }

    #[test]
    fn covers_the_chromium_browsers_that_default_to_doh() {
        let values = doh_policy_values();
        for vendor in ["Google\\Chrome", "Microsoft\\Edge", "BraveSoftware\\Brave"] {
            assert!(
                values.iter().any(|v| v.key.contains(vendor)),
                "missing DoH policy for {vendor}"
            );
        }
    }
}
