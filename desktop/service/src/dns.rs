use anyhow::{Context, Result};
use hickory_proto::op::{Message, MessageType, OpCode, Query, ResponseCode};
use hickory_proto::serialize::binary::{BinDecodable, BinEncodable};
use hickory_proto::rr::{Name, Record, RecordType};
use hickory_resolver::{ResponseCache, TokioResolver, TtlConfig};
use hickory_resolver::config::{ConnectionConfig, NameServerConfig, ResolverConfig, ResolverOpts};
use hickory_resolver::lookup::Lookup;
use hickory_resolver::net::runtime::TokioRuntimeProvider;
use hickory_resolver::net::{DnsError, NetError};
use libreascent_shared::blocklist::DomainBlocklist;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
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

/// Backup resolvers that filter adult content themselves. The bypass seal never
/// covers them on :443 or :853, which is safe for the same reason: an app that
/// talks to them directly still gets their filtering.
pub(crate) const BACKUP_UPSTREAM_IPS: [Ipv4Addr; 4] = [
    Ipv4Addr::new(1, 1, 1, 3),
    Ipv4Addr::new(1, 0, 0, 3),
    Ipv4Addr::new(185, 228, 168, 168),
    Ipv4Addr::new(185, 228, 169, 168),
];

/// Quad9 over DoT, then DoH, then plain UDP, then the filtering backups, in
/// that order. The Quad9 tiers never widen what the firewall already grants to
/// Quad9 on :853; firewall_manager carves Quad9 out of its :53 and :443 seals
/// to match. The plaintext tier is what survives a reset clock: with the CMOS
/// cleared every TLS handshake fails as "not yet valid", and w32time cannot fix
/// the clock because it needs DNS first. When every tier is down the network's
/// own resolver stands in (see `router`).
pub struct Upstream {
    tiers: Vec<Tier>,
    /// One cache in front of every tier, so only an answer off the network
    /// counts as a tier answering. Per-tier caches served hits that reset the
    /// breakers, so a dead upstream never stayed skipped and kept costing every
    /// query its timeouts.
    cache: ResponseCache,
    /// Set once every tier's breaker is open; cleared by the next real answer
    /// from a tier. service_manager opens the router fallback on it.
    router_wanted: AtomicBool,
    /// The network's own resolvers, set by service_manager once the firewall
    /// lets them through. The blocklist has already run by the time a query
    /// gets here, so this changes where answers come from, not what is blocked.
    router: RwLock<Option<(Vec<Ipv4Addr>, TokioResolver)>>,
    started: Instant,
    /// Seconds since `started` of the first failure since the last answer,
    /// plus one; zero while answers flow.
    failing_since: AtomicU64,
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
    async fn lookup(&self, name: Name, rtype: RecordType) -> Result<Vec<Record>, Option<ResponseCode>> {
        let query = Query::query(name.clone(), rtype);
        match self.cache.get(&query, Instant::now()) {
            Some(Ok(message)) => return Ok(message.answers),
            Some(Err(NetError::Dns(DnsError::NoRecordsFound(no_records)))) => {
                return Err(Some(no_records.response_code))
            }
            _ => {}
        }

        let now = self.secs();
        // The tiers are left to upstream_probe while the router stands in:
        // trying them first would cost every query their timeouts.
        if let Some(router) = self.router_resolver() {
            if let Ok(answer) = self.network_answer(query, router.lookup(name, rtype).await, false) {
                self.router_answered();
                return answer;
            }
            return self.failed(now);
        }

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
            match self.network_answer(query.clone(), tier.resolver.lookup(name.clone(), rtype).await, true) {
                Ok(answer) => {
                    self.answered(tier);
                    return answer;
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
        if self
            .tiers
            .iter()
            .all(|tier| tier.down_until.load(Ordering::Relaxed) > now)
            && !self.router_wanted.swap(true, Ordering::Relaxed)
        {
            crate::dns_manager::log_tamper_event(
                "Every filtered upstream is down: falling back to the network's own DNS. The blocklist still applies.",
            );
        }
        self.failed(now)
    }

    /// UPSTREAM_DOWN counts from the first failure, not the last answer: after
    /// an idle spell the last answer can be minutes old, and Locked would then
    /// release the pin before the router fallback had a chance to open.
    fn failed(&self, now: u64) -> Result<Vec<Record>, Option<ResponseCode>> {
        let since = match self.failing_since.compare_exchange(
            0,
            now + 1,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => now,
            Err(stored) => stored - 1,
        };
        if now.saturating_sub(since) >= FAIL_OPEN_SECS {
            UPSTREAM_DOWN.store(true, Ordering::Relaxed);
        }
        Err(None)
    }

    /// Ok for anything the network answered; Err only for a failure to get an
    /// answer. A SERVFAIL or REFUSED is the server answering about one name,
    /// not the server being down: counted as a failure, one broken domain
    /// queried a few times tripped every tier and opened the router.
    fn network_answer(
        &self,
        query: Query,
        result: Result<Lookup, NetError>,
        cache: bool,
    ) -> Result<Result<Vec<Record>, Option<ResponseCode>>, NetError> {
        match result {
            Ok(lookup) => {
                let answers = lookup.answers().to_vec();
                if cache {
                    self.cache.insert(query, Ok(lookup.message().clone()), Instant::now());
                }
                Ok(Ok(answers))
            }
            Err(NetError::Dns(DnsError::NoRecordsFound(no_records))) => {
                let code = no_records.response_code;
                if cache {
                    self.cache.insert(
                        query,
                        Err(NetError::Dns(DnsError::NoRecordsFound(no_records))),
                        Instant::now(),
                    );
                }
                Ok(Err(Some(code)))
            }
            Err(NetError::Dns(DnsError::ResponseCode(code))) => Ok(Err(Some(code))),
            Err(error) => Err(error),
        }
    }

    /// Router answers are not cached: they would outlive the fallback by up to
    /// their TTL once the filtered tiers are back.
    fn router_answered(&self) {
        self.failing_since.store(0, Ordering::Relaxed);
        UPSTREAM_DOWN.store(false, Ordering::Relaxed);
    }

    fn answered(&self, tier: &Tier) {
        tier.failures.store(0, Ordering::Relaxed);
        tier.down_until.store(0, Ordering::Relaxed);
        self.failing_since.store(0, Ordering::Relaxed);
        UPSTREAM_DOWN.store(false, Ordering::Relaxed);
        if self.router_wanted.swap(false, Ordering::Relaxed) {
            crate::dns_manager::log_tamper_event(&format!(
                "Upstream {} answered again: leaving the network's own DNS.",
                tier.label
            ));
        }
    }

    fn router_resolver(&self) -> Option<TokioResolver> {
        if !self.router_wanted.load(Ordering::Relaxed) {
            return None;
        }
        let router = self.router.read().ok()?;
        router.as_ref().map(|(_, resolver)| resolver.clone())
    }

    fn set_router(&self, ips: &[Ipv4Addr], port: u16) {
        let Ok(mut router) = self.router.write() else {
            return;
        };
        let current = router.as_ref().map(|(current, _)| current.as_slice()).unwrap_or_default();
        if current == ips {
            return;
        }
        if ips.is_empty() {
            *router = None;
            crate::dns_manager::log_tamper_event("Network DNS fallback closed.");
            return;
        }
        let mut udp = ConnectionConfig::udp();
        udp.port = port;
        let addrs: Vec<IpAddr> = ips.iter().copied().map(IpAddr::V4).collect();
        match build_resolver(&addrs, udp) {
            Ok(resolver) => {
                *router = Some((ips.to_vec(), resolver));
                crate::dns_manager::log_tamper_event(&format!(
                    "Network DNS fallback open: {ips:?}. The blocklist still applies."
                ));
            }
            Err(error) => crate::dns_manager::log_tamper_event(&format!(
                "Network DNS fallback could not start: {error}"
            )),
        }
    }

    /// Asks every tier directly, past breakers and cache. Answers on success.
    async fn probe(&self) -> bool {
        let Ok(name) = Name::from_ascii("dns.quad9.net.") else {
            return false;
        };
        let query = Query::query(name.clone(), RecordType::A);
        for tier in &self.tiers {
            let result = tier.resolver.lookup(name.clone(), RecordType::A).await;
            if self.network_answer(query.clone(), result, true).is_ok() {
                self.answered(tier);
                return true;
            }
        }
        if let Some(router) = self.router_resolver() {
            if self.network_answer(query, router.lookup(name, RecordType::A).await, false).is_ok() {
                self.router_answered();
                return true;
            }
        }
        false
    }
}

fn build_upstream() -> Result<Upstream> {
    // IPv4-only endpoints. Talking to the upstream over IPv4 avoids a hard
    // failure on hosts without an IPv6 route; clients still receive AAAA
    // records normally. Ports set explicitly rather than by protocol default:
    // the firewall exemptions are written against Quad9 on exactly these.
    let mut upstream = build_upstream_for(
        &[
            IpAddr::V4(Ipv4Addr::new(9, 9, 9, 9)),
            IpAddr::V4(Ipv4Addr::new(149, 112, 112, 112)),
        ],
        [853, 443, 53],
    )?;

    let [cloudflare_a, cloudflare_b, cleanbrowsing_a, cleanbrowsing_b] =
        BACKUP_UPSTREAM_IPS.map(IpAddr::V4);
    let mut cloudflare = ConnectionConfig::https(Arc::from("family.cloudflare-dns.com"), None);
    cloudflare.port = 443;
    let mut cleanbrowsing = ConnectionConfig::tls(Arc::from("family-filter-dns.cleanbrowsing.org"));
    cleanbrowsing.port = 853;
    for (label, ips, connection) in [
        ("Cloudflare Family DoH", [cloudflare_a, cloudflare_b], cloudflare),
        ("CleanBrowsing Family DoT", [cleanbrowsing_a, cleanbrowsing_b], cleanbrowsing),
    ] {
        upstream.tiers.push(Tier {
            label,
            resolver: build_resolver(&ips, connection)?,
            failures: AtomicU32::new(0),
            down_until: AtomicU64::new(0),
        });
    }
    Ok(upstream)
}

fn build_upstream_for(ips: &[IpAddr], ports: [u16; 3]) -> Result<Upstream> {
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
        cache: ResponseCache::new(4096, TtlConfig::default()),
        router_wanted: AtomicBool::new(false),
        router: RwLock::new(None),
        started: Instant::now(),
        failing_since: AtomicU64::new(0),
    })
}

