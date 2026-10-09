use anyhow::{Context, Result};
use hickory_proto::op::{Message, MessageType, OpCode, ResponseCode};
use hickory_proto::serialize::binary::{BinDecodable, BinEncodable};
use hickory_proto::rr::{Name, RecordType};
use hickory_resolver::TokioResolver;
use hickory_resolver::config::{ConnectionConfig, NameServerConfig, ResolverConfig, ResolverOpts};
use hickory_resolver::lookup::Lookup;
use hickory_resolver::net::runtime::TokioRuntimeProvider;
use hickory_resolver::net::{DnsError, NetError};
use libreascent_shared::blocklist::DomainBlocklist;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, UdpSocket};
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

use crate::config_loader;

const LOCAL_PROXY_TIMEOUT: Duration = Duration::from_secs(5);
const RELOAD_POLL_SECS: u64 = 60;
/// Per-tier query timeout. The tiers below do the retrying, so a dead tier
/// should cost one short wait, not hickory's default two attempts of 5s.
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(3);
/// A tier is skipped for this long once it has failed TRIP_AFTER times in a
/// row. One timeout under a burst must not take a tier out: under load Quad9
/// drops the odd query, and a single-failure breaker turned that into a minute
/// of SERVFAIL for everything.
const BREAKER_SECS: u64 = 60;
const TRIP_AFTER: u32 = 3;
/// Seconds without any upstream answer before UPSTREAM_DOWN is raised.
const FAIL_OPEN_SECS: u64 = 60;
/// Something else can hold :53 (Internet Connection Sharing, Mobile Hotspot).
/// Keep trying for two minutes rather than leave a pinned resolver with nothing
/// behind it.
const BIND_RETRIES: u32 = 24;
const BIND_RETRY_DELAY: Duration = Duration::from_secs(5);

/// Raised once every upstream tier has failed for FAIL_OPEN_SECS, cleared by
/// the next answer. service_manager releases the DNS pin on it in Locked mode.
pub static UPSTREAM_DOWN: AtomicBool = AtomicBool::new(false);

static UPSTREAM: OnceLock<Arc<Upstream>> = OnceLock::new();

/// Quad9 over DoT, then DoH, then plain UDP, in that order. Every tier is the
/// same resolver, so a fallback never widens what the firewall already grants
/// to Quad9 on :853; firewall_manager carves Quad9 out of its :53 and :443
/// seals to match. The plaintext tier is what survives a reset clock: with the
/// CMOS cleared every TLS handshake fails as "not yet valid", and w32time cannot
/// fix the clock because it needs DNS first.
pub struct Upstream {
    tiers: Vec<Tier>,
    started: Instant,
    last_ok: AtomicU64,
}

struct Tier {
    label: &'static str,
    resolver: TokioResolver,
    /// Failures since the last answer from this tier.
    failures: AtomicU32,
    /// Seconds since `Upstream::started` before which the tier is skipped.
    down_until: AtomicU64,
}

impl Upstream {
    fn secs(&self) -> u64 {
        self.started.elapsed().as_secs()
    }

    /// Ok: answers. Err(Some): an authoritative negative answer (NXDOMAIN and
    /// friends) to pass through. Err(None): every tier tried failed.
    async fn lookup(&self, name: Name, rtype: RecordType) -> Result<Lookup, Option<ResponseCode>> {
        let now = self.secs();
        let mut live: Vec<&Tier> = self
            .tiers
            .iter()
            .filter(|tier| tier.down_until.load(Ordering::Relaxed) <= now)
            .collect();
        // Every breaker open: still try the primary, so a dead upstream costs a
        // query one timeout rather than an instant refusal for a minute, and the
        // first answer closes the breakers again.
        if live.is_empty() {
            live.push(&self.tiers[0]);
        }
        for tier in live {
            match tier.resolver.lookup(name.clone(), rtype).await {
                Ok(lookup) => {
                    self.answered(tier, now);
                    return Ok(lookup);
                }
                Err(NetError::Dns(DnsError::NoRecordsFound(no_records))) => {
                    self.answered(tier, now);
                    return Err(Some(no_records.response_code));
                }
                Err(error) => {
                    let failures = tier.failures.fetch_add(1, Ordering::Relaxed) + 1;
                    if failures >= TRIP_AFTER {
                        tier.down_until.store(now + BREAKER_SECS, Ordering::Relaxed);
                    }
                    if failures == TRIP_AFTER {
                        crate::dns_manager::log_tamper_event(&format!(
                            "Upstream {} failed {TRIP_AFTER} times, skipped for {BREAKER_SECS}s: {error}",
                            tier.label
                        ));
                    }
                }
            }
        }
        if now.saturating_sub(self.last_ok.load(Ordering::Relaxed)) >= FAIL_OPEN_SECS {
            UPSTREAM_DOWN.store(true, Ordering::Relaxed);
        }
        Err(None)
    }

