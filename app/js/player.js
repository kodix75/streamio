/* ═══════════════════════════════════════════════════════════
   STREAMIO · player.js — hls · direct files · webtorrent · yt
   grows whatever stream the addons hand it
   ═══════════════════════════════════════════════════════════ */
import { saveProgress, getProgress } from "./library.js?v=7";

const cdn = (src) => new Promise((ok, fail) => {
  if (document.querySelector(`script[data-cdn="${src}"]`)) return ok();
  const s = document.createElement("script");
  s.dataset.cdn = src;
  s.src = src; s.onload = ok; s.onerror = fail;
  document.head.appendChild(s);
});

const elVideo   = () => document.getElementById("video");
const elYt      = () => document.getElementById("ytframe");
const elStatus  = () => document.getElementById("playerStatus");
const elPlayer  = () => document.getElementById("player");

/* reference = movie imdb id, or series "tt123:1:2" (for resume) */
export function open({ kind, src, title, ref, provider }){
  const player = elPlayer(), video = elVideo(), yt = elYt();
  player.classList.remove("hidden");
  player.classList.remove("yt-main","video-main");
  elStatus().classList.add("hidden");
  document.body.classList.add("watching");
  /* fold the detail dialog behind the player */
  const dlg = document.getElementById("detail");
  if (dlg && dlg.open) dlg.close();
  const titleEl = document.getElementById("playerTitle");
  if (titleEl) titleEl.textContent = title ?? "now playing";

  /* yt iframe lives in DOM always; toggle classes */
  if (kind === "yt"){
    player.classList.add("yt-main");
    yt.classList.remove("hidden");
    yt.src = src.startsWith("yt:") ? `https://www.youtube-nocookie.com/embed/${src.slice(3)}?autoplay=1&rel=0`
                                   : src.replace(/^.*\/embed\//, "").replace(/^.*watch\?v=/, "").replace(/^.*youtu\.be\//, "");
    return;
  }
  player.classList.add("video-main");
  yt.classList.remove("hidden");
  yt.src = ""; /* kill any past iframe */

  const resume = ref && getProgress(ref);
  const startAt = resume && resume.t > 60 ? resume.t : 0;

  if (kind === "hls"){
    cdn("https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js").then(() => {
      video.onerror = null;
      if (window.Hls.isSupported()){
        const hls = new window.Hls(); hls.loadSource(src); hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => { video.currentTime = startAt; video.play().catch(()=>{}) });
      } else { video.src = src; video.currentTime = startAt; video.play().catch(()=>{}) }
    }).catch(err);
  } else if (kind === "file"){
    video.src = src; video.addEventListener("loadedmetadata", function once(){
      video.removeEventListener("loadedmetadata", once); video.currentTime = startAt;
    }); video.play().catch(()=>{});
  } else if (kind === "torrent"){
    torrent(src, video, title, ref);
  }
  video.dataset.ref = ref || "";
  video.dataset.kind = kind;
  document.title = `${title ?? "watch"} · Streamio 🌿`;
}

function status(txt){ const s = elStatus(); s.textContent = txt; s.classList.remove("hidden"); if (!txt) s.classList.add("hidden") }

/* browsers can't do UDP DHT — bare magnets need websocket trackers to find friends */
const WSS_TRACKERS = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.webtorrent.dev",
  "wss://tracker.files.fm:7073/announce",
];
const ensureTrackers = (id, title) => {
  if (!/^magnet:/i.test(id)) return id;
  let m = id;
  if (!/[?&]dn=/.test(m) && title) m += `&dn=${encodeURIComponent(title)}`;
  if (!/[?&]tr=/.test(m)) m += WSS_TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join("");
  return m;
};

async function torrent(torrentId, video, title, ref){
  status("🌿 waking webtorrent…");
  /* v2 ships as ESM — import it properly, fall back to the UMD v1 build */
  try{
    if (!window.WebTorrent){
      const m = await import("https://cdn.jsdelivr.net/npm/webtorrent@2/+esm");
      window.WebTorrent = m.default ?? m.WebTorrent;
    }
    if (typeof window.WebTorrent !== "function"){
      await cdn("https://cdn.jsdelivr.net/npm/webtorrent@1.9.7/dist/webtorrent.min.js");
    }
  } catch { try{ await cdn("https://cdn.jsdelivr.net/npm/webtorrent@1.9.7/dist/webtorrent.min.js") } catch(e){ return status("couldn't grow webtorrent — check your connection 🌧") } }
  if (typeof window.WebTorrent !== "function") return status("torrent engine didn't sprout — try another stream 🍄");
  window.streamioTorrent?.destroy?.();
  const client = window.streamioTorrent = new window.WebTorrent();
  status("🐍 connecting to the swarm…");

  /* webtorrent's add() takes (id, [opts], ontorrent) — no error callback,
     errors come via client.on("error"). never leave the forest hanging: */
  let gaveUp = false, watchdog;
  client.on?.("error", () => { gaveUp = true; clearTimeout(watchdog); status("swarm whispered errors — try another stream 🍄") });

  let t = null;
  try{ t = client.add(ensureTrackers(torrentId, title), (tor) => {
    if (gaveUp) return;
    clearTimeout(watchdog);
    const file = tor.files.find(f => /\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(f.name))
              ?? tor.files.find(f => f.length > 10 * 1024 * 1024) ?? tor.files[0];
    if (!file) return status("no playable file in this torrent");
    status(""); file.streamTo(video);
    tor.on("download", () =>
      status(`🐍 ${tor.name} — ${tor.downloadSpeed/1e6|0} Mb/s · ${tor.numPeers} peers · ${(tor.progress*100|0)}%`));
    tor.on("done", () => status(`done 🌸 ${tor.length/1e9 < 1 ? (tor.length/1e6|0)+" MB" : (tor.length/1e9).toFixed(1)+" GB"}`));
    video.addEventListener("canplay", function once(){
      video.removeEventListener("canplay", once);
      const p = video.dataset.ref && getProgress(video.dataset.ref);
      if (p && p.t > 60 && video.duration && Math.abs(video.duration - p.d) < 200) video.currentTime = p.t;
    });
  }) } catch(e){ gaveUp = true; return status("torrent failed to bloom — trying another stream is usually the fix 🍄") }

  t?.on?.("noPeers", () => { if (!gaveUp) status("the forest is quiet — waiting for a friend to join… 🦗") });
  watchdog = setTimeout(() => {
    if (gaveUp || (t && (t.progress > 0 || t.metadata))) return;
    gaveUp = true;
    status("the swarm went quiet — browser-edition needs webRTC friends for this one. trying the trailer instead… 🍄");
    const trailer = window.streamioRefMeta?.[ref]?.trailer;
    if (trailer){
      setTimeout(() => open({ kind: "yt", src: trailer, title: `${title} · trailer` }), 900);
    }
  }, 45000);
}