fn build_resolver(ips: &[std::net::IpAddr], connection: ConnectionConfig) -> Result<TokioResolver> {
    let quad9 = ips
        .iter()
        .map(|ip| NameServerConfig::new(*ip, true, vec![connection.clone()]))
        .collect();
    let config = ResolverConfig::from_parts(None, Vec::new(), quad9);

    let mut opts = ResolverOpts::default();
    // Upstream::cache does the caching; see there for why not here.
    opts.cache_size = 0;
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

/// Asks the tiers directly. While the pin is released, or while the router
/// stands in, no query reaches them, so this is how service_manager learns the
/// upstream is back.
pub async fn upstream_probe() -> bool {
    match upstream() {
        Ok(upstream) => upstream.probe().await,
        Err(_) => false,
    }
}

/// The first address any filtered tier gives for `host`, skipping the
/// blocklist and moving on when a tier says it does not exist. For fetching
/// the blocklists themselves, never for client queries.
pub async fn resolve_bypassing_blocklist(host: &str) -> Option<IpAddr> {
    let name = Name::from_ascii(format!("{host}.")).ok()?;
    let upstream = build_upstream().ok()?;
    for tier in &upstream.tiers {
        if let Ok(lookup) = tier.resolver.lookup(name.clone(), RecordType::A).await {
            if let Some(ip) = lookup.answers().iter().find_map(|record| match &record.data {
                hickory_proto::rr::RData::A(a) => Some(IpAddr::V4(a.0)),
                _ => None,
            }) {
                return Some(ip);
            }
        }
    }
    None
}

pub fn router_fallback_wanted() -> bool {
    UPSTREAM
        .get()
        .is_some_and(|upstream| upstream.router_wanted.load(Ordering::Relaxed))
}

pub fn router_fallback_active() -> bool {
    UPSTREAM
        .get()
        .is_some_and(|upstream| upstream.router_resolver().is_some())
}

/// Called by service_manager once the firewall lets `ips` through on :53, and
/// with none to close the fallback.
pub fn set_router_fallback(ips: &[Ipv4Addr]) {
    if let Some(upstream) = UPSTREAM.get() {
        upstream.set_router(ips, 53);
    }
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
    tokio::spawn(crate::filter_proxy::serve(Arc::clone(&blocklist)));

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
        Ok(answers) => {
            response.metadata.response_code = ResponseCode::NoError;
            response.add_answers(answers);
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
        assert_eq!(upstream.tiers.len(), 5);
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
        assert_eq!(
            labels,
            ["DoT", "DoH", "UDP", "Cloudflare Family DoH", "CleanBrowsing Family DoT"]
        );
        assert!(!UPSTREAM_DOWN.load(Ordering::Relaxed));
    }

    async fn trip_every_breaker(upstream: &Upstream) {
        let name = Name::from_ascii("dead.example.").unwrap();
        for _ in 0..TRIP_AFTER {
            assert!(matches!(upstream.lookup(name.clone(), RecordType::A).await, Err(None)));
        }
        assert!(upstream.router_wanted.load(Ordering::Relaxed));
    }

    /// Answers every A query with 192.0.2.7, like a home router's resolver.
    async fn fake_router_dns() -> u16 {
        fake_dns(ResponseCode::NoError).await
    }

    async fn fake_dns(code: ResponseCode) -> u16 {
        use hickory_proto::rr::RData;

        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = socket.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut buffer = [0_u8; 512];
            while let Ok((size, peer)) = socket.recv_from(&mut buffer).await {
                let request = Message::from_bytes(&buffer[..size]).unwrap();
                let query = request.queries[0].clone();
                let mut response =
                    Message::new(request.metadata.id, MessageType::Response, OpCode::Query);
                response.metadata.recursion_desired = request.metadata.recursion_desired;
                response.metadata.recursion_available = true;
                response.metadata.response_code = code;
                if code == ResponseCode::NoError {
                    response.add_answer(Record::from_rdata(
                        query.name().clone(),
                        60,
                        RData::A(Ipv4Addr::new(192, 0, 2, 7).into()),
                    ));
                }
                response.add_query(query);
                let _ = socket.send_to(&response.to_bytes().unwrap(), peer).await;
            }
        });
        port
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_router_answers_once_every_tier_is_down_and_steps_aside_when_one_returns() {
        let upstream = build_upstream_for(&[IpAddr::V4(Ipv4Addr::LOCALHOST)], [1, 1, 1])
            .expect("upstream should build");
        let name = Name::from_ascii("example.com.").unwrap();

        // Down but not yet opened by service_manager: still a plain failure.
        trip_every_breaker(&upstream).await;
        assert!(matches!(upstream.lookup(name.clone(), RecordType::A).await, Err(None)));

        upstream.set_router(&[Ipv4Addr::LOCALHOST], fake_router_dns().await);
        let started = Instant::now();
        let answers = upstream.lookup(name.clone(), RecordType::A).await.expect("router answers");
        assert!(started.elapsed() < UPSTREAM_TIMEOUT, "the dead tiers must be skipped");
        assert_eq!(answers[0].data, Ipv4Addr::new(192, 0, 2, 7).into());
        // A router answer says nothing about the filtered tiers.
        assert!(upstream.tiers.iter().all(|tier| tier.failures.load(Ordering::Relaxed) >= TRIP_AFTER));

        upstream.answered(&upstream.tiers[0]);
        assert!(!upstream.router_wanted.load(Ordering::Relaxed));
        assert!(upstream.router_resolver().is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_servfail_for_one_name_is_an_answer_not_an_outage() {
        let servfail = fake_dns(ResponseCode::ServFail).await;
        let upstream = build_upstream_for(&[IpAddr::V4(Ipv4Addr::LOCALHOST)], [1, 1, servfail])
            .expect("upstream should build");
        let name = Name::from_ascii("broken-dnssec.example.").unwrap();

        for _ in 0..TRIP_AFTER * 2 {
            assert_eq!(
                upstream.lookup(name.clone(), RecordType::A).await,
                Err(Some(ResponseCode::ServFail))
            );
        }
        assert_eq!(upstream.tiers[2].failures.load(Ordering::Relaxed), 0);
        assert_eq!(upstream.tiers[2].down_until.load(Ordering::Relaxed), 0);
        assert!(!upstream.router_wanted.load(Ordering::Relaxed));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_cached_answer_does_not_close_the_breakers() {
        use hickory_proto::rr::RData;

        let upstream = build_upstream_for(&[IpAddr::V4(Ipv4Addr::LOCALHOST)], [1, 1, 1])
            .expect("upstream should build");
        trip_every_breaker(&upstream).await;
        let name = Name::from_ascii("cached.example.").unwrap();
        let mut message = Message::response(0, OpCode::Query);
        message.add_query(Query::query(name.clone(), RecordType::A));
        message.add_answer(Record::from_rdata(
            name.clone(),
            300,
            RData::A(Ipv4Addr::new(192, 0, 2, 9).into()),
        ));
        upstream.cache.insert(Query::query(name.clone(), RecordType::A), Ok(message), Instant::now());

        upstream.lookup(name, RecordType::A).await.expect("served from the cache");

        assert!(upstream.router_wanted.load(Ordering::Relaxed));
        for tier in &upstream.tiers {
            assert!(tier.down_until.load(Ordering::Relaxed) > 0, "{} closed on a cache hit", tier.label);
            assert!(tier.failures.load(Ordering::Relaxed) >= TRIP_AFTER);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn router_answers_do_not_outlive_the_fallback() {
        let upstream = build_upstream_for(&[IpAddr::V4(Ipv4Addr::LOCALHOST)], [1, 1, 1])
            .expect("upstream should build");
        trip_every_breaker(&upstream).await;
        upstream.set_router(&[Ipv4Addr::LOCALHOST], fake_router_dns().await);
        let name = Name::from_ascii("via-router.example.").unwrap();
        upstream.lookup(name.clone(), RecordType::A).await.expect("router answers");

        upstream.set_router(&[], 53);
        assert!(matches!(upstream.lookup(name, RecordType::A).await, Err(None)));
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
