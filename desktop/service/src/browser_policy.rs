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
use libreascent_shared::config::DesktopConfig;
use std::path::Path;
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

/// LibreWolf reads policies only from its own key, never from ...\Mozilla\Firefox.
/// A value here replaces LibreWolf's distribution/policies.json entry of the same
/// top-level name.
const LIBREWOLF_POLICY_KEY: &str = r"HKLM\SOFTWARE\Policies\Mozilla\LibreWolf";
const FIREFOX_FAMILY_POLICY_KEYS: [&str; 2] = [
    r"HKLM\SOFTWARE\Policies\Mozilla\Firefox",
    LIBREWOLF_POLICY_KEY,
];

const BLOCK_MESSAGE: &str = "Extensions are blocked while LibreAscent protection is on.";

/// The keyword and reels blocker from desktop/extension, packed by build.rs.
/// Unsigned, so only LibreWolf (signature check turned off by policy) loads it.
const BLOCKER_ID: &str = "blocker@libreascent.app";
const BLOCKER_XPI: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/libreascent-blocker.xpi"));
const BLOCKER_XPI_VERSION: &str = env!("BLOCKER_XPI_VERSION");
const BLOCKER_XPI_HASH: &str = env!("BLOCKER_XPI_HASH");
const BLOCKER_XPI_DIR: &str = r"C:\ProgramData\LibreAscent";
const BLOCKER_XPI_PREFIX: &str = "libreascent-blocker-";

fn blocker_xpi_name() -> String {
    format!("{BLOCKER_XPI_PREFIX}{BLOCKER_XPI_VERSION}-{BLOCKER_XPI_HASH}.xpi")
}

fn blocker_install_url() -> String {
    format!("file:///C:/ProgramData/LibreAscent/{}", blocker_xpi_name())
}

fn blocker_third_party_key() -> String {
    format!(r"{LIBREWOLF_POLICY_KEY}\3rdparty\Extensions\{BLOCKER_ID}")
}

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
    let mut values = Vec::new();
    for key in FIREFOX_FAMILY_POLICY_KEYS {
        let doh_key = format!(r"{key}\DNSOverHTTPS");
        values.push(PolicyValue::new(&doh_key, "Enabled", "REG_DWORD", "0"));
        values.push(PolicyValue::new(&doh_key, "Locked", "REG_DWORD", "1"));
    }

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

    for key in FIREFOX_FAMILY_POLICY_KEYS {
        let proxy_key = format!(r"{key}\Proxy");
        values.push(PolicyValue::new(&proxy_key, "Mode", "REG_SZ", "none"));
        values.push(PolicyValue::new(&proxy_key, "Locked", "REG_DWORD", "1"));
    }

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

