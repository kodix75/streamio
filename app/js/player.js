/* ═══════════════════════════════════════════════════════════
   STREAMIO · player.js — hls · direct files · webtorrent · yt
   grows whatever stream the addons hand it
   ═══════════════════════════════════════════════════════════ */
import { saveProgress, getProgress } from "./library.js";

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

  /* yt iframe lives in DOM always; toggle classes */
  if (kind === "yt"){
    player.classList.add("yt-main");
    yt.classList.remove("hidden");
    yt.src = src.startsWith("yt:") ? `https://www.youtube-nocookie.com/embed/${src.slice(3)}?autoplay=1`
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
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => { video.currentTime = startAt; video.play() });
      } else { video.src = src; video.currentTime = startAt; video.play() }
    }).catch(err);
  } else if (kind === "file"){
    video.src = src; video.addEventListener("loadedmetadata", function once(){
      video.removeEventListener("loadedmetadata", once); video.currentTime = startAt;
    }); video.play();
  } else if (kind === "torrent"){
    torrent(src, video, title);
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

async function torrent(torrentId, video, title){
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
    status("the swarm went quiet — browser-edition needs webRTC friends for this one. try another stream, or the trailer 🍄");
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

/* autosave progress every ~8s while watching native video */
setInterval(() => {
  const v = elVideo();
  const openPlayer = !elPlayer().classList.contains("hidden");
  if (openPlayer && v.duration && v.currentTime && !isNaN(v.duration)){
    const r = v.dataset.ref;
    const metaSnap = window.streamioRefMeta?.[r];   /* set when opening from detail */
    saveProgress(r, v.currentTime, v.duration, metaSnap || undefined);
  }
}, 8000);
