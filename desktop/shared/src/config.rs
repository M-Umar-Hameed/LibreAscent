use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlMode {
    Flexible,
    Locked,
    Hardcore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FrictionMode {
    Timer,
    Clicks,
    TimeBased,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrictionConfig {
    pub countdown_seconds: u32,
    pub click_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrictionWindow {
    pub enabled: bool,
    pub start_hour: u32,
    pub end_hour: u32,
    pub countdown_seconds: u32,
    pub click_count: u32,
}

impl FrictionWindow {
    // Wrap-around aware: start<end is same-day; start>end spans midnight.
    // Zero-length (start==end) never matches.
    pub fn contains(&self, hour: u32) -> bool {
        if !self.enabled || self.start_hour == self.end_hour {
            return false;
        }
        if self.start_hour < self.end_hour {
            hour >= self.start_hour && hour < self.end_hour
        } else {
            hour >= self.start_hour || hour < self.end_hour
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlocklistSource {
    pub id: String,
    pub name: String,
    pub url: String,
    pub format: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    pub schema_version: u32,
    pub adult_blocking_enabled: bool,
    pub sources: Vec<BlocklistSource>,
    pub included_domains: Vec<String>,
    pub excluded_domains: Vec<String>,
    pub keywords: Vec<String>,
    pub blocked_apps: Vec<BlockedAppRule>,
    pub control_mode: ControlMode,
    pub friction: FrictionConfig,
    #[serde(default = "default_friction_window")]
    pub friction_window: FrictionWindow,
    #[serde(default = "default_friction_mode")]
    pub friction_mode: FrictionMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedAppRule {
    pub name: String,
    pub executable: String,
    pub full_path: Option<String>,
}

pub fn default_friction_window() -> FrictionWindow {
    FrictionWindow {
        enabled: false,
        start_hour: 20,
        end_hour: 6,
        countdown_seconds: 120,
        click_count: 100,
    }
}

pub fn default_friction_mode() -> FrictionMode {
    FrictionMode::Timer
}

pub fn default_config() -> DesktopConfig {
    DesktopConfig {
        schema_version: 1,
        adult_blocking_enabled: true,
        sources: vec![
            BlocklistSource {
                id: "steven-black-porn".to_string(),
                name: "StevenBlack (Porn)".to_string(),
                url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn-only/hosts".to_string(),
                format: "hosts".to_string(),
                enabled: true,
            },
            BlocklistSource {
                id: "oisd-nsfw".to_string(),
                name: "oisd nsfw (Porn)".to_string(),
                url: "https://nsfw.oisd.nl/domainswild2".to_string(),
                format: "domains".to_string(),
                enabled: true,
            },
        ],
        included_domains: Vec::new(),
        excluded_domains: Vec::new(),
        keywords: Vec::new(),
        blocked_apps: Vec::new(),
        control_mode: ControlMode::Flexible,
        friction: FrictionConfig {
            countdown_seconds: 60,
            click_count: 50,
        },
        friction_window: default_friction_window(),
        friction_mode: default_friction_mode(),
    }
}

pub fn default_config_path() -> PathBuf {
    if let Ok(program_data) = std::env::var("PROGRAMDATA") {
        return PathBuf::from(program_data).join("LibreAscent").join("config.json");
    }

    PathBuf::from("LibreAscent").join("config.json")
}

pub fn load_or_create(path: &std::path::Path) -> serde_json::Result<DesktopConfig> {
    if path.exists() {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(config) = serde_json::from_str(&text) {
                return Ok(config);
            }
        }
    }

    let config = default_config();
    let _ = save(path, &config);
    Ok(config)
}

pub fn save(path: &std::path::Path, config: &DesktopConfig) -> serde_json::Result<()> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let text = serde_json::to_string_pretty(config)?;
    let _ = std::fs::write(path, text);
    Ok(())
}

pub fn load_blocklist(config_path: &std::path::Path) -> crate::blocklist::DomainBlocklist {
    let config = load_or_create(config_path).unwrap_or_else(|_| default_config());
    let mut blocklist = crate::blocklist::DomainBlocklist::new(config.included_domains, config.excluded_domains);
    blocklist.extend_keywords(config.keywords);

    let cached_path = config_path.parent().unwrap().join("blocklist.txt");
    if cached_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&cached_path) {
            blocklist.extend_blocked(content.lines().map(|s| s.to_string()));
        }
    }

    blocklist
}

impl DesktopConfig {
    pub fn requires_friction(&self) -> bool {
        self.control_mode != ControlMode::Flexible
    }

    pub fn can_modify_rules(&self) -> bool {
        self.control_mode == ControlMode::Flexible
    }

    // ponytail: config.json is hand-editable; clamp so UI steppers and manual
    // edits can't set friction weaker than the floor. Bounds mirror Settings.tsx.
    pub fn clamp_friction(&mut self) {
        self.friction.countdown_seconds = self.friction.countdown_seconds.clamp(5, 3600);
        self.friction.click_count = self.friction.click_count.clamp(1, 999);
        self.friction_window.countdown_seconds =
            self.friction_window.countdown_seconds.clamp(5, 3600);
        self.friction_window.click_count = self.friction_window.click_count.clamp(1, 999);
        self.friction_window.start_hour = self.friction_window.start_hour.min(23);
        self.friction_window.end_hour = self.friction_window.end_hour.min(23);
    }

    // Which friction is live for a given local hour (0..=23), per the selected
    // mode. Timer = countdown only; Clicks = clicks only; TimeBased = the window
    // challenge during its hours, none outside. Window `enabled` is ignored: the
    // mode itself is the switch.
    pub fn active_friction(&self, hour: u32) -> FrictionConfig {
        match self.friction_mode {
            FrictionMode::Timer => FrictionConfig {
                countdown_seconds: self.friction.countdown_seconds,
                click_count: 0,
            },
            FrictionMode::Clicks => FrictionConfig {
                countdown_seconds: 0,
                click_count: self.friction.click_count,
            },
            FrictionMode::TimeBased => {
                let w = &self.friction_window;
                let in_window = w.start_hour != w.end_hour
                    && if w.start_hour < w.end_hour {
                        hour >= w.start_hour && hour < w.end_hour
                    } else {
                        hour >= w.start_hour || hour < w.end_hour
                    };
                if in_window {
                    FrictionConfig {
                        countdown_seconds: w.countdown_seconds,
                        click_count: w.click_count,
                    }
                } else {
                    FrictionConfig {
                        countdown_seconds: 0,
                        click_count: 0,
                    }
                }
            }
        }
    }

    pub fn tamper_log_path(&self) -> PathBuf {
        default_config_path().parent().unwrap().join("tamper.log")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_uses_schema_version_one() {
        let config = default_config();

        assert_eq!(config.schema_version, 1);
        assert!(config.adult_blocking_enabled);
        assert_eq!(config.control_mode, ControlMode::Flexible);
        assert_eq!(config.friction.countdown_seconds, 60);
        assert_eq!(config.friction.click_count, 50);
    }

    #[test]
    fn default_config_path_ends_with_libreascent_config_json() {
        let path = default_config_path();
        let text = path.to_string_lossy();

        assert!(text.ends_with("LibreAscent\\config.json") || text.ends_with("LibreAscent/config.json"));
    }

    #[test]
    fn creates_default_config_when_missing() {
        let path = temp_path("missing-config.json");
        let _ = std::fs::remove_file(&path);

        let config = load_or_create(&path).expect("config should be created");

        assert_eq!(config.schema_version, 1);
        assert!(path.exists());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn loads_existing_config() {
        let path = temp_path("existing-config.json");
        let mut config = default_config();
        config.included_domains = vec!["example.com".to_string()];
        save(&path, &config).expect("config should save");

        let loaded = load_or_create(&path).expect("config should load");

        assert_eq!(loaded.included_domains, vec!["example.com"]);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn clamp_friction_enforces_bounds() {
        let mut config = default_config();

        config.friction = FrictionConfig {
            countdown_seconds: 0,
            click_count: 0,
        };
        config.clamp_friction();
        assert_eq!(config.friction.countdown_seconds, 5);
        assert_eq!(config.friction.click_count, 1);

        config.friction = FrictionConfig {
            countdown_seconds: 99999,
            click_count: 99999,
        };
        config.clamp_friction();
        assert_eq!(config.friction.countdown_seconds, 3600);
        assert_eq!(config.friction.click_count, 999);
    }

    #[test]
    fn window_contains_same_day_range() {
        let mut w = default_friction_window();
        w.enabled = true;
        w.start_hour = 9;
        w.end_hour = 17;
        assert!(!w.contains(8));
        assert!(w.contains(9));
        assert!(w.contains(16));
        assert!(!w.contains(17));
    }

    #[test]
    fn window_contains_wraps_midnight() {
        let mut w = default_friction_window();
        w.enabled = true;
        w.start_hour = 20;
        w.end_hour = 6;
        assert!(w.contains(20));
        assert!(w.contains(23));
        assert!(w.contains(0));
        assert!(w.contains(5));
        assert!(!w.contains(6));
        assert!(!w.contains(12));
    }

    #[test]
    fn window_disabled_or_zero_length_never_matches() {
        let mut w = default_friction_window();
        w.start_hour = 20;
        w.end_hour = 6;
        assert!(!w.contains(23)); // disabled
        w.enabled = true;
        w.start_hour = 8;
        w.end_hour = 8;
        assert!(!w.contains(8)); // zero-length
    }

    #[test]
    fn active_friction_prefers_enabled_window() {
        let mut config = default_config();
        config.friction = FrictionConfig { countdown_seconds: 60, click_count: 50 };
        config.friction_window = FrictionWindow {
            enabled: true,
            start_hour: 20,
            end_hour: 6,
            countdown_seconds: 300,
            click_count: 200,
        };
        config.friction_mode = FrictionMode::TimeBased;
        assert_eq!(config.active_friction(22).countdown_seconds, 300);
        assert_eq!(config.active_friction(22).click_count, 200);
        assert_eq!(config.active_friction(12).countdown_seconds, 0);
        assert_eq!(config.active_friction(12).click_count, 0);
    }

    #[test]
    fn timer_mode_uses_countdown_only() {
        let mut config = default_config();
        config.friction_mode = FrictionMode::Timer;
        config.friction = FrictionConfig { countdown_seconds: 60, click_count: 50 };
        let f = config.active_friction(12);
        assert_eq!(f.countdown_seconds, 60);
        assert_eq!(f.click_count, 0);
    }

    #[test]
    fn clicks_mode_uses_clicks_only() {
        let mut config = default_config();
        config.friction_mode = FrictionMode::Clicks;
        config.friction = FrictionConfig { countdown_seconds: 60, click_count: 50 };
        let f = config.active_friction(12);
        assert_eq!(f.countdown_seconds, 0);
        assert_eq!(f.click_count, 50);
    }

    #[test]
    fn timebased_mode_ignores_enabled_flag() {
        let mut config = default_config();
        config.friction_mode = FrictionMode::TimeBased;
        config.friction_window = FrictionWindow {
            enabled: false,
            start_hour: 20,
            end_hour: 6,
            countdown_seconds: 300,
            click_count: 200,
        };
        assert_eq!(config.active_friction(22).countdown_seconds, 300);
        assert_eq!(config.active_friction(22).click_count, 200);
        assert_eq!(config.active_friction(12).countdown_seconds, 0);
        assert_eq!(config.active_friction(12).click_count, 0);
    }

    #[test]
    fn legacy_config_defaults_to_timer_mode() {
        let path = temp_path("legacy-mode-config.json");
        let json = r#"{
            "schemaVersion": 1,
            "adultBlockingEnabled": true,
            "sources": [],
            "includedDomains": [],
            "excludedDomains": [],
            "keywords": [],
            "blockedApps": [],
            "controlMode": "locked",
            "friction": { "countdownSeconds": 60, "clickCount": 50 }
        }"#;
        std::fs::write(&path, json).expect("write legacy config");
        let loaded = load_or_create(&path).expect("legacy config should load");
        assert_eq!(loaded.friction_mode, FrictionMode::Timer);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn config_without_window_field_loads_with_default() {
        // Old schema-v1 config.json predates friction_window; must still parse.
        let path = temp_path("legacy-config.json");
        let json = r#"{
            "schemaVersion": 1,
            "adultBlockingEnabled": true,
            "sources": [],
            "includedDomains": [],
            "excludedDomains": [],
            "keywords": [],
            "blockedApps": [],
            "controlMode": "locked",
            "friction": { "countdownSeconds": 60, "clickCount": 50 }
        }"#;
        std::fs::write(&path, json).expect("write legacy config");
        let loaded = load_or_create(&path).expect("legacy config should load");
        assert_eq!(loaded.control_mode, ControlMode::Locked);
        assert!(!loaded.friction_window.enabled);
        assert_eq!(loaded.friction_window.start_hour, 20);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn clamp_bounds_window_fields() {
        let mut config = default_config();
        config.friction_window = FrictionWindow {
            enabled: true,
            start_hour: 99,
            end_hour: 40,
            countdown_seconds: 0,
            click_count: 0,
        };
        config.clamp_friction();
        assert_eq!(config.friction_window.start_hour, 23);
        assert_eq!(config.friction_window.end_hour, 23);
        assert_eq!(config.friction_window.countdown_seconds, 5);
        assert_eq!(config.friction_window.click_count, 1);
    }

    fn temp_path(name: &str) -> std::path::PathBuf {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should work")
            .as_nanos();
        std::env::temp_dir().join(format!("libreascent-{suffix}-{name}"))
    }
}
