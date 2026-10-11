/* Carnet — partie Course (Garmin via Intervals.icu) */
(function(){
const SKEY = "carnet-icu-v1";
const RKEY = "carnet-runs-icu-v1";
const API = "https://intervals.icu/api/v1";
const view = document.getElementById("run-view");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const RUN_TYPES = ["Run","TrailRun","VirtualRun","Treadmill"];

let auth = load(SKEY) || {};
let runs = load(RKEY) || {list:[], lastSync:0, fcMax:null};
let current = null;
let syncing = false, syncErr = "", setupErr = "";
let streamCache = {};

function load(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return null; } }
function saveAuth(){ try { localStorage.setItem(SKEY, JSON.stringify(auth)); } catch(e){} }
function saveRuns(){ try { localStorage.setItem(RKEY, JSON.stringify(runs)); } catch(e){} }
const connected = () => !!(auth.athleteId && auth.apiKey && auth.ok);

/* ---------- IndexedDB pour les courbes ---------- */
let idbP = null;
function idb(){
  if (!idbP) idbP = new Promise(res => {
    try {
      const r = indexedDB.open("carnet-runs", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("streams");
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch(e){ res(null); }
  });
  return idbP;
}
async function idbGet(k){ const db = await idb(); if (!db) return null;
  return new Promise(res => { try { const q = db.transaction("streams").objectStore("streams").get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch(e){ res(null); } }); }
async function idbPut(k, v){ const db = await idb(); if (!db) return;
  return new Promise(res => { try { const tx = db.transaction("streams","readwrite"); tx.objectStore("streams").put(v, k); tx.oncomplete = res; tx.onerror = res; } catch(e){ res(); } }); }

/* ---------- Intervals.icu ---------- */
async function api(path){
  let r;
  try { r = await fetch(API + path, {headers:{Authorization:"Basic " + btoa("API_KEY:" + auth.apiKey)}}); }
  catch(e){ throw new Error(navigator.onLine === false ? "Pas de connexion internet." : "Intervals.icu ne répond pas à l'app (accès bloqué). Préviens Claude."); }
  if (r.status === 401 || r.status === 403) throw new Error("Clé API ou Athlete ID refusé. Vérifie-les dans les réglages d'Intervals.icu.");
  if (r.status === 404) throw new Error("Athlete ID introuvable. Il commence par « i », par exemple i123456.");
  if (r.status === 429) throw new Error("Trop de requêtes. Réessaie dans quelques minutes.");
  if (!r.ok) throw new Error("Erreur Intervals.icu " + r.status);
  return r.json();
}
const day = d => d.toISOString().slice(0, 10);
const num = (...v) => { for (const x of v) if (x != null && isFinite(x)) return +x; return null; };

/* ---------- Synchronisation ---------- */
async function sync(force){
  if (!connected() || syncing) return;
  if (!force && Date.now() - runs.lastSync < 10 * 60 * 1000) return;
  syncing = true; syncErr = ""; render();
  try {
    const newest = runs.list.reduce((m, r) => Math.max(m, Date.parse(r.start.replace("Z",""))), 0);
    const oldest = newest ? new Date(newest - 3 * 864e5) : new Date(Date.now() - 120 * 864e5);
    const acts = await api(`/athlete/${encodeURIComponent(auth.athleteId)}/activities?oldest=${day(oldest)}&newest=${day(new Date(Date.now() + 864e5))}`);
    const byId = new Map(runs.list.map(r => [r.id, r]));
    for (const a of acts || []) {
      const type = a.type || a.sport_type;
      const dist = num(a.distance, a.icu_distance);
      if (!RUN_TYPES.includes(type) || !dist) continue;
      const moving = num(a.moving_time, a.elapsed_time) || 0;
      let cad = num(a.average_cadence); if (cad && cad < 120) cad *= 2;
      byId.set(String(a.id), {
        id: String(a.id), name: a.name || "Course", start: a.start_date_local || a.start_date, dist, moving, elapsed: num(a.elapsed_time, moving),
        elev: num(a.total_elevation_gain, a.icu_elevation_gain), speed: num(a.average_speed, moving ? dist / moving : null), maxSpeed: num(a.max_speed),
        hr: num(a.average_heartrate, a.icu_average_hr), maxHr: num(a.max_heartrate, a.icu_hr_max), cad, type
      });
    }
    runs.list = [...byId.values()].sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
    runs.lastSync = Date.now(); saveRuns();
  } catch(e){ syncErr = e.message || "Synchronisation impossible."; }
  syncing = false; render();
}

async function getStreams(id){
  if (streamCache[id]) return streamCache[id];
  let s = await idbGet("icu-" + id);
  if (!s) {
    const raw = await api(`/activity/${encodeURIComponent(id)}/streams.json?types=time,distance,heartrate,velocity_smooth,altitude,fixed_altitude,cadence,latlng`);
    s = {};
    for (const st of (Array.isArray(raw) ? raw : [])) {
      if (!st || !st.type || !st.data) continue;
      if (st.type === "latlng") { if (st.data2) s.latlng = st.data.map((la, i) => [la, st.data2[i]]); else s.latlng = st.data; }
      else s[st.type] = st.data;
    }
    if (!s.altitude && s.fixed_altitude) s.altitude = s.fixed_altitude;
    if (!s.velocity_smooth && s.distance && s.time) s.velocity_smooth = s.distance.map((d, i) => { const j = Math.max(0, i - 5); const dt = s.time[i] - s.time[j]; return dt > 0 ? (d - s.distance[j]) / dt : null; });
    if (s.cadence) { const sorted = s.cadence.filter(x => x > 30).sort((a, b) => a - b); const med = sorted[sorted.length >> 1] || 0; if (med < 120) s.cadence = s.cadence.map(x => x * 2); }
    await idbPut("icu-" + id, s);
  }
  streamCache[id] = s; return s;
}

/* ---------- Formats ---------- */
const pad = n => String(n).padStart(2, "0");
function fmtDur(sec){ sec = Math.round(sec); const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60; return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`; }
function fmtPace(minKm){ if (!isFinite(minKm) || minKm <= 0) return "–"; let m = Math.floor(minKm), s = Math.round((minKm - m) * 60); if (s === 60) { m++; s = 0; } return `${m}:${pad(s)}`; }
const paceFromSpeed = v => v > 0 ? 1000 / v / 60 : NaN;
const km = m => (m / 1000).toFixed(2).replace(".", ",");
function fmtDate(iso, long){
  const d = new Date(iso.replace("Z", ""));
  return d.toLocaleDateString("fr-FR", long ? {weekday:"long", day:"numeric", month:"long", hour:"2-digit", minute:"2-digit"} : {weekday:"short", day:"numeric", month:"short"});
}
function fcMax(){
  if (runs.fcMax) return runs.fcMax;
  const m = runs.list.reduce((a, r) => Math.max(a, r.maxHr || 0), 0);
  return m || 190;
}

/* ---------- Graphiques SVG ---------- */
const W = 340, H = 150, PL = 34, PR = 8, PT = 8, PB = 20;
let charts = []; // pour le curseur synchronisé

function niceTicks(min, max, n){
  const span = max - min || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1,2,2.5,5,10].map(f => f * mag).find(s => span / s <= n) || mag * 10;
  const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
function quantile(arr, q){ const a = arr.filter(v => v != null && isFinite(v)).sort((x, y) => x - y); if (!a.length) return NaN; return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]; }

function lineChart(id, xs, ys, opt){
  const xMax = xs[xs.length - 1] || 1;
  let lo = opt.min != null ? opt.min : quantile(ys, .02), hi = opt.max != null ? opt.max : quantile(ys, .98);
  if (!isFinite(lo) || !isFinite(hi)) return `<p class="muted">Pas de données.</p>`;
  const padY = (hi - lo) * .12 || 1; lo -= padY; hi += padY;
  const sx = x => PL + (x / xMax) * (W - PL - PR);
  const sy = y => { const t = (y - lo) / (hi - lo); return opt.invert ? PT + t * (H - PT - PB) : H - PB - t * (H - PT - PB); };
  let d = "", area = "", on = false, segStart = null;
  const base = opt.invert ? PT : H - PB;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y == null || !isFinite(y)) { if (on) { area += `L${sx(xs[i-1]).toFixed(1)},${base}Z`; on = false; } continue; }
    const cy = Math.min(H - PB, Math.max(PT, sy(y)));
    const X = sx(xs[i]).toFixed(1), Y = cy.toFixed(1);
    if (!on) { d += `M${X},${Y}`; area += `M${X},${base}L${X},${Y}`; on = true; segStart = X; }
    else { d += `L${X},${Y}`; area += `L${X},${Y}`; }
  }
  if (on) area += `L${sx(xs[xs.length-1]).toFixed(1)},${base}Z`;
  const ticks = niceTicks(lo, hi, 4);
  let grid = "";
  for (const t of ticks) { const y = sy(t); if (y < PT || y > H - PB) continue; grid += `<line class="grid" x1="${PL}" x2="${W-PR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text x="${PL-4}" y="${(y+3).toFixed(1)}" text-anchor="end">${esc(opt.fmt(t))}</text>`; }
  const xt = niceTicks(0, xMax / 1000, 5);
  for (const t of xt) { const x = sx(t * 1000); if (x > W - PR + .5) continue; grid += `<text x="${x.toFixed(1)}" y="${H-6}" text-anchor="middle">${t.toString().replace(".", ",")}</text>`; }
  charts.push({id, xs, ys, sx, sy, xMax, fmt: opt.fmtVal || opt.fmt, unit: opt.unit || ""});
  return `<svg class="chart" id="ch-${id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label)}">
    ${grid}
    <path d="${area}" fill="${opt.color}" fill-opacity=".14"/>
    <path d="${d}" fill="none" stroke="${opt.color}" stroke-width="1.8" stroke-linejoin="round"/>
    <line class="cursor" id="cur-${id}" x1="0" x2="0" y1="${PT}" y2="${H-PB}" visibility="hidden"/>
    <circle id="dot-${id}" r="3.5" fill="${opt.color}" visibility="hidden"/>
  </svg>`;
}
function bindCursor(){
  const set = frac => {
    for (const c of charts) {
      const x = frac * c.xMax;
      let lo = 0, hi = c.xs.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c.xs[m] < x) lo = m; else hi = m; }
      const i = Math.abs(c.xs[lo] - x) < Math.abs(c.xs[hi] - x) ? lo : hi;
      const X = c.sx(c.xs[i]), y = c.ys[i];
      const cur = document.getElementById("cur-" + c.id), dot = document.getElementById("dot-" + c.id), val = document.getElementById("val-" + c.id);
      if (!cur) continue;
      cur.setAttribute("x1", X); cur.setAttribute("x2", X); cur.setAttribute("visibility", "visible");
      if (y != null && isFinite(y)) { dot.setAttribute("cx", X); dot.setAttribute("cy", Math.min(H-PB, Math.max(PT, c.sy(y)))); dot.setAttribute("visibility", "visible"); }
      else dot.setAttribute("visibility", "hidden");
      if (val) val.textContent = `${km(c.xs[i])} km · ${y != null && isFinite(y) ? c.fmt(y) + c.unit : "–"}`;
    }
  };
  const clear = () => { for (const c of charts) { const v = document.getElementById("val-" + c.id); ["cur-","dot-"].forEach(p => { const e = document.getElementById(p + c.id); if (e) e.setAttribute("visibility", "hidden"); }); if (v) v.textContent = v.dataset.def || ""; } };
  view.querySelectorAll("svg.chart").forEach(svg => {
    const move = ev => {
      const r = svg.getBoundingClientRect(); const p = ev.touches ? ev.touches[0] : ev;
      const xv = (p.clientX - r.left) / r.width * W;
      set(Math.min(1, Math.max(0, (xv - PL) / (W - PL - PR))));
    };
    svg.addEventListener("pointerdown", move); svg.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") move(e); });
    svg.addEventListener("touchmove", move, {passive:true});
    svg.addEventListener("pointerleave", clear); svg.addEventListener("touchend", () => setTimeout(clear, 1500));
  });
}

function routeSvg(pts){
  pts = (pts || []).filter(p => p && p[0] != null && p[1] != null && (p[0] || p[1])); if (pts.length < 2) return "";
  if (pts.length > 600) { const st = Math.ceil(pts.length / 600); pts = pts.filter((_, i) => i % st === 0); }
  const c = Math.cos(pts[0][0] * Math.PI / 180);
  const xy = pts.map(([la, lo]) => [lo * c, -la]);
  const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX || 1e-6, h = maxY - minY || 1e-6, S = 300, pd = 14;
  const k = (S - 2 * pd) / Math.max(w, h), VW = w * k + 2 * pd, VH = h * k + 2 * pd;
  const d = xy.map((p, i) => `${i ? "L" : "M"}${((p[0]-minX)*k+pd).toFixed(1)},${((p[1]-minY)*k+pd).toFixed(1)}`).join("");
  const s = xy[0], e = xy[xy.length-1];
  return `<svg class="route" viewBox="0 0 ${VW.toFixed(0)} ${VH.toFixed(0)}" role="img" aria-label="Parcours"><path d="${d}"/>
    <circle cx="${((s[0]-minX)*k+pd).toFixed(1)}" cy="${((s[1]-minY)*k+pd).toFixed(1)}" r="5" fill="var(--done)"/>
    <circle cx="${((e[0]-minX)*k+pd).toFixed(1)}" cy="${((e[1]-minY)*k+pd).toFixed(1)}" r="5" fill="var(--ink)"/></svg>`;
}

/* ---------- Analyse d'une course ---------- */
function smooth(arr, win){
  const out = new Array(arr.length); let sum = 0, n = 0; const q = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]; q.push(v); if (v != null) { sum += v; n++; }
    if (q.length > win) { const o = q.shift(); if (o != null) { sum -= o; n--; } }
    out[i] = n ? sum / n : null;
  }
  return out;
}
function downsample(n, max){ const step = Math.max(1, Math.ceil(n / max)); const idx = []; for (let i = 0; i < n; i += step) idx.push(i); if (idx[idx.length-1] !== n-1) idx.push(n-1); return idx; }
function splitsOf(s){
  const D = s.distance, T = s.time, HR = s.heartrate, A = s.altitude; if (!D || !T) return [];
  const out = []; let k = 1, i0 = 0, tPrev = 0;
  const at = (i, target) => T[i-1] + (T[i] - T[i-1]) * ((target - D[i-1]) / ((D[i] - D[i-1]) || 1));
  for (let i = 1; i < D.length; i++) {
    const last = i === D.length - 1;
    if (D[i] >= k * 1000 || last) {
      const target = last && D[i] < k * 1000 ? D[i] : k * 1000;
      const t = D[i] >= k * 1000 ? at(i, target) : T[i];
      const dist = target - (k - 1) * 1000;
      if (dist < 50) break;
      let hs = 0, hn = 0; if (HR) for (let j = i0; j <= i; j++) if (HR[j] != null) { hs += HR[j]; hn++; }
      out.push({k, dist, time: t - tPrev, pace: (t - tPrev) / 60 / (dist / 1000), hr: hn ? hs / hn : null, elev: A ? A[i] - A[i0] : null});
      tPrev = t; i0 = i; k++;
      if (last) break;
    }
  }
  return out;
}
function zonesOf(s, max){
  const HR = s.heartrate, T = s.time; if (!HR || !T) return null;
  const z = [0,0,0,0,0];
  for (let i = 1; i < HR.length; i++) {
    const dt = Math.min(30, T[i] - T[i-1]), p = HR[i] / max;
    const zi = p < .6 ? 0 : p < .7 ? 1 : p < .8 ? 2 : p < .9 ? 3 : 4;
    z[zi] += dt;
  }
  return z;
}

