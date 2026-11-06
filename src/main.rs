//! `cooee-drover`: one backend for drover's four cooee plugins (cooee docs/plugins.md). It serves each plugin's UI
//! module (`/queue.js`, `/lanes.js`, `/asks.js`, `/fleets.js`) to that plugin's bearer token only, and forwards
//! `GET /api/v1/*` (JSON or the SSE event stream) and `POST /api/v1/<op>` (a form op) to herdsman for any of them.
//! It never reads herdsman's files.
//!
//! Configuration is the environment: `DROVER_ADDR` (default `127.0.0.1:4810`), `HERDSMAN` (herdsman's base URL,
//! default `http://127.0.0.1:7777`), a token per plugin, `DROVER_<QUEUE|LANES|ASKS|FLEETS>_TOKEN` (a plugin without
//! one is not served), and `HERDSMAN_COOKIE`, a paired device's cookie herdsman wants for its paired ops (drive,
//! answer, bqueue, …).
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;
use std::{env, process, thread};

/// The plugins: cooee's entry `drover-<name>` loads module `/<name>.js`, built from `web/src/<name>.ts`.
const PLUGINS: [(&str, &str); 4] = [
    ("queue", include_str!("../web/dist/queue.js")),
    ("lanes", include_str!("../web/dist/lanes.js")),
    ("asks", include_str!("../web/dist/asks.js")),
    ("fleets", include_str!("../web/dist/fleets.js")),
];

struct Config {
    herdsman: String,
    cookie: Option<String>,
    tokens: Vec<(&'static str, String)>,
}

fn main() {
    let addr = env::var("DROVER_ADDR").unwrap_or_else(|_| "127.0.0.1:4810".into());
    let herdsman = env::var("HERDSMAN").unwrap_or_else(|_| "http://127.0.0.1:7777".into());
    let tokens = PLUGINS
        .iter()
        .filter_map(|(p, _)| {
            Some((
                *p,
                env::var(format!("DROVER_{}_TOKEN", p.to_uppercase())).ok()?,
            ))
        })
        .collect();
    let cookie = env::var("HERDSMAN_COOKIE").ok();
    let cfg = Config {
        herdsman,
        cookie,
        tokens,
    };
    if let Err(e) = cfg.check().and_then(|()| serve(&cfg, &addr)) {
        eprintln!("cooee-drover: {e}");
        process::exit(1);
    }
}

impl Config {
    /// cooee's own rules for a token (at least 16 characters), and one token per plugin so each is told apart.
    fn check(&self) -> io::Result<()> {
        let bad = |m: String| Err(io::Error::other(m));
        if self.tokens.is_empty() {
            return bad("no DROVER_<PLUGIN>_TOKEN is set".into());
        }
        if !self.herdsman.starts_with("http://") {
            return bad(format!(
                "HERDSMAN must be an http:// URL, not {}",
                self.herdsman
            ));
        }
        for (i, (p, t)) in self.tokens.iter().enumerate() {
            if t.len() < 16 {
                return bad(format!(
                    "DROVER_{}_TOKEN is under 16 characters",
                    p.to_uppercase()
                ));
            }
            if self.tokens[..i].iter().any(|(_, u)| u == t) {
                return bad(format!(
                    "DROVER_{}_TOKEN is another plugin's token",
                    p.to_uppercase()
                ));
            }
        }
        Ok(())
    }

    /// The plugin whose token `auth` (an `Authorization` value) carries.
    fn plugin(&self, auth: &str) -> Option<&'static str> {
        let given = auth.strip_prefix("Bearer ")?.as_bytes();
        let same = |t: &[u8]| {
            t.len() == given.len() && t.iter().zip(given).fold(0, |d, (a, b)| d | (a ^ b)) == 0
        };
        self.tokens
            .iter()
            .find(|(_, t)| same(t.as_bytes()))
            .map(|(p, _)| *p)
    }
}

