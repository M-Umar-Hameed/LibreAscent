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
    let blocklist_path = config_path.parent().unwrap().join("blocklist.txt");
    let mut all_domains = Vec::new();
    let mut failed = Vec::new();

    for source in &config.sources {
        if !source.enabled {
            continue;
        }

        println!("Fetching {}...", source.name);
        match fetch_source(&source.url).await {
            Ok(content) => {
                let domains = parse_domain_list(&content);
                println!("  Found {} domains", domains.len());
                all_domains.extend(domains);
            }
            Err(e) => {
                println!("Warning: failed to fetch {}: {e:#}", source.name);
                failed.push(source.name.clone());
            }
        }
    }

    // One unreachable source used to abort the whole update, so a newly added
    // list never landed. Dropping its entries instead would unblock everything
    // only it covered, so the previous list is kept alongside.
    // ponytail: entries a failing source has since retired stay until it fetches again.
    if !failed.is_empty() {
        crate::dns_manager::log_tamper_event(&format!(
            "Blocklist update: could not fetch {}; kept their previous entries.",
            failed.join(", ")
        ));
        if let Ok(previous) = fs::read_to_string(&blocklist_path) {
            all_domains.extend(previous.lines().map(str::to_string));
        }
    }

    // Merge with manually included domains and remove duplicates
    all_domains.extend(config.included_domains.clone());
    all_domains.sort();
    all_domains.dedup();

    println!("Total unique domains: {}", all_domains.len());

    fs::write(&blocklist_path, all_domains.join("\n"))
        .with_context(|| format!("failed to write blocklist to {}", blocklist_path.display()))?;

    Ok(())
}

/// System DNS is the proxy, which can block a list's own host (the "nsfw"
/// keyword matches nsfw.oisd.nl), and Quad9 does not resolve every list host.
/// So the host is looked up through the filtered upstreams directly.
async fn fetch_source(url: &str) -> Result<String> {
    let parsed = reqwest::Url::parse(url).context("invalid source URL")?;
    let mut client = reqwest::Client::builder();
    if let (Some(host), Some(port)) = (parsed.host_str(), parsed.port_or_known_default()) {
        if let Some(ip) = crate::dns::resolve_bypassing_blocklist(host).await {
            client = client.resolve(host, std::net::SocketAddr::new(ip, port));
        }
    }
    let response = client.build()?.get(parsed).send().await?.error_for_status()?;
    Ok(response.text().await?)
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

    #[tokio::test]
    async fn an_unreachable_source_keeps_the_previous_entries() {
        let dir = std::env::temp_dir().join(format!("la-updater-dead-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let config_path = dir.join("config.json");
        let mut config = libreascent_shared::config::default_config();
        config.sources.iter_mut().for_each(|s| s.enabled = false);
        config.sources.push(libreascent_shared::config::BlocklistSource {
            id: "dead".into(),
            name: "Dead".into(),
            url: "http://127.0.0.1:1/list".into(),
            format: "domains".into(),
            enabled: true,
        });
        libreascent_shared::config::save(&config_path, &config).unwrap();
        std::fs::write(dir.join("blocklist.txt"), "kept.example\nalso-kept.example").unwrap();

        update_sources(&config_path).await.expect("a dead source is not fatal");

        let list = std::fs::read_to_string(dir.join("blocklist.txt")).unwrap();
        assert!(list.lines().any(|l| l == "kept.example"));
        assert!(list.lines().any(|l| l == "also-kept.example"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Live: Quad9 does not resolve this host and the "nsfw" keyword blocks it
    // at the proxy, so only the direct lookup can reach the list. Run with:
    //   cargo test -p libreascent-service list_hosts_resolve -- --ignored
    #[tokio::test]
    #[ignore]
    async fn list_hosts_resolve_past_the_blocklist() {
        assert!(crate::dns::resolve_bypassing_blocklist("nsfw.oisd.nl").await.is_some());
    }
}
