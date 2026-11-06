/* ═══════════════════════════════════════════════════════════
   STREAMIO BACKEND — turns any torrent/magnet into an HTTP stream
   so the browser player can play it (with range requests = seeking).

   Run:  cd server && npm install && npm start
   Then open the web app; torrents will play through this server
   instead of the (peer-limited) in-browser WebTorrent.

   Env: PORT (default 7000), HOST (default 127.0.0.1)
   ═══════════════════════════════════════════════════════════ */
const http = require("http");
const url = require("url");
const torrentStream = require("torrent-stream");

const PORT = parseInt(process.env.PORT || "7000", 10);
const HOST = process.env.HOST || "127.0.0.1";

// id -> { engine, file, name, createdAt }
const sessions = new Map();
let nextId = 1;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
}

function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function pickVideoFile(files) {
  const videoExt = /\.(mp4|mkv|webm|avi|mov|m4v|m2ts|ts)$/i;
  const vids = files.filter(f => videoExt.test(f.name));
  if (!vids.length) return files.sort((a, b) => b.length - a.length)[0];
  // prefer the largest video file (usually the main feature)
  return vids.sort((a, b) => b.length - a.length)[0];
}

function startTorrent(magnet, cb) {
  let engine;
  try { engine = torrentStream(magnet, { connections: 100, uploads: 10, path: undefined }); }
  catch (e) { return cb(e); }

  const onReady = () => {
    clearTimeout(to);
    const file = pickVideoFile(engine.files);
    if (!file) { engine.destroy(); return cb(new Error("no playable file in torrent")); }
    const id = String(nextId++);
    sessions.set(id, { engine, file, name: file.name, createdAt: Date.now() });
    // auto-cleanup after 2h of inactivity
    setTimeout(() => {
      const s = sessions.get(id);
      if (s && Date.now() - s.createdAt > 2 * 60 * 60 * 1000) {
        try { s.engine.destroy(); } catch (e) {}
        sessions.delete(id);
      }
    }, 2 * 60 * 60 * 1000);
    cb(null, { id, name: file.name, size: file.length, files: engine.files.map((f, i) => ({ index: i, name: f.name, size: f.length })) });
  };

  const to = setTimeout(() => {
    try { engine.destroy(); } catch (e) {}
    cb(new Error("torrent metadata timed out (no peers/DHT)"));
  }, 60000);

  engine.on("ready", onReady);
  engine.on("error", (e) => { clearTimeout(to); try { engine.destroy(); } catch (x) {} cb(e); });
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname || "/";

  // health
  if (path === "/health" || path === "/") {
    json(res, 200, { ok: true, service: "streamio-backend", sessions: sessions.size });
    return;
  }

  // start a torrent
  if (path === "/play" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      let magnet = "";
      try { magnet = (JSON.parse(body || "{}").magnet || "").trim(); } catch (e) {}
      if (!magnet) { json(res, 400, { error: "magnet required" }); return; }
      startTorrent(magnet, (err, info) => {
        if (err) { json(res, 500, { error: String(err.message || err) }); return; }
        json(res, 200, { ...info, streamUrl: `/stream/${info.id}` });
      });
    });
    return;
  }

  // stream a file (with range support)
  const streamMatch = path.match(/^\/stream\/(\d+)(?:\/(\d+))?$/);
  if (streamMatch && req.method === "GET") {
    const id = streamMatch[1];
    const fileIndex = streamMatch[2] ? parseInt(streamMatch[2], 10) : null;
    const sess = sessions.get(id);
    if (!sess) { json(res, 404, { error: "session not found" }); return; }
    const file = (fileIndex != null && sess.engine.files[fileIndex]) ? sess.engine.files[fileIndex] : sess.file;
    if (!file) { json(res, 404, { error: "file not found" }); return; }

    const total = file.length;
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : total - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": "video/mp4",
        });
        const stream = file.createReadStream({ start, end });
        stream.pipe(res);
        stream.on("error", () => { try { res.end(); } catch (e) {} });
        return;
      }
    }
    res.writeHead(200, {
      "Content-Length": total,
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
    });
    const stream = file.createReadStream();
    stream.pipe(res);
    stream.on("error", () => { try { res.end(); } catch (e) {} });
    return;
  }

  // stop a session
  const stopMatch = path.match(/^\/stop\/(\d+)$/);
  if (stopMatch && (req.method === "DELETE" || req.method === "POST")) {
    const id = stopMatch[1];
    const sess = sessions.get(id);
    if (sess) { try { sess.engine.destroy(); } catch (e) {} sessions.delete(id); }
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { error: "not found" });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`🌿 port ${PORT} is already in use — is another streamio-backend running?`);
    console.error("   stop it first, or pick another port:  PORT=7001 npm start");
    process.exit(0);
  }
  console.error("backend error:", e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`🌿 streamio-backend listening on http://${HOST}:${PORT}`);
  console.log("   health:  curl http://127.0.0.1:" + PORT + "/health");
});

process.on("SIGINT", () => {
  for (const [id, s] of sessions) { try { s.engine.destroy(); } catch (e) {} }
  process.exit(0);
});