/* ═══════════════════════════════════════════════════════════
   STREAMIO · ui.js — every view the forest shows you
   ═══════════════════════════════════════════════════════════ */
import { cinemetaCatalog, addonCatalogs, meta, streams, classify, streamTitle, streamSource, addonUrls } from "./api.js";
import { isSaved, toggleSaved, savedItems, continueWatching } from "./library.js";
import { open as openPlayer } from "./player.js";

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const ph = (name) => "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='300'><rect width='200' height='300' fill='#0a2317'/>` +
  `<text x='100' y='150' fill='${"#3f8a52"}' text-anchor='middle' font-family='Georgia' font-style='italic' font-size='15'>${esc(name && name.slice(0, 16) || "…")}</text></svg>`);
const star = `<svg viewBox="0 0 24 24" width="11" height="11"><path fill="#ffd98a" d="m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21Z"/></svg>`;

/* ── poster card ─────────────────────────────────────────── */
function posterCard(m, { progressPct } = {}){
  const type = m.type ?? "movie";
  const info = [
    m.year ?? m.releaseInfo ?? "",
    Array.isArray(m.genre) && m.genre.length ? m.genre.slice(0, 3).join(" · ") : "",
  ].filter(Boolean).join(" · ");
  const saved = isSaved(m.id);
  const pct = progressPct != null ? Math.min(100, progressPct) : null;
  return `<article class="card ${saved ? "saved" : ""}" data-id="${esc(m.id)}" data-type="${esc(type)}" role="button" tabindex="0" title="${esc(m.name)}">
    <button class="heart" data-heart="${esc(m.id)}" data-snap="${esc(JSON.stringify({ id:m.id, name:m.name, type, poster:m.poster }))}"
            title="save to library">${saved ? "♥" : "♡"}</button>
    <img class="poster" loading="lazy" src="${esc(m.poster || ph(m.name))}" onerror="this.onerror=null;this.src='${ph(m.name)}'"/>
    <div class="pbar"><i style="width:${pct == null ? 0 : pct.toFixed(0)}%"></i></div>
    <div class="name">${esc(m.name)}</div>
    <div class="info">${esc(info)}${m.imdbRating ? ` · ${star} ${esc(m.imdbRating)}` : ""}</div>
  </article>`;
}

const skelCards = (n) => Array(n).fill(
  `<div class="card"><div class="poster skel">.</div><div class="name skel">...</div><div class="info skel">...</div></div>`).join("");

const emptyState = (msg, extra = "") =>
  `<div class="empty"><div class="big">🦌</div><p>${msg}</p>${extra}</div>`;

const railSection = (title, cards, link = "") => `
  <section><div class="row-head"><div class="row-title"><h2>${esc(title)}</h2></div>
  ${link ? `<a class="chip" href="${link}">see all →</a>` : ""}</div>
  <div class="rail">${cards}</div></section>`;

/* ── hero ────────────────────────────────────────────────── */
async function heroMovie(){
  const metas = await cinemetaCatalog("movie").catch(() => []);
  const withPoster = metas.filter(m => m.poster);
  if (!withPoster.length) return "";
  const pick = withPoster[Math.floor(Math.random() * Math.min(24, withPoster.length))];
  const full = await meta("movie", pick.id).catch(() => ({ ...pick, type: "movie" }));
  const yt = full.trailer?.startsWith("yt:") ? full.trailer : null;
  return `<section class="hero"><div class="hero-inner">
    <img class="hero-poster" src="${esc(full.poster)}" onerror="this.style.visibility='hidden'"/>
    <div class="hero-meta">
      <div class="hero-sub" style="font-family:var(--serif);font-style:italic;font-size:17px;color:var(--moss);font-size:18px;margin:0 0 -22px">— tonight in the forest</div>
      <div class="hero-title">${esc(full.name)}</div>
      <div>
        ${full.imdbRating ? `<span class="rating">${star} ${esc(full.imdbRating)}</span> ` : ""}
        ${full.releaseInfo ? `<span class="muted small">${esc(full.releaseInfo)}</span>` : ""}
      </div>
      <p class="hero-sub">${esc(full.description)}</p>
      <div class="hero-actions">
        ${yt ? `<button class="btn" data-trailer="${esc(yt)}" data-tname="${esc(full.name)}">▶ watch trailer</button>` : ""}
        <a class="btn ghost" href="#/detail/${esc(full.type ?? "movie")}/${esc(full.id)}">🌴 where to watch</a>
      </div>
    </div></div></section>`;
}

