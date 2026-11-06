/* ═══════════════════════════════════════════════════════════
   STREAMIO · main.js — routes, nav, addons, delegation
   ═══════════════════════════════════════════════════════════ */
import { homeView, browseView, searchView, libraryView, openDetail, $, $$, wireStreams, esc } from "./ui.js?v=4";
import { addonUrls, setAddonUrls, loadManifest, SEEDS, backendUrl, setBackendUrl, addonCollection } from "./api.js?v=4";
import { toggleSaved } from "./library.js?v=4";
import * as player from "./player.js?v=4";

const root = $("#view");

/* ── router ──────────────────────────────────────────────── */
let NAV = 0;   /* view token — late async paints bail out when it changed */
async function route(){
  const h = location.hash || "#/home";
  const [, seg, ...rest] = h.split("/");
  root.dataset.nav = String(++NAV);
  $$("#navLinks a").forEach(a =>
    a.classList.toggle("on", h.startsWith(`#${ seg }`)));

  /* leaving a detail route should fold the detail overlay (browser-back etc.) */
  if (!h.startsWith("#/detail/")){ const d = $("#detail"); if (d.open) d.close(); }

  if (h.startsWith("#/browse/") && rest[0]){
    const [type, genre = ""] = rest[0].split("/").map(decodeURIComponent);
    root.dataset.current = type === "series" ? "series" : "movie";
    return browseView(root, type === "series" ? "series" : "movie", genre);
  }
  if (h.startsWith("#/search/"))  return searchView(root, decodeURIComponent(rest.join("/")));
  if (h === "#/library")          return libraryView(root);
  if (h.startsWith("#/detail/")){
    const [type = "movie", id = ""] = rest.map(decodeURIComponent);
    if (!root.dataset.current) homeView(root);      /* backdrop behind dialog */
    $$("#navLinks a")[0]?.classList.add("on");
    return openDetail(type === "series" ? "series" : "movie", id);
  }
  root.dataset.current = "home";
  return homeView(root);
}
window.addEventListener("hashchange", route);

/* ── search ──────────────────────────────────────────────── */
 $("#q").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.value.trim()){
    location.hash = `#/search/${encodeURIComponent(e.target.value.trim())}`;
    e.target.blur();
  }
});

/* ── global click delegation ─────────────────────────────── */
document.addEventListener("click", async (e) => {
  const t = e.target;

  const closeBtn = t.closest("[data-close]");
  if (closeBtn){
    const dlg = closeBtn.closest("dialog");
    if (dlg) dlg.close();
    const pl = closeBtn.closest(".player");
    if (pl) player.close();
    return;
  }
  const heart = t.closest("[data-heart],[data-save]");
  if (heart?.dataset.snap){
    e.stopPropagation();
    const snap = { ...JSON.parse(heart.dataset.snap), savedAt: 0 };
    heart.textContent = toggleSaved(snap) ? "♥" : "♡";
    heart.closest(".card, .d-info")?.classList.remove("saved");
    return;
  }
  const tr = t.closest("[data-trailer]");
  if (tr){
    player.open({ kind: "yt", src: tr.dataset.trailer, title: tr.dataset.tname ?? "trailer" });
    return;
  }
  /* open a stream straight from a list */
  const stream = t.closest(".stream");
  if (stream){ /* children handle their own bubbles — wireStreams owns these */ return }

  const card = t.closest(".card[data-id]");
  if (card){
    /* the continue-watching rail can carry a ref like tt:1:2 — open its detail */
    location.hash = `#/detail/${card.dataset.type ?? "movie"}/${card.dataset.id}`;
  }
});

/* esc folds the player */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#player").classList.contains("hidden")) player.close();
});

