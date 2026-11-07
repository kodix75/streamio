/* ═══════════════════════════════════════════════════════════
   STREAMIO BACKEND — turns any torrent/magnet into an HTTP stream
   so the browser player can play it (with range requests = seeking).

   Run:  cd server && npm install && npm start
   Then open the web app; torrents will play through this server
   instead of the (peer-limited) in-browser WebTorrent.

   Env: PORT (default 7000), HOST (default 127.0.0.1), FFMPEG_BIN
   ═══════════════════════════════════════════════════════════ */
const http = require("http");
const url = require("url");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");
const torrentStream = require("torrent-stream");

const PORT = parseInt(process.env.PORT || "7000", 10);
const HOST = process.env.HOST || "127.0.0.1";

// ffmpeg availability
let FFMPEG = process.env.FFMPEG_BIN || null;
if (!FFMPEG) {
  try { execSync("ffmpeg -version", { stdio: "ignore" }); FFMPEG = "ffmpeg"; }
  catch (e) { try { execSync("/usr/bin/ffmpeg -version", { stdio: "ignore" }); FFMPEG = "/usr/bin/ffmpeg"; } catch (x) {} }
}

// pick an available H.264 encoder (libx264 may be missing on "free" ffmpeg builds)
function pickEncoder() {
  const candidates = ["libx264", "libopenh264", "h264_vaapi", "h264_nvenc", "h264_qsv", "h264_v4l2m2m"];
  for (const enc of candidates) {
    try {
      const out = execSync(`${FFMPEG || "ffmpeg"} -hide_banner -encoders 2>/dev/null`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      if (out.includes(enc)) return enc;
    } catch (e) {}
  }
  return null;
}
const H264_ENCODER = FFMPEG ? pickEncoder() : null;

// can this ffmpeg DECODE H.265/x265? "ffmpeg-free" builds ship without the decoder,
// and most modern releases are x265 — know thy limits before promising to transcode
function canDecodeHevc() {
  if (!FFMPEG) return false;
  try {
    const out = execSync(`${FFMPEG} -hide_banner -decoders 2>/dev/null`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /^\s*[A-Z.]*\s*hevc\s/m.test(out) || /\bV.*\bhevc\b/.test(out);
  } catch (e) { return false }
}
const HEVC_DECODER = canDecodeHevc();

function isDirectlyPlayable(name) {
  return /\.(mp4|webm|ogg|m4v|mov)$/i.test(name);
}

// id -> { engine, file, name, createdAt, playable, transcoding, transcodePath, transcodeError, transcodedReady }
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
  return vids.sort((a, b) => b.length - a.length)[0];
}

function startTorrent(magnet, cb) {
  // append public trackers if the magnet has none
  if (!/[?&]tr=/.test(magnet)) {
    const trackers = [
      "udp://tracker.openbittorrent.com:80",
      "udp://tracker.opentrackr.org:1337/announce",
      "udp://explodie.org:6969",
      "udp://tracker.empire-js.us:1337",
      "wss://tracker.btorrent.xyz",
      "wss://tracker.openwebtorrent.com",
    ];
    magnet += trackers.map(t => `&tr=${encodeURIComponent(t)}`).join("");
  }
  let engine;
  try { engine = torrentStream(magnet, { connections: 100, uploads: 10 }); }
  catch (e) { return cb(e); }

  const onReady = () => {
    clearTimeout(to);
    const file = pickVideoFile(engine.files);
    if (!file) { engine.destroy(); return cb(new Error("no playable file in torrent")); }
    const id = String(nextId++);
    const playable = isDirectlyPlayable(file.name);
    const sess = { engine, file, name: file.name, createdAt: Date.now(), playable, transcoding: false, transcodePath: null, transcodeError: null, transcodedReady: playable };
    sessions.set(id, sess);

    // if not directly playable, transcode with ffmpeg (if available)
    if (!playable) {
      if (!FFMPEG || !H264_ENCODER) {
        sess.transcodeError = "ffmpeg has no H.264 encoder — install full ffmpeg (RPM Fusion) for MKV/H.265 playback";
        sess.transcodedReady = false;
      } else {
        sess.transcoding = true;
        const outPath = path.join(os.tmpdir(), `streamio_${id}.mp4`);
        sess.transcodePath = outPath;
        const args = [
          "-y", "-i", "pipe:0",
          "-c:v", H264_ENCODER, "-preset", "fast", "-crf", "23",
          "-c:a", "aac", "-b:a", "192k",
          "-movflags", "+faststart",
          outPath,
        ];
        const ff = spawn(FFMPEG, args, { stdio: ["pipe", "pipe", "pipe"] });
        const src = file.createReadStream();
        src.on("error", (e) => { console.error("src error:", e.message); try { ff.stdin.end(); } catch (x) {} });
        ff.stdin.on("error", () => { /* EPIPE etc — ignore */ });
        src.pipe(ff.stdin);
        let stderr = "";
        ff.stderr.on("data", (d) => { stderr += d.toString(); });
        ff.on("close", (code) => {
          if (code === 0 && fs.existsSync(outPath)) {
            sess.transcoding = false;
            sess.transcodedReady = true;
          } else {
            sess.transcoding = false;
            if (/no decoder found for: hevc/i.test(stderr) && !HEVC_DECODER) {
              sess.transcodeError = "🌲 this file is H.265/x265 and the ffmpeg on this machine can't decode it — pick a 🌲264 source, plant a debrid key, or run the Stremio server engine";
            } else {
              sess.transcodeError = "transcode failed: " + stderr.slice(-300);
            }
            sess.transcodedReady = false;
          }
        });
        ff.on("error", (e) => {
          sess.transcoding = false;
          sess.transcodeError = String(e.message);
          sess.transcodedReady = false;
        });
      }
    }

    // auto-cleanup after 2h of inactivity
    setTimeout(() => {
      const s = sessions.get(id);
      if (s && Date.now() - s.createdAt > 2 * 60 * 60 * 1000) {
        try { s.engine.destroy(); } catch (e) {}
        if (s.transcodePath) try { fs.unlinkSync(s.transcodePath); } catch (e) {}
        sessions.delete(id);
      }
    }, 2 * 60 * 60 * 1000);
    cb(null, { id, name: file.name, size: file.length, playable, transcoding: sess.transcoding, files: engine.files.map((f, i) => ({ index: i, name: f.name, size: f.length })) });
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
    json(res, 200, { ok: true, service: "streamio-backend", sessions: sessions.size, ffmpeg: !!FFMPEG, hevc: !!HEVC_DECODER, h264enc: H264_ENCODER });
    return;
  }

  // status of a session (for transcoding progress)
  const statusMatch = path.match(/^\/status\/(\d+)$/);
  if (statusMatch && req.method === "GET") {
    const id = statusMatch[1];
    const sess = sessions.get(id);
    if (!sess) { json(res, 404, { error: "session not found" }); return; }
    json(res, 200, {
      ready: sess.playable || !!sess.transcodedReady,
      transcoding: !!sess.transcoding,
      playable: !!sess.playable,
      error: sess.transcodeError || null,
      name: sess.name,
    });
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
    const sess = sessions.get(id);
    if (!sess) { json(res, 404, { error: "session not found" }); return; }

    // transcoding in progress -> 202
    if (sess.transcoding) {
      cors(res);
      res.writeHead(202, { "Content-Type": "application/json", "Retry-After": "5" });
      res.end(JSON.stringify({ transcoding: true, ready: false }));
      return;
    }
    // transcoding failed -> still try to stream the original file (browser may handle it)
    if (!sess.playable && sess.transcodeError) {
      console.error("transcode failed, streaming original:", sess.transcodeError);
      // fall through to stream original file
    }

    // pick the file to stream
    let filePath = null;
    let total = 0;
    if (sess.transcodePath && sess.transcodedReady && fs.existsSync(sess.transcodePath)) {
      total = fs.statSync(sess.transcodePath).size;
      filePath = sess.transcodePath;
    }

    if (filePath) {
      // stream from transcoded file on disk (with range support)
      if (req.headers.range) {
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range);
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
          const stream = fs.createReadStream(filePath, { start, end });
          stream.pipe(res);
          stream.on("error", () => { try { res.end(); } catch (e) {} });
          return;
        }
      }
      res.writeHead(200, { "Content-Length": total, "Content-Type": "video/mp4", "Accept-Ranges": "bytes" });
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on("error", () => { try { res.end(); } catch (e) {} });
      return;
    }

    // stream from torrent (original, range support)
    const file = sess.file;
    if (!file) { json(res, 404, { error: "file not found" }); return; }
    const total2 = file.length;
    if (req.headers.range) {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : total2 - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${total2}`,
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
    res.writeHead(200, { "Content-Length": total2, "Content-Type": "video/mp4", "Accept-Ranges": "bytes" });
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
    if (sess) { try { sess.engine.destroy(); } catch (e) {} if (sess.transcodePath) try { fs.unlinkSync(sess.transcodePath); } catch (e) {} sessions.delete(id); }
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

process.on("uncaughtException", (e) => {
  console.error("uncaught:", e.message);
});

server.listen(PORT, HOST, () => {
  console.log(`🌿 streamio-backend listening on http://${HOST}:${PORT}`);
  console.log("   ffmpeg:", FFMPEG || "(not found — MKV/H.265 won't transcode)");
  if (FFMPEG) console.log("   h264 encoder:", H264_ENCODER || "(none — install full ffmpeg from RPM Fusion)");
  if (FFMPEG) console.log("   h265 decode:", HEVC_DECODER ? "yes" : "no — x265 sources need the Stremio server engine or a debrid key");
  console.log("   health:  curl http://127.0.0.1:" + PORT + "/health");
});

process.on("SIGINT", () => {
  for (const [id, s] of sessions) { try { s.engine.destroy(); } catch (e) {} if (s.transcodePath) try { fs.unlinkSync(s.transcodePath); } catch (e) {} }
  process.exit(0);
});