/* ═══════════════════════════════════════════════════════════
   STREAMIO · main.js — routes, nav, addons, delegation
   ═══════════════════════════════════════════════════════════ */
import { homeView, browseView, searchView, libraryView, openDetail, $, $$, wireStreams } from "./ui.js";
import { addonUrls, setAddonUrls, loadManifest } from "./api.js";
import { toggleSaved } from "./library.js";
import * as player from "./player.js";

const root = $("#view");

/* ── router ──────────────────────────────────────────────── */
async function route(){
  const h = location.hash || "#/home";
  const [, seg, ...rest] = h.split("/");
  $$("#navLinks a").forEach(a =>
    a.classList.toggle("on", h.startsWith(`#${ seg }`)));

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
$("#addonsBtn").onclick = () => { renderAddonList(); dlg.showModal() };
$("#addonAdd").onclick = doPlant;
$("#addonUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") doPlant() });

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

/* ── canopy vines on the page corners ────────────────────── */
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

/* ── first flight ────────────────────────────────────────── */
addEventListener("DOMContentLoaded", route);
if (document.readyState !== "loading") route();