    fn answered(&self, tier: &Tier, now: u64) {
        tier.failures.store(0, Ordering::Relaxed);
        tier.down_until.store(0, Ordering::Relaxed);
        self.last_ok.store(now, Ordering::Relaxed);
        UPSTREAM_DOWN.store(false, Ordering::Relaxed);
    }
}

fn build_upstream() -> Result<Upstream> {
    use std::net::{IpAddr, Ipv4Addr};

    // IPv4-only Quad9 endpoints. Talking to the upstream over IPv4 avoids a
    // hard failure on hosts without an IPv6 route; clients still receive AAAA
    // records normally. Ports set explicitly rather than by protocol default:
    // the firewall exemptions are written against Quad9 on exactly these.
    build_upstream_for(
        &[
            IpAddr::V4(Ipv4Addr::new(9, 9, 9, 9)),
            IpAddr::V4(Ipv4Addr::new(149, 112, 112, 112)),
        ],
        [853, 443, 53],
    )
}

fn build_upstream_for(ips: &[std::net::IpAddr], ports: [u16; 3]) -> Result<Upstream> {
    let server_name: Arc<str> = Arc::from("dns.quad9.net");
    let mut dot = ConnectionConfig::tls(Arc::clone(&server_name));
    dot.port = ports[0];
    let mut doh = ConnectionConfig::https(Arc::clone(&server_name), None);
    doh.port = ports[1];
    let mut udp = ConnectionConfig::udp();
    udp.port = ports[2];

    let tiers = [("DoT", dot), ("DoH", doh), ("UDP", udp)]
        .into_iter()
        .map(|(label, connection)| {
            Ok(Tier {
                label,
                resolver: build_resolver(ips, connection)?,
                failures: AtomicU32::new(0),
                down_until: AtomicU64::new(0),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Upstream {
        tiers,
        started: Instant::now(),
        last_ok: AtomicU64::new(0),
    })
}

fn build_resolver(ips: &[std::net::IpAddr], connection: ConnectionConfig) -> Result<TokioResolver> {
    let quad9 = ips
        .iter()
        .map(|ip| NameServerConfig::new(*ip, true, vec![connection.clone()]))
        .collect();
    let config = ResolverConfig::from_parts(None, Vec::new(), quad9);

    let mut opts = ResolverOpts::default();
    opts.cache_size = 1024;
    opts.timeout = UPSTREAM_TIMEOUT;
    opts.attempts = 1;
    TokioResolver::builder_with_config(config, TokioRuntimeProvider::default())
        .with_options(opts)
        .build()
        .context("failed to build upstream DNS resolver")
}

pub fn upstream() -> Result<Arc<Upstream>> {
    if let Some(existing) = UPSTREAM.get() {
        return Ok(Arc::clone(existing));
    }
    let built = Arc::new(build_upstream()?);
    Ok(Arc::clone(UPSTREAM.get_or_init(|| built)))
}

/// One lookup through the tiers. While the pin is released nothing reaches the
/// proxy, so this is how service_manager learns the upstream is back.
pub async fn upstream_probe() -> bool {
    let (Ok(upstream), Ok(name)) = (upstream(), Name::from_ascii("dns.quad9.net.")) else {
        return false;
    };
    !matches!(upstream.lookup(name, RecordType::A).await, Err(None))
}

/// Where the browser blocker asks whether a host is blocked. Plain TCP on a
/// port of its own: a VPN app blocks DNS to this machine, not this.
const DOMAIN_CHECK_ADDR: &str = "127.0.0.1:47713";

/// Keeps blocked sites blocked in the browser while a VPN app owns DNS and the
/// proxy is out of the path. Answers `GET /check?host=<name>` with 1 or 0.
async fn serve_domain_checks(blocklist: Arc<RwLock<DomainBlocklist>>) {
    let listener = match TcpListener::bind(DOMAIN_CHECK_ADDR).await {
        Ok(listener) => listener,
        Err(error) => {
            crate::dns_manager::log_tamper_event(&format!(
                "Domain check endpoint cannot bind {DOMAIN_CHECK_ADDR}: {error}"
            ));
            return;
        }
    };
    loop {
        let Ok((mut stream, _)) = listener.accept().await else {
            continue;
        };
        let blocklist = Arc::clone(&blocklist);
        tokio::spawn(async move {
            let mut buffer = [0_u8; 1024];
            let Ok(Ok(read)) = timeout(Duration::from_secs(2), stream.read(&mut buffer)).await else {
                return;
            };
            let request = String::from_utf8_lossy(&buffer[..read]);
            let blocked = check_host(&request)
                .map(|host| blocklist.read().map(|list| list.is_blocked(host)).unwrap_or(false))
                .unwrap_or(false);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\nConnection: close\r\n\r\n{}",
                if blocked { "1" } else { "0" }
            );
            let _ = stream.write_all(response.as_bytes()).await;
        });
    }
}

fn check_host(request: &str) -> Option<&str> {
    let host = request
        .lines()
        .next()?
        .strip_prefix("GET /check?host=")?
        .split(' ')
        .next()?;
    (!host.is_empty() && host.len() < 256).then_some(host)
}

pub struct BlockedDnsResponse {
    pub domain: String,
    pub response: Vec<u8>,
}

/// The blocklist file is rewritten by `update-sources`, which runs while the
/// proxy is already up: the fetch needs DNS, and system DNS is this proxy.
/// Without this the new domains would not apply until the service restarted.
async fn watch_blocklist_file(config_path: PathBuf, blocklist: Arc<RwLock<DomainBlocklist>>) {
    let path = config_path.parent().unwrap_or(&config_path).join("blocklist.txt");
    let mut last = modified_at(&path);

    loop {
        tokio::time::sleep(Duration::from_secs(RELOAD_POLL_SECS)).await;
        let current = modified_at(&path);
        if current == last {
            continue;
        }
        last = current;

        let reloaded = config_loader::load_blocklist(&config_path);
        match blocklist.write() {
            Ok(mut guard) => {
                *guard = reloaded;
                crate::dns_manager::log_tamper_event("Blocklist reloaded after update.");
            }
            Err(_) => return,
        }
    }
}

fn modified_at(path: &std::path::Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(path).ok().and_then(|m| m.modified().ok())
}

pub async fn run_local_dns_proxy(config_path: PathBuf, bind_addr: &str) -> Result<()> {
    run_local_dns_proxy_with_ready(config_path, bind_addr, None).await
}

pub async fn run_local_dns_proxy_with_ready(
    config_path: PathBuf,
    bind_addr: &str,
    ready: Option<oneshot::Sender<Result<(), String>>>,
) -> Result<()> {
    let bind: SocketAddr = bind_addr.parse().context("invalid DNS bind address")?;

    let mut attempt = 0;
    let socket = loop {
        match UdpSocket::bind(bind).await {
            Ok(socket) => break socket,
            Err(error) if attempt < BIND_RETRIES => {
                attempt += 1;
                if attempt == 1 {
                    crate::dns_manager::log_tamper_event(&format!(
                        "DNS proxy cannot bind {bind}: {error}. Retrying."
                    ));
                }
                tokio::time::sleep(BIND_RETRY_DELAY).await;
            }
            Err(error) => {
                let error = anyhow::Error::from(error).context("failed to bind DNS proxy");
                if let Some(sender) = ready {
                    let _ = sender.send(Err(error.to_string()));
                }
                return Err(error);
            }
        }
    };
    if let Some(sender) = ready {
        let _ = sender.send(Ok(()));
    }
    let socket = Arc::new(socket);
    let broadcast_socket = UdpSocket::bind("127.0.0.1:0").await.ok();
    let mut buffer = vec![0_u8; 4096];
    let blocklist = Arc::new(RwLock::new(config_loader::load_blocklist(&config_path)));
    let resolver = upstream()?;
    crate::dns_manager::log_tamper_event("DNS proxy started. Blocklist loaded.");
    tokio::spawn(watch_blocklist_file(config_path.clone(), Arc::clone(&blocklist)));
    tokio::spawn(serve_domain_checks(Arc::clone(&blocklist)));

    loop {
        let (size, peer) = match socket.recv_from(&mut buffer).await {
            Ok(res) => res,
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => {
                // Ignore ConnectionReset on Windows (caused by ICMP Port Unreachable from previous send_to)
                continue;
            }
            Err(e) => return Err(e).context("failed to receive DNS packet"),
        };
        let request = buffer[..size].to_vec();
        let request_id = get_request_id(&request);

        let verdict = {
            let list = blocklist.read().expect("blocklist lock poisoned");
            build_block_response_if_needed(&request, &list)
        };
        match verdict {
            // Not logged: a synchronous append to tamper.log per blocked query
            // put the p99 of the fast path above a second under load, and wrote
            // every blocked name to a world-readable file. The UI gets the
            // broadcast below instead.
            Ok(Some(blocked)) => {
                let _ = socket.send_to(&blocked.response, peer).await;

                if let Some(ref b_socket) = broadcast_socket {
                    let message = format!("block:dns:{}", blocked.domain);
                    let _ = b_socket.send_to(message.as_bytes(), "127.0.0.1:13370").await;
                }
                continue;
            }
            Ok(None) => {}
            Err(error) => {
                crate::dns_manager::log_tamper_event(&format!(
                    "Invalid DNS request ignored: {error}"
                ));
                continue;
            }
        }

        // Resolve concurrently so a single slow upstream query never blocks the
        // next client packet. The resolver pools its DoT connection and caches
        // answers, so this stays cheap under load.
        let socket = Arc::clone(&socket);
        let resolver = Arc::clone(&resolver);
        tokio::spawn(async move {
            match resolve_via_upstream(&resolver, &request).await {
                Ok(response) => {
                    let _ = socket.send_to(&response, peer).await;
                }
                Err(error) => {
                    if let Ok(response) = build_error_response(&request, ResponseCode::ServFail) {
                        let _ = socket.send_to(&response, peer).await;
                    }
                    crate::dns_manager::log_tamper_event(&format!(
                        "Upstream failed: {request_id:04x} - {error}"
                    ));
                }
            }
        });
    }
}

async fn resolve_via_upstream(resolver: &Upstream, request: &[u8]) -> Result<Vec<u8>> {
    let message = Message::from_bytes(request).context("failed to parse DNS request")?;
    let Some(query) = message.queries.first() else {
        return build_error_response(request, ResponseCode::FormErr);
    };

    let mut response = Message::new(message.metadata.id, MessageType::Response, OpCode::Query);
    response.metadata.recursion_desired = message.metadata.recursion_desired;
    response.metadata.recursion_available = true;
    response.add_query(query.clone());

    match resolver.lookup(query.name().clone(), query.query_type()).await {
        Ok(lookup) => {
            response.metadata.response_code = ResponseCode::NoError;
            for record in lookup.answers() {
                response.add_answer(record.clone());
            }
        }
        // A name that does not resolve is a normal answer, not a failure: pass
        // the upstream's code through so NXDOMAIN stays NXDOMAIN.
        Err(Some(code)) => {
            response.metadata.response_code = code;
        }
        Err(None) => {
            response.metadata.response_code = ResponseCode::ServFail;
        }
    }

    response
        .to_bytes()
        .context("failed to encode upstream DNS response")
}

fn get_request_id(request: &[u8]) -> u16 {
    if request.len() < 2 {
        0
    } else {
        u16::from_be_bytes([request[0], request[1]])
    }
}

pub async fn local_dns_proxy_responds() -> Result<bool> {
    let socket = UdpSocket::bind("127.0.0.1:0")
        .await
        .context("failed to bind local DNS health-check socket")?;
    let request = dns_probe_query()?;

    socket
        .send_to(&request, "127.0.0.1:53")
        .await
        .context("failed to send local DNS health-check query")?;

    let mut buffer = vec![0_u8; 512];
    loop {
        match timeout(LOCAL_PROXY_TIMEOUT, socket.recv_from(&mut buffer)).await {
            Ok(Ok((size, _))) => {
                return Message::from_bytes(&buffer[..size])
                    .map(|response| response.metadata.id == 0x4c41)
                    .context("failed to parse local DNS health-check response")
            }
            Ok(Err(e)) if e.kind() == std::io::ErrorKind::ConnectionReset => {
                // Ignore ConnectionReset on Windows (likely ICMP port unreachable from a previous probe)
                continue;
            }
            Ok(Err(error)) => {
                return Err(error).context("failed to receive local DNS health-check response")
            }
            Err(_) => return Ok(false),
        }
    }
}

fn dns_probe_query() -> Result<Vec<u8>> {
    use hickory_proto::op::Query;
    use hickory_proto::rr::{Name, RecordType};

    let mut message = Message::new(0x4c41, MessageType::Query, OpCode::Query);
    message.metadata.recursion_desired = true;
    message.add_query(Query::query(
        Name::from_ascii("cloudflare.com.").context("failed to build DNS health-check name")?,
        RecordType::A,
    ));
    message
        .to_bytes()
        .context("failed to encode DNS health-check query")
}

pub fn build_block_response_if_needed(
    request: &[u8],
    blocklist: &DomainBlocklist,
) -> Result<Option<BlockedDnsResponse>> {
    let message = Message::from_bytes(request).context("failed to parse DNS request")?;
    let Some(query) = message.queries.first() else {
        return Ok(None);
    };
    let domain = query.name().to_ascii();

    if !blocklist.is_blocked(&domain) {
        return Ok(None);
    }

    let response = build_error_response(request, ResponseCode::NXDomain)?;
    Ok(Some(BlockedDnsResponse { domain, response }))
}

pub fn build_error_response(request: &[u8], response_code: ResponseCode) -> Result<Vec<u8>> {
    let message = Message::from_bytes(request).context("failed to parse DNS request")?;
    let mut response = Message::new(message.metadata.id, MessageType::Response, OpCode::Query);
    response.metadata.authoritative = false;
    response.metadata.recursion_desired = message.metadata.recursion_desired;
    response.metadata.recursion_available = true;
    response.metadata.response_code = response_code;

    if let Some(query) = message.queries.first() {
        response.add_query(query.clone());
    }

    response
        .to_bytes()
        .context("failed to encode DNS error response")
}

#[cfg(test)]
mod tests {
    use super::*;
    use hickory_proto::op::Query;
    use hickory_proto::rr::{Name, RecordType};

    // Live check: resolves through the real Quad9 upstream, one tier at a time,
    // so a tier that is silently broken (feature flag, port, path) shows up.
    // Ignored so CI never depends on the network. Run with:
    //   cargo test -p libreascent-service resolves_via_every_quad9_tier -- --ignored --nocapture
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore]
    async fn resolves_via_every_quad9_tier() {
        let upstream = build_upstream().expect("upstream should build");
        assert_eq!(upstream.tiers.len(), 3);
        for tier in &upstream.tiers {
            let name = Name::from_ascii("example.com.").unwrap();
            let lookup = tier
                .resolver
                .lookup(name, RecordType::A)
                .await
                .unwrap_or_else(|e| panic!("{} tier failed: {e}", tier.label));
            assert!(lookup.answers().len() > 0, "{}: expected an A record", tier.label);
        }

        let request = dns_query("example.com.");
        let response_bytes = resolve_via_upstream(&upstream, &request)
            .await
            .expect("upstream should resolve");
        let response = Message::from_bytes(&response_bytes).expect("response should parse");
        assert_eq!(response.metadata.response_code, ResponseCode::NoError);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dead_tiers_trip_their_breakers_and_the_query_fails_fast_after() {
        use std::net::{IpAddr, Ipv4Addr};

        // Port 1 on loopback refuses every tier.
        let upstream = build_upstream_for(&[IpAddr::V4(Ipv4Addr::LOCALHOST)], [1, 1, 1])
            .expect("upstream should build");
        let name = Name::from_ascii("example.com.").unwrap();

        // One failure is weather, not an outage: no breaker trips.
        assert!(matches!(upstream.lookup(name.clone(), RecordType::A).await, Err(None)));
        for tier in &upstream.tiers {
            assert_eq!(tier.down_until.load(Ordering::Relaxed), 0, "{} tripped on one failure", tier.label);
        }
        for _ in 1..TRIP_AFTER {
            assert!(matches!(upstream.lookup(name.clone(), RecordType::A).await, Err(None)));
        }
        for tier in &upstream.tiers {
            assert!(tier.down_until.load(Ordering::Relaxed) >= BREAKER_SECS, "{} should be down", tier.label);
        }
        // Fresh process: the fail-open flag needs FAIL_OPEN_SECS of silence first.
        assert!(!UPSTREAM_DOWN.load(Ordering::Relaxed));

        // With every breaker open a query still tries the primary, once: a
        // dead upstream costs one attempt, not three and not an instant refusal.
        // Three attempts would include the UDP tier's full timeout.
        let started = Instant::now();
        assert!(matches!(upstream.lookup(name, RecordType::A).await, Err(None)));
        assert!(started.elapsed() < UPSTREAM_TIMEOUT);
        assert_eq!(upstream.tiers[0].failures.load(Ordering::Relaxed), TRIP_AFTER + 1);
        assert_eq!(upstream.tiers[1].failures.load(Ordering::Relaxed), TRIP_AFTER);
    }

    #[test]
    fn upstream_tiers_match_the_firewall_exemptions() {
        // firewall_manager carves Quad9 out of :53 and :443 and never blocks
        // Quad9 :853; a tier on any other port would be sealed by our own rules.
        let upstream = build_upstream().expect("upstream should build");
        let labels: Vec<_> = upstream.tiers.iter().map(|t| t.label).collect();
        assert_eq!(labels, ["DoT", "DoH", "UDP"]);
        assert!(!UPSTREAM_DOWN.load(Ordering::Relaxed));
    }

    #[test]
    fn returns_nxdomain_for_blocked_domain() {
        let request = dns_query("example.com.");
        let blocklist = DomainBlocklist::new(vec!["example.com".to_string()], Vec::<String>::new());

        let blocked = build_block_response_if_needed(&request, &blocklist)
            .expect("request should parse")
            .expect("domain should be blocked");
        let response_bytes = blocked.response;
        let response = Message::from_bytes(&response_bytes).expect("response should parse");

        assert_eq!(blocked.domain, "example.com.");
        assert_eq!(response.metadata.response_code, ResponseCode::NXDomain);
        assert_eq!(response.queries.len(), 1);
    }

    #[test]
    fn returns_none_for_allowed_domain() {
        let request = dns_query("allowed.com.");
        let blocklist = DomainBlocklist::new(vec!["example.com".to_string()], Vec::<String>::new());

        let response =
            build_block_response_if_needed(&request, &blocklist).expect("request should parse");

        assert!(response.is_none());
    }

    #[test]
    fn returns_servfail_for_upstream_failure() {
        let request = dns_query("allowed.com.");

        let response_bytes =
            build_error_response(&request, ResponseCode::ServFail).expect("request should parse");
        let response = Message::from_bytes(&response_bytes).expect("response should parse");

        assert_eq!(response.metadata.response_code, ResponseCode::ServFail);
        assert_eq!(response.queries.len(), 1);
    }

    #[test]
    fn builds_valid_dns_probe_query() {
        let request = dns_probe_query().expect("query should encode");
        let message = Message::from_bytes(&request).expect("query should parse");

        assert_eq!(message.metadata.id, 0x4c41);
        assert_eq!(message.queries.len(), 1);
        assert_eq!(message.queries[0].name().to_ascii(), "cloudflare.com.");
    }

    fn dns_query(domain: &str) -> Vec<u8> {
        let mut message = Message::new(42, MessageType::Query, OpCode::Query);
        message.metadata.recursion_desired = true;
        message.add_query(Query::query(
            Name::from_ascii(domain).expect("domain should be valid"),
            RecordType::A,
        ));
        message.to_bytes().expect("query should encode")
    }

    #[test]
    fn domain_check_requests_name_one_host() {
        assert_eq!(check_host("GET /check?host=pornhub.com HTTP/1.1\r\nHost: x\r\n"), Some("pornhub.com"));
        assert_eq!(check_host("GET /check?host= HTTP/1.1"), None);
        assert_eq!(check_host("POST /check?host=a.com HTTP/1.1"), None);
    }
}
