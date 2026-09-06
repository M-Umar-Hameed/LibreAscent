use anyhow::{Context, Result};
use std::time::{Duration, SystemTime};
use libreascent_shared::blocklist::parse_domain_list;
use std::fs;
use std::path::Path;

/// Sources are refetched at most this often; the lists change slowly.
const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// True when the blocklist has never been fetched, or is older than MAX_AGE.
/// A missing file is the case that mattered: nothing ever called update_sources
/// except the CLI subcommand, so an install blocked only manually added domains
/// while the config reported adult blocking as on.
pub fn needs_update(blocklist_path: &Path, now: SystemTime) -> bool {
    let Ok(modified) = std::fs::metadata(blocklist_path).and_then(|m| m.modified()) else {
        return true;
    };
    now.duration_since(modified).map(|age| age > MAX_AGE).unwrap_or(false)
}

/// Fetch when stale. Never fails the caller: an install with an unreachable
/// upstream keeps whatever list it already has rather than refusing to start.
pub async fn update_if_stale(config_path: &Path) -> bool {
    let blocklist_path = config_path.parent().unwrap_or(config_path).join("blocklist.txt");
    if !needs_update(&blocklist_path, SystemTime::now()) {
        return false;
    }
    match update_sources(config_path).await {
        Ok(()) => true,
        Err(e) => {
            crate::dns_manager::log_tamper_event(&format!("Blocklist update failed: {e}"));
            false
        }
    }
}

pub async fn update_sources(config_path: &Path) -> Result<()> {
    let config = crate::config_loader::load_or_create(config_path)
        .map_err(|e| anyhow::anyhow!("failed to load config: {}", e))?;
    let mut all_domains = Vec::new();

    for source in &config.sources {
        if !source.enabled {
            continue;
        }

        println!("Fetching {}...", source.name);
        let response = reqwest::get(&source.url)
            .await
            .with_context(|| format!("failed to fetch source {}", source.name))?;
        
        if !response.status().is_success() {
            println!("Warning: Failed to fetch {}: {}", source.name, response.status());
            continue;
        }

        let content = response.text().await.context("failed to read response text")?;
        let domains = parse_domain_list(&content);
        println!("  Found {} domains", domains.len());
        all_domains.extend(domains);
    }

    // Merge with manually included domains and remove duplicates
    all_domains.extend(config.included_domains.clone());
    all_domains.sort();
    all_domains.dedup();

    println!("Total unique domains: {}", all_domains.len());

    let blocklist_path = config_path.parent().unwrap().join("blocklist.txt");
    fs::write(&blocklist_path, all_domains.join("\n"))
        .with_context(|| format!("failed to write blocklist to {}", blocklist_path.display()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn a_list_that_was_never_fetched_needs_updating() {
        // The shipped state until now: update_sources had no caller but the CLI
        // subcommand, so blocklist.txt never existed and adult blocking was on
        // in config while backed by nothing.
        let dir = std::env::temp_dir().join(format!("la-updater-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let missing = dir.join("blocklist.txt");
        let _ = std::fs::remove_file(&missing);

        assert!(needs_update(&missing, SystemTime::now()));

        std::fs::write(&missing, "example.com").unwrap();
        assert!(!needs_update(&missing, SystemTime::now()), "a fresh list is left alone");
        assert!(
            needs_update(&missing, SystemTime::now() + MAX_AGE + Duration::from_secs(60)),
            "past MAX_AGE it is refetched"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