/// Blocks every Firefox add-on.
///
/// Firefox is the one browser the proxy lock does not seal: an add-on's
/// proxy.onRequest takes precedence over the locked preference, so a VPN add-on
/// re-routes traffic no matter what the proxy policy says. Blocking add-ons
/// outright is the only reliable answer there, and a blocked add-on that is
/// already installed gets disabled rather than merely barred from installing.
///
/// This is deliberately a blanket block rather than a list of known VPN add-on
/// ids: an id list is a race against whatever gets published next, and Firefox
/// here exists to be locked down, not to carry an add-on set.
///
/// LibreWolf is the main browser, so it keeps an allowlist of add-ons that
/// cannot set a proxy and gets the blocker force-installed on top.
pub fn firefox_extension_lockdown_values(config: &DesktopConfig) -> Vec<PolicyValue> {
    let block_all = serde_json::json!({
        "*": { "installation_mode": "blocked", "blocked_install_message": BLOCK_MESSAGE }
    });

    let mut librewolf_settings = block_all.clone();
    for id in &config.allowed_browser_extensions {
        librewolf_settings[id.as_str()] = serde_json::json!({ "installation_mode": "allowed" });
    }
    librewolf_settings[BLOCKER_ID] = serde_json::json!({
        "installation_mode": "force_installed",
        "install_url": blocker_install_url(),
        "private_browsing": true,
    });

    let preferences = serde_json::json!({
        "xpinstall.signatures.required": { "Value": false, "Status": "locked", "Type": "boolean" }
    });

    let third_party_key = blocker_third_party_key();

    vec![
        PolicyValue::new(
            r"HKLM\SOFTWARE\Policies\Mozilla\Firefox",
            "ExtensionSettings",
            "REG_SZ",
            &block_all.to_string(),
        ),
        // about:config can set network.proxy.* and network.trr.* by hand, which
        // reaches the same place a VPN add-on does without installing anything.
        PolicyValue::new(
            r"HKLM\SOFTWARE\Policies\Mozilla\Firefox",
            "BlockAboutConfig",
            "REG_DWORD",
            "1",
        ),
        // LibreWolf only parses JSON-valued policies from REG_MULTI_SZ.
        PolicyValue::new(
            LIBREWOLF_POLICY_KEY,
            "ExtensionSettings",
            "REG_MULTI_SZ",
            &librewolf_settings.to_string(),
        ),
        PolicyValue::new(LIBREWOLF_POLICY_KEY, "BlockAboutConfig", "REG_DWORD", "1"),
        // Troubleshoot Mode starts with every add-on off, the blocker included.
        PolicyValue::new(LIBREWOLF_POLICY_KEY, "DisableSafeMode", "REG_DWORD", "1"),
        PolicyValue::new(
            LIBREWOLF_POLICY_KEY,
            "Preferences",
            "REG_MULTI_SZ",
            &preferences.to_string(),
        ),
        // The blocker reads these through storage.managed.
        PolicyValue::new(
            &third_party_key,
            "keywords",
            "REG_MULTI_SZ",
            &serde_json::json!(config.keywords).to_string(),
        ),
        PolicyValue::new(
            &third_party_key,
            "excludedDomains",
            "REG_MULTI_SZ",
            &serde_json::json!(config.excluded_domains).to_string(),
        ),
    ]
}

/// Every policy value this service enforces.
pub fn browser_policy_values(config: &DesktopConfig) -> Vec<PolicyValue> {
    let mut values = doh_policy_values();
    values.extend(proxy_lock_values());
    values.extend(vpn_extension_blocklist_values());
    values.extend(firefox_extension_lockdown_values(config));
    values
}

/// Every blocker xpi in `dir` other than the current version's.
fn stale_blocker_xpis(dir: &Path) -> Vec<std::path::PathBuf> {
    let current = blocker_xpi_name();
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                n.starts_with(BLOCKER_XPI_PREFIX) && n.ends_with(".xpi") && n != current
            })
        })
        .collect()
}

/// Puts the blocker where install_url points, before the policy that names it.
fn install_blocker_xpi() -> Result<()> {
    let dir = Path::new(BLOCKER_XPI_DIR);
    std::fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))?;
    let path = dir.join(blocker_xpi_name());
    if std::fs::read(&path).ok().as_deref() != Some(BLOCKER_XPI) {
        std::fs::write(&path, BLOCKER_XPI)
            .with_context(|| format!("failed to write {}", path.display()))?;
    }
    for stale in stale_blocker_xpis(dir) {
        let _ = std::fs::remove_file(stale);
    }
    Ok(())
}

