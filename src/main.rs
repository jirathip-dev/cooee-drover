//! `cooee-drover`: one backend for drover's four cooee plugins (cooee docs/plugins.md). It serves each plugin's UI
//! module (`/queue.js`, `/lanes.js`, `/asks.js`, `/fleets.js`) to that plugin's bearer token only, and forwards
//! `GET /api/v1/*` (JSON), `GET /live` (#17: herdsman's SSE event stream) and `POST /api/v1/<op>` (a form op) to
//! herdsman for any of them.
//! It never reads herdsman's files.
//!
//! Configuration is the environment: `DROVER_ADDR` (default `127.0.0.1:4810`), `HERDSMAN` (herdsman's base URL,
//! default `http://127.0.0.1:7777`), a token per plugin, `DROVER_<QUEUE|LANES|ASKS|FLEETS>_TOKEN` (a plugin without
//! one is not served), and `HERDSMAN_COOKIE`, a paired device's cookie herdsman wants for its paired ops (drive,
//! answer, bqueue, …).
//!
//! #412 #417: `GET /design/<fleet>/<n>/<i>` and `/shot/<fleet>/<n>/<i>` (a design's PNG, a verdict's screenshot) come
//! back as `data:image/png;base64,…` text: the plugin frame shows `data:` images only, and `cooee.fetch` passes text.
//! #143: with `COOEE` (cooee's base URL) set, herdsman's new `answer-undelivered` events are each pushed through cooee
//! with the asks plugin's token, read every `DROVER_POLL_SECS` (default 30).
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

#[derive(Clone)]
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
    // herdsman#539: a retired tab's token (0.1's `DROVER_SYSTEM_TOKEN`) is a warning, never a failed start.
    for (k, _) in env::vars().filter(|(k, _)| k.starts_with("DROVER_") && k.ends_with("_TOKEN")) {
        if !PLUGINS
            .iter()
            .any(|(p, _)| k == format!("DROVER_{}_TOKEN", p.to_uppercase()))
        {
            eprintln!("cooee-drover: warning: {k} is no plugin's token (a retired tab?): ignored");
        }
    }
    let cookie = env::var("HERDSMAN_COOKIE").ok();
    let cfg = Config {
        herdsman,
        cookie,
        tokens,
    };
    let poll = env::var("DROVER_POLL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(30);
    let run = || {
        cfg.check()?;
        let asks = cfg.tokens.iter().find(|(p, _)| *p == "asks");
        if let (Ok(cooee), Some((_, token))) = (env::var("COOEE"), asks) {
            let (cfg, token) = (cfg.clone(), token.clone());
            thread::spawn(move || undelivered(&cfg, &cooee, &token, poll));
        }
        serve(&cfg, &addr)
    };
    if let Err(e) = run() {
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

    /// The paired device's cookie as a request header line, if one is set.
    fn cookie_line(&self) -> String {
        self.cookie
            .as_ref()
            .map(|c| format!("cookie: {c}\r\n"))
            .unwrap_or_default()
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
    let live = method == "GET" && path.split('?').next() == Some("/live");
    let cookie = cfg.cookie_line();
    if method == "GET" && (path.starts_with("/design/") || path.starts_with("/shot/")) {
        // herdsman#547: only `/<kind>/<fleet>/<n>/<i>`; a `..`, `%` or extra segment never reaches herdsman.
        let seg: Vec<&str> = path.split('/').skip(2).collect();
        let name = |s: &str| {
            !s.is_empty()
                && !s.starts_with('.')
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        };
        let num = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
        if !matches!(seg[..], [fleet, n, i] if name(fleet) && num(n) && num(i)) {
            return reply(&mut c, "404 Not Found", "text/plain", "no such image");
        }
        let mut out = Vec::new();
        forward(&cfg.herdsman, "GET", path, &cookie, &[], &mut out)?;
        let pos = out.windows(4).position(|w| w == b"\r\n\r\n");
        return match pos.filter(|_| out.split(|b| *b == b' ').nth(1) == Some(b"200")) {
            Some(i) => {
                let png = format!("data:image/png;base64,{}", base64(&out[i + 4..]));
                reply(&mut c, "200 OK", "text/plain", &png)
            }
            None => reply(&mut c, "404 Not Found", "text/plain", "no such image"),
        };
    }
    if method != "GET" && !(method == "POST" && api) {
        return reply(
            &mut c,
            "405 Method Not Allowed",
            "text/plain",
            "GET, or POST to /api/v1/",
        );
    }
    if api || live {
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

fn reply(c: &mut impl Write, status: &str, kind: &str, body: &str) -> io::Result<()> {
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
    c: &mut impl Write,
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

fn base64(b: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    b.chunks(3)
        .flat_map(|c| {
            let n = c
                .iter()
                .enumerate()
                .fold(0, |n, (i, &x)| n | (usize::from(x) << (16 - 8 * i)));
            (0..4).map(move |i| {
                if i <= c.len() {
                    char::from(A[(n >> (18 - 6 * i)) & 63])
                } else {
                    '='
                }
            })
        })
        .collect()
}

/// The raw JSON string literal (quotes and escapes kept) at `"key":` in `json`.
fn literal<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let at = json.find(&format!("\"{key}\":\""))? + key.len() + 3;
    let mut esc = false;
    let end = json[at + 1..].find(|ch| {
        let close = ch == '"' && !esc;
        esc = ch == '\\' && !esc;
        close
    })?;
    Some(&json[at..at + end + 2])
}

/// #143: herdsman's events after the newest seen, every `secs`; each `answer-undelivered` one (its `plain` line) is a
/// cooee push that opens the Asks tab. The first read only finds where the log is.
fn undelivered(cfg: &Config, cooee: &str, token: &str, secs: u64) {
    let cookie = cfg.cookie_line();
    let mut since = None;
    loop {
        let mut out = Vec::new();
        let path = format!("/api/v1/events?since={}", since.unwrap_or(0));
        let _ = forward(&cfg.herdsman, "GET", &path, &cookie, &[], &mut out);
        let text = String::from_utf8_lossy(&out);
        // An event's object starts with `{"seq":` (a string's quote is escaped); the first is the answer's own.
        let mut objs = text.split("{\"seq\":").skip(1);
        let top = objs
            .next()
            .and_then(|s| s.split(',').next()?.parse::<u64>().ok());
        let mut next = top.or(since);
        for e in objs.filter(|e| since.is_some() && e.contains("\"type\":\"answer-undelivered\"")) {
            if let Some(line) = literal(e, "plain") {
                let body = format!(r#"{{"text":{line},"path":"undelivered"}}"#);
                let head = format!(
                    "Authorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
                    body.len()
                );
                let mut out = Vec::new();
                let _ = forward(
                    cooee,
                    "POST",
                    "/plugin/push",
                    &head,
                    body.as_bytes(),
                    &mut out,
                );
                // herdsman#325: cooee down or restarting: this event is read and pushed again next time, not lost.
                if out
                    .split(|b| *b == b' ')
                    .nth(1)
                    .is_none_or(|s| !s.starts_with(b"2"))
                {
                    let seq = e.split(',').next().and_then(|s| s.parse::<u64>().ok());
                    next = seq.map(|s| s - 1).or(since);
                    break;
                }
            }
        }
        since = next;
        thread::sleep(Duration::from_secs(secs));
    }
}
