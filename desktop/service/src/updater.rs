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
    let mut allowed = std::collections::HashSet::new();
    let mut failed = Vec::new();

    for source in &config.sources {
        if !source.enabled {
            continue;
        }

        println!("Fetching {}...", source.name);
        match fetch_source(&source.url).await {
            // An "allow" list takes its domains back out of the others: the
            // proxy lists also carry VPN providers, which stay reachable.
            Ok(content) if source.format == "allow" => {
                let domains = parse_domain_list(&content);
                println!("  Allowing {} domains", domains.len());
                allowed.extend(domains);
            }
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

    // Manually included domains are added after, so a user's own block wins.
    all_domains.retain(|domain| !allowed.contains(domain));
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

    #[tokio::test]
    async fn an_allow_source_takes_its_domains_out_but_not_manual_blocks() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut request = [0_u8; 1024];
                let read = stream.read(&mut request).await.unwrap_or(0);
                let body = if String::from_utf8_lossy(&request[..read]).contains("/allow") {
                    "nordvpn.com\nmanual.example\n"
                } else {
                    "nordvpn.com\ncroxyproxy.com\n"
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = stream.write_all(response.as_bytes()).await;
            }
        });

        let dir = std::env::temp_dir().join(format!("la-updater-allow-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let config_path = dir.join("config.json");
        let mut config = libreascent_shared::config::default_config();
        config.sources = ["block", "allow"]
            .map(|kind| libreascent_shared::config::BlocklistSource {
                id: kind.into(),
                name: kind.into(),
                url: format!("http://127.0.0.1:{port}/{kind}"),
                format: if kind == "allow" { "allow".into() } else { "domains".into() },
                enabled: true,
            })
            .to_vec();
        config.included_domains = vec!["manual.example".into()];
        libreascent_shared::config::save(&config_path, &config).unwrap();

        update_sources(&config_path).await.unwrap();

        let list = std::fs::read_to_string(dir.join("blocklist.txt")).unwrap();
        let lines: Vec<&str> = list.lines().collect();
        assert!(lines.contains(&"croxyproxy.com"));
        assert!(!lines.contains(&"nordvpn.com"), "allow list must take it out");
        assert!(lines.contains(&"manual.example"), "a manual block beats the allow list");
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
