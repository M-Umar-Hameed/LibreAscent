use anyhow::{Context, Result};
use hickory_proto::op::{Message, MessageType, OpCode, ResponseCode};
use hickory_proto::serialize::binary::{BinDecodable, BinEncodable};
use hickory_resolver::TokioResolver;
use hickory_resolver::config::{ConnectionConfig, NameServerConfig, ResolverConfig, ResolverOpts};
use hickory_resolver::net::runtime::TokioRuntimeProvider;
use hickory_resolver::net::{DnsError, NetError};
use libreascent_shared::blocklist::DomainBlocklist;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

use crate::config_loader;

const LOCAL_PROXY_TIMEOUT: Duration = Duration::from_secs(5);

/// Upstream resolver. Forwards over DNS-over-TLS to Quad9 (9.9.9.9:853). The
/// firewall (firewall_manager) seals plaintext :53 and DoH/DoT to every other
/// resolver but leaves Quad9:853 reachable, so this choice must stay Quad9 to
/// match that exemption. The pooled connection and response cache keep steady
/// -state latency close to plain UDP by avoiding a TLS handshake per query.
fn build_upstream_resolver() -> Result<TokioResolver> {
    use std::net::{IpAddr, Ipv4Addr};

    // IPv4-only Quad9 DoT endpoints. Talking to the upstream over IPv4 avoids a
    // hard failure on hosts without an IPv6 route; clients still receive AAAA
    // records normally. 9.9.9.9 is what the firewall leaves reachable on :853.
    let server_name: Arc<str> = Arc::from("dns.quad9.net");
    let quad9 = [
        IpAddr::V4(Ipv4Addr::new(9, 9, 9, 9)),
        IpAddr::V4(Ipv4Addr::new(149, 112, 112, 112)),
    ]
    .into_iter()
    .map(|ip| {
        let mut connection = ConnectionConfig::tls(Arc::clone(&server_name));
        // Set explicitly rather than relying on the protocol default: the
        // firewall exemption is written against Quad9 on :853.
        connection.port = 853;
        NameServerConfig::new(ip, true, vec![connection])
    })
    .collect();
    let config = ResolverConfig::from_parts(None, Vec::new(), quad9);

    let mut opts = ResolverOpts::default();
    opts.cache_size = 1024;
    TokioResolver::builder_with_config(config, TokioRuntimeProvider::default())
        .with_options(opts)
        .build()
        .context("failed to build upstream DNS resolver")
}

pub struct BlockedDnsResponse {
    pub domain: String,
    pub response: Vec<u8>,
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

    let socket = match UdpSocket::bind(bind)
        .await
        .context("failed to bind DNS proxy")
    {
        Ok(socket) => {
            if let Some(sender) = ready {
                let _ = sender.send(Ok(()));
            }
            Arc::new(socket)
        }
        Err(error) => {
            if let Some(sender) = ready {
                let _ = sender.send(Err(error.to_string()));
            }
            return Err(error);
        }
    };
    let broadcast_socket = UdpSocket::bind("127.0.0.1:0").await.ok();
    let mut buffer = vec![0_u8; 4096];
    let blocklist = Arc::new(config_loader::load_blocklist(&config_path));
    let resolver = Arc::new(build_upstream_resolver()?);
    crate::dns_manager::log_tamper_event("DNS proxy started. Blocklist loaded.");

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

        match build_block_response_if_needed(&request, &blocklist) {
            Ok(Some(blocked)) => {
                crate::dns_manager::log_tamper_event(&format!(
                    "Blocked DNS: {domain} ({request_id:04x})",
                    domain = blocked.domain
                ));
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

async fn resolve_via_upstream(resolver: &TokioResolver, request: &[u8]) -> Result<Vec<u8>> {
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
        Err(NetError::Dns(DnsError::NoRecordsFound(no_records))) => {
            response.metadata.response_code = no_records.response_code;
        }
        Err(_) => {
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

    // Live check: resolves through the real Quad9 DoT upstream. Ignored so CI
    // never depends on the network. Run with:
    //   cargo test -p libreascent-service resolves_via_quad9_dot -- --ignored --nocapture
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore]
    async fn resolves_via_quad9_dot() {
        let resolver = build_upstream_resolver().expect("resolver should build");
        let request = dns_query("example.com.");

        let response_bytes = resolve_via_upstream(&resolver, &request)
            .await
            .expect("upstream should resolve");
        let response = Message::from_bytes(&response_bytes).expect("response should parse");

        assert_eq!(response.metadata.response_code, ResponseCode::NoError);
        assert!(
            !response.answers.is_empty(),
            "expected at least one A record from Quad9 DoT"
        );
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
}
