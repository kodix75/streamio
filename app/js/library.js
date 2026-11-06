/* ═══════════════════════════════════════════════════════════
   STREAMIO · library.js — saved items + continue watching
   (localStorage, lives in your browser, no account)
   ═══════════════════════════════════════════════════════════ */

const SAVED = "streamio.saved";
const PROGRESS = "streamio.progress";

const readMap = (k) => { try{ return new Map(Object.entries(JSON.parse(localStorage.getItem(k) || "{}"))) }catch{ return new Map() } };
const writeMap = (k, m) => localStorage.setItem(k, JSON.stringify(Object.fromEntries(m)));

const saved = readMap(SAVED);
const progress = readMap(PROGRESS);
const saveS = () => writeMap(SAVED, saved);
const saveP = () => writeMap(PROGRESS, progress);

/* ── saved (the library) ─────────────────────────────────── */
export const isSaved = (id) => saved.has(id);
export function toggleSaved(metaSnapshot){
  const { id } = metaSnapshot;
  if (saved.has(id)) saved.delete(id);
  else saved.set(id, { ...metaSnapshot, savedAt: Date.now() });
  saveS(); return isSaved(id);
}
export function savedItems(){ return [...saved.values()].sort((a,b) => b.savedAt - a.savedAt) }

/* ── continue watching ───────────────────────────────────── */
export function saveProgress(ref, time, dur, snapshot){
  if (!dur || time < 8 || time > dur - 90) { progress.delete(ref); saveP(); return }
  progress.set(ref, { t: time, d: dur, ts: Date.now(), ...snapshot });
  saveP();
}
export const getProgress = (ref) => progress.get(ref);
export function continueWatching(limit = 12){
  return [...progress.entries()]
    .map(([ref, v]) => ({ ...v, ref, imdb: (ref.split(":")[0]), label: ref }))
    .sort((a,b) => b.ts - a.ts)
    .slice(0, limit);
}
