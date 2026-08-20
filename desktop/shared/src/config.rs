use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlMode {
    Flexible,
    Locked,
    Hardcore,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrictionConfig {
    pub countdown_seconds: u32,
    pub click_count: u32,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedAppRule {
    pub name: String,
    pub executable: String,
    pub full_path: Option<String>,
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

    fn temp_path(name: &str) -> std::path::PathBuf {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should work")
            .as_nanos();
        std::env::temp_dir().join(format!("libreascent-{suffix}-{name}"))
    }
}