/* ── addons drawer ───────────────────────────────────────── */
const dlg = $("#addons");
$("#addonsBtn").onclick = () => { 
  const bu = $("#backendUrl"); if (bu && !bu.value) bu.value = backendUrl();
  // lazy-bind backend test/save (robust against cached/old DOM)
  const saveBtn = $("#backendSave");
  if (saveBtn && !saveBtn._bound){ saveBtn._bound = true; saveBtn.onclick = () => {
    const u = $("#backendUrl").value.trim() || "http://127.0.0.1:7000";
    setBackendUrl(u);
    $("#backendStatus").textContent = `saved: ${u} 🌿`;
  };}
  const testBtn = $("#backendTest");
  if (testBtn && !testBtn._bound){ testBtn._bound = true; testBtn.onclick = async () => {
    const u = $("#backendUrl").value.trim() || backendUrl();
    setBackendUrl(u);
    $("#backendStatus").textContent = "testing…";
    try{
      const r = await fetch(`${u}/health`, { signal: AbortSignal.timeout(2000) });
      const d = await r.json();
      $("#backendStatus").textContent = r.ok ? `✓ connected — ${d.service || "ok"} (${d.sessions ?? 0} sessions)` : `✗ ${r.status}`;
    }catch(e){ $("#backendStatus").textContent = `✗ offline (${e.message})` }
  };}
  renderSuggested();
  renderCommunity();
  renderAddonList(); dlg.showModal() 
};
$("#addonAdd").onclick = doPlant;
$("#addonUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") doPlant() });

/* suggested addons (well-known community manifests) */
const SUGGESTED = [
  { name: "Kitsu (anime)", url: "https://kitsu.strem.io/manifest.json" },
  { name: "OpenSubtitles", url: "https://opensubtitles.strem.io/manifest.json" },
  { name: "ThePirateBay", url: "https://thepiratebay.strem.io/manifest.json" },
  { name: "YTS (movies)", url: "https://yts.strem.io/manifest.json" },
  { name: "EZTV (series)", url: "https://eztv.strem.io/manifest.json" },
  { name: "TMDB", url: "https://tmdb.strem.io/manifest.json" },
  { name: "WatchHub", url: "https://watchhub.strem.io/manifest.json" },
  { name: "YouTube", url: "https://youtube.strem.io/manifest.json" },
  { name: "RARBG", url: "https://rarbg.strem.io/manifest.json" },
  { name: "1337x", url: "https://1337x.strem.io/manifest.json" },
  { name: "HorribleSubs (anime)", url: "https://horriblesubs.strem.io/manifest.json" },
  { name: "IMDb List", url: "https://imdb-list.strem.io/manifest.json" },
  { name: "Top Movies", url: "https://top-movies.strem.io/manifest.json" },
];
function renderSuggested(){
  const box = $("#suggestedAddons"); if (!box) return;
  const planted = addonUrls();
  box.innerHTML = SUGGESTED.map(s => {
    const isPlanted = planted.includes(s.url);
    return `<div class="addon"><div class="meta"><div class="nm">${esc(s.name)}</div>
      <div class="ds">${esc(s.url)}</div></div>
      <button class="icon-btn ${isPlanted ? "rm" : ""}" data-sug="${esc(s.url)}">
        ${isPlanted ? "unplant 🍂" : "plant 🌱"}</button></div>`;
  }).join("");
  $$("#suggestedAddons [data-sug]").forEach(b => b.onclick = async () => {
    const u = b.dataset.sug;
    if (addonUrls().includes(u)){
      setAddonUrls(addonUrls().filter(x => x !== u));
      renderAddonList(); renderSuggested(); route();
    } else {
      b.textContent = "planting…";
      try{
        const m = await loadManifest(u);
        setAddonUrls([...addonUrls(), u]);
        b.textContent = `🌿 ${m.name}`;
        renderAddonList(); renderSuggested();
      }catch(err){ b.textContent = "didn't sprout 🍂" }
    }
  });
}