/* ---------- Écrans ---------- */
function render(){
  if (document.getElementById("run-view").hidden) return;
  charts = [];
  if (!connected()) return renderSetup();
  if (current) return renderDetail(current);
  renderList();
}

function renderSetup(){
  view.innerHTML = `<div class="card">
    <h2>Relier Garmin</h2>
    <p class="muted">Tes courses Garmin passent par Intervals.icu (gratuit) puis arrivent ici automatiquement.</p>
    <ol class="steps">
      <li>Sur <b>intervals.icu</b>, relie ton compte Garmin (Settings › Connections).</li>
      <li>Dans Settings › Developer Settings, génère une <b>API Key</b>.</li>
      <li>Colle ici ton <b>Athlete ID</b> (commence par « i ») et ta clé.</li></ol>
    <label class="field">Athlete ID<input id="sv-id" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="i123456" value="${esc(auth.athleteId || "")}"></label>
    <label class="field">API Key<input id="sv-key" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(auth.apiKey || "")}"></label>
    <button class="btn-main" id="sv-go" type="button">Connecter</button>
    ${setupErr ? `<p class="err">${esc(setupErr)}</p>` : ""}
    <p class="muted">Ces infos restent sur ton téléphone.</p>
  </div>`;
  document.getElementById("sv-go").addEventListener("click", async e => {
    let id = document.getElementById("sv-id").value.trim(), key = document.getElementById("sv-key").value.trim();
    if (/^\d+$/.test(id)) id = "i" + id;
    if (!id || key.length < 10) { setupErr = "Remplis l'Athlete ID et l'API Key."; return renderSetup(); }
    e.target.disabled = true; e.target.textContent = "Connexion…";
    auth = {athleteId: id, apiKey: key, ok: false};
    try { await api(`/athlete/${encodeURIComponent(id)}`); auth.ok = true; saveAuth(); setupErr = ""; render(); sync(true); }
    catch(err){ setupErr = err.message; saveAuth(); renderSetup(); }
  });
}

