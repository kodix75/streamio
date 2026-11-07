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

// serve a file from disk with range support; while the file is still growing
// (live transcode) ranges are capped at the size that exists right now —
// the browser reconnects for more buffer as conversion inches forward
async function serveFileRange(req, res, filePath, growing = false, ultimateTotal = 0) {
  // freshly truncated (conversion still ramping up) — hold the door open until
  // real fragments exist, so the player's media load never sees a barren file
  for (let i = 0; i < 80 && !res.writableEnded; i++) {
    try { if (fs.statSync(filePath).size > 64) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  let actual = 0;
  try { actual = fs.statSync(filePath).size; } catch (e) {}
  // while growing, never advertise the (small) current size as the total —
  // otherwise the browser treats the chunk as the whole file and stops at its end.
  // report a generous upper bound instead, so playback keeps flowing as more arrives.
  const total = growing ? Math.max(actual, ultimateTotal || actual) : actual;
  const m = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
  let start = 0;
  let end = Math.max(0, actual - 1);
  if (m) {
    start = parseInt(m[1], 10) || 0;
    if (m[2]) end = parseInt(m[2], 10);
  }
  // hold the door open until the requested bytes actually exist (live growth),
  // so a range request that runs past the current frontier doesn't 503-and-die
  if (start >= actual) {
    for (let i = 0; i < 80 && !res.writableEnded; i++) {
      try { const s = fs.statSync(filePath).size; if (s > start) { actual = s; break; } } catch (e) {}
      await new Promise(r => setTimeout(r, 250));
    }
    try { actual = fs.statSync(filePath).size; } catch (e) {}
    if (actual === 0 || start >= actual) {
      try { res.writeHead(503, { "Content-Type": "application/json" }); } catch (e) {}
      try { res.end(JSON.stringify({ error: "still growing" })); } catch (e) {}
      return;
    }
    end = Math.min(end, actual - 1);
    if (end < start) end = actual - 1;
  }
  if (actual === 0 || start > end) {
    // a rare race (file gone between stat and read) — not video data
    try { res.writeHead(503, { "Content-Type": "application/json" }); } catch (e) {}
    try { res.end(JSON.stringify({ error: "still growing" })); } catch (e) {}
    return;
  }
  const caps = { "Accept-Ranges": "bytes", "Content-Type": "video/mp4" };
  if (m) {
    res.writeHead(206, { ...caps, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": end - start + 1 });
  } else {
    // growing: Content-Length = bytes we actually have right now (so the browser
    // reads them and then asks for the next range); finished: the whole file
    res.writeHead(200, { ...caps, "Content-Length": growing ? actual : total });
  }
  const stream = fs.createReadStream(filePath, { start, end });
  stream.pipe(res);
  stream.on("error", () => { try { res.end(); } catch (e) {} });
  res.on("close", () => { try { stream.destroy(); } catch (e) {} });
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
        // fragmented mp4 (+empty_moov) — playable from the first fragments, so the film
        // starts streaming while the conversion is still running (faststart can't do that)
        const args = [
          "-y", "-i", "pipe:0",
          "-analyzeduration", "0", "-probesize", "5000000",
          "-c:v", H264_ENCODER, "-preset", "veryfast", "-crf", "23",
          "-c:a", "aac", "-b:a", "192k",
          "-max_muxing_queue_size", "1024",
          "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
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
    // swarm truth — how much of the film has actually downloaded (single-file torrents ≈ the film itself)
    let downloaded = 0, speed = 0;
    try {
      const s = sess.engine?.swarm ?? {};
      const d = +s.downloaded, v = +s.downloadSpeed;
      downloaded = (Number.isFinite(d) && d > 0) ? Math.round(d) : 0;
      speed = (Number.isFinite(v) && v > 0) ? Math.round(v) : 0;
    } catch (e) {}
    let outSize = 0, outExists = false;
    if (sess.transcodePath) {
      try { outExists = fs.existsSync(sess.transcodePath); if (outExists) outSize = fs.statSync(sess.transcodePath).size; } catch (e) {}
    }
    // rough final-size estimate for the % readout (re-compresses to ≈55–65% of source at crf 23)
    const est = Math.round((sess.file?.length ?? 0) * 0.6) || 0;
    json(res, 200, {
      ready: sess.playable || !!sess.transcodedReady,
      transcoding: !!sess.transcoding,
      playable: !!sess.playable,
      // output file exists with real fragments → the player can already start streaming live
      streamable: sess.playable || (outExists && outSize > 64 && !sess.transcodeError),
      error: sess.transcodeError || null,
      name: sess.name,
      size: sess.file?.length ?? 0,
      downloaded, speed,
      outSize, outEstimate: est,
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

    // transcoded/output file exists (growing live, or complete) → serve it straight away
    if (sess.transcodePath && fs.existsSync(sess.transcodePath)) {
      serveFileRange(req, res, sess.transcodePath, !!sess.transcoding, sess.file?.length || 0);
      return;
    }

    // transcoding in progress, nothing written yet -> 202
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
    if (sess.transcodePath && sess.transcodedReady && fs.existsSync(sess.transcodePath)) {
      filePath = sess.transcodePath;
    }

    if (filePath) {
      // stream from transcoded file on disk (with range support)
      serveFileRange(req, res, filePath);
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