async function renderCommunity(){
  const box = $("#communityAddons"); if (!box) return;
  const status = $("#communityStatus");
  if (status) status.textContent = "loading the collection…";
  box.innerHTML = `<div class="muted small" style="padding:8px">loading…</div>`;
  let list = [];
  try{ list = await addonCollection() }catch(e){ list = [] }
  if (!list.length){ if (status) status.textContent = "couldn't reach the collection (offline?)"; box.innerHTML = ""; return }
  const planted = addonUrls();
  box.innerHTML = list.map(a => `
    <div class="addon">
      ${a.logo ? `<img src="${esc(a.logo)}" onerror="this.style.display='none'"/>` : `<img src="assets/logo.svg"/>`}
      <div class="meta"><div class="nm">${esc(a.name)}</div>
        <div class="ds">${esc(a.description || (a.types||[]).join(", "))}</div></div>
      <button class="icon-btn ${planted.includes(a.url) ? "rm" : ""}" data-com="${esc(a.url)}">
        ${planted.includes(a.url) ? "unplant 🍂" : "plant 🌱"}</button>
    </div>`).join("");
  if (status) status.textContent = `${list.length} addons available`;
  $$("#communityAddons [data-com]").forEach(b => b.onclick = async () => {
    const u = b.dataset.com;
    if (addonUrls().includes(u)){
      setAddonUrls(addonUrls().filter(x => x !== u));
      renderAddonList(); renderCommunity(); renderSuggested();
    } else {
      b.textContent = "planting…";
      try{
        const m = await loadManifest(u);
        setAddonUrls([...addonUrls(), u]);
        b.textContent = `🌿 ${m.name}`;
        renderAddonList(); renderCommunity(); renderSuggested();
      }catch(err){ b.textContent = "didn't sprout 🍂" }
    }
  });
}
const debridPlantBtn = $("#debridPlant");
if (debridPlantBtn) debridPlantBtn.onclick = async () => {
  const key = $("#debridKey").value.trim();
  const prov = $("#debridProvider").value;
  if (!key) { $("#debridKey").placeholder = "paste your API key first"; return }
  const url = prov === "alldebrid"
    ? `https://torrentio.strem.fun/alldebrid=${encodeURIComponent(key)}/manifest.json`
    : `https://torrentio.strem.fun/realdebrid=${encodeURIComponent(key)}/manifest.json`;
  $("#debridKey").value = ""; $("#debridKey").placeholder = "planting…";
  try{
    const m = await loadManifest(url);
    setAddonUrls([...addonUrls(), url]);
    $("#debridKey").placeholder = `🌿 ${m.name} took root!`;
    renderAddonList();
  }catch(err){
    $("#debridKey").placeholder = "that key didn't sprout — check it";
  }
  setTimeout(() => $("#debridKey").placeholder = "paste your API key…", 2600);
};

/* playback engine test/save */
const backendSaveBtn = $("#backendSave");
if (backendSaveBtn) backendSaveBtn.onclick = () => {
  const u = $("#backendUrl").value.trim() || "http://127.0.0.1:7000";
  setBackendUrl(u);
  $("#backendStatus").textContent = `saved: ${u} 🌿`;
};
const backendTestBtn = $("#backendTest");
if (backendTestBtn) backendTestBtn.onclick = async () => {
  const u = $("#backendUrl").value.trim() || backendUrl();
  setBackendUrl(u);
  $("#backendStatus").textContent = "testing…";
  try{
    const r = await fetch(`${u}/health`, { signal: AbortSignal.timeout(2000) });
    const d = await r.json();
    $("#backendStatus").textContent = r.ok ? `✓ connected — ${d.service || "ok"} (${d.sessions ?? 0} sessions)` : `✗ ${r.status}`;
  }catch(e){ $("#backendStatus").textContent = `✗ offline (${e.message})` }
};