function weeklyBars(){
  const now = new Date(); const day = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const weeks = []; for (let w = 7; w >= 0; w--) weeks.push({start: new Date(monday.getTime() - w * 7 * 864e5), km: 0});
  const first = weeks[0].start.getTime();
  for (const r of runs.list) {
    const wi = Math.floor((new Date(r.start.replace("Z", "")).getTime() - first) / (7 * 864e5));
    if (wi >= 0 && wi < weeks.length) weeks[wi].km += r.dist / 1000;
  }
  const max = Math.max(5, ...weeks.map(w => w.km)); const bw = (W - PL - PR) / weeks.length;
  let g = "";
  niceTicks(0, max, 3).forEach(t => { const y = H - PB - t / max * (H - PT - PB); g += `<line class="grid" x1="${PL}" x2="${W-PR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text x="${PL-4}" y="${(y+3).toFixed(1)}" text-anchor="end">${t}</text>`; });
  weeks.forEach((w, i) => {
    const h = w.km / max * (H - PT - PB), x = PL + i * bw + bw * .18, y = H - PB - h;
    g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw*.64).toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" rx="3" fill="${i === weeks.length-1 ? "#d9480f" : "var(--pace)"}" fill-opacity="${i === weeks.length-1 ? 1 : .55}"/>`;
    if (w.km > 0) g += `<text x="${(x + bw*.32).toFixed(1)}" y="${(y-3).toFixed(1)}" text-anchor="middle">${w.km.toFixed(0)}</text>`;
    g += `<text x="${(x + bw*.32).toFixed(1)}" y="${H-6}" text-anchor="middle">${w.start.getDate()}/${w.start.getMonth()+1}</text>`;
  });
  return {svg: `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kilomètres par semaine">${g}</svg>`, thisWeek: weeks[weeks.length-1].km};
}

