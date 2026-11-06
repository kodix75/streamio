/* ═══════════════════════════════════════════════════════════
   STREAMIO · api.js — Cinemeta (built-in) + Stremio addons
   addon manifest may sit at:
     https://host/manifest.json                  → base https://host/
     https://host/path/manifest.json             → base https://host/path/
     https://host/providers=x/y/manifest.json    → base …/providers=x/y/
   endpoints mirror that base: /catalog/… /stream/… /meta/…
   ═══════════════════════════════════════════════════════════ */

export const CINEMETA = "https://v3-cinemeta.strem.io";
const LS_ADDONS = "streamio.addonUrls";
const MANIFEST_NAME = "manifest.json";

/* ── addon registry ──────────────────────────────────────── */
export function addonUrls(){ try{ return JSON.parse(localStorage.getItem(LS_ADDONS) || "[]") }catch{ return [] } }
export function setAddonUrls(list){ localStorage.setItem(LS_ADDONS, JSON.stringify([...new Set(list)])) }

/* normalize any manifest URL to a clean HTTPS base */
export function baseOf(manifestUrl){
  let u = String(manifestUrl).trim();
  u = u.replace(/^stremio:\/\//, "https://").replace(/^http:\/\//, "https://");
  u = u.replace(/\/+$/, "");
  const i = u.toLowerCase().lastIndexOf("/" + MANIFEST_NAME);
  if (i >= 0) u = u.slice(0, i);
  return u;
}

const manifestCache = new Map(); // url -> manifest (+.base)
export async function loadManifest(url){
  if (manifestCache.has(url)) return manifestCache.get(url);
  const base = baseOf(url);
  const m = { url, base, ...await jget(`${base}/${MANIFEST_NAME}`) };
  if (!m.name) throw new Error("not an addon manifest");
  manifestCache.set(url, m);
  return m;
}
export function getManifestCache(){ return manifestCache }

async function jget(url){
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/* addon wants streams for this type? manifest resource forms:
   "stream" | ["meta","stream",…] | [{name:"stream",types:["movie"]}] */
function wantsStreams(m, type){
  const rs = m.resources ?? m.resource ?? [];
  const arr = Array.isArray(rs) ? rs : [rs];
  return arr.some(r => {
    if (typeof r === "string") return r === "stream";
    if (r && r.name === "stream"){
      const types = r.types ?? m.types ?? ["movie", "series", "all"];
      return types.includes(type) || types.includes("all");
    }
    return false;
  });
}

/* ── catalogs ────────────────────────────────────────────── */
export async function cinemetaCatalog(type, extra = ""){
  const x = extra ? `/${extra}` : "";
  return (await jget(`${CINEMETA}/catalog/${type}/top${x}.json`)).metas ?? [];
}
export async function addonCatalogs(){
  const out = [];
  for (const url of addonUrls()){
    try{
      const m = await loadManifest(url);
      for (const c of (m.catalogs ?? [])){
        if ((c.extraRequired ?? []).length) continue;
        out.push({
          addon: m, type: c.type, id: c.id, name: `${m.name} · ${c.name ?? c.id}`,
          async fetch(extra){
            const d = await jget(`${m.base}/catalog/${c.type}/${c.id}${extra ? `/${extra}` : ""}.json`);
            return d.metas ?? [];
          },
        });
      }
    }catch(e){ console.warn("addon catalog failed", url, e) }
  }
  return out;
}

/* ── meta detail ─────────────────────────────────────────── */
export async function meta(type, id){
  return (await jget(`${CINEMETA}/meta/${type}/${id}.json`)).meta;
}

/* quality / codec pill heuristic */
export function streamPills(s, id){
  const t = `${s.title ?? ""} ${s.info ?? ""} ${s.name ?? ""}`;
  const pills = [];
  const q = ["2160p","4K","1080p","720p","480p","360p"].find(x => t.toLowerCase().includes(x.toLowerCase()));
  if (q) pills.push(q.replace("4K","2160p"));
  if (t.match(/\bhdr\b/i)) pills.push("HDR");
  if (t.match(/\bdv\b/i)) pills.push("DolbyVision");
  const codec = ["h265","x265","hevc","h264","x264","av1"].find(c => t.toLowerCase().includes(c));
  if (codec) pills.push(codec.toUpperCase());
  if (/web[- ]?dl/i.test(t)) pills.push("WEB-DL");
  if (/blu[- ]?ray|brremux|remux/i.test(t)) pills.push("BluRay");
  if (s.infoHash || /^magnet:/i.test(s.url ?? "")) pills.push("p2p");
  return pills;
}

/* ── streams: from every planted addon that serves them ──── */
export async function streams(type, id){
  const all = [];
  for (const url of addonUrls()){
    try{
      const m = await loadManifest(url);
      if (!wantsStreams(m, type)) continue;
      const d = await jget(`${m.base}/stream/${type}/${id}.json`);
      (d.streams ?? []).forEach(s => all.push({ ...s, _addon: m }));
    }catch(e){ console.warn("streams failed", url, e) }
  }
  /* nicest first: resolution then debrid/http then p2p */
  const rank = (s) => {
    const t = `${s.title ?? ""} ${s.info ?? ""}`.toLowerCase();
    const res = /2160/.test(t) ? 4 : /1080/.test(t) ? 3 : /720/.test(t) ? 2 : 1;
    const inst = s.url && /^https/.test(s.url) ? 2 : 0;   /* debrid / direct → instant */
    return res * 10 + inst;
  };
  return all.sort((a, b) => rank(b) - rank(a));
}

/* classify so the player understands every flavor */
export function classify(s){
  if (s.ytId || /^yt:/.test(s.info ?? "")) return "yt";
  if (s.infoHash) return "torrent";
  if (/^magnet:/i.test(s.url ?? "")) return "torrent";
  if (s.url && /\.m3u8($|\?)/i.test(s.url)) return "hls";
  if (s.url && /^https?:/.test(s.url)) return "file";
  if (s.externalUrl && s.behaviorHints?.proxyStreams === false) return "external";
  return s.externalUrl ? "external" : "unknown";
}
export function streamTitle(s){
  if (s.title) return s.title;
  if (s.info) return s.info;
  if (s.name) return s.description ?? s.name;
  return s.url ?? s.ytId ?? "mysterious stream";
}
export function streamSource(s){ return s.source ?? s._addon?.name ?? "the forest" }

/* curated seedlings for the first planting */
export const SEEDS = [
  {
    name: "Torrentio", url: "https://torrentio.strem.fun/manifest.json",
    icon: " Torrentio-style streams across every grove (torrent/debrid providers)",
  },
  {
    name: "Cinemeta Addon", url: `${CINEMETA}/manifest.json`,
    icon: "Cinemeta's own manifests: extra catalogs & more",
  },
];