export function close(){
  const video = elVideo();
  if (video.dataset.kind !== "yt" && !video.paused && video.currentTime)
    saveProgress(video.dataset.ref, video.currentTime, video.duration);
  video.pause();
  window.streamioTorrent?.destroy?.(); window.streamioTorrent = null;
  elYt().src = "";
  elPlayer().classList.add("hidden");
  document.body.classList.remove("watching");
  document.title = "Streamio 🌿 — a media center for the forest";
}

/* ── custom controls + keyboard ──────────────────────────── */
function setupPlayerControls(){
  const video = elVideo();
  const player = elPlayer();
  if (!video || !player) return;
  const fsBtn = player.querySelector("[data-fullscreen]");
  const pipBtn = player.querySelector("[data-pip]");
  const muteBtn = document.getElementById("muteBtn");
  const vol = document.getElementById("playerVol");
  const skipBack = document.getElementById("skipBack");
  const skipFwd = document.getElementById("skipFwd");
  const playPause = document.getElementById("playPause");
  const seek = document.getElementById("playerSeek");
  const seekFill = document.getElementById("playerSeekFill");
  const timeEl = document.getElementById("playerTime");

  const fmt = (s) => { s = Math.max(0, s | 0); const m = (s / 60) | 0; return m + ":" + String(s % 60).padStart(2, "0") };
  const sync = () => {
    if (!video.duration || isNaN(video.duration)) return;
    if (seekFill) seekFill.style.width = ((video.currentTime / video.duration) * 100) + "%";
    if (timeEl) timeEl.textContent = fmt(video.currentTime) + " / " + fmt(video.duration);
    if (playPause) playPause.textContent = video.paused ? "▶" : "⏸";
    if (muteBtn) muteBtn.textContent = (video.muted || video.volume === 0) ? "🔇" : "🔊";
  };
  video.addEventListener("timeupdate", sync);
  video.addEventListener("play", sync);
  video.addEventListener("pause", sync);
  video.addEventListener("loadedmetadata", sync);
  video.addEventListener("volumechange", sync);

  playPause?.addEventListener("click", () => { if (video.paused) video.play().catch(()=>{}); else video.pause() });
  muteBtn?.addEventListener("click", () => { video.muted = !video.muted });
  vol?.addEventListener("input", (e) => { video.volume = +e.target.value; video.muted = false });
  skipBack?.addEventListener("click", () => { video.currentTime = Math.max(0, video.currentTime - 10) });
  skipFwd?.addEventListener("click", () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10) });
  seek?.addEventListener("click", (e) => {
    if (!video.duration) return;
    const r = seek.getBoundingClientRect();
    video.currentTime = ((e.clientX - r.left) / r.width) * video.duration;
  });
  fsBtn?.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else player.requestFullscreen?.();
  });
  pipBtn?.addEventListener("click", async () => {
    try{ if (document.pictureInPictureElement) await document.exitPictureInPicture();
         else await video.requestPictureInPicture() } catch(e){}
  });

  document.addEventListener("keydown", (e) => {
    if (player.classList.contains("hidden")) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "f" || e.key === "F"){ e.preventDefault(); fsBtn?.click() }
    else if (e.key === "m" || e.key === "M"){ e.preventDefault(); muteBtn?.click() }
    else if (e.key === "ArrowLeft"){ e.preventDefault(); skipBack?.click() }
    else if (e.key === "ArrowRight"){ e.preventDefault(); skipFwd?.click() }
  });
}
/* autosave progress every ~8s while watching native video */
setInterval(() => {
  const v = elVideo();
  const openPlayer = !elPlayer().classList.contains("hidden");
  if (openPlayer && v.duration && v.currentTime && !isNaN(v.duration)){
    const r = v.dataset.ref;
    const metaSnap = window.streamioRefMeta?.[r];
    saveProgress(r, v.currentTime, v.duration, metaSnap || undefined);
  }
}, 8000);