function renderList(){
  const wk = weeklyBars();
  const last30 = runs.list.filter(r => Date.now() - Date.parse(r.start.replace("Z","")) < 30 * 864e5);
  const d30 = last30.reduce((a, r) => a + r.dist, 0), t30 = last30.reduce((a, r) => a + r.moving, 0);
  view.innerHTML = `
    <div class="card">
      <div class="row spread"><h2>Mes courses</h2><button class="btn" id="sv-sync" type="button" ${syncing ? "disabled" : ""}>${syncing ? "Synchro…" : "Actualiser"}</button></div>
      <div class="kpis">
        <div class="kpi"><b>${wk.thisWeek.toFixed(1).replace(".", ",")}</b><span>km cette semaine</span></div>
        <div class="kpi"><b>${(d30/1000).toFixed(0)}</b><span>km sur 30 jours</span></div>
        <div class="kpi"><b>${last30.length ? fmtPace(t30 / 60 / (d30 / 1000)) : "–"}</b><span>allure moy. 30 j</span></div>
      </div>
      <div class="chead"><h3>Kilomètres par semaine</h3></div>
      ${wk.svg}
      ${syncErr ? `<p class="err">${esc(syncErr)}</p>` : ""}
      <p class="syncline">${runs.lastSync ? "Dernière synchro : " + new Date(runs.lastSync).toLocaleString("fr-FR", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}) : "Première synchro en cours…"}</p>
    </div>
    ${runs.list.length ? `<ul class="runs">${runs.list.map(r => `<li><button class="runitem" type="button" data-run="${r.id}">
        <span class="t">${esc(r.name)}</span><span class="km">${km(r.dist)}</span>
        <span class="d">${esc(fmtDate(r.start))}</span>
        <span class="m"><span>${fmtDur(r.moving)}</span><span>${fmtPace(paceFromSpeed(r.speed))} /km</span>${r.hr ? `<span>${Math.round(r.hr)} bpm</span>` : ""}</span>
      </button></li>`).join("")}</ul>` : `<div class="card"><p class="muted">${syncing ? "Récupération de tes courses…" : "Aucune course trouvée sur les 4 derniers mois. Va courir avec ta Garmin : la course arrivera ici après sa synchro avec Intervals.icu."}</p></div>`}
    <div class="card">
      <h3>Réglages</h3>
      <label class="field">Fréquence cardiaque max (pour les zones)<input id="sv-fc" inputmode="numeric" value="${esc(runs.fcMax || "")}" placeholder="${fcMax()} (estimée)"></label>
      <div class="row"><button class="btn" id="sv-fc-save" type="button">Enregistrer</button><button class="btn" id="sv-logout" type="button">Déconnecter Garmin</button></div>
    </div>`;
  document.getElementById("sv-sync").addEventListener("click", () => sync(true));
  document.getElementById("sv-fc-save").addEventListener("click", () => { const v = parseInt(document.getElementById("sv-fc").value, 10); runs.fcMax = v > 120 && v < 230 ? v : null; saveRuns(); render(); });
  document.getElementById("sv-logout").addEventListener("click", () => { auth = {athleteId: auth.athleteId}; saveAuth(); render(); });
  view.querySelectorAll("[data-run]").forEach(b => b.addEventListener("click", () => { current = b.dataset.run; window.scrollTo(0, 0); render(); }));
}

