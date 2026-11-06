//! `cooee-drover` run as cooee runs it: against a fake herdsman `/api/v1`, each plugin's module and data asked for
//! with right and wrong tokens, over HTTP/1.0 one connection per call.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;

const PLUGINS: [&str; 4] = ["queue", "lanes", "asks", "system"];

fn token(p: &str) -> String {
    format!("{p}-token-0123456789abcdef")
}

/// The backend on a free port, pointed at `herdsman`; killed on drop.
struct Drover(Child, String);

impl Drop for Drover {
    fn drop(&mut self) {
        let _ = self.0.kill();
    }
}

fn drover(herdsman: &str) -> Drover {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_cooee-drover"));
    cmd.env("DROVER_ADDR", "127.0.0.1:0")
        .env("HERDSMAN", herdsman);
    for p in PLUGINS {
        cmd.env(format!("DROVER_{}_TOKEN", p.to_uppercase()), token(p));
    }
    let mut child = cmd.stdout(Stdio::piped()).spawn().unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let addr = line.trim().rsplit("http://").next().unwrap().to_owned();
    Drover(child, addr)
}

fn call(addr: &str, path: &str, auth: Option<&str>) -> TcpStream {
    let mut c = TcpStream::connect(addr).unwrap();
    let auth = auth
        .map(|t| format!("Authorization: Bearer {t}\r\n"))
        .unwrap_or_default();
    write!(c, "GET {path} HTTP/1.0\r\nAccept: */*\r\n{auth}\r\n").unwrap();
    c
}

/// `(status line, body)`.
fn get(addr: &str, path: &str, auth: Option<&str>) -> (String, String) {
    let mut out = String::new();
    call(addr, path, auth).read_to_string(&mut out).unwrap();
    let (head, body) = out.split_once("\r\n\r\n").unwrap();
    (head.lines().next().unwrap().to_owned(), body.to_owned())
}

/// A fake herdsman answering one call: `answer` writes the reply; the request head it saw comes back on the channel.
fn herdsman(
    answer: impl FnOnce(&mut TcpStream) + Send + 'static,
) -> (String, mpsc::Receiver<String>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", l.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let (mut c, _) = l.accept().unwrap();
        let mut head = String::new();
        let mut r = BufReader::new(c.try_clone().unwrap());
        while r.read_line(&mut head).unwrap() > 2 {}
        tx.send(head).unwrap();
        answer(&mut c);
    });
    (url, rx)
}

#[test]
fn each_module_is_served_to_its_own_token_only() {
    let d = drover("http://127.0.0.1:9");
    for p in PLUGINS {
        let path = format!("/{p}.js");
        assert_eq!(
            get(&d.1, &path, None).0,
            "HTTP/1.0 401 Unauthorized",
            "{p} without a token"
        );
        assert_eq!(
            get(&d.1, &path, Some("wrong-token-0123456789")).0,
            "HTTP/1.0 401 Unauthorized",
            "{p}"
        );
        for other in PLUGINS.iter().filter(|o| **o != p) {
            let (status, _) = get(&d.1, &path, Some(&token(other)));
            assert_eq!(
                status, "HTTP/1.0 401 Unauthorized",
                "{p}'s module with {other}'s token"
            );
        }
        let (status, body) = get(&d.1, &path, Some(&token(p)));
        assert_eq!(status, "HTTP/1.0 200 OK", "{p} with its token");
        let built = std::fs::read_to_string(format!("web/dist/{p}.js")).unwrap();
        assert_eq!(body, built, "{p}.js is the committed bundle");
        assert!(
            !body.to_ascii_lowercase().contains("</script"),
            "cooee refuses a module with </script"
        );
    }
}

#[test]
fn api_v1_goes_to_herdsman_without_the_token() {
    let state = std::fs::read_to_string("web/fixtures/state.json").unwrap();
    let body = state.clone();
    let (url, seen) = herdsman(move |c| {
        let n = body.len();
        write!(
            c,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {n}\r\n\r\n{body}"
        )
        .unwrap();
    });
    let d = drover(&url);
    assert_eq!(
        get(&d.1, "/api/v1/state", None).0,
        "HTTP/1.0 401 Unauthorized"
    );
    let (status, got) = get(&d.1, "/api/v1/state", Some(&token("asks")));
    assert_eq!((status.as_str(), got), ("HTTP/1.1 200 OK", state));
    let head = seen.recv().unwrap();
    let host = url.trim_start_matches("http://");
    assert!(
        head.starts_with(&format!(
            "GET /api/v1/state HTTP/1.0\r\nHost: {host}\r\naccept: */*\r\n"
        )),
        "{head}"
    );
    assert!(
        !head.to_ascii_lowercase().contains("authorization"),
        "cooee's token stays here: {head}"
    );
}

#[test]
fn the_event_stream_passes_through_as_it_comes() {
    let (more, wait) = mpsc::channel::<()>();
    let (url, _seen) = herdsman(move |c| {
        c.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\nid: 1\ndata: {}\n\n",
        )
        .unwrap();
        wait.recv().unwrap(); // the second event only once the first has arrived through the backend
        c.write_all(b"id: 2\ndata: {}\n\n").unwrap();
    });
    let d = drover(&url);
    let mut r = BufReader::new(call(&d.1, "/api/v1/events?after=0", Some(&token("queue"))));
    let mut got = String::new();
    while !got.ends_with("id: 1\ndata: {}\n\n") {
        assert!(
            r.read_line(&mut got).unwrap() > 0,
            "closed before the first event: {got}"
        );
    }
    assert!(got.contains("text/event-stream"), "{got}");
    more.send(()).unwrap();
    r.read_to_string(&mut got).unwrap();
    assert!(got.ends_with("id: 2\ndata: {}\n\n"), "{got}");
}

#[test]
fn herdsman_down_is_a_502() {
    let free = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap();
    let d = drover(&format!("http://{free}"));
    assert_eq!(
        get(&d.1, "/api/v1/state", Some(&token("lanes"))).0,
        "HTTP/1.0 502 Bad Gateway"
    );
}

#[test]
fn a_short_or_shared_token_or_none_refuses_to_start() {
    let run = |envs: &[(&str, &str)]| {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_cooee-drover"));
        cmd.env("DROVER_ADDR", "127.0.0.1:0");
        for p in PLUGINS {
            cmd.env_remove(format!("DROVER_{}_TOKEN", p.to_uppercase()));
        }
        let out = cmd.envs(envs.iter().copied()).output().unwrap();
        (out.status.code(), String::from_utf8(out.stderr).unwrap())
    };
    let (code, err) = run(&[]);
    assert_eq!(code, Some(1), "{err}");
    assert!(err.contains("no DROVER_<PLUGIN>_TOKEN"), "{err}");
    let (code, err) = run(&[("DROVER_QUEUE_TOKEN", "short")]);
    assert_eq!(code, Some(1), "{err}");
    assert!(err.contains("under 16 characters"), "{err}");
    let same = token("queue");
    let (code, err) = run(&[("DROVER_QUEUE_TOKEN", &same), ("DROVER_ASKS_TOKEN", &same)]);
    assert_eq!(code, Some(1), "{err}");
    assert!(err.contains("another plugin's token"), "{err}");
}