fn serve(cfg: &Config, addr: &str) -> io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    println!("cooee-drover on http://{}", listener.local_addr()?);
    thread::scope(|s| {
        for c in listener.incoming().flatten() {
            s.spawn(move || {
                // A client gone mid-reply is no error of ours.
                let _ = handle(cfg, c);
            });
        }
    });
    Ok(())
}

/// One request (cooee calls over HTTP/1.0, one connection each): a GET, or a POST to `/api/v1/` with its body.
fn handle(cfg: &Config, mut c: TcpStream) -> io::Result<()> {
    c.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut head = Vec::new();
    let mut r = BufReader::new(c.try_clone()?).take(16 * 1024);
    loop {
        let mut line = String::new();
        if r.read_line(&mut line)? == 0 || line.trim().is_empty() {
            break;
        }
        head.push(line.trim_end().to_owned());
    }
    let (method, path) = head
        .first()
        .and_then(|l| l.split_once(' '))
        .unwrap_or_default();
    let path = path.split(' ').next().unwrap_or_default();
    let header = |k: &str| {
        head.iter().skip(1).find_map(|l| {
            let (n, v) = l.split_once(':')?;
            n.eq_ignore_ascii_case(k).then(|| v.trim())
        })
    };
    let Some(plugin) = header("authorization").and_then(|a| cfg.plugin(a)) else {
        return reply(&mut c, "401 Unauthorized", "text/plain", "no token");
    };
    let api = path.starts_with("/api/v1/");
    if method != "GET" && !(method == "POST" && api) {
        return reply(
            &mut c,
            "405 Method Not Allowed",
            "text/plain",
            "GET, or POST to /api/v1/",
        );
    }
    if api {
        let mut body = Vec::new();
        if method == "POST" {
            let n = header("content-length").and_then(|n| n.parse::<u64>().ok());
            r.into_inner()
                .take(n.unwrap_or(0).min(64 * 1024))
                .read_to_end(&mut body)?;
        }
        let len = (method == "POST").then(|| body.len().to_string());
        let pass: String = ["accept", "last-event-id", "content-type"]
            .map(|k| (k, header(k)))
            .into_iter()
            .chain([
                ("cookie", cfg.cookie.as_deref()),
                ("content-length", len.as_deref()),
            ])
            .filter_map(|(k, v)| Some(format!("{k}: {}\r\n", v?)))
            .collect();
        return forward(&cfg.herdsman, method, path, &pass, &body, &mut c);
    }
    match PLUGINS
        .iter()
        .find(|(p, _)| path.strip_prefix('/').and_then(|f| f.strip_suffix(".js")) == Some(p))
    {
        Some((p, js)) if *p == plugin => reply(&mut c, "200 OK", "text/javascript", js),
        Some(_) => reply(
            &mut c,
            "401 Unauthorized",
            "text/plain",
            "another plugin's module",
        ),
        None => reply(&mut c, "404 Not Found", "text/plain", "no such path"),
    }
}

fn reply(c: &mut TcpStream, status: &str, kind: &str, body: &str) -> io::Result<()> {
    let n = body.len();
    write!(
        c,
        "HTTP/1.0 {status}\r\nContent-Type: {kind}\r\nContent-Length: {n}\r\nCache-Control: no-store\r\n\r\n{body}"
    )
}

/// `method path` on herdsman over HTTP/1.0, its whole answer (status, headers, body or event stream) copied back as
/// it comes.
fn forward(
    base: &str,
    method: &str,
    path: &str,
    pass: &str,
    body: &[u8],
    c: &mut TcpStream,
) -> io::Result<()> {
    let host = base
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or_default();
    let addr = if host.contains(':') {
        host.to_owned()
    } else {
        format!("{host}:80")
    };
    let Ok(mut up) = TcpStream::connect(addr) else {
        return reply(
            c,
            "502 Bad Gateway",
            "text/plain",
            "herdsman is unreachable",
        );
    };
    write!(up, "{method} {path} HTTP/1.0\r\nHost: {host}\r\n{pass}\r\n")?;
    up.write_all(body)?;
    io::copy(&mut up, c).map(drop)
}
