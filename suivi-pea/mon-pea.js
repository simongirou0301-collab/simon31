/* Vue « Mon PEA » : valeur vs versements, projection, doublons entre ETF, répartition.
   Tout ce que tu saisis reste dans ton navigateur (localStorage), rien n'est envoyé. */

const CIBLE = {global: 70, nasdaq: 20, europe: 10};
const ETF_COLOR = {global: "var(--c-global)", nasdaq: "var(--c-nasdaq)", europe: "var(--c-europe)"};
let COMPO = null;
let horizon = parseInt(store.get("pea-horizon")) || 20;

const num = (k, def) => { const v = parseFloat(store.get(k)); return isFinite(v) ? v : def; };
const parseFr = s => parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
const eur0 = v => Math.round(v).toLocaleString("fr-FR") + " €";

function txDepots() {
  const t = txList(), dep = t.filter(x => x.type === "depot" || x.type === "retrait");
  if (!dep.length) return null;
  const s = type => t.filter(x => x.type === type).reduce((a, x) => a + x.m, 0);
  const frais = t.reduce((a, x) => a + (x.f || 0), 0);
  const verse = s("depot") - s("retrait");
  return {verse, cash: Math.max(verse - s("achat") + s("vente") - frais, 0)};
}

function reglages() {
  const own = hasOwn(), dep = txDepots();
  return {
    own,
    verse: dep ? dep.verse : num("pea-verse", own ? 0 : 9800),
    cash: dep ? dep.cash : num("pea-cash", 0),
    depTx: !!dep,
    hebdo: num("pea-hebdo", 0),
    mensuel: num("pea-mensuel", 200),
    taux: num("pea-taux", 7)
  };
}

function releves() {
  try { const r = JSON.parse(store.get("pea-releves") || "[]"); return Array.isArray(r) ? r : []; } catch { return []; }
}

