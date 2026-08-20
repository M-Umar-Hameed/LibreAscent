use std::collections::HashSet;

#[derive(Debug, Clone, Default)]
pub struct DomainBlocklist {
    blocked: HashSet<String>,
    allowed: HashSet<String>,
    keywords: Vec<String>,
}

impl DomainBlocklist {
    pub fn new(blocked: impl IntoIterator<Item = String>, allowed: impl IntoIterator<Item = String>) -> Self {
        let mut this = Self::default();
        this.extend_blocked(blocked);
        this.extend_allowed(allowed);
        this
    }

    pub fn extend_blocked(&mut self, domains: impl IntoIterator<Item = String>) {
        self.blocked.extend(domains.into_iter().filter_map(|d| normalize_domain(&d)));
    }

    pub fn extend_allowed(&mut self, domains: impl IntoIterator<Item = String>) {
        self.allowed.extend(domains.into_iter().filter_map(|d| normalize_domain(&d)));
    }

    pub fn extend_keywords(&mut self, keywords: impl IntoIterator<Item = String>) {
        self.keywords.extend(keywords.into_iter().filter_map(|k| {
            let normalized = k.trim().to_ascii_lowercase();
            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        }));
    }

    pub fn is_blocked(&self, domain: &str) -> bool {
        let Some(normalized) = normalize_domain(domain) else {
            return false;
        };

        if matches_domain_set(&normalized, &self.allowed) {
            return false;
        }

        if matches_domain_set(&normalized, &self.blocked) {
            return true;
        }

        self.keywords
            .iter()
            .any(|keyword| normalized.contains(keyword.as_str()))
    }
}

pub fn normalize_domain(input: &str) -> Option<String> {
    let trimmed = input.trim().to_ascii_lowercase();

    // Skip comments and empty lines
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.starts_with('!')
        || trimmed.starts_with('[')
    {
        return None;
    }

    let mut domain: &str = &trimmed;

    // Handle hosts file format (0.0.0.0 domain or 127.0.0.1 domain)
    if domain.starts_with("0.0.0.0 ") || domain.starts_with("127.0.0.1 ") {
        domain = domain.split_whitespace().nth(1).unwrap_or("");
    }

    // Skip AdBlock/uBlock filters that aren't simple domain blocks
    if domain.contains("##") || domain.contains("#?#") || domain.starts_with("@@") {
        return None;
    }

    // Remove inline comments
    if let Some(idx) = domain.find('#') {
        domain = domain[..idx].trim();
    }

    // Handle AdBlock ||domain^ syntax
    if domain.starts_with("||") {
        domain = &domain[2..];
    }
    if let Some(idx) = domain.find('^') {
        domain = &domain[..idx];
    }
    if let Some(idx) = domain.find('$') {
        domain = &domain[..idx];
    }

    // Strip protocols and paths/ports
    let domain = domain
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_end_matches('.')
        .trim();

    if domain.is_empty() || domain.contains(' ') || !domain.contains('.') {
        None
    } else {
        Some(domain.to_string())
    }
}

pub fn parse_domain_list(content: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(|line| normalize_domain(line))
        .collect()
}

fn matches_domain_set(domain: &str, set: &HashSet<String>) -> bool {
    if set.contains(domain) {
        return true;
    }

    let mut remainder = domain;
    while let Some((_, parent)) = remainder.split_once('.') {
        if set.contains(parent) {
            return true;
        }
        remainder = parent;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_domains() {
        assert_eq!(normalize_domain(" HTTPS://Sub.Example.COM/path "), Some("sub.example.com".to_string()));
        assert_eq!(normalize_domain("example.com."), Some("example.com".to_string()));
        assert_eq!(normalize_domain("bad domain.com"), None);
        assert_eq!(normalize_domain("0.0.0.0 example.com"), Some("example.com".to_string()));
        assert_eq!(normalize_domain("||example.com^"), Some("example.com".to_string()));
        assert_eq!(normalize_domain("# comment"), None);
    }

    #[test]
    fn parses_domain_list() {
        let content = "
# Comment
example.com
0.0.0.0 sub.example.com
||blocked.org^
invalid-no-dot
";
        let domains = parse_domain_list(content);
        assert_eq!(domains, vec!["example.com", "sub.example.com", "blocked.org"]);
    }

    #[test]
    fn blocks_exact_and_subdomains() {
        let blocklist = DomainBlocklist::new(vec!["example.com".to_string()], Vec::<String>::new());

        assert!(blocklist.is_blocked("example.com"));
        assert!(blocklist.is_blocked("www.example.com"));
        assert!(blocklist.is_blocked("deep.www.example.com"));
        assert!(!blocklist.is_blocked("example.org"));
    }

    #[test]
    fn allowlist_wins_over_blocklist() {
        let blocklist = DomainBlocklist::new(
            vec!["example.com".to_string()],
            vec!["safe.example.com".to_string()],
        );

        assert!(blocklist.is_blocked("example.com"));
        assert!(!blocklist.is_blocked("safe.example.com"));
        assert!(!blocklist.is_blocked("cdn.safe.example.com"));
    }

    #[test]
    fn blocks_domains_containing_keyword() {
        let mut blocklist = DomainBlocklist::default();
        blocklist.extend_keywords(vec!["porn".to_string(), " CASINO ".to_string()]);

        assert!(blocklist.is_blocked("pornhub.com"));
        assert!(blocklist.is_blocked("my-casino.net"));
        assert!(!blocklist.is_blocked("example.com"));
    }

    #[test]
    fn keyword_respects_allowlist_and_ignores_blank() {
        let mut blocklist = DomainBlocklist::new(
            Vec::<String>::new(),
            vec!["safe-porn-help.org".to_string()],
        );
        blocklist.extend_keywords(vec!["porn".to_string(), "   ".to_string()]);

        assert!(blocklist.is_blocked("pornsite.com"));
        assert!(!blocklist.is_blocked("safe-porn-help.org"));
    }
}
