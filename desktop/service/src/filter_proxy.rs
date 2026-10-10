//! Chromium browsers have no blocker extension, so their policy points them at
//! this local proxy, which refuses blocked hosts and tunnels the rest. The
//! browser hands it the host name, so it holds whatever owns DNS, a VPN app
//! included, and the traffic still leaves through that VPN.

use anyhow::{anyhow, Context, Result};
use libreascent_shared::blocklist::DomainBlocklist;
use std::sync::{Arc, RwLock};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout, Duration};

pub const PROXY_ADDR: &str = "127.0.0.1:47714";
const MAX_HEAD: usize = 16 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(10);

pub async fn serve(blocklist: Arc<RwLock<DomainBlocklist>>) {
    let listener = match TcpListener::bind(PROXY_ADDR).await {
        Ok(listener) => listener,
        Err(error) => {
            crate::dns_manager::log_tamper_event(&format!(
                "Browser filter proxy cannot bind {PROXY_ADDR}: {error}"
            ));
            return;
        }
    };
    loop {
        let Ok((client, _)) = listener.accept().await else {
            continue;
        };
        let blocklist = Arc::clone(&blocklist);
        tokio::spawn(async move {
            let _ = handle(client, blocklist).await;
        });
    }
}

async fn handle(mut client: TcpStream, blocklist: Arc<RwLock<DomainBlocklist>>) -> Result<()> {
    let mut buffer = Vec::with_capacity(4096);
    let head_end = timeout(IO_TIMEOUT, read_head(&mut client, &mut buffer)).await??;
    let head = std::str::from_utf8(&buffer[..head_end]).context("request head is not UTF-8")?;
    let request = parse_request(head).ok_or_else(|| anyhow!("unsupported proxy request"))?;

    let blocked = blocklist.read().map(|list| list.is_blocked(&request.host)).unwrap_or(false);
    if blocked {
        client
            .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    }

    let mut upstream =
        timeout(IO_TIMEOUT, TcpStream::connect((request.host.as_str(), request.port))).await??;
    match request.forward_head {
        None => client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").await?,
        Some(head) => upstream.write_all(head.as_bytes()).await?,
    }
    upstream.write_all(&buffer[head_end..]).await?;
    tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
    Ok(())
}

/// Reads until the blank line ending the request head; returns its length.
async fn read_head(client: &mut TcpStream, buffer: &mut Vec<u8>) -> Result<usize> {
    let mut chunk = [0_u8; 4096];
    loop {
        if let Some(end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            return Ok(end + 4);
        }
        if buffer.len() > MAX_HEAD {
            return Err(anyhow!("request head too large"));
        }
        let read = client.read(&mut chunk).await?;
        if read == 0 {
            return Err(anyhow!("client closed before the request head"));
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
}

#[derive(Debug, PartialEq)]
struct ProxyRequest {
    host: String,
    port: u16,
    /// The head to send upstream for plain HTTP; None for a CONNECT tunnel.
    forward_head: Option<String>,
}

fn parse_request(head: &str) -> Option<ProxyRequest> {
    let (first, rest) = head.split_once("\r\n")?;
    let mut parts = first.split(' ');
    let (method, target, version) = (parts.next()?, parts.next()?, parts.next()?);

    if method.eq_ignore_ascii_case("CONNECT") {
        let (host, port) = split_host_port(target, 443)?;
        return Some(ProxyRequest { host, port, forward_head: None });
    }

    // Plain HTTP arrives in absolute form; the server wants origin form.
    let without_scheme = target.strip_prefix("http://")?;
    let (authority, path) = match without_scheme.find('/') {
        Some(slash) => (&without_scheme[..slash], &without_scheme[slash..]),
        None => (without_scheme, "/"),
    };
    let (host, port) = split_host_port(authority, 80)?;
    let headers: Vec<&str> = rest
        .split("\r\n")
        .filter(|line| !line.is_empty() && !line.to_ascii_lowercase().starts_with("proxy-connection:"))
        .collect();
    Some(ProxyRequest {
        host,
        port,
        forward_head: Some(format!("{method} {path} {version}\r\n{}\r\n\r\n", headers.join("\r\n"))),
    })
}

fn split_host_port(authority: &str, default_port: u16) -> Option<(String, u16)> {
    let (host, port) = if let Some(stripped) = authority.strip_prefix('[') {
        let (host, rest) = stripped.split_once(']')?;
        (host, rest.strip_prefix(':').map(str::parse).transpose().ok()?)
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => (host, Some(port.parse().ok()?)),
            None => (authority, None),
        }
    };
    (!host.is_empty()).then(|| (host.to_ascii_lowercase(), port.unwrap_or(default_port)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_requests_name_their_host_and_port() {
        let request = parse_request("CONNECT www.example.com:443 HTTP/1.1\r\nHost: www.example.com:443\r\n\r\n").unwrap();
        assert_eq!(request.host, "www.example.com");
        assert_eq!(request.port, 443);
        assert_eq!(request.forward_head, None);
    }

    #[test]
    fn plain_http_is_rewritten_to_origin_form_without_proxy_headers() {
        let request = parse_request(
            "GET http://Example.com/a?b=1 HTTP/1.1\r\nHost: example.com\r\nProxy-Connection: keep-alive\r\n\r\n",
        )
        .unwrap();
        assert_eq!(request.host, "example.com");
        assert_eq!(request.port, 80);
        assert_eq!(request.forward_head.unwrap(), "GET /a?b=1 HTTP/1.1\r\nHost: example.com\r\n\r\n");
    }

    #[test]
    fn ipv6_and_explicit_ports_parse() {
        assert_eq!(split_host_port("[::1]:8443", 443), Some(("::1".to_string(), 8443)));
        assert_eq!(split_host_port("site.test:8080", 80), Some(("site.test".to_string(), 8080)));
        assert_eq!(split_host_port("site.test", 80), Some(("site.test".to_string(), 80)));
        assert_eq!(parse_request("GET ftp://x/ HTTP/1.1\r\n\r\n"), None);
    }
}