/* ── home ────────────────────────────────────────────────── */
export async function homeView(root){
  root.innerHTML = `<div style="margin-top:96px">${railSection("the forest is waking…", skelCards(8))}</div>`;
  const hero = await heroMovie();
  const [movies, series, cont, addonCats] = await Promise.all([
    cinemetaCatalog("movie").catch(() => []),
    cinemetaCatalog("series").catch(() => []),
    Promise.resolve(continueWatching()),
    addonCatalogs().catch(() => []),
  ]);
  root.innerHTML = hero
    + (cont.length
        ? railSection("continue watching", cont.map(x =>
            posterCard({ id: x.imdb, name: x.name, type: x.type ?? "movie", poster: x.poster },
                       { progressPct: (x.t / Math.max(1, x.d)) * 100 })).join(""), "#/library")
        : "")
    + railSection("trending movies", movies.map(m => posterCard({ ...m, type:"movie" })).join(""), "#/browse/movie")
    + railSection("trending series", series.map(m => posterCard({ ...m, type:"series" })).join(""), "#/browse/series")
    + addonCats.map((c, i) => `
      <section><div class="row-head"><div class="row-title"><h2>${esc(c.name)}</h2></div>
      <span class="muted small">from ${esc(c.addon.name)}</span></div>
      <div class="rail" id="addonRail${i}">${skelCards(6)}</div></section>`);

  /* fill each addon rail once its own catalog answers */
  await Promise.all(addonCats.map(async (c, i) => {
    const rail = $(`#addonRail${i}`, root);
    if (!rail) return;
    try{
      const ms = await c.fetch();
      rail.innerHTML = ms.slice(0, 18).map(m => posterCard({ ...m, type: c.type })).join("")
        || emptyState("this addon-stand sells nothing today");
      rail.id = ""; /* avoid re-lookup collisions on hash changes */
    }catch(e){ rail.innerHTML = ""; console.warn("addon rail failed", e) }
  }));
}

/* ── browse / search / library ───────────────────────────── */
const GENRES = ["", "action", "adventure", "animation", "comedy", "drama", "science-fiction", "documentary", "romance", "thriller"];

export async function browseView(root, type, genre = ""){
  root.dataset.type = type;
  root.innerHTML = `
    <h1 style="margin-top:108px">the ${type === "movie" ? "movie grove" : "series grove"}${genre ? `<span class="muted" style="font-size:.55em"> · ${esc(genre)}</span>` : ""}</h1>
    <div class="genre-bar">${GENRES.map(g =>
      `<button class="chip ${g === genre ? "on" : ""}" data-genre="${esc(g)}">${g === "" ? "all" : esc(g)}</button>`).join("")}</div>
    <div class="grid">${skelCards(14)}</div>`;
  wireGenre(root, type);
  const items = await cinemetaCatalog(type, genre ? `genre=${encodeURIComponent(genre)}` : "").catch(() => []);
  $(".grid", root).innerHTML = items.map(m => posterCard({ ...m, type })).join("")
    || emptyState("nothing grew here yet 🌱");
}

function wireGenre(root, type){
  $$(".genre-bar .chip", root).forEach(b => b.onclick = () => {
    location.hash = `#/browse/${type}/${encodeURIComponent(b.dataset.genre)}`;
  });
}

export async function searchView(root, q){
  root.innerHTML = `<h1 style="margin-top:108px">searching for “${esc(q)}” 🦋</h1>
    <div class="grid">${skelCards(10)}</div>`;
  const extra = `search=${encodeURIComponent(q)}`;
  const [mv, sr] = await Promise.all([
    cinemetaCatalog("movie", extra).catch(() => []),
    cinemetaCatalog("series", extra).catch(() => []),
  ]);
  const all = [...mv, ...sr];
  root.innerHTML = `<h1 style="margin-top:108px">“${esc(q)}” in the wild</h1>
    <div class="grid">${all.map(m => posterCard(m)).join("")}</div>`
    + (!all.length ? emptyState(`the forest came up empty for “${esc(q)}”`) : "");
}

