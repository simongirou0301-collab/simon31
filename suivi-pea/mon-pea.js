/* Vue « Mon PEA » : valeur vs versements, projection, doublons entre ETF, répartition.
   Tout ce que tu saisis reste dans ton navigateur (localStorage), rien n'est envoyé. */

const CIBLE = {global: 70, nasdaq: 20, europe: 10};
const ETF_COLOR = {global: "var(--c-global)", nasdaq: "var(--c-nasdaq)", europe: "var(--c-europe)"};
let COMPO = null;
let horizon = parseInt(store.get("pea-horizon")) || 20;

const num = (k, def) => { const v = parseFloat(store.get(k)); return isFinite(v) ? v : def; };
const parseFr = s => parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
const eur0 = v => Math.round(v).toLocaleString("fr-FR") + " €";

function reglages() {
  const own = hasOwn();
  return {
    own,
    verse: num("pea-verse", own ? 0 : 9800),
    cash: num("pea-cash", 0),
    hebdo: num("pea-hebdo", 0),
    mensuel: num("pea-mensuel", 200),
    taux: num("pea-taux", 7)
  };
}

function releves() {
  try { const r = JSON.parse(store.get("pea-releves") || "[]"); return Array.isArray(r) ? r : []; } catch { return []; }
}

function simuler(v0, r) {
  const rm = Math.pow(1 + r.taux / 100, 1 / 12) - 1;
  const parMois = r.hebdo * 52 / 12;
  let inv = v0, cash = r.cash, verse = r.verse;
  const pts = [{an: 0, total: inv + cash, verse}];
  for (let m = 1; m <= horizon * 12; m++) {
    inv *= 1 + rm;
    if (cash > 0.01 && parMois > 0) { const mv = Math.min(cash, parMois); cash -= mv; inv += mv; }
    else { inv += r.mensuel; verse += r.mensuel; }
    if (m % 12 === 0) pts.push({an: m / 12, total: inv + cash, verse});
  }
  return pts;
}