function simuler(v0, r, ans = horizon, taux = r.taux) {
  const rm = Math.pow(1 + taux / 100, 1 / 12) - 1;
  const parMois = r.hebdo * 52 / 12;
  let inv = v0, cash = r.cash, verse = r.verse;
  const pts = [{an: 0, total: inv + cash, verse}];
  for (let m = 1; m <= ans * 12; m++) {
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
  ${headerHtml(view === "analyse" ? "Analyse de mon portefeuille" : "Mon portefeuille", view === "analyse" ? "Mon PEA · doublons et répartition" : "Mon PEA · vue d'ensemble")}

  ${r.own ? "" : `<div class="card note">Ce sont des <b>chiffres d'exemple</b> (10 000 € en 70/20/10). Entre les tiens dans « Mes chiffres » de l'onglet Mon PEA : ils restent uniquement sur ton appareil.</div>`}

  ${subNav()}

  ${view === "pea" ? (sub() === "chiffres" ? `<section class="card">
    <h2>Mes chiffres</h2>
    <p class="muted small" style="margin:4px 0 0">${hasTx() ? `Valeurs calculées depuis tes transactions (onglet Achats) au cours de clôture du ${esc(LATEST.label)}.${r.depTx ? "" : " Versements et espèces : à recopier depuis Trade Republic."}` : "Recopie-les depuis Trade Republic, ou importe tes transactions dans l'onglet Achats."} Tout reste dans ce navigateur seulement.</p>
    <div class="form">
      ${etfs.map(e => `<label>Valeur ${esc(e.short)}<input id="pv-${e.id}" class="num" inputmode="decimal" ${hasTx() ? "readonly" : ""} value="${vals[e.id].toFixed(2).replace(".", ",")}"></label>`).join("")}
      <label>Versements totaux<input id="pv-verse" class="num" inputmode="decimal" ${r.depTx ? "readonly" : ""} value="${r.verse.toFixed(2).replace(".", ",")}"></label>
      <label>Espèces à investir<input id="pv-cash" class="num" inputmode="decimal" ${r.depTx ? "readonly" : ""} value="${r.cash.toFixed(2).replace(".", ",")}"></label>
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

  ` : sub() === "projection" ? `<section class="card">
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

  ` : sub() === "achats" ? achatsHtml(r) : sub() === "objectif" ? objectifHtml(r, v0) : sub() === "comparer" ? comparerHtml(r, v0) : fiscaliteHtml(r, v0, gain)) : sub() === "doublons" ? `<section class="card">
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

  ` : sub() === "repartition" ? `<section class="card">
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
  ` : sub() === "indices" ? indicesHtml() : krachHtml(true)}
  ${navHtml()}`;

  wirePea();
}

function wirePea() {
  wireViews();
  const on = document.querySelector('.subbtn[aria-pressed="true"]');
  if (on) on.parentElement.scrollLeft = on.offsetLeft - (on.parentElement.clientWidth - on.offsetWidth) / 2;
  const save = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.onchange = () => { const v = parseFr(el.value); if (isFinite(v) && v >= 0) store.set(key, String(v)); renderPea(); };
  };
  LATEST.etfs.forEach(e => save("pv-" + e.id, "pea-inv-" + e.id));
  save("pv-cible", "pea-cible");
  const ov = document.getElementById("pv-ouverture");
  if (ov) ov.onchange = () => { if (ov.value) store.set("pea-ouverture", ov.value); renderPea(); };
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
  wireAchats();
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
    const h = courbe(DATA.etfs.find(x => x.id === e.id) || e);
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
  if (!touches.length) return `<section class="card"><details open><summary><h2 style="display:inline">Si ça chute un jour</h2></summary>
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
  const futurs = ag.filter(a => new Date(a.date + "T00:00:00") >= ref).slice(0, 6);
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


/* Objectif, comparateur, fiscalité. */

function moisPour(r, v0, cible) {
  const rm = Math.pow(1 + r.taux / 100, 1 / 12) - 1, parMois = r.hebdo * 52 / 12;
  let inv = v0, cash = r.cash;
  if (inv + cash >= cible) return 0;
  for (let m = 1; m <= 600; m++) {
    inv *= 1 + rm;
    if (cash > 0.01 && parMois > 0) { const mv = Math.min(cash, parMois); cash -= mv; inv += mv; } else inv += r.mensuel;
    if (inv + cash >= cible) return m;
  }
  return null;
}

function objectifHtml(r, v0) {
  const cible = num("pea-cible", 50000);
  const total = v0 + r.cash;
  const pct = Math.min(total / cible * 100, 100);
  const mois = moisPour(r, v0, cible);
  const quand = mois == null ? null : new Date(new Date().getFullYear(), new Date().getMonth() + mois, 1);
  const etapes = [0.25, 0.5, 0.75, 1].map(f => ({f, m: moisPour(r, v0, cible * f)}));
  const fmtMois = m => m === 0 ? "atteint" : m == null ? "plus de 50 ans" : new Date(new Date().getFullYear(), new Date().getMonth() + m, 1).toLocaleDateString("fr-FR", {month: "long", year: "numeric"});
  return `<section class="card">
    <h2>Mon objectif</h2>
    <div class="form" style="grid-template-columns:1fr"><label>Montant visé<input id="pv-cible" class="num" inputmode="decimal" value="${cible.toFixed(0)}"></label></div>
    <div class="bigbar" role="progressbar" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <div class="ticks"><span>0 €</span><span>${eur0(cible / 2)}</span><span>${eur0(cible)}</span></div>
    <div class="kpis">
      <div class="kpi"><label>Aujourd'hui</label><div class="v num">${eur0(total)}</div></div>
      <div class="kpi"><label>Avancement</label><div class="v num up">${pct.toFixed(0)} %</div></div>
      <div class="kpi"><label>Date estimée</label><div class="v">${mois === 0 ? "Atteint !" : quand ? esc(quand.toLocaleDateString("fr-FR", {month: "short", year: "numeric"})) : "—"}</div></div>
    </div>
    <div class="jalons">${etapes.map(e => `<div><span class="muted small">${Math.round(e.f * 100)} % · ${eur0(cible * e.f)}</span><b>${esc(fmtMois(e.m))}</b></div>`).join("")}</div>
    <p class="muted small" style="margin:10px 0 0">Estimation avec tes réglages de l'onglet Projection (${r.taux.toFixed(1).replace(".", ",")} %/an, ${r.hebdo ? eur0(r.hebdo) + "/semaine tant qu'il reste des espèces, puis " : ""}${eur0(r.mensuel)}/mois).</p>
  </section>`;
}

function comparerHtml(r, v0) {
  const C = COMPO?.comparaison || {livretA: 1.7, inflation_long: 2, inflation_actuelle: 3, livretA_date: "", inflation_date: ""};
  const pea = simuler(v0, r), livret = simuler(v0, r, horizon, C.livretA);
  const fin = pea[pea.length - 1], finL = livret[livret.length - 1];
  const reel = v => v / Math.pow(1 + C.inflation_long / 100, horizon);
  const ps = (COMPO?.fiscalite?.ps ?? 18.6) / 100;
  const peaNet = fin.total - Math.max(0, fin.total - fin.verse) * ps;
  const chart = svgLines([
    {pts: pea.map(p => [p.an, p.total]), color: "var(--up)", fill: true},
    {pts: livret.map(p => [p.an, p.total]), color: "var(--c-europe)"},
    {pts: pea.map(p => [p.an, p.verse]), color: "var(--muted)", dash: true}
  ], {label: "PEA comparé au Livret A", zero: true, fmtY: v => v >= 1e6 ? (v / 1e6).toFixed(1).replace(".", ",") + " M€" : Math.round(v / 1000) + " k€", fmtX: a => a === 0 ? "aujourd'hui" : "dans " + a + " ans"});
  return `<section class="card">
    <div class="etfhead">
      <div><h2>PEA ou Livret A ?</h2><div class="muted small">Les mêmes versements, sur ${horizon} ans</div></div>
      <div class="seg" role="group" aria-label="Horizon">${[10, 20, 30].map(h => `<button class="segbtn" data-h="${h}" aria-pressed="${h === horizon}">${h} ans</button>`).join("")}</div>
    </div>
    ${chart}
    <div class="legend"><i style="background:var(--up)"></i><span>PEA à ${r.taux.toFixed(1).replace(".", ",")} %/an</span><i style="background:var(--c-europe)"></i><span>Livret A à ${String(C.livretA).replace(".", ",")} %</span><i style="background:var(--muted)"></i><span>Versé</span></div>
    <table class="cmptable"><tbody>
      <tr><td>PEA</td><td class="num"><b>${eur0(fin.total)}</b></td></tr>
      <tr><td>PEA après prélèvements sociaux (${String(COMPO?.fiscalite?.ps ?? 18.6).replace(".", ",")} % sur les gains)</td><td class="num">${eur0(peaNet)}</td></tr>
      <tr><td>Livret A (sans impôt)</td><td class="num">${eur0(finL.total)}</td></tr>
      <tr><td>Argent versé, sous le matelas</td><td class="num">${eur0(fin.verse)}</td></tr>
      <tr><td>PEA net en euros d'aujourd'hui (inflation ${String(C.inflation_long).replace(".", ",")} %/an)</td><td class="num">${eur0(reel(peaNet))}</td></tr>
    </tbody></table>
    <p style="margin:10px 0 0">Écart PEA net / Livret A : <b class="num up">${fmtEur(peaNet - finL.total, 0)}</b>. Le Livret A ne perd jamais, le PEA peut baisser fortement certaines années.</p>
    <p class="muted small" style="margin:6px 0 0">Livret A à ${String(C.livretA).replace(".", ",")} % depuis le ${esc(C.livretA_date)}, supposé constant. Inflation récente : ${String(C.inflation_actuelle).replace(".", ",")} % (${esc(C.inflation_date)}) ; la projection retient ${String(C.inflation_long).replace(".", ",")} %/an en moyenne. Si l'inflation dépasse le taux du livret, l'argent qui y dort perd du pouvoir d'achat.</p>
  </section>`;
}

function fiscaliteHtml(r, v0, gain) {
  const F = COMPO?.fiscalite || {plafond: 150000, ps: 18.6, ir: 12.8};
  const tx1 = txList().map(t => t.d).sort()[0] || "";
  const ouv = store.get("pea-ouverture") || tx1;
  let bloc = `<p class="empty-inline">Entre la date d'ouverture de ton PEA (dans l'appli Trade Republic) pour voir le compte à rebours.</p>`;
  if (ouv) {
    const d0 = new Date(ouv + "T00:00:00"), d5 = new Date(d0); d5.setFullYear(d5.getFullYear() + 5);
    const now = new Date(), tot = d5 - d0, fait = Math.min(Math.max(now - d0, 0), tot);
    const jours = Math.ceil((d5 - now) / 864e5);
    bloc = `<div class="bigbar"><span style="width:${fait / tot * 100}%;background:var(--accent)"></span></div>
      <div class="ticks"><span>${esc(d0.toLocaleDateString("fr-FR"))}</span><span>5 ans : ${esc(d5.toLocaleDateString("fr-FR"))}</span></div>
      <p style="margin:10px 0 0">${jours > 0 ? `Encore <b class="num">${jours.toLocaleString("fr-FR")} jours</b> (${(jours / 365.25).toFixed(1).replace(".", ",")} ans) avant l'exonération d'impôt sur le revenu.` : `<b class="up">Ton PEA a plus de 5 ans</b> : tes gains ne paient plus que les prélèvements sociaux, et tu peux retirer sans clôturer.`}</p>`;
  }
  const reste = Math.max(F.plafond - r.verse, 0);
  const plus5 = ouv && new Date() >= (() => { const d = new Date(ouv + "T00:00:00"); d.setFullYear(d.getFullYear() + 5); return d; })();
  const g = Math.max(gain, 0);
  return `<section class="card">
    <h2>Les 5 ans du PEA</h2>
    <div class="form" style="grid-template-columns:1fr"><label>Date d'ouverture du PEA<input id="pv-ouverture" type="date" value="${esc(ouv)}"></label></div>
    ${!store.get("pea-ouverture") && tx1 ? `<p class="muted small" style="margin:6px 0 0">Par défaut, date de ta 1re transaction importée. Corrige-la si ton PEA a été ouvert avant.</p>` : ""}
    ${bloc}
  </section>
  <section class="card">
    <h2>Plafond de versements</h2>
    <div class="bigbar"><span style="width:${Math.min(r.verse / F.plafond * 100, 100)}%;background:var(--c-nasdaq)"></span></div>
    <div class="ticks"><span>Versé : ${eur0(r.verse)}</span><span>${eur0(F.plafond)}</span></div>
    <p style="margin:10px 0 0">Il te reste <b class="num">${eur0(reste)}</b> à verser${r.hebdo ? `, soit environ ${Math.floor(reste / r.hebdo)} semaines à ${eur0(r.hebdo)}` : ""}. Les gains peuvent dépasser le plafond sans limite.</p>
  </section>
  <section class="card">
    <h2>Si tu retirais aujourd'hui</h2>
    <table class="cmptable"><tbody>
      <tr><td>Plus-value actuelle</td><td class="num">${eur0(g)}</td></tr>
      <tr><td>Avant 5 ans : ${(F.ir + F.ps).toFixed(1).replace(".", ",")} % (${String(F.ir).replace(".", ",")} % d'impôt + ${String(F.ps).replace(".", ",")} % de prélèvements sociaux), et le PEA est clôturé</td><td class="num down">−${eur0(g * (F.ir + F.ps) / 100)}</td></tr>
      <tr><td>Après 5 ans : ${String(F.ps).replace(".", ",")} % de prélèvements sociaux seulement</td><td class="num down">−${eur0(g * F.ps / 100)}</td></tr>
    </tbody></table>
    <p class="muted small" style="margin:8px 0 0">Les impôts ne portent que sur les gains, jamais sur l'argent versé, et rien n'est dû tant que tu ne retires pas.${plus5 ? "" : " Tant que ton PEA a moins de 5 ans, tout retrait entraîne en principe sa clôture."} ${esc(F.source || "")}.</p>
  </section>`;
}

/* Onglet « Achats » : import des transactions, prix de revient et plus-value réelle.
   Le fichier est lu dans le navigateur et gardé dans localStorage : rien n'est envoyé. */

const TX_ETF = [["global", /global|acwi|gpea|FR0014017NX3/i], ["nasdaq", /nasdaq|pust|FR0011871110/i], ["europe", /europe|pceu|FR0013412038/i]];
const TX_TYPE = [["achat", /achat|buy|plan|savings|épargne|epargne|kauf/i], ["vente", /vente|sell|verkauf/i], ["depot", /d[ée]p[oô]t|versement|deposit|virement|einzahlung/i], ["retrait", /retrait|withdraw|auszahlung/i]];

function lireTransactions(texte) {
  texte = texte.replace(/^﻿/, "").trim();
  let lignes;
  if (/^[\[{]/.test(texte)) {
    const j = JSON.parse(texte);
    lignes = (Array.isArray(j) ? j : j.transactions || []).map(o => ({d: o.date || o.d, etf: o.etf || o.isin || o.nom || "", type: o.type || "", q: o.quantite ?? o.q ?? "", m: o.montant ?? o.m ?? "", f: o.frais ?? o.f ?? ""}));
  } else {
    const rows = texte.split(/\r?\n/).filter(l => l.trim());
    const sep = rows[0].includes(";") ? ";" : rows[0].includes("\t") ? "\t" : ",";
    const head = rows[0].split(sep).map(h => h.trim().toLowerCase());
    const col = re => head.findIndex(h => re.test(h));
    const c = {d: col(/date/), etf: col(/etf|isin|titre|produit|nom/), type: col(/type|op/), q: col(/quantit|parts|qty|nombre/), m: col(/montant|amount|total/), f: col(/frais|fee/)};
    if (c.d < 0 || c.type < 0 || c.m < 0) throw new Error("Colonnes attendues : date, etf, type, quantite, montant, frais.");
    lignes = rows.slice(1).map(l => { const v = l.split(sep).map(x => x.trim().replace(/^"|"$/g, "")); return {d: v[c.d], etf: c.etf >= 0 ? v[c.etf] : "", type: v[c.type], q: c.q >= 0 ? v[c.q] : "", m: v[c.m], f: c.f >= 0 ? v[c.f] : ""}; });
  }
  const nb = x => { const v = parseFr(String(x ?? "").replace(/[€\s]/g, "")); return isFinite(v) ? Math.abs(v) : 0; };
  const date = x => { const m = String(x).match(/(\d{4})-(\d{2})-(\d{2})/) || String(x).match(/(\d{2})[\/.](\d{2})[\/.](\d{4})/); return !m ? null : m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`; };
  const out = [], rejet = [];
  lignes.forEach((l, i) => {
    const type = (TX_TYPE.find(([, re]) => re.test(l.type)) || [])[0];
    const etf = (TX_ETF.find(([, re]) => re.test(l.etf)) || [])[0] || null;
    const d = date(l.d);
    if (!d || !type || ((type === "achat" || type === "vente") && (!etf || !nb(l.q)))) { rejet.push(i + 2); return; }
    out.push({d, etf: type === "achat" || type === "vente" ? etf : null, type, q: nb(l.q), m: nb(l.m), f: nb(l.f)});
  });
  if (!out.length) throw new Error("Aucune transaction reconnue dans ce fichier.");
  return {tx: out.sort((a, b) => a.d.localeCompare(b.d)), rejet};
}

function achatsHtml(r) {
  const tx = txList();
  const aide = `<details style="margin-top:12px"><summary class="muted small">Format du fichier</summary>
    <p class="muted small" style="margin:6px 0 0">Un fichier CSV (ou JSON) avec une ligne par opération : <b>date</b> ; <b>etf</b> (global, nasdaq, europe, ou le code ISIN) ; <b>type</b> (achat, vente, depot, retrait) ; <b>quantite</b> (nombre de parts) ; <b>montant</b> (en €, hors frais) ; <b>frais</b>. Les dépôts servent à calculer tes versements et tes espèces.</p>
    <pre class="small" style="overflow-x:auto;margin:8px 0 0">date;etf;type;quantite;montant;frais
2026-09-01;;depot;;3000;0
2026-09-02;global;achat;400,5;2100;0
2026-09-02;nasdaq;achat;5,41;600;0</pre></details>`;
  const boutons = `<div class="row-actions">
      <label class="btn" style="cursor:pointer">${tx.length ? "Remplacer par un nouveau fichier" : "Importer mon fichier"}<input type="file" id="tx-file" accept=".csv,.txt,.json,text/csv,application/json" hidden></label>
      ${tx.length ? `<button class="btn ghost" id="tx-clear">Effacer mes transactions</button>` : ""}
      <span class="muted small" id="tx-msg" aria-live="polite"></span>
    </div>`;
  if (!tx.length) return `<section class="card">
    <h2>Mes achats</h2>
    <p style="margin:6px 0 0">Importe l'historique de tes transactions pour voir ta vraie plus-value, ton prix de revient par ETF et une estimation exacte des impôts.</p>
    <p class="muted small" style="margin:6px 0 0">Le fichier est lu sur ton appareil et gardé dans ce navigateur uniquement. Il n'est jamais envoyé ni publié.</p>
    ${boutons}${aide}
  </section>`;

  const etfs = LATEST.etfs;
  const lignes = etfs.map(e => {
    const p = txPos(e.id), cours = e.eur ? e.eur.close : null;
    const valeur = cours ? p.q * cours : null;
    return {e, p, cours, valeur, pv: valeur != null ? valeur - p.cout : null};
  }).filter(l => l.p.q > 0 || l.p.realise);
  const cout = lignes.reduce((a, l) => a + l.p.cout, 0);
  const valeur = lignes.reduce((a, l) => a + (l.valeur || 0), 0);
  const pv = valeur - cout, realise = lignes.reduce((a, l) => a + l.p.realise, 0);

  // Vraie courbe : parts détenues chaque jour × cours en euros de ce jour.
  const dates = (etfs[0].eur?.history || []).map(h => h[0]);
  const pts = dates.map(d => {
    let v = 0, c = 0;
    etfs.forEach(e => { const h = (e.eur?.history || []).find(x => x[0] === d); const p = txPos(e.id, d); if (h) v += p.q * h[1]; c += p.cout; });
    return [new Date(d).getTime(), v, c];
  }).filter(p => p[2] > 0);
  const courbeVraie = pts.length >= 2 ? svgLines([
    {pts: pts.map(p => [p[0], p[1]]), color: "var(--accent)", fill: true},
    {pts: pts.map(p => [p[0], p[2]]), color: "var(--muted)", dash: true}
  ], {label: "Valeur de mes ETF et argent investi", fmtY: eur0, fmtX: t => new Date(t).toLocaleDateString("fr-FR", {day: "numeric", month: "short"})}) : "";

  const nAchats = tx.filter(t => t.type === "achat").length;
  return `<section class="card">
    <h2>Ma vraie plus-value</h2>
    <p class="muted small" style="margin:4px 0 0">Parts achetées × dernier cours LS Exchange du ${esc(LATEST.label)}.</p>
    <div class="kpis">
      <div class="kpi"><label>Investi (frais compris)</label><div class="v num">${fmtEurPlain(cout)}</div></div>
      <div class="kpi"><label>Valeur</label><div class="v num">${fmtEurPlain(valeur)}</div></div>
      <div class="kpi"><label>Plus-value</label><div class="v num ${cls(pv)}">${fmtEur(pv)} <span class="small">(${fmtPct(cout ? pv / cout * 100 : 0)})</span></div></div>
    </div>
    ${realise ? `<p style="margin:10px 0 0">Plus-value déjà encaissée sur des ventes : <b class="num ${cls(realise)}">${fmtEur(realise)}</b>.</p>` : ""}
  </section>

  <section class="card">
    <h2>Par ETF</h2>
    <table class="cmptable"><tbody>
      ${lignes.map(l => `<tr><td><b>${esc(l.e.short)}</b><br><span class="muted small num">${l.p.q.toLocaleString("fr-FR", {maximumFractionDigits: 4})} parts · prix de revient ${l.p.pru.toLocaleString("fr-FR", {maximumFractionDigits: 4})} € · cours ${l.cours != null ? l.cours.toLocaleString("fr-FR", {maximumFractionDigits: 4}) + " €" : "?"}</span></td>
        <td class="num">${l.valeur != null ? fmtEurPlain(l.valeur) : "?"}<br><span class="small ${cls(l.pv || 0)}">${l.pv != null ? `${fmtEur(l.pv)} (${fmtPct(l.p.cout ? l.pv / l.p.cout * 100 : 0)})` : ""}</span></td></tr>`).join("")}
    </tbody></table>
    <p class="muted small" style="margin:8px 0 0">Le prix de revient est la moyenne de tes prix d'achat, frais compris. Si le cours est au-dessus, tu es gagnant sur cet ETF.</p>
  </section>

  ${courbeVraie ? `<section class="card">
    <h2>Ma vraie courbe</h2>
    <p class="muted small" style="margin:4px 0 0">Ce que valaient réellement tes parts chaque jour, face à l'argent que tu avais investi.</p>
    ${courbeVraie}
    <div class="legend"><i style="background:var(--accent)"></i><span>Valeur de mes parts</span><i style="background:var(--muted)"></i><span>Investi</span></div>
  </section>` : ""}

  <section class="card">
    <h2>Mes transactions</h2>
    <p class="muted small" style="margin:4px 0 0">${tx.length} opérations dont ${nAchats} achats, du ${esc(new Date(tx[0].d).toLocaleDateString("fr-FR"))} au ${esc(new Date(tx[tx.length - 1].d).toLocaleDateString("fr-FR"))}. Gardées dans ce navigateur uniquement.</p>
    <details style="margin-top:8px"><summary class="muted small">Voir la liste</summary>
      <table class="cmptable"><tbody>${tx.slice().reverse().map(t => `<tr><td>${esc(new Date(t.d).toLocaleDateString("fr-FR"))} · ${esc({achat: "Achat", vente: "Vente", depot: "Dépôt", retrait: "Retrait"}[t.type])}${t.etf ? " " + esc(etfs.find(e => e.id === t.etf)?.short || t.etf) : ""}${t.q ? `<br><span class="muted small num">${t.q.toLocaleString("fr-FR", {maximumFractionDigits: 4})} parts à ${(t.m / t.q).toLocaleString("fr-FR", {maximumFractionDigits: 4})} €</span>` : ""}</td><td class="num">${fmtEurPlain(t.m)}${t.f ? `<br><span class="muted small">frais ${fmtEurPlain(t.f)}</span>` : ""}</td></tr>`).join("")}</tbody></table>
    </details>
    ${boutons}${aide}
  </section>`;
}

function wireAchats() {
  const f = document.getElementById("tx-file");
  if (f) f.onchange = async () => {
    const file = f.files[0]; if (!file) return;
    try {
      const {tx, rejet} = lireTransactions(await file.text());
      store.set("pea-tx", JSON.stringify(tx));
      renderPea();
      const m = document.getElementById("tx-msg");
      if (m) m.textContent = `${tx.length} opérations importées.` + (rejet.length ? ` Lignes ignorées : ${rejet.join(", ")}.` : "");
    } catch (err) {
      const m = document.getElementById("tx-msg"); if (m) m.textContent = "Import impossible : " + err.message;
    }
  };
  const c = document.getElementById("tx-clear");
  if (c) c.onclick = () => { if (confirm("Effacer les transactions de ce navigateur ?")) { try { localStorage.removeItem("pea-tx"); } catch {} renderPea(); } };
}

/* Mon PEA vs les grands indices : les mêmes sommes, aux mêmes dates, placées dans un ETF CAC 40 ou S&P 500. */

function indicesHtml() {
  const H = LATEST.historique, IDX = LATEST.indices || [];
  const achats = txList().filter(t => t.etf && (t.type === "achat" || t.type === "vente"));
  if (!H || !achats.length) return `<section class="card">
    <h2>Mon PEA vs les grands indices</h2>
    <p style="margin:6px 0 0">Importe tes transactions dans Mon PEA › Achats : la page calculera ce que tu aurais avec les mêmes sommes, aux mêmes dates, placées dans le CAC 40 ou le S&P 500.</p>
  </section>`;
  const prix = (id, d) => { const h = H[id] || []; let v = null; for (const p of h) { if (p[0] > d) break; v = p[1]; } return v ?? (h[0] || [])[1]; };
  const debut = achats[0].d;
  const dates = H.global.map(p => p[0]).filter(d => d >= debut);
  const parts = Object.fromEntries(IDX.map(i => [i.id, 0]));
  let investi = 0, k = 0;
  const pts = dates.map(d => {
    while (k < achats.length && achats[k].d <= d) {
      const t = achats[k++], m = t.type === "achat" ? t.m + (t.f || 0) : -(t.m - (t.f || 0));
      investi += m;
      IDX.forEach(i => { parts[i.id] += m / prix(i.id, t.d); });
    }
    const moi = LATEST.etfs.reduce((s, e) => s + txPos(e.id, d).q * (prix(e.id, d) || 0), 0);
    const r = {d, investi, moi};
    IDX.forEach(i => { r[i.id] = parts[i.id] * prix(i.id, d); });
    return r;
  });
  const fin = pts[pts.length - 1];
  const pct = v => fin.investi ? (v / fin.investi - 1) * 100 : 0;
  const series = [{id: "moi", nom: "Mon PEA", color: "var(--accent)"}, ...IDX.map((i, n) => ({id: i.id, nom: i.nom, color: n ? "var(--c-nasdaq)" : "var(--c-europe)", dash: true}))];
  const chart = pts.length >= 2 ? svgLines(series.map(s => ({pts: pts.map(p => [new Date(p.d).getTime(), p.investi ? (p[s.id] / p.investi - 1) * 100 : 0]), color: s.color, dash: s.dash})),
    {label: "Plus-value en % : mon PEA comparé au CAC 40 et au S&P 500", fmtY: v => (v > 0 ? "+" : "") + v.toFixed(1).replace(".", ",") + " %", fmtX: t => new Date(t).toLocaleDateString("fr-FR", {day: "numeric", month: "short"})}) : "";
  const classement = series.map(s => ({...s, v: fin[s.id], p: pct(fin[s.id])})).sort((a, b) => b.p - a.p);
  const rang = classement.findIndex(s => s.id === "moi");
  const ecart = IDX.map(i => ({nom: i.nom, diff: fin.moi - fin[i.id]}));
  return `<section class="card">
    <h2>Mon PEA vs les grands indices</h2>
    <p class="muted small" style="margin:4px 0 0">Depuis ton premier achat le ${esc(new Date(debut).toLocaleDateString("fr-FR"))} : les mêmes sommes, aux mêmes dates, placées dans un ETF CAC 40 ou S&P 500.</p>
    ${chart}
    <div class="legend">${series.map(s => `<i style="background:${s.color}"></i><span>${esc(s.nom)}</span>`).join("")}</div>
    <div class="kpis">${classement.map(s => `<div class="kpi"><label>${s.id === "moi" ? "<b>Mon PEA</b>" : "Avec le " + esc(s.nom)}</label><div class="v num ${cls(s.p)}">${fmtPct(s.p)}</div><div class="muted small num">${fmtEurPlain(s.v)}</div></div>`).join("")}</div>
    <p style="margin:10px 0 0">${rang === 0 ? "<b>Tu fais mieux que les deux indices.</b>" : rang === classement.length - 1 ? "Pour l'instant, les deux indices font mieux que toi." : `Tu fais mieux que le ${esc(classement[classement.length - 1].nom)}, mais moins bien que le ${esc(classement[0].nom)}.`} ${ecart.map(x => `Par rapport au ${esc(x.nom)} : <b class="num ${cls(x.diff)}">${fmtEur(x.diff)}</b>.`).join(" ")}</p>
    <p class="muted small" style="margin:8px 0 0">Sur quelques semaines, l'écart dépend surtout de l'actualité du moment : c'est sur plusieurs années que la comparaison a du sens. Investi : ${fmtEurPlain(fin.investi)}. Cours en euros de LS Exchange. ${IDX.map(i => esc(i.etf) + " : " + esc(i.note)).join(" ")}</p>
  </section>`;
}
