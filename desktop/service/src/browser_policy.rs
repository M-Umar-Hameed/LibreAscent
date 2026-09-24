//! Locks down the browser features that route around the local DNS proxy,
//! via Windows policy keys under HKLM.
//!
//! Two separate escapes are covered.
//!
//! DNS-over-HTTPS: sealing it by IP does not work, because the resolver
//! addresses in firewall_manager (1.1.1.1, 8.8.8.8, ...) are the plaintext/DoT
//! endpoints, while a browser's DoH endpoint is a separate hostname on the
//! provider's CDN. Firefox's default resolves to 172.64.41.4 and 162.159.61.4,
//! neither of which is in any seal list, so DoH sailed straight past the
//! firewall and the local proxy never saw the query. CDN ranges also rotate, so
//! chasing them is unwinnable.
//!
//! Browser VPN extensions: these tunnel the whole request inside their own
//! connection through the chrome.proxy API, so the blocked hostname is resolved
//! at the far end and no query reaches this machine's resolver at all. Neither
//! the DNS proxy nor the firewall's port seals can see it. A proxy set by policy
//! is the answer: Chromium refuses an extension's proxy override while one is in
//! force, which covers VPN extensions that are not yet installed as well as the
//! ones that are.
//!
//! Policy keys are the enforceable answer for both: the browser disables the
//! feature itself, the setting greys out, and it survives restarts.

use anyhow::{Context, Result};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A single registry value to write under HKLM.
pub struct PolicyValue {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub data: String,
}

impl PolicyValue {
    fn new(key: &str, name: &str, kind: &str, data: &str) -> Self {
        Self {
            key: key.to_string(),
            name: name.to_string(),
            kind: kind.to_string(),
            data: data.to_string(),
        }
    }
}

/// Chromium-family browsers, which share policy names under their own vendor key.
const CHROMIUM_POLICY_KEYS: [&str; 3] = [
    r"HKLM\SOFTWARE\Policies\Google\Chrome",
    r"HKLM\SOFTWARE\Policies\Microsoft\Edge",
    r"HKLM\SOFTWARE\Policies\BraveSoftware\Brave",
];

/// Chrome Web Store ids of VPN/proxy extensions found tunnelling past the DNS
/// proxy on a real install. Blocklisting disables one that is already there, not
/// just the next install. The proxy lock below is what covers the ones nobody
/// has listed here yet, so this is defence in depth and not the main seal.
const VPN_EXTENSION_IDS: [&str; 4] = [
    "bihmplhobchoageeokmgbdihknkjbknd", // Touch VPN
    "hnmpcagpplmpfojmgmnngilcnanddlhb", // Windscribe
    "omghfjlpggmjjaagoclmmobgdodcjboh", // Browsec VPN
    "eppiocemhmnlbhjplcgkofciiegomcon", // Urban VPN Proxy
];

/// Policy values that turn DoH off. Chromium-family browsers share the
/// DnsOverHttpsMode string; Firefox uses a dedicated key, where Locked also
/// removes the control from the UI so it cannot be switched back on.
pub fn doh_policy_values() -> Vec<PolicyValue> {
    let mut values = vec![
        PolicyValue::new(
            r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS",
            "Enabled",
            "REG_DWORD",
            "0",
        ),
        PolicyValue::new(
            r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS",
            "Locked",
            "REG_DWORD",
            "1",
        ),
    ];

    for key in CHROMIUM_POLICY_KEYS {
        values.push(PolicyValue::new(key, "DnsOverHttpsMode", "REG_SZ", "off"));
    }

    values
}

/// Pins the proxy to direct. Chromium rejects a chrome.proxy override from an
/// extension while a proxy policy is in force, which is what stops a VPN
/// extension re-routing traffic around the local resolver.
///
/// Firefox gets the same lock, but it is not the seal there: a Firefox
/// extension's proxy.onRequest still takes precedence over the locked
/// preference, so Firefox needs the extension blocked rather than the proxy
/// pinned. Written anyway because it costs nothing and closes the manual
/// about:preferences route.
pub fn proxy_lock_values() -> Vec<PolicyValue> {
    let mut values = Vec::new();

    for key in CHROMIUM_POLICY_KEYS {
        values.push(PolicyValue::new(
            key,
            "ProxySettings",
            "REG_SZ",
            r#"{"ProxyMode":"direct"}"#,
        ));
    }

    values.push(PolicyValue::new(
        r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\Proxy",
        "Mode",
        "REG_SZ",
        "none",
    ));
    values.push(PolicyValue::new(
        r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\Proxy",
        "Locked",
        "REG_DWORD",
        "1",
    ));

    values
}

