/* ═══════════════════════════════════════════════════════════
   STREAMIO · api.js — Cinemeta (built-in) + Stremio addons
   ═══════════════════════════════════════════════════════════ */

export const CINEMETA = "https://v3-cinemeta.strem.io";
const LS_ADDONS = "streamio.addonUrls";

/* ── addon registry ──────────────────────────────────────── */
export function addonUrls(){ try{ return JSON.parse(localStorage.getItem(LS_ADDONS) || "[]") }catch{ return [] } }
export function setAddonUrls(list){ localStorage.setItem(LS_ADDONS, JSON.stringify([...new Set(list)])) }

const manifestCache = new Map(); // url -> manifest | {error}
export async function loadManifest(url){
  if (manifestCache.has(url)) return manifestCache.get(url);
  const u = url.replace(/^stremio:\/\//,"https://").replace(/^http:\/\//,"https://");
  const m = { url, ...await jget(u) };
  manifestCache.set(url, m);
  return m;
}
export function getManifestCache(){ return manifestCache }

async function jget(url){
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/* ── catalogs ────────────────────────────────────────────── */
export async function cinemetaCatalog(type, extra = ""){
  const x = extra ? `/${extra}` : "";
  return (await jget(`${CINEMETA}/catalog/${type}/top${x}.json`)).metas ?? [];
}
export async function addonCatalogs(){
  /* every planted addon's first catalog, flattened */
  const out = [];
  for (const url of addonUrls()){
    try{
      const m = await loadManifest(url);
      for (const c of (m.catalogs ?? [])){
        if (c.extraRequired?.length) continue;
        out.push({
          addon: m, type: c.type, id: c.id, name: `${m.name} · ${c.name ?? c.id}`,
          posterShape: c.extraSupported?.includes("search") ? c.posterShape : c.posterShape,
          fetch: (extra) =>
            jget(`${url.replace(/^stremio:\/\//,"https://")}/catalog/${c.type}/${c.id}${extra?`/${extra}`:""}.json`).then(r => r.metas ?? []),
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

/* ── streams: from every planted addon that serves them ──── */
export async function streams(type, id){
  const all = [];
  for (const url of addonUrls()){
    try{
      const m = await loadManifest(url);
      const wantsStream = (m.resources ?? m.resource ?? "").toString() === "stream"
        || m.resources?.some?.(r => r.name ? r.name === "stream" : r === "stream");
      const types = (m.types ?? m.idPrefixes ?? []) ;
      if (!wantsStream) continue;
      if (types.length && !types.includes(type) && !types.includes("all")) continue;
      const s = await jget(`${url.replace(/^stremio:\/\//,"https://").replace(/\?.*$/,"")}/stream/${type}/${id}.json`);
      (s.streams ?? []).forEach(st => all.push({ ...st, _addon: m }));
    }catch(e){ console.warn("streams failed", url, e) }
  }
  return all;
}

/* classify a stream so the player knows how to grow it */
export function classify(s){
  if (s.ytId || /^yt:/.test(s.info || "")) return "yt";
  if (s.infoHash || /^magnet:/i.test(s.url || "")) return "torrent";
  if (s.url && /\.m3u8($|\?)/i.test(s.url)) return "hls";
  if (s.url && /^https?:/.test(s.url)) return "file";
  if (s.externalUrl) return "external";
  return "unknown";
}
export function streamTitle(s){
  if (s.title) return s.title;
  if (s.info) return s.info;
  if (s.name) return s.description ?? s.name;
  return s.url ?? s.ytId ?? "mysterious stream";
}
export function streamSource(s){ return s.source ?? s._addon?.name ?? "the forest" }
