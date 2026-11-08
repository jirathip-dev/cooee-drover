// A read-only herdsman for the verify recipe (.herdsman/verify.md): serves the recorded web/fixtures/ as /api/v1
// (`PORT=7777 node scripts/fixture-herdsman.mjs`), so drover runs against no live board. Every op answers READ_ONLY.
import fs from "node:fs";
import http from "node:http";

const fixture = (name) => fs.readFileSync(new URL(`../web/fixtures/${name}.json`, import.meta.url));
const FILES = { state: "state", queue: "queue", needs: "needs", host: "host", events: "events", issue: "issue" };

http.createServer((req, res) => {
  const [, api, v1, name, ...rest] = new URL(req.url, "http://x").pathname.split("/");
  // `lessons` is the list; `lessons/<fleet>/digest` its digest; nothing else under it
  const lesson = rest.length === 0 ? "lessons" : rest.length === 2 && rest[1] === "digest" ? "digest" : null;
  const file = api === "api" && v1 === "v1" && req.method === "GET" && (name === "lessons" ? lesson : FILES[name]);
  // #17: herdsman's `/live` stream, held open with no events
  if (req.method === "GET" && api === "live") return res.writeHead(200, { "content-type": "text/event-stream" }).write(": ping\n\n");
  console.log(req.method, req.url, file ? 200 : req.method === "POST" ? 405 : 404);
  // #17: `events` with the recorded endings after them (one open ask in `needs`, the closed ones in the events)
  if (file === "events") {
    const ev = JSON.parse(fixture("events")), end = JSON.parse(fixture("endings")).list;
    ev.list.push(...end.map((e, i) => ({ ...e, seq: ev.seq + 1 + i })));
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...ev, seq: ev.seq + end.length }));
  }
  if (file) return res.writeHead(200, { "content-type": "application/json" }).end(fixture(file));
  if (req.method === "POST") {
    const body = JSON.stringify({ ok: false, code: "READ_ONLY", message: "the fixture herdsman takes no ops" });
    return res.writeHead(405, { "content-type": "application/json" }).end(body);
  }
  res.writeHead(404, { "content-type": "text/plain" }).end("no such path");
}).listen(+process.env.PORT, "127.0.0.1", () => console.log(`fixture herdsman on 127.0.0.1:${process.env.PORT}`));