/// ExtensionInstallBlocklist is a numbered list: value "1", "2", ... each one an
/// extension id. A blocklisted extension is disabled, so this also turns off the
/// ones already installed.
pub fn vpn_extension_blocklist_values() -> Vec<PolicyValue> {
    let mut values = Vec::new();

    for key in CHROMIUM_POLICY_KEYS {
        let list_key = format!(r"{key}\ExtensionInstallBlocklist");
        for (index, id) in VPN_EXTENSION_IDS.iter().enumerate() {
            values.push(PolicyValue::new(
                &list_key,
                &(index + 1).to_string(),
                "REG_SZ",
                id,
            ));
        }
    }

    values
}

/// Every policy value this service enforces.
pub fn browser_policy_values() -> Vec<PolicyValue> {
    let mut values = doh_policy_values();
    values.extend(proxy_lock_values());
    values.extend(vpn_extension_blocklist_values());
    values
}

fn reg_command(args: &[&str]) -> Command {
    let mut command = Command::new("reg");
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

/// Write every policy value. Missing browsers are not a problem: the key is
/// created regardless and the browser reads it if it is ever installed.
pub fn enforce_browser_policy() -> Result<()> {
    for value in browser_policy_values() {
        let status = reg_command(&[
            "add",
            &value.key,
            "/v",
            &value.name,
            "/t",
            &value.kind,
            "/d",
            &value.data,
            "/f",
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

/// Remove the policy values so uninstalling does not leave DoH disabled, the
/// proxy pinned, or extensions blocked forever. Failures are ignored: a value
/// that is already absent is success.
pub fn reset_browser_policy() {
    for value in browser_policy_values() {
        let _ = reg_command(&["delete", &value.key, "/v", &value.name, "/f"]).status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_policy_targets_hklm() {
        let values = browser_policy_values();
        assert!(!values.is_empty());
        for value in &values {
            assert!(
                value.key.starts_with(r"HKLM\SOFTWARE\Policies\"),
                "policy must live under the machine policy hive: {}",
                value.key
            );
        }
    }

    #[test]
    fn doh_is_disabled_everywhere() {
        let values = doh_policy_values();
        for value in &values {
            match value.kind.as_str() {
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

    #[test]
    fn every_chromium_browser_gets_the_proxy_pinned_to_direct() {
        // A browser VPN extension tunnels the request through chrome.proxy, so
        // the hostname resolves at the far end and neither the DNS proxy nor the
        // firewall ever sees it. Chromium refuses an extension's override while
        // a proxy policy is in force, which is what closes that route.
        let values = proxy_lock_values();
        for vendor in ["Google\\Chrome", "Microsoft\\Edge", "BraveSoftware\\Brave"] {
            let proxy = values
                .iter()
                .find(|v| v.key.contains(vendor) && v.name == "ProxySettings")
                .unwrap_or_else(|| panic!("missing proxy lock for {vendor}"));
            assert_eq!(proxy.data, r#"{"ProxyMode":"direct"}"#);
        }
    }

    #[test]
    fn firefox_proxy_is_locked_as_well_as_set() {
        // Mode alone leaves the box editable in about:preferences.
        let values = proxy_lock_values();
        let firefox: Vec<_> = values
            .iter()
            .filter(|v| v.key.ends_with(r"Mozilla\Firefox\Proxy"))
            .collect();
        assert!(firefox.iter().any(|v| v.name == "Mode" && v.data == "none"));
        assert!(firefox.iter().any(|v| v.name == "Locked" && v.data == "1"));
    }

    #[test]
    fn vpn_extensions_are_blocklisted_under_numbered_values() {
        // ExtensionInstallBlocklist is a numbered list; a name that is not
        // "1", "2", ... is ignored by Chromium and the extension stays enabled.
        let values = vpn_extension_blocklist_values();
        assert_eq!(values.len(), VPN_EXTENSION_IDS.len() * CHROMIUM_POLICY_KEYS.len());

        for value in &values {
            assert!(value.key.ends_with("ExtensionInstallBlocklist"));
            assert!(
                value.name.parse::<u32>().map(|n| n >= 1).unwrap_or(false),
                "blocklist entries are numbered from 1, got {}",
                value.name
            );
            assert_eq!(value.data.len(), 32, "extension ids are 32 chars");
        }

        for id in VPN_EXTENSION_IDS {
            assert!(
                values.iter().any(|v| v.data == id),
                "missing blocklist entry for {id}"
            );
        }
    }

    #[test]
    fn numbering_restarts_per_browser() {
        // One shared counter across browsers would write "4", "5", "6" under
        // Edge, and Chromium stops reading the list at the first gap.
        let values = vpn_extension_blocklist_values();
        let chrome: Vec<_> = values
            .iter()
            .filter(|v| v.key.contains("Google\\Chrome"))
            .map(|v| v.name.clone())
            .collect();

        let expected: Vec<String> = (1..=VPN_EXTENSION_IDS.len()).map(|n| n.to_string()).collect();
        assert_eq!(chrome, expected);
    }
}