async function doPlant(){
  const inp = $("#addonUrl");
  let url = inp.value.trim();
  if (!url) return;
  url = url.replace(/^stremio:\/\//, "https://").replace(/^http:\/\//, "https://");
  inp.value = "";inp.placeholder = "planting…";
  try{
    const m = await loadManifest(url);
    setAddonUrls([...addonUrls(), url]);
    inp.placeholder = `🌿 ${m.name} took root!`;
    renderAddonList();
  }catch(err){
    inp.placeholder = "that seedling didn't sprout — check the manifest URL";
  }
  setTimeout(() => inp.placeholder = "https://…/manifest.json", 2600);
}

async function renderAddonList(){
  const box = $("#addonList");
  const urls = addonUrls();
  $("#addonCount").textContent = urls.length ? `${urls.length} addon${urls.length > 1 ? "s" : ""}` : "addons";
  if (!urls.length){ box.innerHTML = `<p class="muted small">the clearing is empty — plant your first addon above 🌱</p>`; return }
  box.innerHTML = urls.map(u => `<div class="addon" data-u="${esc(u)}"><span class="muted small">checking…</span></div>`).join("");
  await Promise.all(urls.map(async (u, i) => {
    const slot = box.querySelector(`[data-u="${CSS.escape(u)}"]`);
    if (!slot) return;
    try{
      const m = await loadManifest(u);
      slot.innerHTML = `
        <img src="${esc(m.logo || m.logoUrl || "assets/logo.svg")}" onerror="this.src='assets/logo.svg'"/>
        <div class="meta"><div class="nm">${esc(m.name)}</div>
          <div class="ds">${esc(m.description ?? `${(m.catalogs ?? []).length} catalogs · ${(m.types ?? m.types ?? []).join(", ")}`)}</div></div>
        <button class="icon-btn rm" data-rm="${esc(u)}" title="unplant">unplant 🍂</button>`;
      slot.querySelector("[data-rm]").onclick = () => {
        setAddonUrls(addonUrls().filter(x => x !== u));
        renderAddonList(); route();
      };
    }catch(err){
      slot.innerHTML = `<div style="flex:1" class="muted small">@ ${esc(u)} — couldn't grow (offline?)</div>
        <button class="icon-btn rm" data-rm="${esc(u)}">remove</button>`;
      slot.querySelector("[data-rm]").onclick = () => { setAddonUrls(addonUrls().filter(x => x !== u)); renderAddonList() };
    }
  }));
}

/* ═══════════════════════════════════════════════════════════
   THEME STUDIO — presets · accent · weather · wallpaper
   (settings live in localStorage; the forest remembers)
   ═══════════════════════════════════════════════════════════ */
const LS_SET = "streamio.settings";
const PRESETS = [
  { id: "rainforest",  name: "rainforest night", demo: "linear-gradient(135deg,#0c2618,#051108)", accent: "#7be38b" },
  { id: "glade",       name: "sunlit glade",     demo: "linear-gradient(135deg,#3f6b2c,#12240f)", accent: "#f2c94c" },
  { id: "pine",        name: "midnight pine",    demo: "linear-gradient(135deg,#0a2325,#030b0e)", accent: "#8fe8d2" },
  { id: "wildflower",  name: "wildflower hollow",demo: "linear-gradient(135deg,#3a2350,#120b18)", accent: "#ff8fab" },
];
const ACCENTS = ["#7be38b", "#f2c94c", "#8fe8d2", "#ff8fab", "#9ecbff", "#ffb37b", "#c9a6ff"];
const settings = (() => { try{ return JSON.parse(localStorage.getItem(LS_SET) || "{}") }catch{ return {} } })();
const saveSet = () => localStorage.setItem(LS_SET, JSON.stringify(settings));

function apply(){
  document.body.dataset.theme  = settings.theme  ?? "rainforest";
  document.body.dataset.rain   = settings.rain   === false ? "off" : "on";
  document.body.dataset.rays   = settings.rays   === false ? "off" : "on";
  document.body.dataset.grain  = settings.grain  === false ? "off" : "on";
  document.body.dataset.fire   = settings.fire   === false ? "off" : "on";
  document.body.dataset.vig    = settings.vignette === false ? "off" : "on";
  document.body.dataset.motion = settings.motion === false ? "off" : "on";
  document.body.dataset.font   = settings.font === "sans" ? "sans" : "serif";
  document.body.style.removeProperty("--glow");
  document.body.style.removeProperty("--moss");
  document.body.style.removeProperty("--card-w");
  document.body.style.removeProperty("--glass-b");
  if (settings.accent){
    const acc = settings.accent;
    /* glow strength (25–100%) bends the accent toward the gloom */
    const glow = (settings.glow != null && settings.glow < 100)
      ? `color-mix(in oklab, ${acc} ${settings.glow}%, transparent)` : acc;
    document.body.style.setProperty("--glow", glow);
    document.body.style.setProperty("--moss", `color-mix(in oklab, ${acc} 62%, #0d2a17)`);
  }
  if (settings.card != null && settings.card != "152")
    document.body.style.setProperty("--card-w", `${settings.card}px`);
  if (settings.blur != null && settings.blur != 12)
    document.body.style.setProperty("--glass-b", `${settings.blur}px`);
  let wall = document.querySelector(".wall-layer");
  if (settings.wall){
    wall ??= Object.assign(document.createElement("div"), { className: "wall-layer" });
    wall.style.backgroundImage = `url("${String(settings.wall).replace(/"/g, "%22")}")`;
    if (!wall.isConnected) document.body.prepend(wall);
  } else wall?.remove();
  document.title = "Streamio 🌿 — a media center for the forest";
}

const dlgS = $("#settings");
$("#settingsBtn").onclick = () => { paintSettings(); dlgS.showModal() };

function paintSettings(){
  $("#themePreset").innerHTML = PRESETS.map(p => `
    <button class="swatch ${(settings.theme ?? "rainforest") === p.id ? "on" : ""}" data-preset="${p.id}" title="${p.name}">
      <i style="background:${p.demo}"></i><span>${p.name}</span>
    </button>`).join("");
  $$("#themePreset .swatch").forEach(b => b.onclick = () => {
    settings.theme = b.dataset.preset; settings.accent = undefined; saveSet(); apply(); paintSettings();
  });
  $("#accentPreset").innerHTML = "";
  for (const c of ACCENTS){
    const b = document.createElement("button");
    b.className = "swatch accent-swatch"; b.title = c;
    b.style.background = c;
    b.style.outline = settings.accent === c ? `2px solid var(--text)` : "none";
    b.style.outlineOffset = "2px";
    b.onclick = () => { settings.accent = settings.accent === c ? undefined : c; saveSet(); apply(); paintSettings() };
    $("#accentPreset").appendChild(b);
  }
  $("#accentCustom").value = settings.accent ?? "#7be38b";
  $("#setRain").checked  = settings.rain  !== false;
  $("#setRays").checked  = settings.rays  !== false;
  $("#setGrain").checked = settings.grain !== false;
  $("#setFire").checked  = settings.fire  !== false;
  $("#setVig").checked   = settings.vignette !== false;
  $("#setMotion").checked= settings.motion !== false;
  $("#setGlow").value    = settings.glow ?? 100;   $("#outGlow").textContent = `${settings.glow ?? 100}%`;
  $("#setCard").value    = settings.card ?? 152;   $("#outCard").textContent = `${settings.card ?? 152}px`;
  $("#setGlass").value   = settings.blur ?? 12;    $("#outGlass").textContent = `${settings.blur ?? 12}px`;
  $$(".seg-row [data-font]").forEach(b => b.classList.toggle("on", (settings.font ?? "serif") === b.dataset.font));
}
$("#accentCustom").addEventListener("input", (e) => {
  settings.accent = e.target.value; saveSet(); apply();
});
$("#setRain").onchange  = (e) => { settings.rain  = e.target.checked; saveSet(); apply() };
$("#setRays").onchange  = (e) => { settings.rays  = e.target.checked; saveSet(); apply() };
$("#setGrain").onchange = (e) => { settings.grain = e.target.checked; saveSet(); apply() };
$("#setFire").onchange  = (e) => { settings.fire  = e.target.checked; saveSet(); apply() };
$("#setVig").onchange   = (e) => { settings.vignette = e.target.checked; saveSet(); apply() };
$("#setMotion").onchange= (e) => { settings.motion = e.target.checked; saveSet(); apply() };
$("#setGlow").addEventListener("input",  (e) => { settings.glow = +e.target.value; $("#outGlow").textContent = `${e.target.value}%`; saveSet(); apply() });
$("#setCard").addEventListener("input",  (e) => { settings.card = +e.target.value; $("#outCard").textContent = `${e.target.value}px`; saveSet(); apply() });
$("#setGlass").addEventListener("input", (e) => { settings.blur = +e.target.value; $("#outGlass").textContent = `${e.target.value}px`; saveSet(); apply() });
$$(".seg-row [data-font]").forEach(b => b.onclick = () => { settings.font = b.dataset.font; saveSet(); apply(); paintSettings() });
$("#wallSet").onclick = () => {
  const v = $("#wallPath").value.trim();
  if (!v) return;
  settings.wall = v; saveSet(); apply(); dlgS.close();
};
$("#wallClear").onclick = () => { settings.wall = undefined; delete settings.wall; saveSet(); apply() };
$("#resetAll").onclick = () => { localStorage.removeItem(LS_SET);
  for (const k of ["theme","accent","wall","rain","rays","grain","fire","vignette","motion","glow","card","blur","font"]) delete settings[k];
  apply(); paintSettings();
};

/* ═══════════════════════════════════════════════════════════
   FIRST LIGHT — welcome + one-click planting of the basics
   ═══════════════════════════════════════════════════════════ */
const dlgW = $("#welcome");
if (localStorage.getItem("streamio.greeted") !== "yes" && addonUrls().length === 0){
  $("#seedList").innerHTML = SEEDS.map(s => `
    <div class="addon"><img src="assets/logo.svg"/>
      <div class="meta"><div class="nm">${s.name}</div><div class="ds">${s.icon}</div></div>
    </div>`).join("");
  $("#plantAll").onclick = async () => {
    setAddonUrls([...addonUrls(), ...SEEDS.map(s => s.url)]);
    $("#addonCount").textContent = `${SEEDS.length} addons`;
    localStorage.setItem("streamio.greeted", "yes");
    dlgW.close(); route();
  };
  ["click", "keydown"].forEach(() => dlgW.addEventListener("close", () => localStorage.setItem("streamio.greeted", "yes"), { once: true }));
  setTimeout(() => dlgW.showModal(), 700);
}

/* ── attraction: follow-glow + rail arrows ───────────────── */
document.addEventListener("pointermove", (e) => {
  const card = e.target.closest?.(".card");
  if (!card) return;
  const b = card.getBoundingClientRect();
  card.style.setProperty("--gx", `${((e.clientX - b.left) / b.width) * 100}%`);
  card.style.setProperty("--gy", `${((e.clientY - b.top) / b.height) * 100}%`);
}, { passive: true });

document.addEventListener("click", (e) => {
  const n = e.target.closest(".rail-nav");
  if (!n) return;
  const rail = n.closest(".rail-w")?.querySelector(".rail");
  rail?.scrollBy({ left: n.dataset.dir === "prev" ? -700 : 700, behavior: "smooth" });
});

/* ═══════════════════════════════════════════════════════════
   canopy vines on the page corners ──────────────────────── */
const vine = (cls) => {
  const v = document.createElement("div");
  v.className = `vine ${cls}`; v.setAttribute("aria-hidden", "true");
  v.innerHTML = `<svg width="88" height="150" viewBox="0 0 88 150">
    <path d="M44 0C40 44 46 84 30 132c-6-24-2-64 8-92-8 2-18 10-24 22 2-18 14-32 30-62Z" fill="#123c22"/>
    <path d="M40 0c14 30 12 66 2 104-14-26-16-70-2-104Z" fill="#1d5330" opacity=".9"/>
    <ellipse cx="26" cy="86" rx="13" ry="6" fill="#2f6b3f" transform="rotate(-26 26 86)"/>
    <ellipse cx="52" cy="64" rx="12" ry="5" fill="#2f6b3f" transform="rotate(22 52 64)"/>
    <ellipse cx="38" cy="118" rx="11" ry="5" fill="#14381f" transform="rotate(-14 38 118)"/>
  </svg>`;
  document.body.appendChild(v);
};
if (matchMedia("(min-width: 1100px)").matches){ vine("l"); vine("r") }

/* drifting fireflies among the leaves — spawn a wandering swarm once */
(function fireflies(){
  const box = document.querySelector(".fireflies");
  if (!box) return;
  for (let i = 0; i < 14; i++){
    const s = document.createElement("i");
    s.style.setProperty("--x",  `${(Math.random() * 96).toFixed(1)}vw`);
    s.style.setProperty("--y0", `${(52 + Math.random() * 42).toFixed(1)}vh`);
    s.style.setProperty("--t",  `${(14 + Math.random() * 24).toFixed(1)}s`);
    s.style.setProperty("--d",  `${(-Math.random() * 34).toFixed(1)}s`);
    s.style.setProperty("--o",  `${(0.3 + Math.random() * 0.45).toFixed(2)}`);
    s.style.setProperty("--s",  `${(2 + Math.random() * 3).toFixed(1)}px`);
    box.appendChild(s);
  }
})();

/* ── first flight ────────────────────────────────────────── */
function syncAddonCount(){ try { const n = addonUrls().length; const el = document.getElementById("addonCount"); if (el) el.textContent = n ? `${n} addon${n > 1 ? "s" : ""}` : "addons" } catch(e){} }
syncAddonCount();
addEventListener("DOMContentLoaded", () => { syncAddonCount(); apply(); route() });
if (document.readyState !== "loading") { apply(); route(); }