async function renderDetail(id){
  const r = runs.list.find(x => x.id === id); if (!r) { current = null; return render(); }
  const pace = paceFromSpeed(r.speed);
  view.innerHTML = `<button class="back" id="sv-back" type="button">‹ Toutes les courses</button>
    <div class="card">
      <h2>${esc(r.name)}</h2>
      <p class="muted">${esc(fmtDate(r.start, true))}</p>
      <div class="kpis">
        <div class="kpi"><b>${km(r.dist)}</b><span>km</span></div>
        <div class="kpi"><b>${fmtDur(r.moving)}</b><span>temps</span></div>
        <div class="kpi"><b>${fmtPace(pace)}</b><span>allure /km</span></div>
        <div class="kpi"><b>${r.hr ? Math.round(r.hr) : "–"}</b><span>bpm moyen</span></div>
        <div class="kpi"><b>${r.maxHr ? Math.round(r.maxHr) : "–"}</b><span>bpm max</span></div>
        <div class="kpi"><b>${r.elev != null ? Math.round(r.elev) : "–"}</b><span>m D+</span></div>
        <div class="kpi"><b>${r.cad ? Math.round(r.cad) : "–"}</b><span>pas / min</span></div>
        <div class="kpi"><b>${fmtPace(paceFromSpeed(r.maxSpeed))}</b><span>allure max</span></div>
        <div class="kpi"><b>${fmtDur(r.elapsed || r.moving)}</b><span>temps total</span></div>
      </div>
    </div>
    <div id="sv-detail"><div class="card"><p class="muted">Chargement des courbes…</p></div></div>`;
  document.getElementById("sv-back").addEventListener("click", () => { current = null; render(); });
  let s;
  try { s = await getStreams(id); } catch(e) { if (current === id) document.getElementById("sv-detail").innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button class="btn" id="sv-retry" type="button">Réessayer</button></div>`; const b = document.getElementById("sv-retry"); if (b) b.addEventListener("click", () => render()); return; }
  if (current !== id) return;
  charts = [];
  const D = s.distance || [], n = D.length;
  const idx = downsample(n, 400), xs = idx.map(i => D[i]);
  let html = "";
  if (s.velocity_smooth) {
    const v = smooth(s.velocity_smooth.map(x => x > 0.8 ? x : null), 10);
    const p = idx.map(i => v[i] ? paceFromSpeed(v[i]) : null).map(x => x != null && x < 15 ? x : null);
    html += `<div class="card"><div class="chead"><h3>Allure</h3><span class="val" id="val-pace" data-def="moy. ${fmtPace(pace)} /km">moy. ${fmtPace(pace)} /km</span></div>
      ${lineChart("pace", xs, p, {invert:true, color:"var(--pace)", fmt: fmtPace, unit:" /km", label:"Allure selon la distance"})}</div>`;
  }
  if (s.heartrate) {
    const h = smooth(s.heartrate, 5), hy = idx.map(i => h[i]);
    html += `<div class="card"><div class="chead"><h3>Fréquence cardiaque</h3><span class="val" id="val-hr" data-def="moy. ${r.hr ? Math.round(r.hr) : "–"} bpm">moy. ${r.hr ? Math.round(r.hr) : "–"} bpm</span></div>
      ${lineChart("hr", xs, hy, {color:"var(--hr)", fmt: v => Math.round(v), unit:" bpm", label:"Fréquence cardiaque selon la distance"})}</div>`;
  }
  if (s.altitude) {
    const ay = idx.map(i => s.altitude[i]);
    html += `<div class="card"><div class="chead"><h3>Altitude</h3><span class="val" id="val-alt" data-def="D+ ${Math.round(r.elev || 0)} m">D+ ${Math.round(r.elev || 0)} m</span></div>
      ${lineChart("alt", xs, ay, {color:"var(--alt)", fmt: v => Math.round(v), unit:" m", label:"Altitude selon la distance"})}</div>`;
  }
  if (s.cadence) {
    const c = smooth(s.cadence.map(x => x > 60 ? x : null), 10), cy = idx.map(i => c[i]);
    html += `<div class="card"><div class="chead"><h3>Cadence</h3><span class="val" id="val-cad" data-def="moy. ${r.cad ? Math.round(r.cad) : "–"} pas/min">moy. ${r.cad ? Math.round(r.cad) : "–"} pas/min</span></div>
      ${lineChart("cad", xs, cy, {color:"var(--cad)", fmt: v => Math.round(v), unit:" pas/min", label:"Cadence selon la distance"})}</div>`;
  }
  const sp = splitsOf(s);
  if (sp.length) {
    const full = sp.filter(x => x.dist > 900), avg = full.length ? full.reduce((a, x) => a + x.pace, 0) / full.length : sp[0].pace;
    const minP = Math.min(...sp.map(x => x.pace)), maxP = Math.max(...sp.map(x => x.pace));
    html += `<div class="card"><h3>Temps au kilomètre</h3><div style="overflow-x:auto"><table class="splits"><thead><tr><th>Km</th><th>Allure</th><th style="width:38%"></th><th>Bpm</th><th>Dén.</th></tr></thead><tbody>
      ${sp.map(x => { const w = maxP > minP ? 35 + 65 * (maxP - x.pace) / (maxP - minP) : 100; const cls = x.pace < avg - .08 ? "fast" : x.pace > avg + .08 ? "slow" : "";
        return `<tr><td>${x.dist > 950 ? x.k : (x.dist/1000).toFixed(2).replace(".", ",")}</td><td>${fmtPace(x.pace)}</td><td><div class="bar ${cls}" style="width:${w.toFixed(0)}%"></div></td><td>${x.hr ? Math.round(x.hr) : "–"}</td><td>${x.elev != null ? (x.elev > 0 ? "+" : "") + Math.round(x.elev) : "–"}</td></tr>`; }).join("")}
      </tbody></table></div><p class="muted">Vert : plus rapide que ta moyenne · Rouge : plus lent.</p></div>`;
  }
  const z = zonesOf(s, fcMax());
  if (z) {
    const tot = z.reduce((a, b) => a + b, 0) || 1, cols = ["#9aa7b4","#4a9bd8","#3aa66a","#e3a32b","#d64545"], names = ["Récup","Endurance","Tempo","Seuil","Max"];
    html += `<div class="card"><h3>Zones cardiaques</h3><div class="zones">${z.map((t, i) => `<div class="zone"><span>Z${i+1}</span><div class="zb"><i style="width:${(t/tot*100).toFixed(1)}%;background:${cols[i]}"></i></div><span>${fmtDur(t)}</span></div>`).join("")}</div>
      <p class="muted">${names.map((n, i) => `Z${i+1} ${n}`).join(" · ")} · FC max ${fcMax()} bpm</p></div>`;
  }
  const rs = s.latlng ? routeSvg(s.latlng) : "";
  if (rs) html += `<div class="card"><h3>Parcours</h3>${rs}<p class="muted">Point vert : départ · point foncé : arrivée.</p></div>`;
  document.getElementById("sv-detail").innerHTML = html || `<div class="card"><p class="muted">Pas de courbes pour cette activité.</p></div>`;
  bindCursor();
}

window.Run = {
  show(){ render(); sync(false); }
};
if (!document.getElementById("run-view").hidden) Run.show();
})();
