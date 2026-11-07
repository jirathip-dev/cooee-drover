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
  console.log(req.method, req.url, file ? 200 : req.method === "POST" ? 405 : 404);
  if (file) return res.writeHead(200, { "content-type": "application/json" }).end(fixture(file));
  if (req.method === "POST") {
    const body = JSON.stringify({ ok: false, code: "READ_ONLY", message: "the fixture herdsman takes no ops" });
    return res.writeHead(405, { "content-type": "application/json" }).end(body);
  }
  res.writeHead(404, { "content-type": "text/plain" }).end("no such path");
}).listen(+process.env.PORT, "127.0.0.1", () => console.log(`fixture herdsman on 127.0.0.1:${process.env.PORT}`));
