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

async function torrent(torrentId, video, title){
  status("🌿 waking webtorrent…");
  try{ await cdn("https://cdn.jsdelivr.net/npm/webtorrent@2/dist/webtorrent.min.js") }
  catch(e){ return status("couldn't load webtorrent from CDN — check your connection.") }
  window.streamioTorrent?.destroy?.();
  const client = window.streamioTorrent = new window.WebTorrent();
  status("🐍 connecting to the swarm…");
  client.add(torrentId, (torrent) => {
    const file = torrent.files.find(f => /\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(f.name))
              ?? torrent.files.find(f => f.progLength > 10 * 1024 * 1024) ?? torrent.files[0];
    if (!file) return status("no playable file in this torrent");
    status(""); file.streamTo(video); file.getBlobURL?.();
    torrent.on("download", () =>
      status(`🐍 ${torrent.name} — ${torrent.downloadSpeed/1e6|0} Mb/s · ${torrent.numPeers} peers · ${(torrent.progress*100|0)}%`));
    video.addEventListener("canplay", function once(){
      video.removeEventListener("canplay", once);
      const p = video.dataset.ref && getProgress(video.dataset.ref);
      if (p && p.t > 60 && Math.abs(video.duration - p.d) < 200) video.currentTime = p.t;
    });
  }, () => status("torrent failed to bloom — trying another stream is usually the fix 🍄"));
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