fn reg_command(args: &[&str]) -> Command {
    let mut command = Command::new("reg");
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

/// REG_MULTI_SZ data is split on "\0" by default, which JSON can contain, so it
/// gets a separator that JSON never does.
fn reg_add_args(value: &PolicyValue) -> Vec<&str> {
    let mut args = vec!["add", &value.key, "/v", &value.name, "/t", &value.kind];
    if value.kind == "REG_MULTI_SZ" {
        args.extend(["/s", "\u{1}"]);
    }
    args.extend(["/d", &value.data, "/f"]);
    args
}

/// Write every policy value. Missing browsers are not a problem: the key is
/// created regardless and the browser reads it if it is ever installed. A
/// failed xpi write does not hold back the DoH, proxy and add-on locks.
pub fn enforce_browser_policy(config: &DesktopConfig) -> Result<()> {
    let xpi = install_blocker_xpi();
    for value in browser_policy_values(config) {
        let status = reg_command(&reg_add_args(&value))
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
    xpi
}

/// Remove the policy values so uninstalling does not leave DoH disabled, the
/// proxy pinned, or extensions blocked forever. Failures are ignored: a value
/// that is already absent is success. Value names do not depend on the config,
/// so the default one covers whatever was written.
pub fn reset_browser_policy() {
    let defaults = libreascent_shared::config::default_config();
    for value in browser_policy_values(&defaults) {
        let _ = reg_command(&["delete", &value.key, "/v", &value.name, "/f"]).status();
    }
    for sub in [r"\DNSOverHTTPS", r"\Proxy", r"\3rdparty"] {
        let _ = reg_command(&["delete", &format!("{LIBREWOLF_POLICY_KEY}{sub}"), "/f"]).status();
    }

    let dir = Path::new(BLOCKER_XPI_DIR);
    let _ = std::fs::remove_file(dir.join(blocker_xpi_name()));
    for stale in stale_blocker_xpis(dir) {
        let _ = std::fs::remove_file(stale);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use libreascent_shared::config::default_config;

    #[test]
    fn every_policy_targets_hklm() {
        let values = browser_policy_values(&default_config());
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
    fn firefox_blocks_every_addon_and_about_config() {
        // Verified against Firefox 156 on 2026-09-24: with this policy set,
        // installing Windscribe from addons.mozilla.org is refused with
        // "blocked by your organization" and the message below, while the same
        // profile without ExtensionSettings offers the install prompt, whose
        // permissions include "Control browser proxy settings". That permission
        // is the bypass, and Firefox honours proxy.onRequest over the locked
        // proxy pref, so blocking the add-on is the only seal that holds here.
        let values = firefox_extension_lockdown_values(&default_config());

        let settings = values
            .iter()
            .find(|v| v.name == "ExtensionSettings")
            .expect("ExtensionSettings must be set");
        assert_eq!(settings.key, r"HKLM\SOFTWARE\Policies\Mozilla\Firefox");
        assert_eq!(settings.kind, "REG_SZ");

        let parsed: serde_json::Value =
            serde_json::from_str(&settings.data).expect("Firefox reads this as JSON; it must parse");
        assert_eq!(parsed["*"]["installation_mode"], "blocked");
        assert!(
            parsed["*"]["blocked_install_message"]
                .as_str()
                .is_some_and(|m| !m.is_empty()),
            "the block message is what the user sees instead of the install prompt"
        );

        let about_config = values
            .iter()
            .find(|v| v.name == "BlockAboutConfig")
            .expect("about:config sets network.proxy by hand, so it must be blocked");
        assert_eq!(about_config.data, "1");
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

    fn find<'a>(values: &'a [PolicyValue], key: &str, name: &str) -> &'a PolicyValue {
        values
            .iter()
            .find(|v| v.key == key && v.name == name)
            .unwrap_or_else(|| panic!("missing {key}\\{name}"))
    }

    fn librewolf(sub: &str) -> String {
        format!(r"{LIBREWOLF_POLICY_KEY}{sub}")
    }

    #[test]
    fn librewolf_gets_doh_proxy_and_about_config_locked() {
        // LibreWolf ignores ...\Mozilla\Firefox, so the Firefox values alone
        // leave its DoH, proxy and about:config wide open.
        let values = browser_policy_values(&default_config());
        assert_eq!(find(&values, &librewolf(r"\DNSOverHTTPS"), "Enabled").data, "0");
        assert_eq!(find(&values, &librewolf(r"\DNSOverHTTPS"), "Locked").data, "1");
        assert_eq!(find(&values, &librewolf(r"\Proxy"), "Mode").data, "none");
        assert_eq!(find(&values, &librewolf(r"\Proxy"), "Locked").data, "1");
        assert_eq!(find(&values, LIBREWOLF_POLICY_KEY, "BlockAboutConfig").data, "1");
        let safe_mode = find(&values, LIBREWOLF_POLICY_KEY, "DisableSafeMode");
        assert_eq!((safe_mode.kind.as_str(), safe_mode.data.as_str()), ("REG_DWORD", "1"));
    }

    #[test]
    fn multi_sz_values_get_a_separator_json_cannot_contain() {
        for value in &browser_policy_values(&default_config()) {
            let args = reg_add_args(value);
            assert_eq!(args[..6], ["add", &value.key, "/v", &value.name, "/t", &value.kind]);
            assert_eq!(args[args.len() - 3..], ["/d", &value.data, "/f"]);
            if value.kind == "REG_MULTI_SZ" {
                assert_eq!(args[6..8], ["/s", "\u{1}"]);
                assert!(!value.data.contains('\u{1}'));
            } else {
                assert_eq!(args.len(), 9);
            }
        }
    }

    #[test]
    fn signature_pref_is_unlocked_on_librewolf_only() {
        let values = browser_policy_values(&default_config());
        let prefs: Vec<_> = values.iter().filter(|v| v.name == "Preferences").collect();
        assert_eq!(prefs.len(), 1, "Firefox must keep requiring signed add-ons");
        assert_eq!(prefs[0].key, LIBREWOLF_POLICY_KEY);
        assert_eq!(prefs[0].kind, "REG_MULTI_SZ");

        let parsed: serde_json::Value = serde_json::from_str(&prefs[0].data).unwrap();
        let pref = &parsed["xpinstall.signatures.required"];
        assert_eq!(pref["Value"], false);
        assert_eq!(pref["Status"], "locked");
        assert_eq!(pref["Type"], "boolean");
    }

    #[test]
    fn librewolf_blocks_addons_except_allowed_and_forces_the_blocker() {
        let mut config = default_config();
        config.allowed_browser_extensions = vec!["addon@darkreader.org".to_string()];
        let values = firefox_extension_lockdown_values(&config);

        let settings = find(&values, LIBREWOLF_POLICY_KEY, "ExtensionSettings");
        assert_eq!(settings.kind, "REG_MULTI_SZ");
        let parsed: serde_json::Value = serde_json::from_str(&settings.data).unwrap();

        assert_eq!(parsed["*"]["installation_mode"], "blocked");
        assert_eq!(parsed["*"]["blocked_install_message"], BLOCK_MESSAGE);
        assert_eq!(parsed["addon@darkreader.org"]["installation_mode"], "allowed");
        assert!(parsed.get("uBlock0@raymondhill.net").is_none());

        let blocker = &parsed[BLOCKER_ID];
        assert_eq!(blocker["installation_mode"], "force_installed");
        assert_eq!(blocker["private_browsing"], true);
        let url = blocker["install_url"].as_str().unwrap();
        assert!(url.starts_with("file:///C:/ProgramData/LibreAscent/libreascent-blocker-"));
        assert!(url.ends_with(&format!("{BLOCKER_XPI_VERSION}-{BLOCKER_XPI_HASH}.xpi")));
        assert_eq!(BLOCKER_XPI_HASH.len(), 8);
        assert!(BLOCKER_XPI_HASH.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn default_allowlist_reaches_librewolf() {
        let values = firefox_extension_lockdown_values(&default_config());
        let settings = find(&values, LIBREWOLF_POLICY_KEY, "ExtensionSettings");
        let parsed: serde_json::Value = serde_json::from_str(&settings.data).unwrap();
        for id in default_config().allowed_browser_extensions {
            assert_eq!(parsed[id.as_str()]["installation_mode"], "allowed", "{id}");
        }
    }

    #[test]
    fn blocker_gets_keywords_and_excluded_domains_as_json_arrays() {
        let mut config = default_config();
        config.keywords = vec!["onlyfans".to_string(), "nsfw".to_string()];
        config.excluded_domains = vec!["example.com".to_string()];
        let values = firefox_extension_lockdown_values(&config);
        let key = librewolf(r"\3rdparty\Extensions\blocker@libreascent.app");

        let keywords = find(&values, &key, "keywords");
        assert_eq!(keywords.kind, "REG_MULTI_SZ");
        let parsed: Vec<String> = serde_json::from_str(&keywords.data).unwrap();
        assert_eq!(parsed, config.keywords);

        let excluded = find(&values, &key, "excludedDomains");
        assert_eq!(excluded.kind, "REG_MULTI_SZ");
        let parsed: Vec<String> = serde_json::from_str(&excluded.data).unwrap();
        assert_eq!(parsed, config.excluded_domains);

        let empty = firefox_extension_lockdown_values(&default_config());
        assert_eq!(find(&empty, &key, "keywords").data, "[]");
    }

    #[test]
    fn packaged_xpi_is_a_zip_without_tests() {
        assert!(BLOCKER_XPI.starts_with(b"PK"));
        let text = String::from_utf8_lossy(BLOCKER_XPI);
        assert!(text.contains("manifest.json"));
        assert!(!text.contains(".test.js"));
    }
}