function svgLines(series, opts) {
  const W = 640, H = 210, P = {l: 8, r: 64, t: 14, b: 24};
  const all = series.flatMap(s => s.pts.map(p => p[1]));
  const xs = series[0].pts.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let mn = opts.zero ? 0 : Math.min(...all), mx = Math.max(...all);
  if (mx === mn) { mx += 1; mn -= 1; }
  const X = x => P.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = v => P.t + (1 - (v - mn) / (mx - mn)) * (H - P.t - P.b);
  const grid = [0.25, 0.5, 0.75, 1].map(f => mn + (mx - mn) * f);
  let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">`;
  grid.forEach(g => { out += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(g)}" y2="${Y(g)}" stroke="var(--line)"/><text x="${W - P.r + 6}" y="${Y(g) + 4}" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${esc(opts.fmtY(g))}</text>`; });
  series.forEach(s => {
    const pts = s.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
    if (s.fill) out += `<polygon points="${X(s.pts[0][0])},${Y(mn)} ${pts} ${X(s.pts[s.pts.length - 1][0])},${Y(mn)}" fill="${s.color}" opacity=".13"/>`;
    out += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.dash ? 2 : 2.6}" ${s.dash ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
    s.pts.forEach((p, i) => { if (s.dots || i === s.pts.length - 1) out += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${s.dots ? 3.5 : 4.5}" fill="${s.color}"/>`; });
  });
  out += `<text x="${P.l}" y="${H - 6}" font-size="11" fill="var(--muted)">${esc(opts.fmtX(x0))}</text><text x="${W - P.r}" y="${H - 6}" font-size="11" fill="var(--muted)" text-anchor="end">${esc(opts.fmtX(x1))}</text></svg>`;
  return out;
}

function compareBars(rows, refLabel) {
  const mx = Math.max(...rows.flatMap(r => [r.moi, r.ref || 0]), 1);
  return `<div class="cmp">${rows.map(r => `
    <div class="cmprow"><span class="name">${esc(r.nom)}</span>
      <span class="track2"><span class="fill2" style="width:${r.moi / mx * 100}%"></span>${r.ref != null ? `<span class="ref" style="left:${r.ref / mx * 100}%" title="${esc(refLabel)}"></span>` : ""}</span>
      <span class="num">${r.moi.toFixed(1).replace(".", ",")} %</span></div>`).join("")}</div>
    <div class="legend"><i style="background:var(--accent)"></i><span>Mon portefeuille</span>${rows.some(r => r.ref != null) ? `<span class="refkey"></span><span>${esc(refLabel)}</span>` : ""}</div>`;
}

function renderPea() {
  const app = document.getElementById("app");
  const r = reglages();
  const etfs = LATEST.etfs;
  const vals = Object.fromEntries(etfs.map(e => [e.id, invested(e)]));
  const v0 = Object.values(vals).reduce((a, b) => a + b, 0);
  const gain = v0 + r.cash - r.verse;

  // 1. Relevés valeur vs versements
  const rel = releves().slice().sort((a, b) => a.d.localeCompare(b.d));
  const relChart = rel.length >= 2 ? svgLines([
    {pts: rel.map(p => [new Date(p.d).getTime(), p.valeur]), color: "var(--accent)", fill: true, dots: true},
    {pts: rel.map(p => [new Date(p.d).getTime(), p.verse]), color: "var(--muted)", dash: true, dots: true}
  ], {label: "Valeur et versements au fil du temps", fmtY: eur0, fmtX: t => new Date(t).toLocaleDateString("fr-FR", {day: "numeric", month: "short", year: "2-digit"})}) : "";

  // 2. Projection
  const sim = simuler(v0, r);
  const fin = sim[sim.length - 1];
  const projChart = svgLines([
    {pts: sim.map(p => [p.an, p.total]), color: "var(--up)", fill: true},
    {pts: sim.map(p => [p.an, p.verse]), color: "var(--muted)", dash: true}
  ], {label: `Projection sur ${horizon} ans`, zero: true, fmtY: v => v >= 1e6 ? (v / 1e6).toFixed(1).replace(".", ",") + " M€" : Math.round(v / 1000) + " k€", fmtX: a => a === 0 ? "aujourd'hui" : "dans " + a + " ans"});
  const jalons = [5, 10, 15, 20, 25, 30].filter(a => a <= horizon).map(a => sim[a]);

  // 3. Doublons : exposition réelle par entreprise
  const expo = {};
  etfs.forEach(e => e.holdings.forEach(h => {
    const nom = h.n.replace(/ [AC]$/, "");
    const x = expo[nom] || (expo[nom] = {nom, total: 0, par: {}});
    const eur = vals[e.id] * h.w / 100;
    x.total += eur; x.par[e.id] = (x.par[e.id] || 0) + eur;
  }));
  const expoList = Object.values(expo).sort((a, b) => b.total - a.total);
  const doublons = expoList.filter(x => Object.keys(x.par).length > 1);
  const top = expoList.slice(0, 15);
  const mxExpo = Math.max(...top.map(x => x.total), 1);
  const top10Pct = v0 ? expoList.slice(0, 10).reduce((s, x) => s + x.total, 0) / v0 * 100 : 0;

  // 4. Répartition
  const alloc = etfs.map(e => ({id: e.id, nom: e.short, pct: v0 ? vals[e.id] / v0 * 100 : 0, cible: CIBLE[e.id] || 0}));
  const mix = key => {
    if (!COMPO) return [];
    const acc = {};
    etfs.forEach(e => Object.entries(COMPO[key][e.id] || {}).forEach(([k, w]) => { acc[k] = (acc[k] || 0) + (v0 ? vals[e.id] / v0 : 0) * w; }));
    const ref = COMPO[key].global;
    return Object.entries(acc).map(([nom, moi]) => ({nom, moi, ref: ref[nom] ?? null})).sort((a, b) => (/^Autres/.test(a.nom) - /^Autres/.test(b.nom)) || b.moi - a.moi);
  };
  const pays = mix("pays"), secteurs = mix("secteurs");
  const usMoi = pays.find(p => p.nom === "États-Unis")?.moi || 0;
  const techMoi = secteurs.find(p => p.nom === "Technologie")?.moi || 0;
  const plusGrosEcart = alloc.slice().sort((a, b) => Math.abs(b.pct - b.cible) - Math.abs(a.pct - a.cible))[0];

  app.innerHTML = `
  ${headerHtml("Mon portefeuille", "Mon PEA · vue d'ensemble")}

  ${r.own ? "" : `<div class="card note">Ce sont des <b>chiffres d'exemple</b> (10 000 € en 70/20/10). Entre les tiens dans « Mes chiffres » ci-dessous : ils restent uniquement sur ton appareil.</div>`}

  <section class="card">
    <h2>Mes chiffres</h2>
    <p class="muted small" style="margin:4px 0 0">Recopie-les depuis Trade Republic. Ils sont enregistrés dans ce navigateur seulement.</p>
    <div class="form">
      ${etfs.map(e => `<label>Valeur ${esc(e.short)}<input id="pv-${e.id}" class="num" inputmode="decimal" value="${vals[e.id].toFixed(2).replace(".", ",")}"></label>`).join("")}
      <label>Versements totaux<input id="pv-verse" class="num" inputmode="decimal" value="${r.verse.toFixed(2).replace(".", ",")}"></label>
      <label>Espèces à investir<input id="pv-cash" class="num" inputmode="decimal" value="${r.cash.toFixed(2).replace(".", ",")}"></label>
      <label>Plan par semaine<input id="pv-hebdo" class="num" inputmode="decimal" value="${r.hebdo.toFixed(0)}"></label>
      <label>Ajout par mois ensuite<input id="pv-mensuel" class="num" inputmode="decimal" value="${r.mensuel.toFixed(0)}"></label>
    </div>
    <div class="kpis">
      <div class="kpi"><label>Valeur totale</label><div class="v num">${eur0(v0 + r.cash)}</div></div>
      <div class="kpi"><label>Versé</label><div class="v num">${eur0(r.verse)}</div></div>
      <div class="kpi"><label>Plus-value</label><div class="v num ${cls(gain)}">${fmtEur(gain, 0)}</div></div>
    </div>
  </section>

  <section class="card">
    <h2>Valeur et versements au fil du temps</h2>
    <p class="muted small" style="margin:4px 0 0">L'écart entre la courbe pleine (valeur) et les pointillés (argent versé), c'est ce que la bourse t'a rapporté.</p>
    ${relChart || `<p class="empty-inline">${rel.length ? "1 relevé enregistré. La courbe apparaît dès le 2e : reviens en enregistrer un la semaine prochaine." : "Aucun relevé pour l'instant. Enregistre ta situation du jour, puis une fois par semaine : la courbe se dessinera."}</p>`}
    <div class="row-actions">
      <button class="btn" id="save-releve">Enregistrer ma situation du jour</button>
      ${rel.length ? `<button class="btn ghost" id="undo-releve">Effacer le dernier relevé</button>` : ""}
      <span class="muted small" id="releve-msg" aria-live="polite"></span>
    </div>
    ${rel.length ? `<div class="legend"><i style="background:var(--accent)"></i><span>Valeur</span><i style="background:var(--muted)"></i><span>Versé</span><span>· ${rel.length} relevé${rel.length > 1 ? "s" : ""}</span></div>` : ""}
  </section>

  <section class="card">
    <div class="etfhead">
      <div><h2>Et dans ${horizon} ans ?</h2><div class="muted small">Sans jamais vendre, rendement moyen constant</div></div>
      <div class="seg" role="group" aria-label="Horizon">${[10, 20, 30].map(h => `<button class="segbtn" data-h="${h}" aria-pressed="${h === horizon}">${h} ans</button>`).join("")}</div>
    </div>
    <div class="slider"><label for="pv-taux">Rendement moyen : <b class="num">${r.taux.toFixed(1).replace(".", ",")} %/an</b></label>
      <input type="range" id="pv-taux" min="2" max="12" step="0.5" value="${r.taux}"></div>
    ${projChart}
    <div class="legend"><i style="background:var(--up)"></i><span>Valeur projetée</span><i style="background:var(--muted)"></i><span>Argent versé</span></div>
    <div class="kpis">
      <div class="kpi"><label>Valeur finale</label><div class="v num up">${eur0(fin.total)}</div></div>
      <div class="kpi"><label>Versé</label><div class="v num">${eur0(fin.verse)}</div></div>
      <div class="kpi"><label>Gagné grâce aux intérêts composés</label><div class="v num up">${eur0(fin.total - fin.verse)}</div></div>
    </div>
    <div class="jalons">${jalons.map(j => `<div><span class="muted small">${j.an} ans</span><b class="num">${eur0(j.total)}</b></div>`).join("")}</div>
    <p class="muted small" style="margin:10px 0 0">${r.cash > 0 && r.hebdo > 0 ? `Tes espèces sont investies à ${eur0(r.hebdo)}/semaine, puis tu ajoutes ${eur0(r.mensuel)}/mois. ` : `Tu ajoutes ${eur0(r.mensuel)}/mois. `}La vraie bourse ne monte pas en ligne droite : certaines années feront −20 % ou pire. Les ${r.taux.toFixed(0)} % sont une moyenne, dividendes réinvestis compris.</p>
  </section>

  <section class="card">
    <h2>Les doublons entre mes ETF</h2>
    <p class="muted small" style="margin:4px 0 0">Combien tu possèdes vraiment de chaque entreprise, tous ETF confondus. ${doublons.length} des plus grosses entreprises sont dans plusieurs de tes ETF.</p>
    <div class="expo">${top.map(x => `
      <div class="exporow">
        <span class="name">${esc(x.nom)}${Object.keys(x.par).length > 1 ? ` <span class="badge">×${Object.keys(x.par).length}</span>` : ""}</span>
        <span class="stack">${etfs.filter(e => x.par[e.id]).map(e => `<span style="width:${x.par[e.id] / mxExpo * 100}%;background:${ETF_COLOR[e.id]}" title="${esc(e.short)} : ${eur0(x.par[e.id])}"></span>`).join("")}</span>
        <span class="num">${eur0(x.total)}</span>
      </div>`).join("")}</div>
    <div class="legend">${etfs.map(e => `<i style="background:${ETF_COLOR[e.id]}"></i><span>via ${esc(e.short)}</span>`).join("")}</div>
    ${doublons[0] ? `<p style="margin:10px 0 0">Exemple : <b>${esc(doublons[0].nom)}</b> pèse ${eur0(doublons[0].total)} chez toi, dont ${etfs.filter(e => doublons[0].par[e.id]).map(e => `${eur0(doublons[0].par[e.id])} via ${esc(e.short)}`).join(" et ")}. Tes 10 premières entreprises représentent ${top10Pct.toFixed(0)} % de ton portefeuille.</p>` : ""}
    <p class="muted small" style="margin:6px 0 0">Calculé sur les plus grosses positions de chaque ETF seulement.</p>
  </section>

  <section class="card">
    <h2>Ma répartition</h2>
    <h3 style="margin-top:10px">Par ETF, comparée à mon objectif 70/20/10</h3>
    <div class="cmp">${alloc.map(a => `
      <div class="cmprow"><span class="name">${esc(a.nom)}</span>
        <span class="track2"><span class="fill2" style="width:${a.pct}%;background:${ETF_COLOR[a.id]}"></span><span class="ref" style="left:${a.cible}%"></span></span>
        <span class="num">${a.pct.toFixed(1).replace(".", ",")} %</span></div>`).join("")}</div>
    <div class="legend"><span class="refkey"></span><span>Objectif</span></div>
    <p style="margin:8px 0 0">${Math.abs(plusGrosEcart.pct - plusGrosEcart.cible) < 2 ? "Tu es dans les clous : moins de 2 points d'écart sur chaque ETF." : `Le plus gros écart est sur <b>${esc(plusGrosEcart.nom)}</b> : ${plusGrosEcart.pct.toFixed(1).replace(".", ",")} % au lieu de ${plusGrosEcart.cible} % (${fmtEur(vals[plusGrosEcart.id] - plusGrosEcart.cible / 100 * v0, 0)}). ${plusGrosEcart.pct > plusGrosEcart.cible ? "Pas besoin de vendre : mets un peu moins sur celui-ci dans tes prochains versements." : "Tes prochains versements peuvent le renforcer en priorité."}`}</p>

    <h3 style="margin-top:18px">Par pays</h3>
    ${COMPO ? compareBars(pays, "MSCI Monde (ACWI) seul") : `<p class="muted">Chargement…</p>`}
    <p class="muted small" style="margin:6px 0 0">Les États-Unis pèsent ${usMoi.toFixed(0)} % chez toi${COMPO ? `, contre ${COMPO.pays.global["États-Unis"].toFixed(0)} % dans le MSCI Monde seul` : ""}. ${COMPO ? esc(COMPO.notes.nasdaq_pays) : ""}</p>

    <h3 style="margin-top:18px">Par secteur</h3>
    ${COMPO ? compareBars(secteurs, "MSCI Monde (ACWI) seul") : ""}
    <p class="muted small" style="margin:6px 0 0">La technologie pèse ${techMoi.toFixed(0)} % chez toi${COMPO ? `, contre ${COMPO.secteurs.global["Technologie"].toFixed(0)} % dans le MSCI Monde seul : c'est l'effet de ton Nasdaq 100` : ""}.</p>
    ${COMPO ? `<p class="muted small" style="margin:6px 0 0">Sources : ${esc(COMPO.source)}. ${esc(COMPO.notes.europe_autres)}</p>` : ""}
  </section>

  ${krachHtml(true)}`;

  wirePea();
}

function wirePea() {
  wireViews();
  const save = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.onchange = () => { const v = parseFr(el.value); if (isFinite(v) && v >= 0) store.set(key, String(v)); renderPea(); };
  };
  LATEST.etfs.forEach(e => save("pv-" + e.id, "pea-inv-" + e.id));
  save("pv-verse", "pea-verse"); save("pv-cash", "pea-cash"); save("pv-hebdo", "pea-hebdo"); save("pv-mensuel", "pea-mensuel");
  const t = document.getElementById("pv-taux");
  if (t) t.oninput = () => { store.set("pea-taux", t.value); renderPea(); document.getElementById("pv-taux")?.focus(); };
  document.querySelectorAll(".segbtn").forEach(b => b.onclick = () => { horizon = +b.dataset.h; store.set("pea-horizon", String(horizon)); renderPea(); });
  const sr = document.getElementById("save-releve");
  if (sr) sr.onclick = () => {
    const r = reglages();
    const valeur = LATEST.etfs.reduce((s, e) => s + invested(e), 0) + r.cash;
    const d = new Date().toISOString().slice(0, 10);
    const list = releves().filter(x => x.d !== d);
    list.push({d, valeur: Math.round(valeur * 100) / 100, verse: r.verse});
    store.set("pea-releves", JSON.stringify(list));
    renderPea();
    const m = document.getElementById("releve-msg"); if (m) m.textContent = "Relevé du " + new Date().toLocaleDateString("fr-FR") + " enregistré.";
  };
  const ur = document.getElementById("undo-releve");
  if (ur) ur.onclick = () => {
    const list = releves().sort((a, b) => a.d.localeCompare(b.d)); list.pop();
    store.set("pea-releves", JSON.stringify(list)); renderPea();
  };
}

fetch("composition.json", {cache: "no-cache"}).then(r => r.ok ? r.json() : null).then(c => { COMPO = c; if (LATEST) render(); }).catch(() => {});

/* Mode krach, calendrier des annonces, récap de la semaine. */

function baisses() {
  return (LATEST || DATA).etfs.map(e => {
    const h = (DATA.etfs.find(x => x.id === e.id) || e).history || e.history;
    const hi = Math.max(...h.map(p => p[1])), last = h[h.length - 1][1];
    return {id: e.id, nom: e.short, dd: (last / hi - 1) * 100};
  });
}

function krachHtml(toujours) {
  const touches = baisses().filter(b => b.dd <= -5);
  if (!touches.length && !toujours) return "";
  const k = COMPO?.krachs || [];
  const tableau = k.length ? `<div class="tablewrap"><table class="krachs">
      <thead><tr><th>Indice</th><th>Crise</th><th>Chute</th><th>Retour au sommet</th></tr></thead>
      <tbody>${k.map(x => `<tr><td>${esc(x.indice)}</td><td>${esc(x.nom)} <span class="muted small">${esc(x.periode)}</span></td><td class="num down">${x.baisse} %</td><td>${esc(x.recup)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted small" style="margin:6px 0 0">${esc(COMPO.krachs_note)}</p>` : "";
  const conseils = `<ul class="calm">
      <li><b>Ne vends pas.</b> Une perte n'est réelle que si tu vends. Tous les krachs de ce tableau ont fini par être effacés.</li>
      <li><b>Garde ton plan.</b> Chaque semaine, tes ${eur0(num("pea-hebdo", 0) || 300)} achètent plus de parts quand c'est bas : c'est là que se prépare la remontée.</li>
      <li><b>Regarde loin.</b> Avec un horizon de plus de 5 ans, une baisse de 10 à 20 % arrive presque chaque année ou deux.</li></ul>`;
  if (!touches.length) return `<section class="card"><details><summary><h2 style="display:inline">Si ça chute un jour</h2></summary>
      <p style="margin:8px 0 0">Cette partie devient une alerte quand un de tes ETF recule de plus de 5 % par rapport à son plus haut récent. Voici ce qu'elle te rappellera :</p>${conseils}${tableau}</details></section>`;
  return `<section class="card krach" role="alert">
    <span class="eyebrow">Mode krach</span>
    <h2>${touches.map(t => `${esc(t.nom)} ${fmtPct(t.dd, 1)}`).join(" · ")} depuis son plus haut récent</h2>
    <p style="margin:6px 0 0">Ça fait peur, mais c'est normal en bourse. Voici de quoi garder la tête froide.</p>
    ${conseils}${tableau}
  </section>`;
}

function calendrierHtml() {
  const ag = (DATA.agenda || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!ag.length) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ref = DATA === LATEST ? today : new Date(DATA.date + "T00:00:00");
  const futurs = ag.filter(a => new Date(a.date + "T00:00:00") >= ref).slice(0, 10);
  if (!futurs.length) return "";
  const etfs = (LATEST || DATA).etfs;
  const poidsEur = a => etfs.reduce((s, e) => s + e.holdings.filter(h => (a.tickers || []).includes(h.s)).reduce((t, h) => t + invested(e) * h.w / 100, 0), 0);
  const jour = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", {weekday: "short", day: "numeric", month: "short"});
  return `<section class="card">
    <h2>Calendrier des annonces</h2>
    <p class="muted small" style="margin:4px 0 0">Les rendez-vous qui peuvent faire bouger tes ETF dans les prochaines semaines.</p>
    <div class="cal">${futurs.map(a => {
      const n = Math.round((new Date(a.date + "T00:00:00") - ref) / 864e5);
      const eur = poidsEur(a);
      return `<article class="calrow">
        <div class="caldate"><b>${esc(jour(a.date))}</b><span class="muted small">${n === 0 ? "aujourd'hui" : n === 1 ? "demain" : "dans " + n + " j"}</span></div>
        <div style="min-width:0">
          <div class="chips"><span class="chip ${a.type === "banque" ? "bank" : ""}">${a.type === "banque" ? "Banque centrale" : "Résultats"}</span>${(a.tickers || []).map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
          <h3 style="margin-top:4px">${esc(a.titre)}</h3>
          <p style="margin:2px 0 0">${esc(a.texte)}</p>
          ${eur > 0.5 ? `<span class="muted small">Ton argent concerné : environ ${eur0(eur)}</span>` : ""}
        </div></article>`;
    }).join("")}</div>
    <p class="muted small" style="margin:8px 0 0">Les résultats sont publiés après la clôture américaine (vers 22 h en France) : l'effet se voit sur la séance du lendemain.</p>
  </section>`;
}

function recapHtml() {
  const r = DATA.recap;
  if (!r) return "";
  const etfs = (LATEST || DATA).etfs;
  return `<section class="card recap">
    <span class="eyebrow">Récap de la semaine</span>
    <h2>Semaine ${esc(r.semaine)}</h2>
    <div class="chips" style="margin-top:8px">${etfs.map(e => `<span class="pill ${cls(r.etfs[e.id])} num">${esc(e.short)} ${fmtPct(r.etfs[e.id], 1)}</span>`).join("")}</div>
    <ol class="recaplist">${r.lignes.map(l => `<li>${esc(l)}</li>`).join("")}</ol>
    <span class="muted small">Sources : ${esc(r.source)}</span>
  </section>`;
}
