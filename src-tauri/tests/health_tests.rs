use illama_lib::health::{check_http_health, find_available_port, is_port_available};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
};

#[test]
fn health_requires_an_http_200_response_not_just_an_open_port() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let _ = stream.write_all(b"not an http server");
        }
    });

    let health = check_http_health("127.0.0.1", port, 500);

    assert!(!health.healthy);
}

#[test]
fn health_accepts_successful_http_health_endpoint() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            read_request(&mut stream);
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\n{\"status\":\"ok\"}");
        }
    });

    let health = check_http_health("127.0.0.1", port, 500);

    assert!(health.healthy);
}

#[test]
fn available_port_helper_moves_past_an_occupied_port() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let occupied = listener.local_addr().unwrap().port();

    assert!(!is_port_available("127.0.0.1", occupied));

    let available = find_available_port("127.0.0.1", occupied, 20).unwrap();

    assert_ne!(available, occupied);
    assert!(is_port_available("127.0.0.1", available));
}

fn read_request(stream: &mut TcpStream) {
    let mut buffer = [0_u8; 512];
    let _ = stream.read(&mut buffer);
}
