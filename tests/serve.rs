//! `cooee-drover` run as cooee runs it: against a fake herdsman `/api/v1`, each plugin's module and data asked for
//! with right and wrong tokens, over HTTP/1.0 one connection per call.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;

const PLUGINS: [&str; 4] = ["queue", "lanes", "asks", "fleets"];

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
    drover_with(herdsman, &[])
}

fn drover_with(herdsman: &str, envs: &[(&str, &str)]) -> Drover {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_cooee-drover"));
    cmd.env("DROVER_ADDR", "127.0.0.1:0")
        .env("HERDSMAN", herdsman)
        .envs(envs.iter().copied());
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

/// A fake herdsman answering one call: `answer` writes the reply; the request it saw (head, and a POST's body) comes
/// back on the channel.
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
        let n = head
            .lines()
            .find_map(|l| l.strip_prefix("content-length: "))
            .map_or(0, |n| n.parse().unwrap());
        let mut body = vec![0; n];
        r.read_exact(&mut body).unwrap();
        tx.send(head + &String::from_utf8(body).unwrap()).unwrap();
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
fn a_form_op_posts_to_herdsman_with_its_body_and_the_paired_cookie() {
    let (url, seen) = herdsman(|c| {
        c.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
            .unwrap();
    });
    let d = drover_with(&url, &[("HERDSMAN_COOKIE", "hd=paired-device")]);
    let form = "fleet=f&mtime=1";
    let mut c = TcpStream::connect(&d.1).unwrap();
    let auth = token("queue");
    write!(
        c,
        "POST /api/v1/pause HTTP/1.0\r\nAuthorization: Bearer {auth}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n\r\n{form}",
        form.len()
    )
    .unwrap();
    let mut out = String::new();
    c.read_to_string(&mut out).unwrap();
    assert!(out.starts_with("HTTP/1.1 200 OK"), "{out}");
    let host = url.trim_start_matches("http://");
    assert_eq!(
        seen.recv().unwrap(),
        format!(
            "POST /api/v1/pause HTTP/1.0\r\nHost: {host}\r\ncontent-type: application/x-www-form-urlencoded\r\ncookie: hd=paired-device\r\ncontent-length: 15\r\n\r\n{form}"
        )
    );
}

#[test]
fn only_api_v1_takes_a_post() {
    let d = drover("http://127.0.0.1:9");
    let mut c = TcpStream::connect(&d.1).unwrap();
    let auth = token("queue");
    write!(
        c,
        "POST /queue.js HTTP/1.0\r\nAuthorization: Bearer {auth}\r\n\r\n"
    )
    .unwrap();
    let mut out = String::new();
    c.read_to_string(&mut out).unwrap();
    assert!(out.starts_with("HTTP/1.0 405 Method Not Allowed"), "{out}");
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

#[test]
fn a_design_png_comes_back_as_a_data_url_and_a_missing_one_as_404() {
    let png: &[u8] = &[0x89, b'P', b'N', b'G', 0, 0xff, 1];
    let (url, seen) = herdsman(move |c| {
        write!(
            c,
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\n\r\n",
            png.len()
        )
        .unwrap();
        c.write_all(png).unwrap();
    });
    let d = drover_with(&url, &[("HERDSMAN_COOKIE", "hd=paired-device")]);
    let (status, body) = get(&d.1, "/design/fleet-1/4/0", Some(&token("asks")));
    assert_eq!(status, "HTTP/1.0 200 OK");
    assert_eq!(body, "data:image/png;base64,iVBORwD/AQ==");
    let head = seen.recv().unwrap();
    assert!(
        head.starts_with("GET /design/fleet-1/4/0 HTTP/1.0\r\n"),
        "{head}"
    );
    assert!(head.contains("cookie: hd=paired-device\r\n"), "{head}");

    let (url, _seen) = herdsman(|c| {
        c.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 19\r\n\r\nno such screenshot\n")
            .unwrap();
    });
    let d = drover(&url);
    assert_eq!(
        get(&d.1, "/shot/fleet-1/4/9", Some(&token("asks"))).0,
        "HTTP/1.0 404 Not Found"
    );
}

/// A fake server answering `answers` in turn, one connection each; each request it saw comes back on the channel.
fn replies(answers: Vec<String>) -> (String, mpsc::Receiver<String>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", l.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for a in answers {
            let (mut c, _) = l.accept().unwrap();
            let mut r = BufReader::new(c.try_clone().unwrap());
            let mut head = String::new();
            while r.read_line(&mut head).unwrap() > 2 {}
            let n = head
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .map(|n| n.parse().unwrap())
                })
                .unwrap_or(0);
            let mut body = vec![0; n];
            r.read_exact(&mut body).unwrap();
            let _ = tx.send(head + &String::from_utf8(body).unwrap());
            write!(
                c,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{a}",
                a.len()
            )
            .unwrap();
        }
    });
    (url, rx)
}

#[test]
fn an_undelivered_answer_after_start_is_pushed_through_cooee() {
    let ev = |seq: u32, kind: &str, plain: &str| {
        format!(
            r#"{{"seq":{seq},"ts":1,"fleet":"f","issue":4,"type":"{kind}","data":{{"id":"q1","reason":"lane gone"}},"text":"x","plain":"{plain}"}}"#
        )
    };
    let old = ev(3, "answer-undelivered", "an old one");
    let new = [
        ev(6, "answer-delivered", "f #4 answer-delivered: "),
        ev(
            7,
            "answer-undelivered",
            r#"f #4 answer-undelivered: \"q1\" lane gone"#,
        ),
    ];
    let (cooee, pushed) = replies(vec![r#"{"ok":true}"#.into()]);
    let (url, seen) = replies(vec![
        format!(r#"{{"seq":5,"refresh":false,"list":[{old}]}}"#),
        format!(r#"{{"seq":7,"refresh":false,"list":[{}]}}"#, new.join(",")),
    ]);
    let _d = drover_with(&url, &[("COOEE", &cooee), ("DROVER_POLL_SECS", "0")]);
    assert!(
        seen.recv()
            .unwrap()
            .starts_with("GET /api/v1/events?since=0 HTTP/1.0\r\n")
    );
    assert!(
        seen.recv()
            .unwrap()
            .starts_with("GET /api/v1/events?since=5 HTTP/1.0\r\n")
    );
    let push = pushed.recv().unwrap();
    assert!(push.starts_with("POST /plugin/push HTTP/1.0\r\n"), "{push}");
    assert!(
        push.contains(&format!("Authorization: Bearer {}\r\n", token("asks"))),
        "{push}"
    );
    assert!(
        push.ends_with(
            r#"{"text":"f #4 answer-undelivered: \"q1\" lane gone","path":"undelivered"}"#
        ),
        "only the new undelivered one, its line as herdsman words it: {push}"
    );
    assert!(
        pushed
            .recv_timeout(std::time::Duration::from_millis(300))
            .is_err(),
        "pushed once"
    );
}
