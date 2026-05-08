use serde::{Deserialize, Serialize};
use std::{
    io::{self, Read, Write},
    net::{TcpListener, TcpStream, ToSocketAddrs},
    time::Duration,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    pub healthy: bool,
    pub message: String,
}

pub fn check_http_health(host: &str, port: u16, timeout_ms: u64) -> HealthStatus {
    match http_get(host, port, "/health", timeout_ms) {
        Ok(response) if (200..300).contains(&response.status_code) => HealthStatus {
            healthy: true,
            message: "本地 llama-server /health 已就绪。".to_string(),
        },
        Ok(response) => HealthStatus {
            healthy: false,
            message: format!("健康检查返回 HTTP {}。", response.status_code),
        },
        Err(error) => HealthStatus {
            healthy: false,
            message: error.to_string(),
        },
    }
}

pub fn is_port_available(host: &str, port: u16) -> bool {
    TcpListener::bind(format!("{host}:{port}")).is_ok()
}

pub fn find_available_port(host: &str, preferred: u16, search_window: u16) -> Option<u16> {
    let start = preferred.max(1024);
    let end = preferred.saturating_add(search_window).max(start);
    (start..=end).find(|port| is_port_available(host, *port))
}

pub fn http_get(host: &str, port: u16, path: &str, timeout_ms: u64) -> io::Result<HttpResponse> {
    let address = format!("{host}:{port}");
    let socket = match address
        .to_socket_addrs()
        .ok()
        .and_then(|mut addresses| addresses.next())
    {
        Some(socket) => socket,
        None => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "无法解析本地服务地址。",
            ));
        }
    };

    let timeout = Duration::from_millis(timeout_ms);
    let mut stream = TcpStream::connect_timeout(&socket, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;

    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let request = format!(
        "GET {normalized_path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes())?;

    let mut response = String::new();
    stream.take(128 * 1024).read_to_string(&mut response)?;
    parse_http_response(&response)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status_code: u16,
    pub body: String,
}

fn parse_http_response(raw: &str) -> io::Result<HttpResponse> {
    let Some((head, body)) = raw.split_once("\r\n\r\n") else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "服务未返回有效 HTTP 响应。",
        ));
    };

    let status_line = head.lines().next().unwrap_or_default();
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "HTTP 状态行无效。"))?;

    Ok(HttpResponse {
        status_code,
        body: body.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::parse_http_response;

    #[test]
    fn parses_basic_http_response() {
        let response =
            parse_http_response("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok").unwrap();

        assert_eq!(response.status_code, 200);
        assert_eq!(response.body, "ok");
    }
}