export async function libraryView(root){
  const saved = savedItems();
  const cont = continueWatching(40);
  root.innerHTML = `<h1 style="margin-top:108px">your library</h1>`
    + (cont.length ? railSection("continue watching", cont.map(x =>
        posterCard({ id: x.imdb, name: x.name, type: x.type ?? "movie", poster: x.poster },
                   { progressPct: (x.t / Math.max(1, x.d)) * 100 })).join("")) : "")
    + `<section><div class="row-head"><div class="row-title"><h2>saved for later 🍄</h2></div></div>
        <div class="grid">${saved.length ? saved.map(m => posterCard(m)).join("") : ""}</div></section>`
    + (!saved.length ? emptyState("your library is an empty clearing — press ♡ on any poster to plant it here",
        `<a class="btn" href="#/browse/movie" style="margin-top:10px">go plant some 🌱</a>`) : "");
}

/* ── detail dialog ───────────────────────────────────────── */
export async function openDetail(type, id){
  const dlg = $("#detail");
  dlg.innerHTML = `<div style="padding:26px"><div class="poster skel" style="width:100%;aspect-ratio:2.4">.</div></div>`;
  dlg.showModal();
  let m;
  try{ m = await meta(type, id) }
  catch(e){ dlg.innerHTML = `<div style="padding:22px" class="empty"><div class="big">🌫️</div><p>couldn't reach the forest — the network muffled the call</p></div>`; return }

  const vids = m.videos ?? [];
  const seasons = [...new Set(vids.map(v => v.season))].filter(s => s != null).sort((a,b) => a - b);
  const ytT = m.trailer?.startsWith("yt:") ? m.trailer : null;
  const genres = (m.genres ?? (Array.isArray(m.genre) ? m.genre : [])).slice(0, 5);

  dlg.innerHTML = `
    <div class="d-hero">
      <img class="bgback" src="${esc(m.banner || m.background || m.poster)}" onerror="this.style.display='none'"/>
      <button class="icon-btn d-close" data-close>✕</button>
    </div>
    <div class="d-body">
      <img class="d-poster" src="${esc(m.poster || ph(m.name))}" onerror="this.onerror=null;this.src='${ph(m.name)}'"/>
      <div class="d-info" style="padding-top:76px">
        <h1 style="font-size:clamp(26px,3.4vw,40px)">${esc(m.name)}</h1>
        <div class="d-tags">
          ${m.imdbRating ? `<span class="rating">${star} ${esc(m.imdbRating)}</span>` : ""}
          ${m.releaseInfo ? `<span class="tag">${esc(m.releaseInfo)}</span>` : ""}
          ${genres.map(g => `<span class="tag">${esc(g)}</span>`).join("")}
        </div>
        <p class="d-desc">${esc(m.description)}</p>
        <div class="d-actions">
          ${ytT || (m.videos ?? []).length || true ? `<button class="btn" data-pick id="primaryWatch">▶ watch</button>` : ""}
          ${ytT ? `<button class="btn ghost" data-trailer="${esc(ytT)}" data-tname="${esc(m.name)}">🎬 trailer</button>` : ""}
          <button class="btn ghost" data-save="${esc(m.id)}" data-snap="${esc(JSON.stringify({ id:m.id, name:m.name, type, poster:m.poster }))}">${isSaved(m.id) ? "♥ saved" : "♡ save"}</button>
        </div>
        <div id="streamZone"></div>
        ${type === "series" && seasons.length ? `
          <div class="season-bar">${seasons.map(s =>
            `<button class="chip ${s === seasons[0] ? "on" : ""}" data-season="${s}">s${s}</button>`).join("")}</div>
          <div class="ep-list" id="eps"></div>` : ""}
      </div>
    </div>`;

  dlg.dataset.imdb = m.id; dlg.dataset.type = type;
  $("[data-save]", dlg).onclick = (e) => {
    const b = e.currentTarget;
    const snap = JSON.parse(b.dataset.snap);
    b.textContent = toggleSaved({ ...snap, savedAt: 0 }) ? "♥ saved" : "♡ save";
  };

  const zone = $("#streamZone", dlg);
  if (type === "movie"){
    await paintStreams(zone, type, m.id, m.name, { name: m.name, poster: m.poster, type });
  }
  if (type === "series" && seasons.length){
    drawEpisodes(dlg, m, seasons);
  }
  $("[data-pick]", dlg).onclick = () => {
    ($(`#eps`, dlg) ?? zone)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
}

function drawEpisodes(dlg, m, seasons, picked = seasons[0]){
  const box = $("#eps", dlg); if (!box) return;
  const vids = (m.videos ?? []).filter(v => v.season === picked).sort((a,b) => (a.episode ?? 0) - (b.episode ?? 0));
  box.innerHTML = vids.map(v => `
    <button class="ep" data-ep="${esc(v.id)}" data-snap="${esc(JSON.stringify({ id:m.id, name:m.name, type:"series", poster:m.poster }))}">
      <span><b style="color:var(--glow)">e${v.episode ?? "?"}</b> ${esc(v.name ?? v.title ?? `episode ${v.episode}`)}</span>
      <span class="muted small" style="margin-left:auto">${esc((v.released ?? "").slice(0, 10))}</span>
    </button>`).join("");
  $$(".ep", box).forEach(b => b.onclick = () => {
    const [imdb, s, e] = b.dataset.ep.split(":");
    const label = `${m.name} · s${s}e${e}`;
    const zone = $("#streamZone", dlg) ?? dlg;
    paintStreams(zone, "series", b.dataset.ep, label, JSON.parse(b.dataset.snap));
    zone.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $$(".season-bar .chip", dlg).forEach(b => b.onclick = () => {
    $$(".season-bar .chip", dlg).forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    drawEpisodes(dlg, m, seasons, Number(b.dataset.season));
  });
}

/* ask every planted addon for streams; wire rows to the player */
async function paintStreams(zone, type, id, title, refMeta){
  window.streamioRefMeta ??= {};
  window.streamioRefMeta[id] = refMeta;
  if (addonUrls().length === 0){
    zone.innerHTML = `<div class="empty" style="margin:16px 0;padding:16px;border:1px solid var(--line);border-radius:16px">
      🌊 <b>no stream addons planted yet.</b><br>
      press <code>addons</code> in the menu and plant one — e.g.
      <code>https://torrentio.strem.fun/manifest.json</code></div>`;
    return;
  }
  zone.innerHTML = `<div class="streams"><div class="stream skel">.</div><div class="stream skel">.</div><div class="stream skel">.</div></div>`;
  let list = [];
  try{ list = await streams(type, id) }catch(e){ console.warn(e) }
  if (!list.length){
    zone.innerHTML = `<div class="empty" style="margin:16px 0;padding:16px;border:1px solid var(--line);border-radius:16px">
      🌊 your addons offered no streams for <b>${esc(title)}</b> — try another addon or another fog-layer 🍃</div>`;
    return;
  }
  const kindLabel = { file:"file", hls:"hls", torrent:"torrent", yt:"youtube", external:"link", unknown:"?" };
  zone.innerHTML = `<div class="row-head" style="margin:18px 0 10px"><div class="row-title"><h2>streams</h2></div>
      <span class="muted small">${list.length} gossamer threads</span></div>
    <div class="streams">${list.map(s => {
      const k = classify(s);
      const magnet = k === "torrent" ? (s.url ?? `magnet:?xt=urn:btih:${s.infoHash}&dn=${encodeURIComponent(title)}`) : "";
      const src = k === "external" ? (s.externalUrl ?? "") : (s.url ?? s.ytId ?? magnet);
      return `<button class="stream" data-kind="${k}" data-src="${esc(src)}" data-title="${esc(streamTitle(s))}" data-ref="${esc(id)}">
        <span class="kind">${kindLabel[k]}</span>
        <span class="txt"><div class="sx">${esc(streamSource(s))}</div><div class="st">${esc(streamTitle(s))}</div></span>
      </button>`;
    }).join("")}</div>`;
  wireStreams(zone);
}

export function wireStreams(box){
  $$(".stream", box).forEach(b => b.onclick = () => {
    if (b.dataset.kind === "external"){ window.open(b.dataset.src, "_blank"); return }
    if (!b.dataset.src && b.dataset.kind !== "yt") return;
    openPlayer({
      kind: b.dataset.kind,
      src: b.dataset.src,
      ref: b.dataset.ref,
      title: b.dataset.title,
    });
  });
}
