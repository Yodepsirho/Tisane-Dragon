/* Une seule application pour deux pages : « Tisane & Dragon » (index.html) et « Alchimie & Dragon » (alchimie.html).
   Même code, mêmes principes ; l'alchimie a ses propres collections (préfixe alch_) et sa propre bibliothèque de recettes du MJ. */
const APP = window.APP || { id: "tisane" }, ALCH = APP.id === "alchimie", COLP = ALCH ? "alch_" : "";
const T = ALCH ? "potion" : "tisane";   // le mot employé pour le produit fini
document.documentElement.dataset.app = APP.id;

/* ============================================================
   1. Couche de données : Firestore si firebase-config.js est rempli,
   sinon localStorage (mode test local).
   Collections : inventaire, essais, tisanes, ingredients (catégories + qualité de chaque ingrédient), categories
   ============================================================ */
const cfg = window.firebaseConfig || {};
const useFirebase = cfg.apiKey && cfg.apiKey !== "REMPLACER" && typeof firebase !== "undefined";
let store;
if (useFirebase) {
  firebase.initializeApp(cfg);
  const fs = firebase.firestore();
  /* Un refus de Firebase (ex. règles Firestore pas à jour) ne doit pas passer inaperçu :
     sans ça l'interface montre la modification, puis elle « disparaît » au rafraîchissement. */
  const fail = (col, err) => {
    console.error("Firestore (" + col + ")", err);
    const b = document.getElementById("banner");
    b.classList.add("err"); b.classList.remove("hidden");
    b.textContent = err && err.code === "permission-denied"
      ? `Firebase a refusé l'accès à « ${col} » : les règles Firestore ne sont pas à jour, ce qui n'est pas enregistré disparaîtra au rafraîchissement. Déploie le dernier firestore.rules (firebase deploy --only firestore:rules --project tisaneetdragon).`
      : `Enregistrement impossible dans « ${col} » : ${(err && err.message) || err}`;
  };
  store = {
    subscribe: (col, cb) => fs.collection(col).onSnapshot(s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), err => fail(col, err)),
    add: (col, obj) => fs.collection(col).add({ ...obj, createdAt: Date.now() }).catch(err => fail(col, err)),
    set: (col, id, obj) => fs.collection(col).doc(id).set(obj, { merge: true }).catch(err => fail(col, err)),
    /* crée le document seulement s'il n'existe pas (ne piétine pas une catégorie renommée) */
    seed: (col, id, obj) => fs.collection(col).doc(id).get().then(d => d.exists ? null : fs.collection(col).doc(id).set(obj)).catch(err => fail(col, err)),
    del: (col, id) => fs.collection(col).doc(id).delete().catch(err => fail(col, err))
  };
} else {
  const listeners = {};
  const load = c => JSON.parse(localStorage.getItem("tisane_" + c) || "{}");
  const emit = c => (listeners[c] || []).forEach(cb => cb(Object.entries(load(c)).map(([id, v]) => ({ id, ...v }))));
  const save = (c, d) => { localStorage.setItem("tisane_" + c, JSON.stringify(d)); emit(c); };
  store = {
    subscribe: (col, cb) => { (listeners[col] = listeners[col] || []).push(cb); emit(col); },
    add: (col, obj) => { const d = load(col); d[Date.now() + Math.random().toString(36).slice(2, 6)] = { ...obj, createdAt: Date.now() }; save(col, d); },
    set: (col, id, obj) => { const d = load(col); d[id] = { ...(d[id] || {}), ...obj }; save(col, d); },
    seed: (col, id, obj) => { const d = load(col); if (!d[id]) { d[id] = obj; save(col, d); } },
    del: (col, id) => { const d = load(col); delete d[id]; save(col, d); }
  };
  const b = document.getElementById("banner");
  b.textContent = "Mode local : Firebase n'est pas configuré (voir firebase-config.js). Les données restent dans ce navigateur.";
  b.classList.remove("hidden");
}

const rawStore = store;   /* accès direct aux deux jeux de collections (transfert d'ingrédients, fiche de personnage commune) */
if (COLP) {   /* l'alchimie lit et écrit dans ses propres collections */
  const raw = store;
  store = {
    subscribe: (c, cb) => raw.subscribe(COLP + c, cb), add: (c, o) => raw.add(COLP + c, o), set: (c, i, o) => raw.set(COLP + c, i, o),
    seed: (c, i, o) => raw.seed(COLP + c, i, o), del: (c, i) => raw.del(COLP + c, i)
  };
}

/* ============================================================
   2. État et utilitaires
   ============================================================ */
let inventory = [], trials = [], tisanes = [], ingMeta = [], categories = [];
let filterIng = null, shownRecipes = [], knownRecipes = [], recTab = "ok", invFilter = null, ingForm = null;
const $ = id => document.getElementById(id);
const norm = s => s.trim().toLowerCase();
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const player = () => $("player").value.trim();
const invId = (p, name) => (p + "__" + name).replace(/[\/\s]+/g, "_");
const setKey = ings => [...new Set(ings.map(i => i.name))].sort().join("+");
const recipeKey = (ings, result) => setKey(ings) + "|" + norm(result || "");
const tisId = (p, key) => (p + "__" + key).replace(/[\/\s]+/g, "_");
const metaId = name => name.replace(/[\/\s]+/g, "_");
const catId = label => norm(label).replace(/[\/\s]+/g, "_");
const byLabel = (a, b) => a.name.localeCompare(b.name);
const PALETTE = ["#86b5e0", "#c3a1e0", "#e6a95a", "#6fcdbf", "#e08fb4", "#d6cf7a", "#e0916a", "#9aa9c9", "#a3c4a0"];
const OLD_EPIC_COLOR = "#a56ee0";   // couleur de la catégorie « Épique » ajoutée par erreur dans une version précédente
const HEX = /^#[0-9a-f]{6}$/i;

/* ============================================================
   2b. Grimoire du MJ : familles, catalogue, effets et moteur de résolution.
   Les données (RULES) viennent du dépôt « Grimoire du tisanier ». Le laboratoire en mode automatique joue le rôle du MJ.
   ============================================================ */
/* Les règles du Grimoire (grimoire-tisane.js) ne sont chargées que par la page des tisanes : l'alchimie repart de zéro. */
const RULES = window.RULES || { F: {}, X: {}, Y: {}, Z: {}, D: [], DD: [], DI: [], TN: [], DU: [] };

/* Les six familles du Grimoire remplacent les Classifications de l'app (identifiants fixes, pour qu'un réimport ne crée pas de doublon) */
const FAMILIES = ALCH ? {} : {
  A: { name: "Apaisantes", color: "#e08fb4" }, V: { name: "Vigoureuses", color: "#e0916a" }, E: { name: "Écorces et feuillages", color: "#a3c4a0" },
  L: { name: "Lunaires", color: "#9aa9c9" }, M: { name: "Mythalliques", color: "#6fcdbf" }, N: { name: "Inertes", color: "#a8a99a" }
};
const famCatId = f => catId(FAMILIES[f].name);
const famIds = new Set(Object.keys(FAMILIES).map(f => catId(FAMILIES[f].name)));   // identifiants réservés : ces catégories ne sont jamais montrées aux PJ
const famOfName = {}; Object.keys(RULES.F).forEach(f => RULES.F[f][1].forEach(([n]) => { famOfName[n] = f; }));
const stripKey = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
/* Bibliothèque du MJ (le « backend ») : ingrédients, potions (un effet par paire de familles) et effets anecdotiques.
   Elle vit dans Firestore et se modifie dans l'onglet MJ. Tant qu'elle n'est pas initialisée, ce sont les données du Grimoire qui servent. */
/* Cinq qualités (Commun → Légendaire), identiques sur Tisane et Alchimie. Les anciens noms (Basse, Moyenne, Élevée, Suprême) restent reconnus et sont convertis à la lecture. */
const QL = ["", "Commun", "Peu commun", "Rare", "Épique", "Légendaire"];
const QN = {}; QL.forEach((q, i) => { if (q) QN[q] = i; });
const Q_ALIAS = { basse: "Commun", commun: "Commun", commune: "Commun", moyenne: "Peu commun", "peu commun": "Peu commun", "peu commune": "Peu commun", "élevée": "Rare", elevee: "Rare", rare: "Rare", "épique": "Épique", epique: "Épique", "suprême": "Légendaire", supreme: "Légendaire", "légendaire": "Légendaire", legendaire: "Légendaire" };
const normQ = q => QN[q] ? q : (Q_ALIAS[String(q || "").trim().toLowerCase()] || "");
const DEFAULTS = ALCH ? { ingredients: [], potions: [], anecdotes: [], categories: [] } : {
  ingredients: RULES.D.map(([name, desc, price]) => ({ name, desc, price, family: famOfName[name] })),
  potions: Object.keys(RULES.X).map(k => ({ key: k, name: RULES.X[k][0], tiers: RULES.X[k][1], duration: RULES.X[k][2] || null, fail: RULES.Z[k] })),
  anecdotes: Object.keys(RULES.Y).map(k => ({ key: k, name: RULES.Y[k][0], text: RULES.Y[k][1], type: RULES.Y[k][2] }))
};
let libIng = [], libPot = [], libAnec = [];
/* Tisanes : prête dès que les potions sont enregistrées. Alchimie : prête dès qu'elle contient quelque chose, ou si le fichier grimoire-alchimie.json est vide (rien à initialiser). */
const libReady = () => ALCH ? (libIng.length + libPot.length > 0 || DEFAULTS.ingredients.length + DEFAULTS.potions.length === 0) : libPot.length > 0;
let rawCats = [], RECS = [];
let CATALOG = [], POT = {}, ANEC = {};
/* Catégories : celles de Firestore ; tant que l'alchimie n'est pas initialisée, celles du fichier grimoire-alchimie.json s'y ajoutent */
function applyCats() {
  const extra = ALCH ? DEFAULTS.categories.filter(c => !rawCats.some(x => x.id === c.id)) : [];
  /* Tant que la bibliothèque n'est pas initialisée, le fichier fait foi : une ancienne catégorie de même identifiant gardée dans Firebase
     (par exemple « Médicinal » rangé à l'époque en Classification) ne doit pas écraser son groupe, son nom ni sa couleur. */
  const fromFile = ALCH && !libReady() ? new Map(DEFAULTS.categories.map(c => [c.id, c])) : null;
  const base = fromFile ? rawCats.map(c => fromFile.has(c.id) ? { ...c, name: fromFile.get(c.id).name, color: fromFile.get(c.id).color, group: fromFile.get(c.id).group } : c) : rawCats;
  categories = [...base, ...extra].filter(c => !c.deleted && !famIds.has(c.id));
  /* Tisane reprend à l'identique les catégories d'Alchimie (classification, propriété, environnement), lues dans grimoire-alchimie.json */
  if (!ALCH && SHARED_CATS) categories = SHARED_CATS.map(c => ({ ...c }));
}
let SHARED_CATS = null;
const catMemo = new Map();
function rebuildLib() {
  const L = libReady() ? { ingredients: libIng, potions: libPot, anecdotes: libAnec } : DEFAULTS;
  CATALOG = L.ingredients.filter(d => d.name && (ALCH || FAMILIES[d.family])).map(d => ({ id: d.id || metaId(d.name), clas: Array.isArray(d.clas) ? d.clas : [], props: Array.isArray(d.props) ? d.props : [], envs: Array.isArray(d.envs) ? d.envs : [], name: d.name, desc: d.desc || "", p: Number(d.price) || 0, f: d.family, q: qualOfDoc(d), key: stripKey(d.name) }));
  POT = {}; L.potions.forEach(x => { POT[x.key || x.id] = x; });
  RECS = L.potions;
  applyCats();
  ANEC = {}; L.anecdotes.forEach(x => { ANEC[x.key] = x; });
  catMemo.clear(); slotMemo.clear(); litKeys = null;
}
/* Qualité d'un ingrédient de la bibliothèque : le champ « q », à défaut la mention « Qualité … » de sa description (imports anciens) */
function qualOfDoc(d) {
  const q = normQ(d.q); if (q) return q;
  const m = /Qualité (basse|moyenne|élevée|suprême|commune?|peu commune?|rare|épique|légendaire)/i.exec(d.desc || "");
  return m ? normQ(m[1]) : "";
}
const slotMemo = new Map();
let litKeys = null;
rebuildLib();
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/* Retrouve l'ingrédient du Grimoire qui correspond à un nom saisi à la main (accents, tirets, majuscules et petites fautes tolérés).
   Une correspondance doit être unique : en cas d'égalité, on ne devine pas. */
function catalogItem(name) {
  const k = stripKey(name || ""); if (!k) return null;
  if (catMemo.has(k)) return catMemo.get(k);
  let found = CATALOG.find(c => c.key === k) || null;
  if (!found) {
    const scored = CATALOG.map(c => ({ c, d: lev(k, c.key) })).sort((x, y) => x.d - y.d);
    const lim = Math.min(3, Math.floor(k.length * 0.15));
    if (scored.length && scored[0].d <= lim && (scored.length < 2 || scored[1].d > scored[0].d)) found = scored[0].c;
  }
  catMemo.set(k, found);
  return found;
}
/* Règles du MJ pour deux ingrédients : inerte ou somme des prix ≤ 10 = effet anecdotique, sinon effet de la paire de familles selon la somme (≤60 léger, ≤200 marqué, au-delà exceptionnel) */
function mixOutcome(a, b) {
  const s = a.p + b.p, key = [a.f, b.f].sort().join("");
  if (a.f === "N" || b.f === "N" || s <= 10) {
    const y = ANEC[key]; if (!y) return null;
    return { potion: false, name: y.name, text: y.text, type: y.type, duration: y.type === "0" ? null : "1 heure", names: [a.name, b.name], a, b, s };
  }
  const t = s <= 60 ? 0 : s <= 200 ? 1 : 2, e = POT[key]; if (!e) return null;
  return { potion: true, name: e.name, t, tier: RULES.TN[t], duration: e.duration || RULES.DU[t], text: e.tiers[t], dd: RULES.DD[t], fail: (e.fail || "").replace(/\{d\}/g, RULES.DI[t]), names: [a.name, b.name], a, b, s };
}
/* Alchimie : une recette du MJ est un jeu de 2 à 4 « emplacements ». Un emplacement est :
   - un ingrédient précis de la bibliothèque,
   - une classification (« Eau », « Toxine »…) : n'importe quel ingrédient de cette classification convient,
     et « Essence de créature - Chenille » demande plutôt un ingrédient de ce nom, à défaut n'importe lequel de la classe,
   - une autre potion (produit déjà fabriqué), ou un objet écrit tel quel.
   La qualité du résultat est la moyenne des qualités des ingrédients (Peu commun + Légendaire = Épique). */
const hasCat = (it, id) => it.clas.includes(id) || (it.props || []).includes(id);
const slotRaw = id => String(id).replace(/_/g, " ");
function resolveSlot(id) {
  if (slotMemo.has(id)) return slotMemo.get(id);
  const raw = slotRaw(id), key = stripKey(raw), [head, spec] = raw.split(" - ").map(x => x.trim());
  let r;
  if (CATALOG.some(c => c.id === id)) r = { t: "ing", id, score: 3 };
  else if (RECS.some(x => stripKey(x.name) === key)) r = { t: "prod", key, score: 3 };
  else {
    const hk = stripKey(head || ""), cl = categories.find(c => groupOf(c) === "classification" && stripKey(c.name) === hk) || categories.find(c => groupOf(c) === "propriete" && stripKey(c.name) === hk);   // « Toxine », « Psychotrope »… sont des propriétés
    if (cl) {
      const sk = spec ? stripKey(spec) : "", useSpec = sk.length >= 5 && CATALOG.some(c => hasCat(c, cl.id) && c.key.includes(sk));
      r = { t: "cls", cid: cl.id, spec: useSpec ? sk : "", score: useSpec ? 2 : 1 };
    } else r = { t: "lit", key, score: 3 };
  }
  slotMemo.set(id, r); return r;
}
function alchItem(name) {
  const c = catalogItem(name); if (c) return c;
  const k = stripKey(name || ""); if (!k) return null;
  const r = RECS.find(x => stripKey(x.name) === k); if (r) return { id: "r_" + metaId(r.name), prod: true, name: r.name, key: k, clas: [], q: "" };
  if (!litKeys) { litKeys = new Map(); RECS.forEach(x => (x.ingredients || []).forEach(id => { const s = resolveSlot(id); if (s.t === "lit") litKeys.set(s.key, slotRaw(id)); })); }
  return litKeys.has(k) ? { id: metaId(litKeys.get(k)), lit: true, name: litKeys.get(k), key: k, clas: [], q: "" } : null;
}
const slotFits = (s, it) => s.t === "ing" ? it.id === s.id : s.t === "prod" ? !!it.prod && it.key === s.key : s.t === "lit" ? !!it.lit && it.key === s.key
  : !it.prod && !it.lit && hasCat(it, s.cid) && (!s.spec || it.key.includes(s.spec));
function slotsMatch(slots, items) {
  if (slots.length !== items.length) return false;
  const used = [], go = k => { if (k === slots.length) return true; for (let j = 0; j < items.length; j++) if (!used[j] && slotFits(slots[k], items[j])) { used[j] = true; if (go(k + 1)) return true; used[j] = false; } return false; };
  return go(0);
}
const itemQual = it => { const q = it.q || (it.prod || it.lit ? "" : rarityOf(it.name).q) || ""; return QN[q] ? q : ""; };
function alchOutcome(items) {
  const names = items.map(i => i.name);
  const hits = RECS.map(r => { const sl = (r.ingredients || []).map(resolveSlot); return slotsMatch(sl, items) ? { r, score: sl.reduce((a, s) => a + s.score, 0) } : null; }).filter(Boolean);
  const top = Math.max(0, ...hits.map(h => h.score)), best = hits.filter(h => h.score === top);
  if (best.length > 1) return { error: `Ces ingrédients conviennent à plusieurs recettes (${best.map(h => h.r.name).join(", ")}). Le MJ doit trancher : choisis un état à la main.` };
  if (!best.length) return { potion: false, name: "Sans effet", text: "Le mélange ne donne rien de probant.", type: "0", duration: null, names };
  const r = best[0].r, qs = items.map(itemQual).filter(Boolean), avg = qs.length ? Math.floor(qs.reduce((a, q) => a + QN[q], 0) / qs.length + 0.5) : 0;
  return { potion: true, name: r.name, text: r.text || "", duration: r.duration || null, fail: r.fail || "", names, qual: avg ? QL[avg] : "", qualFrom: qs };
}
function autoOutcome(ings) {
  if (ALCH) {
    if (ings.length > 4) return { error: "Le MJ automatique ne tranche que les mélanges de deux à quatre ingrédients." };
    const items = ings.map(i => alchItem(i.name)), miss = ings.find((_, k) => !items[k]);
    if (miss) return { error: `« ${cap(miss.name)} » est inconnu du MJ. Choisis un état à la main.` };
    if (new Set(items).size !== items.length) return { error: "Deux de ces noms désignent le même ingrédient." };
    return alchOutcome(items);
  }
  if (ings.length !== 2) return { error: "Le MJ automatique ne tranche que les mélanges de deux ingrédients. Retire-en un, ou choisis un état à la main." };
  const items = ings.map(i => catalogItem(i.name)), miss = ings.find((_, k) => !items[k]);
  if (miss) return { error: `« ${cap(miss.name)} » est inconnu du MJ. Choisis un état à la main.` };
  if (items[0] === items[1]) return { error: "Ces deux noms désignent le même ingrédient." };
  return mixOutcome(items[0], items[1]) || { error: "Le MJ n'a pas d'effet pour cette paire de familles." };
}
const outcomeName = o => o.potion && o.tier ? `${o.name} (${o.tier})` : o.name;
const outcomeKind = o => o.potion ? "Potion" : o.type === "b" ? "Désastre mineur" : o.type === "f" ? "Effet anecdotique amusant" : "Aucun effet";
const outcomeNotes = o => o.potion && ALCH ? `${o.text}${o.qual ? " Qualité : " + o.qual + "." : ""}${o.duration ? " Durée : " + o.duration + "." : ""}${o.fail ? " Effet secondaire : " + o.fail : ""}`
  : o.potion
  ? `${o.tier}, durée : ${o.duration}. ${o.text} Jet de préparation raté (DD ${o.dd}) : ${o.fail}`
  : `${outcomeKind(o)}${o.duration ? ", durée : " + o.duration : ""}. ${o.text}`;
function outcomeHTML(o, withSum) {
  const cls = o.potion ? "ok" : o.type === "b" ? "ko" : "st-unknown";
  return `<div class="outcome"><h3 class="${cls}">${esc(outcomeName(o))}</h3>
    <div class="pair">${o.names.map(esc).join(" + ")}${withSum && o.s !== undefined ? ` · somme des prix : ${o.s}` : ""}</div>
    <div class="pair">${o.potion ? "Potion" : esc(outcomeKind(o))}${o.duration ? " · durée : " + esc(o.duration) : ""}</div>
    ${o.qual ? `<div class="pair">Qualité obtenue : <b>${esc(o.qual)}</b>${o.qualFrom.length > 1 ? " (moyenne de : " + o.qualFrom.map(esc).join(", ") + ")" : ""}</div>` : ""}
    <p style="margin:6px 0 0;white-space:pre-line">${esc(o.text)}</p>
    ${o.potion && o.dd ? `<div class="bad"><b>Jet de préparation raté</b> (outils d'herboriste ou Intelligence (Nature), DD ${o.dd}) : ${esc(o.fail)}</div>` : o.potion && o.fail ? `<div class="bad"><b>Effet secondaire</b> : ${esc(o.fail)}</div>` : ""}</div>`;
}
const descHTML = d => esc(d).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

/* Qualités : il n'y a plus de raretés, la qualité les remplace (partagée entre tous les PJ).
   Le champ stocké reste « rarity » et les identifiants sont inchangés pour ne pas perdre les données déjà saisies
   (peu-commun = Basse, rare = Moyenne, epique = Élevée, legendaire = Suprême, commun = sans qualité). */
const RARITIES = [
  { id: "commun", label: "Sans qualité", color: "#a8a99a" },
  { id: "peu-commun", label: "Commun", color: "#7ccf7c", q: "Commun", dd: 10, mod: "+2", val: "Cuivre" },
  { id: "rare", label: "Peu commun", color: "#5b9bff", q: "Peu commun", dd: 15, mod: "+0", val: "Argent" },
  { id: "epique", label: "Rare", color: "#b07af0", q: "Rare", dd: 20, mod: "-2", val: "Or" },
  { id: "epique-5", label: "Épique", color: "#e8618c", q: "Épique", dd: 22, mod: "-3", val: "Électrum" },
  { id: "legendaire", label: "Légendaire", color: "#f2b33d", q: "Légendaire", dd: 25, mod: "-4", val: "Platine" }
];
function rarityOf(name) {
  const ci = catalogItem(name);   // la qualité de la bibliothèque du MJ fait foi
  const lib = ci && ci.q && RARITIES.find(r => r.q === ci.q);
  if (lib) return lib;
  const m = ingMeta.find(x => x.name === name);
  return RARITIES.find(r => m && r.id === m.rarity) || RARITIES[0];
}
/* DD d'acquisition, modificateur de fabrication et valeur : déduits de la qualité */
const qualLine = r => r.q && ALCH ? `Qualité <b style="color:${r.color}">${r.q}</b>` : r.q ? `Qualité <b style="color:${r.color}">${r.q}</b> · DD d'acquisition ${r.dd} · Mod. fabrication ${r.mod} · ${r.val}` : "";
function renderQualTable() {
  $("qual-table").innerHTML = `<table class="qt"><tr><th>Qualité</th><th>DD d'acquisition</th><th>Mod. du DD de fabrication</th><th>Valeur monétaire</th></tr>`
    + RARITIES.filter(r => r.q).map(r => `<tr><td style="color:${r.color}">◆ ${r.q}</td><td>${r.dd}</td><td>${r.mod}</td><td>${r.val}</td></tr>`).join("") + "</table>";
}
/* Losange coloré devant le nom (couleur de la qualité), rien pour un ingrédient sans qualité */
function rarMark(name) {
  const r = rarityOf(name);
  return r.id === "commun" ? "" : `<span class="rar" style="color:${r.color}" title="Qualité ${r.label}">◆</span>`;
}

/* Catégories d'un ingrédient (plusieurs possibles, partagées entre tous les PJ).
   Les anciennes données n'avaient qu'un champ « category » : il reste lu. */
const metaCatIds = m => !m ? [] : Array.isArray(m.categories) ? m.categories : (m.category ? [m.category] : []);
/* Classification (famille du Grimoire), Propriété et Environnement viennent de la bibliothèque du MJ.
   Un PJ ne voit, pour un ingrédient de son inventaire, que les groupes que le MJ lui a révélés. */
const famCat = f => ({ id: famCatId(f), name: FAMILIES[f].name, color: FAMILIES[f].color, group: "classification" });
const myItem = name => inventory.find(i => i.player === player() && i.name === name);
const allCats = () => categories;
function catParts(name) {
  const it = myItem(name); if (!it) return { rev: [], own: [] };
  const ci = catalogItem(name), rv = it.reveal || {}, pool = allCats(), byId = id => pool.find(c => c.id === id);
  const rev = ci ? [...(rv.classification ? ci.clas.map(byId) : []), ...(rv.propriete ? ci.props : []).map(byId), ...(rv.environnement ? ci.envs : []).map(byId)].filter(Boolean) : [];
  return { rev, own: (it.cats || []).map(byId).filter(Boolean) };
}
/* Ce que le PJ voit d'un de ses ingrédients : ce que le MJ lui a révélé, plus ce qu'il a noté lui-même */
function catsOf(name) {
  const p = catParts(name);
  return [...new Map([...p.rev, ...p.own].map(c => [c.id, c])).values()];
}
const catIdsOf = name => catsOf(name).map(c => c.id);
/* Trois familles de catégories : Classification (celles d'origine), Propriété et Environnement (où cueillir l'ingrédient). Sans champ « group », une catégorie est une Classification. */
const GROUPS = [{ id: "classification", label: "Classification" }, { id: "propriete", label: "Propriété" }, { id: "environnement", label: "Environnement" }];
const MANAGED = ["classification", "propriete", "environnement"];   // groupes de catégories que le MJ gère ; la classification = les familles fixes du Grimoire
const groupOf = c => c && GROUPS.some(g => g.id === c.group) ? c.group : "classification";
const fmt = x => `${rarMark(x.name)}${esc(cap(x.name))} ×${x.qty}`;

/* États d'un mélange : ok (recette finie), unknown (testé, effets inconnus), untested (pas encore testé), ko (raté) */
const statusOf = t => t.status || (t.success ? "ok" : "ko");
const RANK = { ko: 0, untested: 1, unknown: 2, ok: 3 };
const STATUS_LABEL = { ok: "Réussi", unknown: "Effets inconnus", untested: "À tester", ko: "Raté" };
const REC_TABS = [
  { id: "ok", title: "Recettes finies", empty: "Aucune recette finie pour l'instant. Compose un mélange réussi dans le laboratoire." },
  { id: "untested", title: "À tester", empty: "Aucun mélange en attente d'essai. Au laboratoire, choisis l'état « Pas encore testé » pour en noter un." },
  { id: "unknown", title: "Effets à découvrir", empty: "Aucun mélange testé sans effet connu. Au laboratoire, choisis « Testé, effets inconnus »." }
];

let toastTimer;
function toast(msg, ms = 2200) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

/* Les personnages : liste à compléter ici quand un joueur rejoint la table */
const PLAYERS = ["Griselda", "Pitic", "Varo"];
$("player").innerHTML = '<option value="">— Choisir —</option>' + PLAYERS.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
$("player").value = localStorage.getItem("tisane_player") || "";
$("player").addEventListener("change", () => { localStorage.setItem("tisane_player", player()); renderInventory(); renderTisanes(); });

function showTab(t) {
  $("view-recette").classList.toggle("hidden", t !== "recette");
  if ($("view-accueil")) $("view-accueil").classList.toggle("hidden", t !== "accueil");
  $("view-grimoire").classList.toggle("hidden", t !== "grimoire");
  $("view-mj").classList.toggle("hidden", t !== "mj");
  if ($("view-recherche")) $("view-recherche").classList.toggle("hidden", t !== "recherche");
  ["accueil", "recette", "grimoire", "recherche", "mj"].filter(x => $("tab-" + x)).forEach(x => {
    $("tab-" + x).classList.toggle("active", t === x);
    $("tab-" + x).setAttribute("aria-selected", t === x);
  });
  if (t === "recette") renderSocio();
  if (t === "mj") renderMj();
  if (t === "recherche") renderSearch();
  if (t === "accueil") renderQuick();
}
if ($("tab-accueil")) $("tab-accueil").onclick = () => showTab("accueil");
$("tab-recette").onclick = () => showTab("recette");
$("tab-grimoire").onclick = () => showTab("grimoire");
$("tab-mj").onclick = () => showTab("mj");
if ($("tab-recherche")) $("tab-recherche").onclick = () => showTab("recherche");

/* ============================================================
   3. Inventaire
   ============================================================ */
const tag = (c, extra) => `<span class="tg t-${groupOf(c)}" style="--c:${esc(c.color)}">${esc(c.name)}${extra || ""}</span>`;

/* Tri de l'inventaire : qualité (la plus haute d'abord, par défaut), quantité (la plus grande d'abord),
   propriété ou classification (ordre alphabétique de la première catégorie de la famille, sans catégorie à la fin). Ensuite par nom. */
let invSort = "rarity";
try { invSort = localStorage.getItem("tisane_invsort") || "rarity"; } catch (e) {}
function invSorter() {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const firstCat = (name, g) => { const c = catsOf(name).filter(x => groupOf(x) === g).sort(byLabel)[0]; return c ? c.name : null; };
  const rank = n => RARITIES.findIndex(r => r.id === rarityOf(n).id);
  if (invSort === "qty") return (a, b) => b.qty - a.qty || byName(a, b);
  if (GROUPS.some(g => g.id === invSort)) return (a, b) => {
    const x = firstCat(a.name, invSort), y = firstCat(b.name, invSort);
    return x === y ? byName(a, b) : x === null ? 1 : y === null ? -1 : x.localeCompare(y) || byName(a, b);
  };
  return (a, b) => rank(b.name) - rank(a.name) || byName(a, b);
}
$("inv-sort").value = invSort;
$("inv-sort").addEventListener("change", () => {
  invSort = $("inv-sort").value;
  try { localStorage.setItem("tisane_invsort", invSort); } catch (e) {}
  renderInventory();
});
function renderInvFilter(mine) {
  const vis = new Map(); mine.forEach(i => catsOf(i.name).forEach(c => vis.set(c.id, c)));
  if (invFilter && invFilter !== "__none" && !vis.has(invFilter)) invFilter = null;
  const chip = (id, label) => `<button type="button" class="fchip${invFilter === id ? " on" : ""}" data-f="${esc(id || "")}">${esc(label)}</button>`;
  const cchip = c => `<button type="button" class="tg t-${groupOf(c)}${invFilter === c.id ? " on" : ""}" style="--c:${esc(c.color)}" data-f="${esc(c.id)}">${esc(c.name)}</button>`;
  $("inv-filter").innerHTML = vis.size && mine.length
    ? chip(null, "Toutes") + GROUPS.map(g => {
        const cs = [...vis.values()].filter(c => groupOf(c) === g.id).sort(byLabel);
        return cs.length ? `<span class="fgroup">${g.label}</span>` + cs.map(cchip).join("") : "";
      }).join("") + chip("__none", "Sans catégorie")
    : "";
}
$("inv-filter").addEventListener("click", e => {
  const b = e.target.closest("[data-f]"); if (!b) return;
  invFilter = b.dataset.f || null; renderInventory();
});

function renderInventory() {
  const me = player();
  $("inv-owner").textContent = me || "…"; $("known-owner").textContent = me || "…";
  const mineAll = inventory.filter(i => i.player === me).sort(invSorter());
  renderInvFilter(mineAll);
  const keep = i => !invFilter ? true : invFilter === "__none" ? !catIdsOf(i.name).length : catIdsOf(i.name).includes(invFilter);
  const stock = mineAll.filter(i => i.qty > 0), known = mineAll;   // « connus » = tout ce que le PJ connaît, en stock ou non
  const noMe = '<div class="empty">Choisis ton personnage en haut de la page.</div>';
  $("inventory").innerHTML = !me ? noMe
    : !stock.length ? '<div class="empty">Ton inventaire est vide. Utilise « Ajouter un ingrédient ».</div>'
    : !stock.filter(keep).length ? '<div class="empty">Aucun ingrédient en stock dans cette catégorie.</div>'
    : invTable(stock.filter(keep));
  $("known").innerHTML = !me ? noMe
    : !known.length ? '<div class="empty">Aucun ingrédient connu pour le moment.</div>'
    : !known.filter(keep).length ? '<div class="empty">Aucun ingrédient connu dans cette catégorie.</div>'
    : invTable(known.filter(keep), true);


  const names = new Set([...inventory.map(i => i.name), ...trials.flatMap(t => t.ingredients.map(x => x.name))]);
  const places = new Set([...mineAll.flatMap(i => [...(i.harvests || []), ...(i.purchases || [])].map(h => h.place))]);
  $("places").innerHTML = [...places].sort().map(p => `<option value="${esc(p)}">`).join("");
  $("all-ingredients").innerHTML = [...names].sort().map(n => `<option value="${esc(cap(n))}">`).join("");
}

let qtyOpen = null;   // ligne dont on est en train de modifier la quantité (les boutons − et + n'apparaissent qu'à ce moment)
const inGroup = (name, g) => catsOf(name).filter(c => groupOf(c) === g).sort(byLabel);
let knownOpen = new Set();   // lignes dépliées dans « Ingrédients connus »
const dateFr = t => new Date(t).toLocaleDateString("fr-FR");
/* Historique d'un ingrédient : récoltes (notées à la main, par PJ), ingrédients déjà testés avec lui et recettes possibles (déduits des essais de tous les PJ) */
/* Liste de lieux (plusieurs occurrences possibles) : récoltes ou achats, notés à la main par chaque PJ */
function placeBlock(i, field, title, none, ph) {
  const list = i[field] || [];
  return `<div><h4>${title}${list.length ? ` (${list.length})` : ""}</h4>
    ${list.length ? "<ul>" + list.map((h, k) => `<li>${esc(h.place)} <span class="muted">${dateFr(h.at)}</span><button class="x" data-act="hdel" data-field="${field}" data-id="${i.id}" data-k="${k}" aria-label="Retirer cette ligne">✕</button></li>`).join("") + "</ul>" : `<div class="muted">${none}</div>`}
    <div class="hrow"><input list="places" placeholder="${ph}" aria-label="${ph}" data-hin="${i.id}" data-field="${field}"><button class="btn ghost small" data-act="hadd" data-field="${field}" data-id="${i.id}">Ajouter</button></div></div>`;
}
function detailHTML(i) {
  const withMap = {};
  trials.filter(t => t.ingredients.some(x => x.name === i.name)).forEach(t => t.ingredients.forEach(x => { if (x.name !== i.name) withMap[x.name] = (withMap[x.name] || 0) + 1; }));
  const recs = buildRecipes().filter(r => r.ingredients.some(x => x.name === i.name));
  const ci = catalogItem(i.name);   // la description est visible d'office ; seule la famille est révélée par le MJ
  return `<tr class="drow"><td colspan="6"><div class="dgrid">
    ${ci ? `<div><h4>Fiche</h4><div>${descHTML(ci.desc)}</div></div>` : ""}
    ${placeBlock(i, "harvests", "Récolté à", "Aucune récolte notée.", "Lieu de récolte")}
    ${placeBlock(i, "purchases", "Acheté à", "Aucun achat noté.", "Lieu d'achat (boutique, marché…)")}
    <div><h4>Testé avec</h4>
      ${Object.keys(withMap).length ? "<div>" + Object.entries(withMap).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => `<span class="chip">${rarMark(n)}${esc(cap(n))}${c > 1 ? ` ×${c}` : ""}</span>`).join("") + "</div>" : '<div class="muted">Jamais testé avec un autre ingrédient.</div>'}</div>
    <div><h4>Potions possibles</h4>
      ${recs.length ? "<ul>" + recs.map(r => `<li><button class="linkbtn" data-act="rec" data-key="${esc(r.key)}">${esc(r.result || "Sans nom")}</button><span class="tag ${r.status}">${STATUS_LABEL[r.status]}</span></li>`).join("") + "</ul>" : '<div class="muted">Aucune recette avec cet ingrédient.</div>'}</div>
  </div></td></tr>`;
}
function invTable(items, detail) {
  const row = i => {
    const r = rarityOf(i.name), open = qtyOpen === i.id;
    return `<tr>${detail ? `<td class="tcenter"><button class="btn ghost icon" data-act="tog" data-id="${i.id}" aria-expanded="${knownOpen.has(i.id)}" aria-label="Historique de ${esc(i.name)}" title="Historique">${knownOpen.has(i.id) ? "▾" : "▸"}</button></td>` : ""}<td><div class="iname">${rarMark(i.name)}${esc(cap(i.name))}</div>${r.q ? `<span class="qual">${qualLine(r)}</span>` : ""}</td>
      ${GROUPS.map(g => `<td>${inGroup(i.name, g.id).map(c => tag(c)).join("")}<button type="button" class="catplus" data-act="cat" data-g="${g.id}" data-id="${i.id}" title="Ajouter ou retirer : ${g.label}" aria-label="${g.label} de ${esc(i.name)}">+</button></td>`).join("")}
      ${detail ? "" : `<td class="tcenter"><span class="qwrap" data-qwrap="1">${open ? `<button class="btn ghost small" data-act="dec" data-id="${i.id}" aria-label="Retirer un" ${i.qty <= 0 ? "disabled" : ""}>−</button>` : ""}
        <button class="qnum${open ? " on" : ""}${i.qty <= 0 ? " zero" : ""}" data-act="qty" data-id="${i.id}" title="Cliquer pour modifier la quantité" aria-label="Quantité : ${i.qty}">${i.qty}</button>
        ${open ? `<button class="btn ghost small" data-act="inc" data-id="${i.id}" aria-label="Ajouter un">+</button>` : ""}</span></td>
      <td class="tcenter"><button class="btn ghost small" data-act="lab" data-id="${i.id}">Au labo</button> <button class="btn ghost small" data-act="xfer" data-id="${i.id}" title="Envoyer vers ${ALCH ? "Tisane" : "Alchimie"} &amp; Dragon">⇄</button></td>`}
      <td class="tcenter"><button class="btn ghost icon" data-act="edit" data-id="${i.id}" title="Modifier l'ingrédient" aria-label="Modifier ${esc(i.name)}">✎</button></td>${detail ? `<td class="tcenter"><button class="btn ghost icon" data-act="inc" data-id="${i.id}" title="Ajouter un à l'inventaire" aria-label="Ajouter ${esc(i.name)} à l'inventaire">+</button></td>` : ""}</tr>${detail && knownOpen.has(i.id) ? detailHTML(i) : ""}`;
  };
  const cols = detail
    ? '<col style="width:36px"><col style="width:28%"><col style="width:24%"><col style="width:22%"><col style="width:16%"><col style="width:44px"><col style="width:44px">'
    : '<col style="width:25%"><col style="width:18%"><col style="width:16%"><col style="width:11%"><col style="width:150px"><col style="width:96px"><col style="width:44px">';
  const head = detail
    ? '<th></th><th>Nom</th><th title="Classification">Class.</th><th title="Propriété">Prop.</th><th title="Environnement">Env.</th><th></th><th></th>'
    : '<th>Nom</th><th title="Classification">Class.</th><th title="Propriété">Prop.</th><th title="Environnement">Env.</th><th class="tcenter" title="Quantité">Qté</th><th></th><th></th>';
  return `<table class="invt"><colgroup>${cols}</colgroup><tr>${head}</tr>${items.map(row).join("")}</table>`;
}

/* ---------- Catégories (partagées : tout PJ peut en ajouter, renommer, recolorer) ---------- */
function setIngMeta(name, patch) {
  store.set("ingredients", metaId(name), { name, ...patch });
}
/* « category » (ancien champ à valeur unique) est remis à null : seule la liste « categories » compte désormais */
const setIngCategories = (name, ids) => setIngMeta(name, { categories: [...new Set(ids)], category: null });
const rarOptions = cur => RARITIES.map(r => `<option value="${r.id}"${r.id === cur ? " selected" : ""} style="color:${r.color}">${r.label}</option>`).join("");
function createCategory(label, group) {
  const clean = label.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const same = categories.find(c => norm(c.name) === norm(clean));
  if (same) return same.id;
  let id = catId(clean); while (categories.some(c => c.id === id)) id += "_";
  const color = PALETTE.find(p => !categories.some(c => c.color === p)) || PALETTE[categories.length % PALETTE.length];
  store.set("categories", id, { name: cap(clean), color, group: group || "classification" });
  return id;
}
function promptCategory(onDone, group, onCancel) {
  group = group || "classification";
  openModal(`<h2>Nouvelle catégorie</h2><p class="muted" style="margin:0 0 8px">Famille : ${GROUPS.find(g => g.id === group).label}</p>
    <form id="cat-form"><input id="cat-input" placeholder="Ex : Fleurs, Racines, Baies…" maxlength="40" required>
    <div class="actions-row"><button class="btn ghost" type="button" id="cat-cancel">Annuler</button><button class="btn" type="submit">Créer la catégorie</button></div></form>`);
  $("cat-cancel").onclick = () => { closeModal(); if (onCancel) onCancel(); };
  $("cat-form").onsubmit = e => {
    e.preventDefault();
    const id = createCategory($("cat-input").value, group);
    closeModal();
    if (id) { toast("Catégorie créée"); if (onDone) onDone(id); }
  };
  $("cat-input").focus();
}
/* Modifier une catégorie : nom et couleur. L'identifiant ne change jamais, les ingrédients restent rattachés. */
function editCategory(c) {
  let color = c.color;
  openModal(`<h2>Modifier la catégorie</h2>
    <form id="ce-form">
      <label class="muted" for="ce-name">Nom</label>
      <input id="ce-name" maxlength="40" required value="${esc(c.name)}">
      <label class="muted" for="ce-group" style="display:block;margin-top:14px">Famille</label>
      <select id="ce-group" class="full">${GROUPS.filter(g => MANAGED.includes(g.id)).map(g => `<option value="${g.id}"${g.id === groupOf(c) ? " selected" : ""}>${g.label}</option>`).join("")}</select>
      <div class="muted" style="margin-top:14px">Couleur</div>
      <div class="swatches" id="ce-sw">${PALETTE.map(p => `<button type="button" class="swatch${p === color ? " on" : ""}" data-c="${p}" style="background:${p}" aria-label="Couleur ${p}"></button>`).join("")}
        <input type="color" id="ce-color" value="${esc(color)}" aria-label="Couleur personnalisée"></div>
      <div class="actions-row"><button class="btn ghost" type="button" id="ce-cancel">Annuler</button><button class="btn" type="submit">Enregistrer</button></div>
    </form>`);
  const sync = () => { $("ce-color").value = color; document.querySelectorAll("#ce-sw .swatch").forEach(s => s.classList.toggle("on", s.dataset.c === color)); };
  $("ce-sw").addEventListener("click", e => { const s = e.target.closest(".swatch"); if (s) { color = s.dataset.c; sync(); } });
  $("ce-color").addEventListener("input", () => { color = $("ce-color").value; sync(); });
  $("ce-cancel").onclick = closeModal;
  $("ce-form").onsubmit = e => {
    e.preventDefault();
    const name = cap($("ce-name").value.trim().replace(/\s+/g, " "));
    if (!name) return;
    if (categories.some(x => x.id !== c.id && norm(x.name) === norm(name))) { toast("Une catégorie porte déjà ce nom."); return; }
    store.set("categories", c.id, { name, color: HEX.test(color) ? color : c.color, group: $("ce-group").value });
    closeModal(); toast("Catégorie modifiée");
  };
  $("ce-name").focus(); $("ce-name").select();
}
function renderCategories() {
  $("categories").innerHTML = (ALCH ? "" : '<p class="muted" style="margin:0 0 8px">Ces catégories sont celles d\'Alchimie &amp; Dragon : pour en ajouter ou en modifier, passe par la page Alchimie.</p>') + GROUPS.filter(g => MANAGED.includes(g.id)).map(g => {
    const cs = categories.filter(c => groupOf(c) === g.id).sort(byLabel);
    return `<div class="catgroup"><div class="row between"><h3>${g.label}</h3>${ALCH ? `<button class="btn ghost small" type="button" data-newg="${g.id}">Nouvelle catégorie</button>` : ""}</div>
      <div class="catlist">${cs.length ? cs.map(c => {
        const n = CATALOG.filter(x => x.clas.includes(c.id) || x.props.includes(c.id) || x.envs.includes(c.id)).length;
        return `<span class="catitem">${tag(c)}<span class="muted" style="margin-right:2px">${n}</span>
          ${ALCH ? `<button class="edit" data-act="edit" data-id="${esc(c.id)}" aria-label="Modifier la catégorie ${esc(c.name)}" title="Modifier le nom, la couleur ou la famille">✎</button>
          <button data-act="del" data-id="${esc(c.id)}" aria-label="Supprimer la catégorie ${esc(c.name)}" title="Supprimer la catégorie">✕</button>` : ""}</span>`;
      }).join("") : '<div class="empty" style="padding:0">Aucune catégorie.</div>'}</div></div>`;
  }).join("");
}
function deleteCategory(c) {
  const members = CATALOG.filter(x => x.clas.includes(c.id) || x.props.includes(c.id) || x.envs.includes(c.id));
  confirmBox(`Supprimer la catégorie « ${c.name} » ?`,
    `<p><b>Les ingrédients ne sont pas supprimés.</b></p><ul>
      <li>${members.length ? `Les ${members.length} ingrédient${members.length > 1 ? "s" : ""} de cette catégorie (${members.map(m => esc(cap(m.name))).join(", ")}) perdent cette catégorie (ils gardent les autres).` : "Aucun ingrédient n'est rangé dedans."}</li>
      <li>La catégorie disparaît pour tous les PJ.</li></ul>`,
    "Supprimer la catégorie", () => {
      if (ALCH && DEFAULTS.categories.some(x => x.id === c.id)) store.set("categories", c.id, { name: c.name, color: c.color, group: groupOf(c), deleted: true });   // catégorie du livre : on la masque (le fichier la fournit toujours)
      else store.del("categories", c.id);
      if (libReady()) members.forEach(m => store.set("grimoire_ingredients", m.id, { clas: m.clas.filter(id => id !== c.id), props: m.props.filter(id => id !== c.id), envs: m.envs.filter(id => id !== c.id) }));
      toast("Catégorie supprimée");
    });
}
$("categories").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.newg) { promptCategory(null, b.dataset.newg); return; }
  const c = categories.find(x => x.id === b.dataset.id); if (!c) return;
  if (b.dataset.act === "edit") editCategory(c); else deleteCategory(c);
});

/* ---------- Fenêtre « ingrédient » : ajout et modification ---------- */
function catChecks(selected, only, noNew, locked) {
  const pool = allCats();
  return GROUPS.filter(g => !only || g.id === only).map(g => {
    const cs = pool.filter(c => groupOf(c) === g.id).sort(byLabel);
    return `<div><div class="fgroup" style="margin:0">${g.label}</div><div class="cchips">${cs.map(c => `<label class="cchip" style="--c:${esc(c.color)}"><input type="checkbox" data-cat="${esc(c.id)}"${selected.includes(c.id) ? " checked" : ""}${locked && locked.includes(c.id) ? " disabled" : ""}>${tag(c)}</label>`).join("") || '<span class="muted">Aucune catégorie : le MJ peut en créer.</span>'}
      ${noNew ? "" : `<button type="button" class="btn ghost small" data-newcat="${g.id}">+ Nouvelle</button>`}</div></div>`;
  }).join("");
}
/* Le PJ attribue des catégories à ses ingrédients, sans en créer ni en supprimer (c'est le rôle du MJ).
   Ce qui lui a été révélé reste coché et verrouillé. */
function catAssignModal(it, group) {
  const p = catParts(it.name), locked = p.rev.map(c => c.id), sel = [...new Set([...locked, ...p.own.map(c => c.id)])];
  openModal(`<h2>${esc(cap(it.name))}</h2><p class="muted" style="margin:0 0 8px">${GROUPS.find(g => g.id === group).label}</p>
    <form id="ca-form">${catChecks(sel, group, true, locked)}
      <div class="actions-row"><button type="button" class="btn ghost" id="ca-cancel">Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>`);
  $("ca-cancel").onclick = closeModal;
  $("ca-form").onsubmit = e => {
    e.preventDefault();
    const inGrp = new Set(allCats().filter(c => groupOf(c) === group).map(c => c.id));
    const picked = [...document.querySelectorAll("#ca-form input[data-cat]:checked:not(:disabled)")].map(x => x.dataset.cat);
    store.set("inventaire", it.id, { cats: [...new Set([...(it.cats || []).filter(id => !inGrp.has(id)), ...picked])] });
    closeModal();
  };
}
function readIngForm() {
  const f = ingForm, m = $("modal-box");
  if (f.mode === "add") f.name = $("if-name").value;
  f.rarity = $("if-rar").value;
  f.qty = $("if-qty").value;
  if ($("if-known")) f.known = $("if-known").checked;
  f.cats = [...document.querySelectorAll("#if-form input[data-cat]:checked:not(:disabled)")].map(x => x.dataset.cat);
}
function ingModal() {
  const f = ingForm, add = f.mode === "add", r = RARITIES.find(x => x.id === f.rarity) || RARITIES[0];
  openModal(`<h2>${add ? "Ajouter un ingrédient" : esc(cap(f.name))}</h2>
    <form id="if-form" autocomplete="off">
      ${add ? `<label class="muted" for="if-name">Nom</label><input id="if-name" list="all-ingredients" required value="${esc(f.name)}">` : ""}
      <div class="row" style="margin-top:12px;align-items:flex-start">
        <div style="flex:1;min-width:150px"><label class="muted" for="if-rar">Qualité</label>
          <select id="if-rar" class="full rar-select" style="color:${r.color}">${rarOptions(f.rarity)}</select></div>
        <div style="width:110px"${f.noQty ? ' class="hidden"' : ""}><label class="muted" for="if-qty">Quantité</label>
          <input id="if-qty" type="number" min="0" value="${esc(f.qty)}"${f.known ? " disabled" : ""}></div>
      </div>
      <div id="if-qual" class="qual" style="min-height:1.3em;margin-top:4px">${qualLine(r)}</div>
      <div style="margin-top:12px">${(() => { const lk = !add ? catParts(f.name).rev.map(c => c.id) : []; return catChecks([...new Set([...lk, ...(f.cats || [])])], null, true, lk); })()}</div>
      ${add ? `<label class="check2"><input type="checkbox" id="if-known"${f.known ? " checked" : ""}><span>Ingrédient connu : je le connais mais je n'en ai pas en stock (il ira dans « Ingrédients connus »)</span></label>` : ""}
      <div class="actions-row">
        ${add ? "" : '<button type="button" class="btn ghost danger" id="if-del" style="margin-right:auto">Supprimer</button>'}
        <button type="button" class="btn ghost" id="if-cancel">Annuler</button>
        <button class="btn" type="submit">${add ? "Ajouter" : "Enregistrer"}</button></div>
    </form>`);
  $("if-cancel").onclick = closeModal;
  if ($("if-del")) $("if-del").onclick = () => deleteIngredient(f.name);
  $("if-rar").onchange = () => {
    const x = RARITIES.find(q => q.id === $("if-rar").value);
    $("if-rar").style.color = x.color; $("if-qual").innerHTML = qualLine(x);
  };
  if ($("if-known")) $("if-known").onchange = () => { $("if-qty").disabled = $("if-known").checked; };
  /* ingrédient déjà connu dans l'app : on reprend sa qualité */
  /* qualité automatique : si l'ingrédient est dans la bibliothèque du MJ, sa qualité est reprise et verrouillée */
  const autoQual = name => {
    const ci = catalogItem(name), lib = ci && ci.q && RARITIES.find(r => r.q === ci.q);
    if (lib) { $("if-rar").value = lib.id; $("if-rar").onchange(); }
    $("if-rar").disabled = !!lib;
    $("if-qual").dataset.lib = lib ? "1" : "";
    if (lib) $("if-qual").innerHTML = qualLine(lib) + ' <span class="muted">(fixée par le MJ)</span>';
    return lib;
  };
  autoQual(f.name);
  if ($("if-name")) $("if-name").addEventListener("input", () => {
    const n = norm($("if-name").value);
    if (autoQual(n)) return;
    const m = ingMeta.find(x => x.name === n); if (!m) return;
    if (m.rarity) { $("if-rar").value = m.rarity; $("if-rar").onchange(); }
  });
  $("if-form").onsubmit = e => {
    e.preventDefault(); readIngForm();
    const me = player();
    if (!me) { toast("Choisis d'abord ton personnage."); return; }
    const q = parseInt(f.qty, 10), qty = Number.isNaN(q) ? 0 : Math.max(0, q);
    if (add) {
      const name = norm(f.name); if (!name) return;
      const id = invId(me, name), ex = inventory.find(i => i.id === id);
      store.set("inventaire", id, { player: me, name, qty: f.known ? (ex ? ex.qty : 0) : (ex ? ex.qty : 0) + qty, cats: [...new Set([...((ex && ex.cats) || []), ...f.cats])] });
      setIngMeta(name, { rarity: f.rarity });
      toast(f.known ? `${cap(name)} ajouté aux ingrédients connus` : `${cap(name)} ajouté`);
    } else {
      store.set("inventaire", f.id, { qty, cats: f.cats });
      setIngMeta(f.name, { rarity: f.rarity });
      toast("Ingrédient modifié");
    }
    closeModal();
  };
  const first = $("if-name") || $("if-rar"); first.focus();
}
$("add-ing").onclick = () => {
  if (!player()) { toast("Choisis d'abord ton personnage."); $("player").focus(); return; }
  ingForm = { mode: "add", name: "", rarity: "commun", cats: [], qty: 1, known: false };
  ingModal();
};
function invClick(e) {
  const b = e.target.closest("button[data-id]"); if (!b) return;
  const it = inventory.find(i => i.id === b.dataset.id); if (!it) return;
  const act = b.dataset.act;
  if (act === "edit") { ingForm = { mode: "edit", id: it.id, name: it.name, rarity: rarityOf(it.name).id, qty: it.qty, known: false, cats: [...(it.cats || [])], noQty: !!b.closest("#known") }; ingModal(); }
  else if (act === "qty") { qtyOpen = qtyOpen === it.id ? null : it.id; renderInventory(); }
  else if (act === "inc") { store.set("inventaire", it.id, { qty: it.qty + 1 }); if (b.closest("#known")) toast(`${cap(it.name)} : ${it.qty + 1} en inventaire`); }
  else if (act === "cat") catAssignModal(it, b.dataset.g);
  else if (act === "dec") { if (it.qty > 0) store.set("inventaire", it.id, { qty: it.qty - 1 }); }
  else if (act === "lab") { addToLab(it.name); goLab(); toast(`${cap(it.name)} ajouté au laboratoire`); }
}
$("inventory").addEventListener("click", invClick);
$("known").addEventListener("click", invClick);
$("known").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const act = b.dataset.act, it = inventory.find(i => i.id === b.dataset.id);
  if (act === "tog" && it) { knownOpen.has(it.id) ? knownOpen.delete(it.id) : knownOpen.add(it.id); renderInventory(); }
  else if (act === "hadd" && it) {
    const f = b.dataset.field, inp = [...document.querySelectorAll("#known [data-hin]")].find(x => x.dataset.hin === it.id && x.dataset.field === f), place = inp ? inp.value.trim().replace(/\s+/g, " ") : "";
    if (!place) { toast("Écris le lieu."); if (inp) inp.focus(); return; }
    store.set("inventaire", it.id, { [f]: [...(it[f] || []), { place: cap(place), at: Date.now() }] });
  }
  else if (act === "hdel" && it) store.set("inventaire", it.id, { [b.dataset.field]: (it[b.dataset.field] || []).filter((_, k) => k !== +b.dataset.k) });
  else if (act === "rec") { const r = buildRecipes().find(x => x.key === b.dataset.key); if (r) recipeModal(r); }
});
$("known").addEventListener("keydown", e => {   // Entrée dans le champ « Lieu de récolte » = Ajouter
  if (e.key !== "Enter" || !e.target.matches("[data-hin]")) return;
  e.preventDefault(); e.target.parentElement.querySelector("[data-act=hadd]").click();
});
/* un clic ailleurs referme les boutons − et + */
document.addEventListener("click", e => { if (qtyOpen && !e.target.closest("[data-qwrap]")) { qtyOpen = null; renderInventory(); } });
document.addEventListener("keydown", e => { if (e.key === "Escape" && qtyOpen) { qtyOpen = null; renderInventory(); } });

/* Fenêtre de confirmation (suppressions) */
function confirmBox(title, html, okLabel, onOk) {
  openModal(`<h2>${esc(title)}</h2><div class="warn">${html}</div>
    <div class="actions-row"><button class="btn ghost" id="c-cancel">Annuler</button>
    <button class="btn danger" id="c-ok">${esc(okLabel)}</button></div>`);
  $("c-cancel").onclick = closeModal;
  $("c-ok").onclick = () => { closeModal(); onOk(); };
  $("c-cancel").focus();
}

/* Supprimer un ingrédient : il disparaît partout (inventaires, sociogramme, recettes et essais liés) */
function deleteIngredient(name) {
  const invItems = inventory.filter(i => i.name === name);
  const linkedTrials = trials.filter(t => t.ingredients.some(i => i.name === name));
  const linkedRecipes = buildRecipes().filter(r => r.ingredients.some(i => i.name === name));
  const failed = linkedTrials.filter(t => statusOf(t) === "ko").length;
  const stock = tisanes.filter(x => (x.ingredients || []).some(i => i.name === name));
  const owners = [...new Set(invItems.map(i => i.player))];

  let html = `<p><b>Attention : cette action est définitive et concerne tous les PJ.</b></p><ul>
    <li>« ${esc(cap(name))} » est retiré du sociogramme et de tous les inventaires (${owners.map(esc).join(", ")}).</li>`;
  html += linkedRecipes.length
    ? `<li>Recettes liées supprimées (${linkedRecipes.length}) : ${linkedRecipes.map(r => `<i>${esc(r.result || "Sans nom")}</i> (${esc(STATUS_LABEL[r.status].toLowerCase())})`).join(", ")}.</li>`
    : `<li>Aucune recette n'utilise cet ingrédient.</li>`;
  if (failed) html += `<li>Essais ratés supprimés (${failed}) : ceux qui contenaient cet ingrédient.</li>`;
  if (stock.length) html += `<li>Les tisanes correspondantes sont retirées des inventaires de tisanes.</li>`;
  html += `</ul>`;

  confirmBox(`Supprimer « ${cap(name)} » ?`, html, "Supprimer l'ingrédient", () => {
    invItems.forEach(i => store.del("inventaire", i.id));
    ingMeta.filter(m => m.name === name).forEach(m => store.del("ingredients", m.id));
    linkedTrials.forEach(t => store.del("essais", t.id));
    stock.forEach(x => store.del("tisanes", x.id));
    if (filterIng === name) filterIng = null;
    labRows().forEach(r => { if (norm(r.children[0].value) === name) { r.children[0].value = ""; r.children[1].value = 1; } });
    toast(`${cap(name)} supprimé`);
  });
}

/* Supprimer une recette : ses essais, son lien dans le sociogramme et ses tisanes en stock */
function deleteRecipe(r) {
  const stock = tisanes.filter(x => x.key === r.key);
  confirmBox(`Supprimer « ${r.result || "Sans nom"} » ?`,
    `<p><b>Cette action est définitive.</b></p><ul>
      <li>La recette quitte la liste et sa concoction disparaît du sociogramme (sauf si d'autres essais utilisent les mêmes ingrédients).</li>
      ${stock.length ? `<li>Les ${T}s en stock sont retirées (${stock.map(x => esc(x.player)).join(", ")}).</li>` : ""}
      <li>Les ingrédients et les essais ratés ne sont pas touchés.</li></ul>`,
    "Supprimer la recette", () => {
      r.trials.forEach(t => store.del("essais", t.id));
      stock.forEach(x => store.del("tisanes", x.id));
      toast("Recette supprimée");
    });
}

/* ============================================================
   4. Laboratoire (colonne de droite, visible dans les deux onglets)
   ============================================================ */
const labRows = () => [...document.querySelectorAll("#lab-rows .ing-row")];
function addLabRow(name = "", qty = 1) {
  const d = document.createElement("div"); d.className = "ing-row";
  d.innerHTML = `<input list="all-ingredients" placeholder="Ingrédient" aria-label="Ingrédient">
    <input type="number" min="1" aria-label="Quantité"><button type="button" aria-label="Retirer cette ligne">✕</button>`;
  d.children[0].value = name; d.children[1].value = qty;
  d.children[2].onclick = () => { d.remove(); if (labRows().length < 2) addLabRow(); };
  $("lab-rows").appendChild(d);
  return d;
}
/* Le laboratoire est toujours visible à droite ; sur petit écran il passe sous le contenu, on y descend */
/* Le laboratoire se masque et se rouvre à volée (bouton en haut, ✕ dans le laboratoire) ; le choix est retenu sur cet appareil. Il se rouvre tout seul quand on lui envoie un ingrédient ou une recette. */
const LAB_KEY = "tisane_lab_hidden";
function setLab(open, save = true) {
  $("lab").closest(".shell").classList.toggle("lab-off", !open);
  $("lab-toggle").setAttribute("aria-pressed", String(open));
  if (save) try { localStorage.setItem(LAB_KEY, open ? "0" : "1"); } catch (e) { /* stockage indisponible */ }
}
const labOpen = () => !$("lab").closest(".shell").classList.contains("lab-off");
$("lab-toggle").addEventListener("click", () => setLab(!labOpen()));
$("lab-close").addEventListener("click", () => setLab(false));
try { if (localStorage.getItem(LAB_KEY) === "1") setLab(false, false); } catch (e) { /* ignoré */ }
function goLab() { if (!labOpen()) setLab(true); if (window.innerWidth <= 960) $("lab").scrollIntoView({ behavior: "smooth", block: "start" }); }
function resetLabRows(list = []) {
  $("lab-rows").innerHTML = "";
  list.forEach(i => addLabRow(cap(i.name), i.qty));
  while (labRows().length < 2) addLabRow();
}
function addToLab(name) {
  const n = norm(name), same = labRows().find(r => norm(r.children[0].value) === n);
  if (same) { same.children[1].value = (parseInt(same.children[1].value, 10) || 0) + 1; return; }
  const row = labRows().find(r => !r.children[0].value.trim()) || addLabRow();
  row.children[0].value = cap(name); row.children[1].value = 1;
}
/* Les champs qui n'ont pas de sens pour l'état choisi sont masqués */
function syncLab() {
  const s = $("l-status").value;
  $("l-result-wrap").classList.toggle("hidden", s === "auto");
  $("l-yield-wrap").classList.toggle("hidden", s !== "ok" && s !== "auto");
  $("l-consume-wrap").classList.toggle("hidden", s === "untested");
  $("l-result").placeholder = s === "ok" ? (ALCH ? "Ex : potion de soin" : "Ex : tisane apaisante") : "Nom provisoire (facultatif)";
}
$("l-status").addEventListener("change", syncLab);
$("add-row").onclick = () => addLabRow().children[0].focus();
$("lab-clear").onclick = () => { resetLabRows(); $("l-result").value = ""; $("l-notes").value = ""; };

$("lab-form").addEventListener("submit", e => {
  e.preventDefault();
  const me = player();
  if (!me) { toast("Choisis d'abord ton personnage."); $("player").focus(); return; }
  const merged = {};
  labRows().forEach(r => {
    const n = norm(r.children[0].value); if (!n) return;
    merged[n] = (merged[n] || 0) + (parseInt(r.children[1].value, 10) || 1);
  });
  const ings = Object.entries(merged).map(([name, qty]) => ({ name, qty }));
  if (ings.length < 2) { toast("Il faut au moins deux ingrédients différents."); return; }

  let status = $("l-status").value, result = $("l-result").value.trim(), notes = $("l-notes").value.trim(), outcome = null;
  if (status === "auto") {
    /* Le Grimoire joue le MJ : potion = recette finie ; effet anecdotique ou désastre = essai raté, avec le détail dans les notes */
    outcome = autoOutcome(ings);
    if (outcome.error) { toast(outcome.error, 5000); return; }
    status = outcome.potion ? "ok" : "ko"; result = outcomeName(outcome);
    notes = [outcomeNotes(outcome), notes].filter(Boolean).join(" · ");
  }
  store.add("essais", { player: me, ingredients: ings, result, status, success: status === "ok", notes });

  if ($("l-consume").checked && status !== "untested") {
    ings.forEach(i => {
      const it = inventory.find(x => x.id === invId(me, i.name)); if (!it) return;
      store.set("inventaire", it.id, { qty: Math.max(0, it.qty - i.qty) });
    });
  }
  if (status === "ok") {
    const y = parseInt($("l-yield").value, 10), amount = Number.isNaN(y) ? 1 : Math.max(0, y);
    addTisane({ key: recipeKey(ings, result), result, ingredients: ings }, amount);
  }
  $("l-yield").value = 1; $("l-consume").checked = true;
  const msg = outcome ? [outcome.potion ? "ok" : outcome.type === "b" ? "ko" : "st-unknown", outcome.potion ? "Potion obtenue" : "Pas de potion"] : { ok: ["ok", "Recette ajoutée"], unknown: ["st-unknown", "Essai noté : effets à découvrir"], untested: ["st-untested", "Ajouté aux recettes à tester"], ko: ["ko", "Essai raté noté"] }[status];
  const last = $("lab-last");
  last.classList.remove("hidden");
  last.innerHTML = outcome ? `<b class="${msg[0]}">${msg[1]}</b>${outcomeHTML(outcome)}`
    : `<b class="${msg[0]}">${msg[1]}</b><br>${ings.map(fmt).join(", ")}${result ? " : " + esc(result) : ""}`;
  resetLabRows(); $("l-result").value = ""; $("l-notes").value = "";
});

/* ============================================================
   5. Recettes (finies / à tester / effets à découvrir) + historique
   Une recette = mêmes ingrédients + même résultat. Son état est le meilleur de ses essais (réussi > effets inconnus > à tester).
   Les essais ratés ne forment pas de recette : ils restent dans l'historique et dans le sociogramme.
   ============================================================ */
function buildRecipes() {
  const map = {};
  trials.forEach(t => {
    const s = statusOf(t); if (s === "ko") return;
    const key = recipeKey(t.ingredients, t.result);
    const r = map[key] = map[key] || { key, setKey: setKey(t.ingredients), result: t.result, ingredients: t.ingredients, trials: [], status: s };
    r.trials.push(t);
    if (RANK[s] > RANK[r.status]) r.status = s;
  });
  Object.values(map).forEach(r => r.trials.sort((a, b) => b.createdAt - a.createdAt));
  return Object.values(map).sort((a, b) => b.trials[0].createdAt - a.trials[0].createdAt);
}

/* Favoris : la recette porte la liste des PJ qui l'ont en favori, sur chacun de ses essais (synchronisé, sans nouvelle collection) */
const isFav = r => { const me = player(); return !!me && r.trials.some(t => (t.favs || []).includes(me)); };
function toggleFav(r) {
  const me = player(); if (!me) { toast("Choisis d'abord ton personnage."); $("player").focus(); return; }
  const on = !isFav(r);
  r.trials.forEach(t => { const f = (t.favs || []).filter(x => x !== me); store.set("essais", t.id, { favs: on ? [...f, me] : f }); });
  toast(on ? `« ${r.result || "Recette"} » ajoutée aux favoris` : "Retirée des favoris");
}
const favBtn = r => `<span class="fav${isFav(r) ? " on" : ""}" data-fav role="button" tabindex="0" title="${isFav(r) ? "Retirer des favoris" : "Mettre en favori"}" aria-label="Favori">${isFav(r) ? "★" : "☆"}</span>`;

/* Le PJ connaît déjà une recette (son personnage a de l'expérience) : il la cherche dans la bibliothèque du MJ et l'ajoute à ses recettes finies, sans passer par le laboratoire */
function addRecipeModal() {
  const me = player(); if (!me) { toast("Choisis d'abord ton personnage."); $("player").focus(); return; }
  const known = new Set(trials.filter(t => t.player === me && statusOf(t) === "ok").map(t => norm(t.result || "")));
  const head = r => String(r.text || "").split("\n")[0];
  openModal(`<h2>Ajouter une recette</h2><p class="muted" style="margin:0 0 8px">Cherche une recette de la bibliothèque par son nom, son rang ou sa spécialisation. Elle rejoint tes recettes finies avec ses effets.</p>
    <input id="ar-q" type="search" placeholder="Ex : antitoxine, apothicaire, potion de force…" autocomplete="off"><div id="ar-list" style="margin-top:10px;max-height:50vh;overflow:auto"></div>
    <div class="actions-row"><button type="button" class="btn ghost" id="ar-close">Fermer</button></div>`);
  $("ar-close").onclick = closeModal;
  const draw = () => {
    const q = $("ar-q").value, all = [...RECS].sort((a, b) => (a.name || "").localeCompare(b.name || "")), hits = all.filter(r => matchQ(q, `${r.name} ${head(r)}`)), shown = hits.slice(0, 40);
    $("ar-list").innerHTML = !all.length ? '<div class="empty" style="padding:0">La bibliothèque n\'a pas encore de recette.</div>'
      : !hits.length ? '<div class="empty" style="padding:0">Aucune recette ne correspond.</div>'
      : shown.map(r => `<div class="mjfx row between"><span><b>${esc(r.name)}</b><div class="muted">${esc(head(r))}</div></span>${known.has(norm(r.name)) ? '<span class="muted">Déjà connue</span>' : `<button type="button" class="btn small" data-add="${esc(r.id)}">Ajouter</button>`}</div>`).join("")
        + (hits.length > shown.length ? `<div class="muted" style="margin-top:8px">${hits.length - shown.length} autres : précise ta recherche.</div>` : "");
  };
  $("ar-q").addEventListener("input", draw);
  $("ar-list").addEventListener("click", e => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    const r = RECS.find(x => x.id === b.dataset.add); if (!r) return;
    const merged = {};
    (r.ingredients || []).forEach(id => { const n = norm((CATALOG.find(c => c.id === id) || { name: slotRaw(id) }).name); merged[n] = (merged[n] || 0) + 1; });
    store.add("essais", { player: me, ingredients: Object.entries(merged).map(([name, qty]) => ({ name, qty })), result: r.name, status: "ok", success: true, notes: [r.text, r.fail].filter(Boolean).join("\n") });
    known.add(norm(r.name)); draw(); recTab = "ok"; toast(`« ${r.name} » ajoutée à tes recettes`);
  });
  draw(); $("ar-q").focus();
}
$("rec-add").onclick = addRecipeModal;
/* Illustrations des potions : dossier img/potions (une grande image pour les fiches, une miniature « -t » pour le sociogramme et les listes).
   Associées par le nom de la recette, accents et majuscules ignorés. Pour en ajouter une : déposer img/potions/<nom>.webp et <nom>-t.webp, puis l'inscrire ici. */
const POTION_IMG = {};
[["Baume d'altération", "baume-d-alteration"], ["Décoction de guérison", "decoction-de-guerison"], ["Élixir de célérité", "elixir-de-celerite"], ["Infusion sainte", "infusion-sainte"],
 ["Liquide de l'imposteur", "liquide-de-l-imposteur"], ["Potion de coagulation", "potion-de-coagulation"], ["Potion de guérison", "potion-de-guerison"], ["Potion de mouvement", "potion-de-mouvement"]]
  .forEach(([n, f]) => { POTION_IMG[stripKey(n)] = f; });
const potionImg = (name, thumb) => { const f = POTION_IMG[stripKey(name || "")]; return f ? `img/potions/${f}${thumb ? "-t" : ""}.webp` : ""; };
const pimgTag = (name, cls) => { const u = potionImg(name, cls !== "big"); return u ? `<img class="pimg ${cls || ""}" src="${u}" alt="" loading="lazy">` : ""; };
function renderRecipes() {
  const all = buildRecipes();
  const scoped = filterIng ? all.filter(r => r.ingredients.some(i => i.name === filterIng)) : all;
  const count = id => scoped.filter(r => r.status === id).length;
  $("rec-tabs").innerHTML = REC_TABS.map(t => `<button type="button" class="subtab${t.id === recTab ? " active" : ""}" role="tab" aria-selected="${t.id === recTab}" data-tab="${t.id}">${t.title}<b>${count(t.id)}</b></button>`).join("");
  shownRecipes = scoped.filter(r => r.status === recTab);
  const tab = REC_TABS.find(t => t.id === recTab);
  $("filter-label").textContent = filterIng ? `Filtre : ${cap(filterIng)}` : "";
  $("clear-filter").classList.toggle("hidden", !filterIng);
  $("socio-filter").classList.toggle("hidden", !filterIng);
  $("socio-filter-label").textContent = filterIng ? `Filtre actif sur les recettes : ${cap(filterIng)}` : "";
  knownRecipes = scoped.filter(r => isFav(r));
  $("recipes-known").innerHTML = knownRecipes.length ? knownRecipes.map((r, i) => `
    <button class="recipe" data-i="${i}">
      <h3>${pimgTag(r.result)}${esc(r.result || "Sans nom")}</h3>${favBtn(r)}
      <span class="ings">${r.ingredients.map(x => `<span class="chip">${fmt(x)}</span>`).join("")}</span>
    </button>`).join("") : `<div class="empty">${filterIng ? "Aucune recette favorite ne contient cet ingrédient." : "Aucune recette favorite. Mets une recette en favori avec l'étoile ☆ dans Le Grimoire."}</div>`;
  $("recipes").innerHTML = shownRecipes.length ? shownRecipes.map((r, i) => `
    <button class="recipe" data-i="${i}">
      <h3>${pimgTag(r.result)}${esc(r.result || "Sans nom")}</h3>${favBtn(r)}
      <span class="by">${esc([...new Set(r.trials.map(t => t.player))].join(", "))}</span>
      <span class="ings">${r.ingredients.map(x => `<span class="chip">${fmt(x)}</span>`).join("")}</span>
    </button>`).join("")
    : `<div class="empty">${filterIng ? "Aucune recette de cette liste ne contient cet ingrédient." : tab.empty}</div>`;

  const sorted = [...trials].sort((a, b) => b.createdAt - a.createdAt);
  $("trials").innerHTML = sorted.length ? "<table>" + sorted.map(t => {
      const s = statusOf(t), cls = s === "ok" ? "ok" : s === "ko" ? "ko" : "st-" + s;
      return `<tr><td class="${cls}">${STATUS_LABEL[s]}</td>
      <td>${t.ingredients.map(fmt).join(", ")}</td>
      <td>${esc(t.result || "")}</td><td class="muted">${esc(t.player)}</td></tr>`;
    }).join("") + "</table>"
    : '<div class="empty">Aucun essai enregistré.</div>';
}
$("rec-tabs").addEventListener("click", e => {
  const b = e.target.closest(".subtab"); if (!b) return;
  recTab = b.dataset.tab; renderRecipes();
});

/* Fiche d'une recette (utilisée par la liste et par le clic sur une concoction du sociogramme) */
function recipeModal(r) {
  const buttons = Object.keys(STATUS_LABEL).filter(s => s !== r.status && s !== "untested").map(s =>
    `<button type="button" class="btn ghost small" data-st="${s}">${s === "ok" ? "Marquer réussie : recette finie" : s === "unknown" ? "Testée, effets inconnus" : "Marquer ratée"}</button>`).join("");
  openModal(`${pimgTag(r.result, "big")}<h2>${esc(r.result || "Sans nom")}<span class="tag ${r.status}">${STATUS_LABEL[r.status]}</span></h2>
    <p>${r.ingredients.map(x => `<span class="chip">${fmt(x)}</span>`).join("")}</p>
    ${r.trials.map(t => `<p class="muted" style="margin:4px 0">${esc(t.player)}, le ${new Date(t.createdAt).toLocaleDateString("fr-FR")}${t.notes ? " : " + esc(t.notes) : ""}</p>`).join("")}
    ${r.status !== "ok" ? `<div style="margin-top:14px"><label class="muted" for="m-name">Nom ou effet découvert</label>
      <input id="m-name" value="${esc(r.result || "")}" placeholder="Ex : ${ALCH ? "potion de soin" : "tisane apaisante"}"><div class="statusbtns">${buttons}</div></div>` : ""}
    <div class="actions-row">
      <button class="btn ghost danger" id="m-del">Supprimer la recette</button>
      <button class="btn ghost" id="m-fav">${isFav(r) ? "★ Retirer des favoris" : "☆ Mettre en favori"}</button>
      <button class="btn ghost" id="m-close">Fermer</button>
      ${r.status === "ok" ? `<button class="btn ghost" id="m-add">Ajouter 1 à mes ${T}s</button>` : ""}
      <button class="btn" id="m-redo">${r.status === "ok" ? "Refaire au laboratoire" : "Tester au laboratoire"}</button></div>`);
  $("m-close").onclick = closeModal;
  $("m-fav").onclick = () => { toggleFav(r); closeModal(); };
  $("m-del").onclick = () => deleteRecipe(r);
  if ($("m-add")) $("m-add").onclick = () => {
    if (!player()) { toast("Choisis d'abord ton personnage."); return; }
    addTisane(r, 1); closeModal(); toast(`Ajoutée à ton inventaire de ${T}s`);
  };
  document.querySelectorAll("#modal-box [data-st]").forEach(b => b.onclick = () => {
    const st = b.dataset.st, name = $("m-name").value.trim();
    r.trials.forEach(t => store.set("essais", t.id, { status: st, success: st === "ok", result: name }));
    closeModal(); recTab = st === "ok" || st === "unknown" ? st : recTab;
    toast(st === "ok" ? "Recette finie !" : st === "unknown" ? "Déplacée dans « Effets à découvrir »" : "Marquée comme ratée");
  });
  $("m-redo").onclick = () => {
    resetLabRows(r.ingredients); $("l-result").value = r.result || ""; $("l-status").value = "ok"; syncLab();
    closeModal(); goLab(); toast("Recette chargée dans le laboratoire");
  };
}
$("recipes").addEventListener("click", e => {
  const c = e.target.closest(".recipe"); if (!c) return;
  const r = shownRecipes[+c.dataset.i]; if (!r) return;
  if (e.target.closest("[data-fav]")) toggleFav(r); else recipeModal(r);
});
$("recipes-known").addEventListener("click", e => {
  const c = e.target.closest(".recipe"); if (!c) return;
  const r = knownRecipes[+c.dataset.i]; if (!r) return;
  if (e.target.closest("[data-fav]")) toggleFav(r); else recipeModal(r);
});
$("clear-filter").onclick = $("socio-filter-clear").onclick = () => { filterIng = null; renderRecipes(); renderSocio(); };

/* Clic sur une concoction (rond du sociogramme) : toutes les recettes et essais faits avec ces ingrédients */
function openConcoction(sk) {
  const recs = buildRecipes().filter(r => r.setKey === sk);
  const ko = trials.filter(t => setKey(t.ingredients) === sk && statusOf(t) === "ko");
  if (recs.length === 1 && !ko.length) return recipeModal(recs[0]);
  const names = sk.split("+").map(n => `<span class="chip">${rarMark(n)}${esc(cap(n))}</span>`).join("");
  openModal(`<h2>Concoction</h2><p>${names}</p>
    ${recs.map((r, i) => `<button class="recipe" data-i="${i}" style="border-bottom:1px solid var(--line)"><h3>${esc(r.result || "Sans nom")}<span class="tag ${r.status}">${STATUS_LABEL[r.status]}</span></h3>
      <span class="by">${esc([...new Set(r.trials.map(t => t.player))].join(", "))}</span></button>`).join("")}
    ${ko.length ? `<p class="ko" style="margin:12px 0 4px"><b>Essais ratés (${ko.length})</b></p>${ko.map(t => `<p class="muted" style="margin:2px 0">${esc(t.player)}, le ${new Date(t.createdAt).toLocaleDateString("fr-FR")}${t.result ? " : " + esc(t.result) : ""}${t.notes ? " : " + esc(t.notes) : ""}</p>`).join("")}` : ""}
    <div class="actions-row"><button class="btn ghost" id="m-close">Fermer</button></div>`);
  $("m-close").onclick = closeModal;
  document.querySelectorAll("#modal-box .recipe").forEach(b => b.onclick = () => recipeModal(recs[+b.dataset.i]));
}

/* ============================================================
   5b. Inventaire des tisanes terminées (sous les recettes)
   ============================================================ */
function addTisane(r, amount) {
  const me = player(), id = tisId(me, r.key), ex = tisanes.find(x => x.id === id);
  store.set("tisanes", id, { player: me, key: r.key, result: r.result || "", ingredients: r.ingredients, qty: (ex ? ex.qty : 0) + amount });
}
function renderTisanes() {
  const me = player();
  $("tis-owner").textContent = me || "…";
  const byName = (a, b) => (a.result || "").localeCompare(b.result || "");
  const mine = tisanes.filter(x => x.player === me).sort(byName);
  $("tisanes").innerHTML = !me ? `<div class="empty">Choisis ton personnage en haut de la page pour voir tes ${T}s.</div>`
    : !mine.length ? `<div class="empty">Aucune ${T} en stock. Une recette réussie au laboratoire s'ajoute ici avec sa quantité.</div>`
    : "<table>" + mine.map(x => `<tr class="${x.qty <= 0 ? "zero" : ""}">
        <td><span class="tname">${esc(x.result || "Sans nom")}</span>${x.qty <= 0 ? ' <span class="muted">(épuisée)</span>' : ""}<br>
          ${(x.ingredients || []).map(i => `<span class="chip">${fmt(i)}</span>`).join("")}</td>
        <td class="qty"><button class="btn ghost small" data-act="tdec" data-id="${x.id}" aria-label="Retirer une" ${x.qty <= 0 ? "disabled" : ""}>−</button>
          <b style="margin:0 10px">${x.qty}</b>
          <button class="btn ghost small" data-act="tinc" data-id="${x.id}" aria-label="Ajouter une">+</button></td></tr>`).join("") + "</table>";

  const byPlayer = {};
  tisanes.filter(x => x.player !== me).forEach(x => (byPlayer[x.player] = byPlayer[x.player] || []).push(x));
  $("tisanes-others").innerHTML = Object.keys(byPlayer).length
    ? Object.entries(byPlayer).map(([p, items]) => `<p style="margin:0 0 10px"><b>${esc(p)}</b><br>${items.sort(byName).map(x => `<span class="chip">${esc(x.result || "Sans nom")} ×${x.qty}</span>`).join("")}</p>`).join("")
    : `<div class="empty">Aucun autre PJ n'a encore de ${T} en stock.</div>`;
}
$("tisanes").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const x = tisanes.find(t => t.id === b.dataset.id); if (!x) return;
  if (b.dataset.act === "tinc") store.set("tisanes", x.id, { qty: x.qty + 1 });
  else if (b.dataset.act === "tdec" && x.qty > 0) store.set("tisanes", x.id, { qty: x.qty - 1 });
});

function openModal(html) { $("modal-box").innerHTML = html; $("modal").classList.remove("hidden"); }
function closeModal() { $("modal").classList.add("hidden"); }
$("modal").addEventListener("mousedown", e => { if (e.target === $("modal")) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

/* ============================================================
   6. Sociogramme
   Ingrédients = rectangles. Chaque jeu d'ingrédients essayé ensemble = une concoction : un rond placé au milieu du lien
   (au centre de gravité s'il y a 3 ingrédients ou plus). Les ingrédients ne se chevauchent jamais :
   la mise en place sépare les rectangles et agrandit la zone si elle est trop petite.
   ============================================================ */
const STYLE = {
  ok:      { color: "#a3c4a0", dash: "" },
  unknown: { color: "#e6a95a", dash: "2 4" },
  untested:{ color: "#8fa59d", dash: "6 5" },
  ko:      { color: "#d68c7e", dash: "5 4" }
};
const PX = 16, PY = 14, HUB_R = 16;

function renderSocio() {
  const svg = $("socio"), W = 800;
  const names = new Set(inventory.map(i => i.name));
  trials.forEach(t => t.ingredients.forEach(i => names.add(i.name)));
  const nodes = [...names].sort().map(n => ({ name: n, w: Math.max(54, n.length * 7.5 + 18), h: 24, x: 0, y: 0, vx: 0, vy: 0 }));

  const legendCats = new Map(); nodes.forEach(n => catsOf(n.name).forEach(c => legendCats.set(c.id, c)));
  $("cat-legend").innerHTML = [...legendCats.values()].sort(byLabel)
    .map(c => tag(c)).join("")
    + RARITIES.filter(r => r.id !== "commun" && nodes.some(n => rarityOf(n.name).id === r.id))
      .map(r => `<span><span class="rar" style="color:${r.color}">◆</span>${r.label}</span>`).join("");
  if (!nodes.length) {
    svg.setAttribute("viewBox", `0 0 ${W} 380`);
    svg.innerHTML = `<text x="${W / 2}" y="190" text-anchor="middle" fill="#8fa59d" font-size="22">Les ingrédients et leurs concoctions apparaîtront ici.</text>`;
    return;
  }
  const idx = Object.fromEntries(nodes.map((n, i) => [n.name, i]));

  /* concoctions : un rond par jeu d'ingrédients */
  const hubs = {};
  trials.forEach(t => {
    const sk = setKey(t.ingredients), st = statusOf(t);
    const h = hubs[sk] = hubs[sk] || { key: sk, members: [...new Set(t.ingredients.map(i => idx[i.name]))], status: null, trials: 0, recipes: new Set(), results: new Set() };
    h.trials++; h.recipes.add(recipeKey(t.ingredients, t.result)); if (t.result) h.results.add(t.result);
    if (h.status === null || RANK[st] > RANK[h.status]) h.status = st;
  });
  const H_ = Object.values(hubs);
  const centre = h => ({ x: h.members.reduce((s, i) => s + nodes[i].x, 0) / h.members.length, y: h.members.reduce((s, i) => s + nodes[i].y, 0) / h.members.length });

  /* nettoyage des chevauchements : rectangles entre eux, puis rectangles contre ronds */
  const separate = (W, H) => {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const A = nodes[i], B = nodes[j];
      let dx = B.x - A.x, dy = B.y - A.y;
      if (!dx && !dy) { dx = 0.5; dy = 0.3; }
      const ox = (A.w + B.w) / 2 + PX - Math.abs(dx), oy = (A.h + B.h) / 2 + PY - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        moved = true;
        if (ox * 1.0 < oy * 2.2) { const s = Math.sign(dx) * ox / 2; A.x -= s; B.x += s; }  // pousse plutôt à l'horizontale (les étiquettes sont larges)
        else { const s = Math.sign(dy) * oy / 2; A.y -= s; B.y += s; }
      }
    }
    H_.forEach(h => {
      const c = centre(h);
      nodes.forEach(n => {
        const px = Math.max(n.x - n.w / 2, Math.min(c.x, n.x + n.w / 2)), py = Math.max(n.y - n.h / 2, Math.min(c.y, n.y + n.h / 2));
        let dx = px - c.x, dy = py - c.y, d = Math.hypot(dx, dy);
        const need = HUB_R + 7;
        if (d < need) {
          moved = true;
          if (d < 0.01) { dx = n.x - c.x || 1; dy = n.y - c.y; d = Math.hypot(dx, dy) || 1; }
          const k = (need - d) / d; n.x += dx * k * 0.6; n.y += dy * k * 0.6;
        }
      });
    });
    nodes.forEach(n => {
      n.x = Math.min(W - n.w / 2 - 10, Math.max(n.w / 2 + 10, n.x));
      n.y = Math.min(H - n.h / 2 - 14, Math.max(n.h / 2 + 14, n.y));
    });
    return moved;
  };
  const clean = () => {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const A = nodes[i], B = nodes[j];
      if (Math.abs(B.x - A.x) < (A.w + B.w) / 2 + PX / 2 && Math.abs(B.y - A.y) < (A.h + B.h) / 2 + PY / 2) return false;
    }
    for (const h of H_) {
      const c = centre(h);
      for (const n of nodes) {
        const px = Math.max(n.x - n.w / 2, Math.min(c.x, n.x + n.w / 2)), py = Math.max(n.y - n.h / 2, Math.min(c.y, n.y + n.h / 2));
        if (Math.hypot(px - c.x, py - c.y) < HUB_R + 3) return false;
      }
    }
    return true;
  };
  const layout = H => {
    const n = nodes.length;
    nodes.forEach((nd, i) => {
      const a = 2 * Math.PI * i / n - Math.PI / 2;
      nd.x = W / 2 + (n > 1 ? (W / 2 - 110) * 0.9 * Math.cos(a) : 0); nd.y = H / 2 + (n > 1 ? (H / 2 - 50) * 0.9 * Math.sin(a) : 0); nd.vx = nd.vy = 0;
    });
    for (let it = 0; it < 260; it++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const A = nodes[i], B = nodes[j];
        const dx = A.x - B.x, dy = A.y - B.y, d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2), f = 6000 / d2;
        A.vx += dx / d * f; A.vy += dy / d * f; B.vx -= dx / d * f; B.vy -= dy / d * f;
      }
      H_.forEach(h => {
        for (let a = 0; a < h.members.length; a++) for (let b = a + 1; b < h.members.length; b++) {
          const A = nodes[h.members[a]], B = nodes[h.members[b]], dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 160) * 0.02;
          A.vx += dx / d * f; A.vy += dy / d * f; B.vx -= dx / d * f; B.vy -= dy / d * f;
        }
      });
      nodes.forEach(nd => {
        nd.vx += (W / 2 - nd.x) * 0.004; nd.vy += (H / 2 - nd.y) * 0.004;
        nd.x += nd.vx * 0.5; nd.y += nd.vy * 0.5; nd.vx *= 0.6; nd.vy *= 0.6;
      });
      separate(W, H);
    }
    for (let k = 0; k < 800 && separate(W, H); k++);
    return clean();
  };
  const area = nodes.reduce((s, n) => s + (n.w + PX) * (n.h + PY), 0) * 2.6;
  let H = Math.max(380, Math.ceil(area / W));
  for (let attempt = 0; attempt < 6 && !layout(H); attempt++) H = Math.round(H * 1.25);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  /* Tracé : on cherche les positions (ingrédients et ronds) qui évitent les croisements de lignes et les lignes qui traversent un autre ingrédient ou un autre rond.
     Recuit simulé avec un tirage pseudo-aléatoire fixé par les données : le même grimoire donne toujours le même dessin. */
  H_.forEach(h => { const c = centre(h); h.cx = c.x; h.cy = c.y; });
  const edges = []; H_.forEach((h, hi) => h.members.forEach(ni => edges.push({ n: ni, h: hi })));
  const eByNode = nodes.map(() => []), eByHub = H_.map(() => []);
  edges.forEach((e, k) => { eByNode[e.n].push(k); eByHub[e.h].push(k); });
  const ccw = (ax, ay, bx, by, cx, cy) => (cy - ay) * (bx - ax) - (by - ay) * (cx - ax);
  const segX = (a, b, c, d) => {   // intersection stricte de deux segments [a,b] et [c,d] ; renvoie le point ou null
    const d1 = ccw(c.x, c.y, d.x, d.y, a.x, a.y), d2 = ccw(c.x, c.y, d.x, d.y, b.x, b.y), d3 = ccw(a.x, a.y, b.x, b.y, c.x, c.y), d4 = ccw(a.x, a.y, b.x, b.y, d.x, d.y);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) { const t = d3 / (d3 - d4); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, t }; }
    return null;
  };
  const segRect = (p, q, n) => {   // le segment traverse-t-il le rectangle de l'ingrédient n ?
    const m = 2, x0 = n.x - n.w / 2 - m, x1 = n.x + n.w / 2 + m, y0 = n.y - n.h / 2 - m, y1 = n.y + n.h / 2 + m, dx = q.x - p.x, dy = q.y - p.y;
    let t0 = 0, t1 = 1;
    for (const [pp, qq] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
      if (pp === 0) { if (qq < 0) return false; } else { const r = qq / pp; if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } }
    }
    return true;
  };
  const segCirc = (p, q, c, r) => {
    const dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((c.cx - p.x) * dx + (c.cy - p.y) * dy) / l2));
    return Math.hypot(p.x + dx * t - c.cx, p.y + dy * t - c.cy) < r;
  };
  const P = k => nodes[edges[k].n], Q = k => H_[edges[k].h];
  const WC = 100, WT = 150, WH = 120, WL = 0.04;
  const qpt = k => ({ x: Q(k).cx, y: Q(k).cy });
  const crossK2 = k => { let c = 0; const e = edges[k], a = P(k), b = qpt(k); for (let f = 0; f < edges.length; f++) { const g = edges[f]; if (f === k || g.n === e.n || g.h === e.h) continue; if (segX(a, b, P(f), qpt(f))) c++; } return c; };
  const thruK = k => { let c = 0; const a = P(k), b = qpt(k); nodes.forEach((u, i) => { if (i !== edges[k].n && segRect(a, b, u)) c++; }); return c; };
  const hubK = k => { let c = 0; const a = P(k), b = qpt(k); H_.forEach((g, i) => { if (i !== edges[k].h && segCirc(a, b, g, HUB_R + 2)) c++; }); return c; };
  const edgeCost = k => WC * crossK2(k) + WT * thruK(k) + WH * hubK(k) + WL * Math.hypot(P(k).x - Q(k).cx, P(k).y - Q(k).cy);
  const nodeThru = v => { let c = 0; edges.forEach((e, k) => { if (e.n !== v && segRect(P(k), qpt(k), nodes[v])) c++; }); return c; };
  const hubThru = g => { let c = 0; edges.forEach((e, k) => { if (e.h !== g && segCirc(P(k), qpt(k), H_[g], HUB_R + 2)) c++; }); return c; };
  const costNode = v => eByNode[v].reduce((s, k) => s + edgeCost(k), 0) + WT * nodeThru(v);
  const costHub = g => eByHub[g].reduce((s, k) => s + edgeCost(k), 0) + WH * hubThru(g);
  const freeNode = v => {   // pas de chevauchement avec les autres ingrédients ni avec les ronds
    const A = nodes[v];
    if (A.x - A.w / 2 < 8 || A.x + A.w / 2 > W - 8 || A.y - A.h / 2 < 12 || A.y + A.h / 2 > H - 12) return false;
    for (let j = 0; j < nodes.length; j++) { if (j === v) continue; const B = nodes[j]; if (Math.abs(B.x - A.x) < (A.w + B.w) / 2 + PX / 2 && Math.abs(B.y - A.y) < (A.h + B.h) / 2 + PY / 2) return false; }
    for (const h of H_) { const px = Math.max(A.x - A.w / 2, Math.min(h.cx, A.x + A.w / 2)), py = Math.max(A.y - A.h / 2, Math.min(h.cy, A.y + A.h / 2)); if (Math.hypot(px - h.cx, py - h.cy) < HUB_R + 3) return false; }
    return true;
  };
  const freeHub = g => {
    const h = H_[g];
    if (h.cx < HUB_R + 6 || h.cx > W - HUB_R - 6 || h.cy < HUB_R + 10 || h.cy > H - HUB_R - 10) return false;
    for (const n of nodes) { const px = Math.max(n.x - n.w / 2, Math.min(h.cx, n.x + n.w / 2)), py = Math.max(n.y - n.h / 2, Math.min(h.cy, n.y + n.h / 2)); if (Math.hypot(px - h.cx, py - h.cy) < HUB_R + 3) return false; }
    for (let j = 0; j < H_.length; j++) if (j !== g && Math.hypot(H_[j].cx - h.cx, H_[j].cy - h.cy) < 2 * HUB_R + 6) return false;
    return true;
  };
  if (edges.length > 2) {
    let seed = 2166136261; const feed = str => { for (let i = 0; i < str.length; i++) { seed ^= str.charCodeAt(i); seed = Math.imul(seed, 16777619); } };
    nodes.forEach(n => feed(n.name)); H_.forEach(h => feed(h.key));
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const items = nodes.length + H_.length, iters = Math.min(9000, 160 * items);
    for (let it = 0; it < iters; it++) {
      const prog = it / iters, T = 40 * Math.pow(0.008, prog), sig = 70 * (1 - prog) + 6;
      const r = Math.floor(rnd() * items), isNode = r < nodes.length, item = isNode ? nodes[r] : H_[r - nodes.length];
      const ox = isNode ? item.x : item.cx, oy = isNode ? item.y : item.cy, v = isNode ? r : r - nodes.length;
      const before = isNode ? costNode(v) : costHub(v);
      const jump = rnd() < 0.04;
      const nx = jump ? 20 + rnd() * (W - 40) : ox + gauss() * sig, ny = jump ? 20 + rnd() * (H - 40) : oy + gauss() * sig;
      if (isNode) { item.x = nx; item.y = ny; } else { item.cx = nx; item.cy = ny; }
      if (!(isNode ? freeNode(v) : freeHub(v))) { if (isNode) { item.x = ox; item.y = oy; } else { item.cx = ox; item.cy = oy; } continue; }
      const delta = (isNode ? costNode(v) : costHub(v)) - before;
      if (delta > 0 && rnd() >= Math.exp(-delta / T)) { if (isNode) { item.x = ox; item.y = oy; } else { item.cx = ox; item.cy = oy; } }
    }
  }

  /* croisements restants : l'une des deux lignes passe par-dessus l'autre avec un petit pont en demi-cercle */
  const HOP = 6, hops = edges.map(() => []);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const e = edges[i], g = edges[j]; if (e.n === g.n || e.h === g.h) continue;
    const a = P(i), b = qpt(i), c = P(j), d = qpt(j), p = segX(a, b, c, d); if (!p) continue;
    const hi = Math.abs(b.x - a.x) / (Math.hypot(b.x - a.x, b.y - a.y) || 1), hj = Math.abs(d.x - c.x) / (Math.hypot(d.x - c.x, d.y - c.y) || 1);
    const over = hi >= hj ? i : j;   // la ligne la plus horizontale saute par-dessus l'autre
    const A = over === i ? a : c, B = over === i ? b : d, len = Math.hypot(B.x - A.x, B.y - A.y), tt = Math.hypot(p.x - A.x, p.y - A.y) / (len || 1);
    hops[over].push({ x: p.x, y: p.y, t: tt, len });
  }
  const spokePath = k => {
    const a = P(k), b = qpt(k), len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const sweep = Math.abs(ux) > Math.abs(uy) ? (ux > 0 ? 1 : 0) : (uy > 0 ? 1 : 0);
    let d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}`, last = -1e9;
    hops[k].sort((p, q) => p.t - q.t).forEach(p => {
      const dist = p.t * len; if (dist < HOP + 3 || len - dist < HOP + 3 || dist - last < 2 * HOP + 2) return;
      d += ` L${(p.x - ux * HOP).toFixed(1)} ${(p.y - uy * HOP).toFixed(1)} A${HOP} ${HOP} 0 0 ${sweep} ${(p.x + ux * HOP).toFixed(1)} ${(p.y + uy * HOP).toFixed(1)}`; last = dist;
    });
    return d + ` L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  };
  const dim = names => filterIng && !names.includes(filterIng);
  const spokes = edges.map((e, k) => {
    const h = H_[e.h], st = STYLE[h.status], o = dim(h.key.split("+")) ? 0.12 : 0.9, wdt = h.status === "ko" ? 1.5 : 1.5 + Math.min(h.trials, 4) * 0.8;
    return `<path d="${spokePath(k)}" fill="none" stroke="${st.color}" stroke-width="${wdt}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""} opacity="${o}"/>`;
  }).join("");
  const hubSvg = H_.map((h, hi) => {
    const c = { x: h.cx, y: h.cy }, st = STYLE[h.status], o = dim(h.key.split("+")) ? 0.2 : 1, n = h.recipes.size;
    const img = [...h.results].map(r => potionImg(r, true)).find(Boolean);   // miniature de la potion, s'il y en a une
    const inner = img
      ? `<clipPath id="hc${hi}"><circle cx="${c.x}" cy="${c.y}" r="${HUB_R - 1.5}"/></clipPath><image href="${img}" x="${c.x - HUB_R}" y="${c.y - HUB_R}" width="${2 * HUB_R}" height="${2 * HUB_R}" preserveAspectRatio="xMidYMid meet" clip-path="url(#hc${hi})"/>`
        + (n > 1 ? `<circle cx="${c.x + HUB_R - 2}" cy="${c.y + HUB_R - 2}" r="6.5" fill="#152325" stroke="${st.color}" stroke-width="1.2"/><text x="${c.x + HUB_R - 2}" y="${c.y + HUB_R + 1.5}" text-anchor="middle" font-size="9">${n}</text>` : "")
      : n > 1 ? `<text x="${c.x}" y="${c.y + 4}" text-anchor="middle">${n}</text>` : `<circle cx="${c.x}" cy="${c.y}" r="3.5" fill="${st.color}"/>`;
    return `<g class="hub" data-set="${esc(h.key)}" data-label="${esc([...h.results].join(" · ") || "Concoction sans nom")}" opacity="${o}"><circle class="ring" cx="${c.x}" cy="${c.y}" r="${HUB_R}" fill="#152325" stroke="${st.color}" stroke-width="2.2"/>
      ${inner}
      </g>`;
  }).join("");
  const nodeSvg = nodes.map(n => {
    const cs = catsOf(n.name), r = rarityOf(n.name);
    const gem = r.id === "commun" ? "" : `<path d="M${n.x + n.w / 2} ${n.y - 20} l7 7 l-7 7 l-7 -7 z" fill="${r.color}" stroke="#0f1a1b" stroke-width="1.5"><title>Qualité ${r.label}</title></path>`;
    const dots = cs.length > 1 ? cs.map((c, k) => `<circle cx="${n.x + (k - (cs.length - 1) / 2) * 10}" cy="${n.y + 12}" r="3.6" fill="${esc(c.color)}" stroke="#0f1a1b" stroke-width="1"/>`).join("") : "";
    return `<g class="node${n.name === filterIng ? " sel" : ""}" data-name="${esc(n.name)}"${cs.length ? ` style="--cat:${esc(cs[0].color)}"` : ""}>
      <rect x="${n.x - n.w / 2}" y="${n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="5"/>${gem}${dots}
      <text x="${n.x}" y="${n.y + 4.5}" text-anchor="middle">${esc(cap(n.name))}</text></g>`;
  }).join("");
  svg.innerHTML = spokes + nodeSvg + hubSvg;
}
/* Survol d'un rond : le nom de la recette s'affiche juste au-dessus */
function hubTip(h) {
  const svg = $("socio"), c = h.querySelector("circle.ring"), cx = +c.getAttribute("cx"), cy = +c.getAttribute("cy");
  const vb = svg.viewBox.baseVal, text = h.dataset.label, w = Math.max(60, text.length * 7.4 + 20);
  const x = Math.min(vb.width - w - 4, Math.max(4, cx - w / 2)), y = cy - HUB_R - 36 < 2 ? cy + HUB_R + 8 : cy - HUB_R - 32;
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("id", "hub-tip"); g.setAttribute("pointer-events", "none");
  g.innerHTML = `<rect x="${x}" y="${y}" width="${w}" height="26" rx="6" fill="#1d3235" stroke="#e6a95a" stroke-width="1.2"/>
    <text x="${x + w / 2}" y="${y + 17.5}" text-anchor="middle" fill="#e7dfca" font-size="14" font-family="Alegreya Sans, sans-serif" font-weight="500"></text>`;
  g.querySelector("text").textContent = text;
  svg.appendChild(g);
}
$("socio").addEventListener("mouseover", e => {
  const old = $("hub-tip"); if (old) old.remove();
  const h = e.target.closest(".hub"); if (h) hubTip(h);
});
$("socio").addEventListener("mouseleave", () => { const old = $("hub-tip"); if (old) old.remove(); });
$("socio").addEventListener("click", e => {
  const hub = e.target.closest(".hub");
  if (hub) { openConcoction(hub.dataset.set); return; }
  const g = e.target.closest(".node"); if (!g) return;
  filterIng = filterIng === g.dataset.name ? null : g.dataset.name;
  renderRecipes(); renderSocio();
});

/* ============================================================
   6b. Mode MJ : import du catalogue, simulateur, effets du Grimoire.
   Simple séparation d'affichage (réglage propre à ce navigateur) : les règles restent lisibles dans le code de la page.
   ============================================================ */
let mjMode = false;
try { mjMode = localStorage.getItem("tisane_mj") === "1"; } catch (e) {}
function applyMj() {
  $("tab-mj").classList.toggle("hidden", !mjMode);
  $("mj-toggle").textContent = mjMode ? "Quitter le mode MJ" : "Mode MJ";
  if (!mjMode && !$("view-mj").classList.contains("hidden")) showTab("accueil");
}
$("mj-toggle").onclick = () => {
  mjMode = !mjMode;
  try { localStorage.setItem("tisane_mj", mjMode ? "1" : "0"); } catch (e) {}
  applyMj(); if (mjMode) showTab("mj");
};

/* Reprise des données déjà saisies par les PJ : leurs propriétés et environnements passent dans la bibliothèque du MJ (pour les ingrédients
   qu'elle connaît), et les anciennes Classifications sont supprimées (les familles du Grimoire les remplacent). */
function migrationPlan() {
  const add = {};   // id d'ingrédient de la bibliothèque -> { props, envs } à ajouter
  ingMeta.forEach(m => {
    const ci = catalogItem(m.name); if (!ci) return;
    metaCatIds(m).forEach(id => {
      const c = categories.find(x => x.id === id); if (!c) return;
      const g = groupOf(c), key = g === "propriete" ? "props" : g === "environnement" ? "envs" : null;
      if (!key || ci[key].includes(id)) return;
      const a = add[ci.id] = add[ci.id] || { ci, props: [...ci.props], envs: [...ci.envs] };
      if (!a[key].includes(id)) a[key].push(id);
    });
  });
  return { add: Object.values(add), oldCats: categories.filter(c => groupOf(c) === "classification") };
}
function runMigration() {
  const p = migrationPlan();
  p.add.forEach(a => store.set("grimoire_ingredients", a.ci.id, { props: a.props, envs: a.envs }));
  p.oldCats.forEach(c => store.del("categories", c.id));
}
function migrationModal() {
  const p = migrationPlan();
  confirmBox("Reprendre les données des PJ ?",
    `<ul><li>${p.add.length ? `Propriétés et environnements déjà saisis par les PJ, repris dans la bibliothèque pour : ${p.add.map(a => esc(a.ci.name)).join(", ")}.` : "Aucune propriété ni aucun environnement à reprendre."}</li>
      <li>Anciennes Classifications supprimées : ${p.oldCats.length ? p.oldCats.map(c => esc(c.name)).join(", ") : "aucune"}. Les six familles du Grimoire les remplacent.</li>
      <li>Les PJ ne voient plus ces catégories tant que tu ne les leur révèles pas.</li></ul>`,
    "Reprendre", () => { runMigration(); toast("Données reprises"); });
}

/* Révélations : pour chaque ingrédient d'un PJ, ce que son personnage a appris (classification, propriété, environnement). Stocké sur son inventaire. */
const RV_GROUPS = [["classification", "Classification"], ["propriete", "Propriété"], ["environnement", "Environnement"]];
let rvPlayer = null;
function rvPreview(ci, g) {
  if (g === "classification") return catList(ci.clas) || '<span class="muted">aucune</span>';
  const ids = g === "propriete" ? ci.props : ci.envs, tags = ids.map(id => categories.find(c => c.id === id)).filter(Boolean);
  return tags.length ? tags.map(c => tag(c)).join("") : '<span class="muted">aucune</span>';
}
function renderReveal() {
  const players = [...new Set(inventory.map(i => i.player))].sort();
  if (!players.includes(rvPlayer)) rvPlayer = players[0] || null;
  $("rv-player").innerHTML = players.map(p => `<option${p === rvPlayer ? " selected" : ""}>${esc(p)}</option>`).join("");
  const rows = inventory.filter(i => i.player === rvPlayer).sort((a, b) => a.name.localeCompare(b.name)).map(i => ({ i, ci: catalogItem(i.name) }));
  const known = rows.filter(r => r.ci), other = rows.filter(r => !r.ci);
  $("rv-all").classList.toggle("hidden", !known.length);
  $("rv-list").innerHTML = !players.length ? '<div class="empty" style="padding:0">Aucun PJ n\'a encore d\'ingrédient.</div>'
    : (known.length ? '<table class="ctable"><tr><th>Ingrédient</th>' + RV_GROUPS.map(g => `<th>${g[1]}</th>`).join("") + "</tr>" + known.map(({ i, ci }) => `<tr><td>${esc(cap(i.name))}</td>`
        + RV_GROUPS.map(([g]) => `<td><label><input type="checkbox" data-rv="${g}" data-id="${esc(i.id)}"${i.reveal && i.reveal[g] ? " checked" : ""}> ${rvPreview(ci, g)}</label></td>`).join("") + "</tr>").join("") + "</table>"
      : '<div class="empty" style="padding:0">Aucun ingrédient de ce PJ n\'est dans la bibliothèque.</div>')
    + (other.length ? `<p class="muted" style="margin:10px 0 0">Hors bibliothèque (rien à révéler) : ${other.map(r => esc(cap(r.i.name))).join(", ")}.</p>` : "");
}
$("rv-player").addEventListener("change", () => { rvPlayer = $("rv-player").value; renderReveal(); });
$("rv-list").addEventListener("change", e => {
  const c = e.target.closest("input[data-rv]"); if (!c) return;
  const it = inventory.find(i => i.id === c.dataset.id); if (!it) return;
  store.set("inventaire", it.id, { reveal: { ...(it.reveal || {}), [c.dataset.rv]: c.checked } });
});
document.querySelectorAll("#rv-all [data-all]").forEach(b => b.onclick = () => {
  const on = b.dataset.all === "1", v = {}; RV_GROUPS.forEach(([g]) => { v[g] = on; });
  inventory.filter(i => i.player === rvPlayer && catalogItem(i.name)).forEach(i => store.set("inventaire", i.id, { reveal: { ...v } }));
});

/* Ingrédients ajoutés par les PJ qui ne sont pas dans la bibliothèque : le MJ les ajoute ou les remplace par un ingrédient de la bibliothèque (faute de frappe, par exemple) */
const orphanKnown = name => ALCH ? !!alchItem(name) : !!catalogItem(name);
function orphanList() {
  const m = new Map();
  inventory.forEach(i => { if (!i.name || orphanKnown(i.name)) return; (m.get(i.name) || m.set(i.name, []).get(i.name)).push(i); });
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
function closestLib(name) {
  const k = stripKey(name); if (!k) return null;
  const best = CATALOG.map(c => ({ c, d: lev(k, c.key) })).sort((x, y) => x.d - y.d)[0];
  return best && best.d <= Math.max(3, Math.floor(k.length * 0.4)) ? best.c : null;
}
function renderOrphans() {
  const list = orphanList(), box = $("mj-orphans");
  $("tab-mj").textContent = list.length ? `MJ (${list.length})` : "MJ";
  if (!box) return;
  box.classList.toggle("hidden", !list.length);
  if (!list.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h2>⚠ Ingrédients hors bibliothèque (${list.length})</h2>
    <p class="muted" style="margin:-6px 0 10px">Des PJ ont ajouté des ingrédients que la bibliothèque ne connaît pas : le laboratoire automatique les refuse et tu ne peux rien leur révéler. Ajoute-les à la bibliothèque, ou remplace-les par un ingrédient existant (faute de frappe, par exemple).</p>
    <table class="ctable"><tr><th>Ingrédient</th><th>PJ</th><th></th></tr>${list.map(([n, items], k) => `<tr><td>${esc(cap(n))}</td><td>${items.map(i => esc(i.player) + (i.qty > 0 ? " ×" + i.qty : "")).join(", ")}</td>
      <td style="white-space:nowrap"><button class="btn small" type="button" data-orph="add" data-k="${k}">Ajouter à la bibliothèque</button> <button class="btn ghost small" type="button" data-orph="rep" data-k="${k}">Remplacer par…</button></td></tr>`).join("")}</table>`;
  box.querySelectorAll("[data-orph]").forEach(b => b.onclick = () => {
    const [name] = list[+b.dataset.k];
    if (b.dataset.orph === "add") libIngModal(null, { name: cap(name), desc: "", p: ALCH ? 0 : 10, f: "A", q: "", sel: [], inv: false });
    else replaceModal(name);
  });
}
function replaceModal(name) {
  const sug = closestLib(name);
  openModal(`<h2>Remplacer « ${esc(cap(name))} »</h2><p class="muted" style="margin:0 0 8px">Chez tous les PJ, cet ingrédient devient l'ingrédient de la bibliothèque choisi : quantités, lieux de récolte et d'achat et catégories sont fusionnés.</p>
    <form id="rp-form" autocomplete="off"><input id="rp-name" list="cat-ingredients" placeholder="Ingrédient de la bibliothèque" required value="${esc(sug ? sug.name : "")}">
    ${sug ? `<div class="muted" style="margin-top:4px">Proposition : ${esc(sug.name)}</div>` : ""}
    <div class="actions-row"><button type="button" class="btn ghost" id="rp-cancel">Annuler</button><button class="btn" type="submit">Remplacer</button></div></form>`);
  $("rp-cancel").onclick = closeModal;
  $("rp-form").onsubmit = e => {
    e.preventDefault();
    const t = catalogItem($("rp-name").value.trim()); if (!t) { toast("Cet ingrédient n'est pas dans la bibliothèque."); return; }
    replaceIngredient(name, t); closeModal(); toast(`« ${cap(name)} » remplacé par ${t.name}`);
  };
  $("rp-name").focus();
}
function replaceIngredient(oldName, target) {
  const tn = norm(target.name);
  inventory.filter(i => i.name === oldName).forEach(i => {
    const nid = invId(i.player, tn), ex = inventory.find(x => x.id === nid) || {};
    store.set("inventaire", nid, {
      player: i.player, name: tn, qty: (ex.qty || 0) + (i.qty || 0),
      harvests: [...(ex.harvests || []), ...(i.harvests || [])], purchases: [...(ex.purchases || []), ...(i.purchases || [])],
      cats: [...new Set([...(ex.cats || []), ...(i.cats || [])])], reveal: ex.reveal || i.reveal || {}
    });
    if (nid !== i.id) store.del("inventaire", i.id);
  });
}
function renderMj() {
  if (!mjMode) return;
  renderOrphans();
  if (ALCH) {
    $("cat-ingredients").innerHTML = CATALOG.map(c => `<option value="${esc(c.name)}">`).join("");
    $("mj-import").innerHTML = `<p style="margin:0 0 10px">${CATALOG.length} ingrédient${CATALOG.length > 1 ? "s" : ""}, ${RECS.length} recette${RECS.length > 1 ? "s" : ""}, ${categories.length} catégorie${categories.length > 1 ? "s" : ""}.</p>
      <div class="row"><button type="button" class="btn" id="mj-export">Exporter ${GRIMOIRE_FILE}</button><button type="button" class="btn ghost" id="mj-importf">Importer un fichier</button>
      <input type="file" id="mj-file" accept=".json,application/json" class="hidden"></div>`;
    $("mj-export").onclick = exportFile;
    $("mj-importf").onclick = () => $("mj-file").click();
    $("mj-file").onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; };
    renderReveal(); renderLib(); mjSim(); return;
  }
  const p = migrationPlan(), todo = p.oldCats.length || p.add.length;
  $("mj-import").innerHTML = `<p style="margin:0 0 10px">${todo ? `${p.add.length} ingrédient${p.add.length > 1 ? "s" : ""} avec des propriétés ou environnements saisis par les PJ à reprendre · ${p.oldCats.length} ancienne${p.oldCats.length > 1 ? "s" : ""} Classification${p.oldCats.length > 1 ? "s" : ""} à remplacer.` : "Rien à reprendre : les données des PJ sont à jour."}${libReady() ? "" : " Initialise d'abord la bibliothèque."}</p>
    ${todo && libReady() ? '<button type="button" class="btn" id="mj-import-btn">Reprendre les données des PJ</button>' : ""}`;
  if ($("mj-import-btn")) $("mj-import-btn").onclick = migrationModal;
  $("cat-ingredients").innerHTML = CATALOG.map(c => `<option value="${esc(c.name)}">`).join("");
  renderReveal();
  renderLib(); mjSim();
}
function mjSim() {
  const vals = ["a", "b", "c", "d"].slice(0, ALCH ? 4 : 2).map(k => $("mj-" + k).value.trim()).filter(Boolean), out = $("mj-out");
  const msg = t => { out.innerHTML = `<div class="empty" style="padding:0">${t}</div>`; };
  if (vals.length < 2) return msg("Choisis au moins deux ingrédients.");
  const items = vals.map(ALCH ? alchItem : catalogItem), miss = vals.find((_, k) => !items[k]);
  if (miss) return msg(`« ${esc(miss)} » n'est pas dans la bibliothèque.`);
  if (new Set(items).size !== items.length) return msg("Choisis des ingrédients différents.");
  const o = ALCH ? alchOutcome(items) : mixOutcome(items[0], items[1]);
  if (o && o.error) return msg(esc(o.error));
  out.innerHTML = o ? outcomeHTML(o, true) : '<div class="empty" style="padding:0">Pas d\'effet défini pour cette paire.</div>';
}
["a", "b", "c", "d"].forEach(k => $("mj-" + k).addEventListener("input", mjSim));

/* ---------- Bibliothèque du MJ : ingrédients, potions, effets anecdotiques ---------- */
const famNames = k => [...k].map(c => FAMILIES[c].name).join(" + ");
const famTag = f => `<span class="tg t-classification" style="--c:${FAMILIES[f].color}">${esc(FAMILIES[f].name)}</span>`;
/* ---------- Fichier grimoire-alchimie.json : tout ce que le MJ saisit pour l'alchimie, exportable et réimportable ---------- */
const GRIMOIRE_FILE = "grimoire-alchimie.json";
/* fichier -> bibliothèque par défaut (identifiants déduits des noms) */
function fileToDefaults(d) {
  d = d || {};
  DEFAULTS.categories = (d.categories || []).filter(c => c && c.id && c.name).map(c => ({ id: c.id, name: c.name, color: HEX.test(c.color) ? c.color : PALETTE[0], group: MANAGED.includes(c.group) ? c.group : "propriete" }));
  DEFAULTS.ingredients = (d.ingredients || []).filter(i => i && i.name).map(i => ({ name: i.name, desc: i.desc || "", q: normQ(i.qualite), price: 0, clas: i.clas || [], props: i.props || [], envs: i.envs || [] }));
  DEFAULTS.potions = (d.recettes || []).filter(r => r && r.name).map(r => ({ id: "r_" + metaId(r.name), name: r.name, ingredients: (r.ingredients || []).map(metaId), text: r.text || "", duration: r.duration || null, fail: r.fail || "" }));
}
/* bibliothèque actuelle -> fichier */
function exportData() {
  const nameOf = id => (CATALOG.find(c => c.id === id) || {}).name;
  return {
    version: 1,
    categories: categories.filter(c => MANAGED.includes(groupOf(c))).map(c => ({ id: c.id, name: c.name, color: c.color, group: groupOf(c) })).sort((a, b) => a.name.localeCompare(b.name)),
    ingredients: [...CATALOG].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ name: c.name, desc: c.desc, qualite: c.q || "", clas: c.clas, props: c.props, envs: c.envs })),
    recettes: [...RECS].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(r => ({ name: r.name, ingredients: (r.ingredients || []).map(id => nameOf(id) || slotRaw(id)), text: r.text || "", duration: r.duration || null, fail: r.fail || "" }))
  };
}
/* fichier -> Firestore (réécrit les mêmes éléments : un réimport ne crée pas de doublon) */
function writeFile(d) {
  fileToDefaults(d);
  DEFAULTS.categories.forEach(c => store.set("categories", c.id, { name: c.name, color: c.color, group: c.group }));
  DEFAULTS.ingredients.forEach(i => store.set("grimoire_ingredients", metaId(i.name), i));
  DEFAULTS.potions.forEach(r => store.set("grimoire_potions", r.id, { name: r.name, ingredients: r.ingredients, text: r.text, duration: r.duration, fail: r.fail }));
}
function exportFile() {
  const blob = new Blob([JSON.stringify(exportData(), null, 2) + "\n"], { type: "application/json" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = GRIMOIRE_FILE; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Fichier exporté");
}
function importFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    let d; try { d = JSON.parse(rd.result); } catch (e) { toast("Ce fichier n'est pas un JSON valide.", 4000); return; }
    if (!d || typeof d !== "object" || !Array.isArray(d.ingredients) || !Array.isArray(d.recettes)) { toast("Ce n'est pas un grimoire d'alchimie (il manque « ingredients » ou « recettes »).", 4500); return; }
    confirmBox("Importer ce grimoire ?", `<p>${d.ingredients.length} ingrédient${d.ingredients.length > 1 ? "s" : ""}, ${d.recettes.length} recette${d.recettes.length > 1 ? "s" : ""} et ${(d.categories || []).length} catégorie${(d.categories || []).length > 1 ? "s" : ""}.</p><p>Les éléments de même nom sont remplacés, les autres sont conservés.</p>`,
      "Importer", () => { writeFile(d); toast("Grimoire importé"); });
  };
  rd.readAsText(file);
}
function seedLibrary() {
  if (ALCH) { writeFile({ categories: DEFAULTS.categories, ingredients: DEFAULTS.ingredients, recettes: DEFAULTS.potions.map(r => ({ ...r, ingredients: r.ingredients.map(id => (DEFAULTS.ingredients.find(i => metaId(i.name) === id) || {}).name || slotRaw(id)) })) }); return; }
  DEFAULTS.ingredients.forEach(d => store.set("grimoire_ingredients", metaId(d.name), d));
  DEFAULTS.potions.forEach(d => store.set("grimoire_potions", d.key, d));
  DEFAULTS.anecdotes.forEach(d => store.set("grimoire_anecdotes", d.key, d));
}
const catList = ids => ids.map(id => categories.find(c => c.id === id)).filter(Boolean).map(c => tag(c)).join("");
/* Recherche dans la bibliothèque : tous les mots saisis doivent se retrouver (accents et majuscules ignorés) ; les listes s'affichent par pages */
const LIB_PAGE = 30;
const libView = { ing: "", pot: "", ingN: LIB_PAGE, potN: LIB_PAGE };
const matchQ = (q, hay) => { const t = String(q || "").split(/\s+/).map(stripKey).filter(Boolean), h = stripKey(hay); return t.every(x => h.includes(x)); };
const moreBtn = (k, shown, total) => total > shown ? `<div style="text-align:center;margin-top:10px"><button type="button" class="btn ghost small" data-more="${k}">Afficher plus (${Math.min(LIB_PAGE, total - shown)} sur ${total - shown} restants)</button></div>` : "";
const countLine = (shown, total, all) => `<div class="muted" style="margin:0 0 6px">${total === all ? `${all} au total` : `${total} résultat${total > 1 ? "s" : ""} sur ${all}`}${shown < total ? ` · ${shown} affichés` : ""}</div>`;
function renderLib() {
  const ready = libReady();
  $("lib-add").classList.toggle("hidden", !ready);
  $("lib-init").innerHTML = ready ? "" : `<div class="warn" style="margin-bottom:12px"><p style="margin:0 0 8px">La bibliothèque n'est pas encore enregistrée : ce sont les données du Grimoire d'origine qui servent. Initialise-la pour pouvoir les modifier.</p><button type="button" class="btn" id="lib-seed">Initialiser la bibliothèque</button></div>`;
  if (!ready) $("lib-seed").onclick = () => { seedLibrary(); toast("Bibliothèque initialisée"); };
  const order = Object.keys(FAMILIES);
  const catNames = ids => ids.map(id => (categories.find(c => c.id === id) || {}).name || "").join(" ");
  const rows0 = [...CATALOG].sort((x, y) => ALCH ? x.name.localeCompare(y.name) : order.indexOf(x.f) - order.indexOf(y.f) || x.p - y.p || x.name.localeCompare(y.name));
  const rowsAll = rows0.filter(c => matchQ(libView.ing, `${c.name} ${c.desc} ${ALCH ? "" : (FAMILIES[c.f] || {}).name || ""} ${catNames([...c.clas, ...c.props, ...c.envs])}`)), rows = rowsAll.slice(0, libView.ingN);
  $("lib-ing").innerHTML = rows0.length && !rowsAll.length ? '<div class="empty" style="padding:0">Aucun ingrédient ne correspond à cette recherche.</div>' : rows.length ? countLine(rows.length, rowsAll.length, rows0.length) + '<table class="ctable"><tr><th>Ingrédient</th><th>Classification</th><th>Propriété</th><th>Environnement</th>' + (ALCH ? "" : '<th class="num">Prix</th>') + '<th></th></tr>'
    + rows.map(c => `<tr><td>${esc(c.name)}<div class="muted">${descHTML(c.desc)}</div></td><td>${ALCH ? catList(c.clas) : famTag(c.f) + catList(c.clas)}</td><td>${catList(c.props)}</td><td>${catList(c.envs)}</td>${ALCH ? "" : `<td class="num">${c.p}</td>`}
      <td class="tcenter">${ready ? `<button class="btn ghost icon" data-lib="ing" data-id="${esc(c.id)}" title="Modifier" aria-label="Modifier ${esc(c.name)}">✎</button>` : ""}</td></tr>`).join("") + "</table>" + moreBtn("ing", rows.length, rowsAll.length)
    : '<div class="empty">La bibliothèque est vide. Utilise « Ajouter un ingrédient ».</div>';
  if (ALCH) {   /* potions = recettes du MJ */
    /* Un emplacement de recette peut être un ingrédient précis, une catégorie (« Eau », « Toxine »…), une autre potion ou un nom libre : seul ce dernier cas n'a pas de fiche. */
    const nameOf = id => { const c = CATALOG.find(x => x.id === id); if (c) return esc(c.name); const sl = resolveSlot(id); return sl.t === "cls" ? `<span title="Toute catégorie « ${esc(slotRaw(id))} »">${esc(cap(slotRaw(id)))}</span>` : esc(cap(slotRaw(id))); };
    const recAll = [...RECS].sort((x, y) => (x.name || "").localeCompare(y.name || "")), recF = recAll.filter(r => matchQ(libView.pot, `${r.name} ${r.text || ""} ${(r.ingredients || []).map(id => (CATALOG.find(c => c.id === id) || { name: slotRaw(id) }).name).join(" ")}`)), recS = recF.slice(0, libView.potN);
    $("lib-pot").innerHTML = (recAll.length ? countLine(recS.length, recF.length, recAll.length) : "") + (recS.map(r => `<details class="mjfx"><summary class="row between" style="cursor:pointer"><span><b>${esc(r.name)}</b> <i>(${(r.ingredients || []).map(nameOf).join(" + ")})</i></span><button class="btn ghost icon" data-lib="rec" data-id="${esc(r.id)}" title="Modifier" aria-label="Modifier ${esc(r.name)}">✎</button></summary>
      <div style="white-space:pre-line;margin-top:6px">${esc(r.text || "")}${r.duration ? ` <span class="muted">Durée : ${esc(r.duration)}.</span>` : ""}</div>${r.fail ? `<div class="muted">↳ Effet secondaire : ${esc(r.fail)}</div>` : ""}</details>`).join("") || (recAll.length ? '<div class="empty" style="padding:0">Aucune potion ne correspond à cette recherche.</div>' : '<div class="empty" style="padding:0">Aucune potion. Utilise « Ajouter une potion ».</div>')) + moreBtn("pot", recS.length, recF.length);
    return;
  }
  const pots = Object.keys(POT).sort(), anec = Object.keys(ANEC).sort();
  $("lib-pot").innerHTML = pots.map(k => { const e = POT[k]; return `<div class="mjfx"><div class="row between"><span><b>${esc(e.name)}</b> <i>(${famNames(k)})</i></span>${ready ? `<button class="btn ghost icon" data-lib="pot" data-id="${k}" title="Modifier" aria-label="Modifier ${esc(e.name)}">✎</button>` : ""}</div>
    ${e.tiers.map((t, i) => `<div><b>${RULES.TN[i]}</b> (durée ${esc(e.duration || RULES.DU[i])}) : ${esc(t)}</div><div class="muted">↳ Échec (DD ${RULES.DD[i]}) : ${esc((e.fail || "").replace(/\{d\}/g, RULES.DI[i]))}</div>`).join("")}</div>`; }).join("");
  $("lib-anec").innerHTML = anec.map(k => { const y = ANEC[k]; return `<div class="mjfx"><div class="row between"><span><b>${esc(y.name)}</b> <i>(${famNames(k)} : ${y.type === "b" ? "désastre mineur" : y.type === "f" ? "amusant" : "rien"})</i></span>${ready ? `<button class="btn ghost icon" data-lib="anec" data-id="${k}" title="Modifier" aria-label="Modifier ${esc(y.name)}">✎</button>` : ""}</div>${esc(y.text)}</div>`; }).join("");
}
function libIngModal(it, form) {
  const add = !it;
  const f = form || (add ? { name: "", desc: "", p: ALCH ? 0 : 10, f: "A", q: "", sel: [] } : { name: it.name, desc: it.desc, p: it.p, f: it.f, q: it.q || "", sel: [...it.clas, ...it.props, ...it.envs] });
  const read = () => {
    f.name = $("li-name").value; if ($("li-fam")) f.f = $("li-fam").value; f.p = $("li-price").value; if ($("li-q")) f.q = $("li-q").value; if ($("li-inv")) f.inv = $("li-inv").checked; f.desc = $("li-desc").value;
    f.sel = [...document.querySelectorAll("#li-form input[data-cat]:checked")].map(x => x.dataset.cat);
  };
  openModal(`<h2>${add ? "Nouvel ingrédient" : esc(it.name)}</h2>
    <form id="li-form" autocomplete="off">
      <label class="muted" for="li-name">Nom</label><input id="li-name" required value="${esc(f.name)}">
      ${ALCH ? `<input id="li-price" type="hidden" value="0"><label class="muted" for="li-q" style="display:block;margin-top:12px">Qualité (sert à la moyenne du résultat)</label><select id="li-q" class="full"><option value="">Aucune</option>${QL.slice(1).map(q => `<option${q === f.q ? " selected" : ""}>${q}</option>`).join("")}</select>` : `<div class="row" style="margin-top:12px;align-items:flex-start">
        <div style="flex:1;min-width:150px"><label class="muted" for="li-fam">Famille (sert aux mélanges)</label>
          <select id="li-fam" class="full">${Object.keys(FAMILIES).map(k => `<option value="${k}"${k === f.f ? " selected" : ""}>${FAMILIES[k].name}</option>`).join("")}</select></div>
        <div style="width:110px"><label class="muted" for="li-price">Prix</label><input id="li-price" type="number" min="0" required value="${esc(f.p)}"></div>
      </div>`}
      <div style="margin-top:14px">${MANAGED.map(g => catChecks(f.sel, g)).join("")}</div>
      <label class="muted" for="li-desc" style="display:block;margin-top:12px">Description (**gras** pour un lieu)</label>
      <textarea id="li-desc" rows="4" style="width:100%">${esc(f.desc)}</textarea>
      ${add ? `<label class="check2"><input type="checkbox" id="li-inv"${f.inv ? " checked" : ""}><span>Ajouter aussi à l'inventaire et aux ingrédients connus de ${esc(player() || "mon personnage")} (1 exemplaire)</span></label>` : ""}
      <div class="actions-row">${add ? "" : '<button type="button" class="btn ghost danger" id="li-del" style="margin-right:auto">Supprimer</button>'}
        <button type="button" class="btn ghost" id="li-cancel">Annuler</button><button class="btn" type="submit">${add ? "Ajouter" : "Enregistrer"}</button></div>
    </form>`);
  $("li-cancel").onclick = closeModal;
  document.querySelectorAll("#li-form [data-newcat]").forEach(b => b.onclick = () => {
    read();
    promptCategory(id => { f.sel = [...new Set([...f.sel, id])]; libIngModal(it, f); }, b.dataset.newcat, () => libIngModal(it, f));
  });
  if ($("li-del")) $("li-del").onclick = () => confirmBox(`Supprimer « ${it.name} » de la bibliothèque ?`,
    "<p>L'ingrédient quitte la bibliothèque : le laboratoire automatique ne le reconnaîtra plus. Les inventaires et les recettes des PJ ne sont pas touchés.</p>",
    "Supprimer", () => { store.del("grimoire_ingredients", it.id); toast("Ingrédient retiré de la bibliothèque"); });
  $("li-form").onsubmit = e => {
    e.preventDefault(); read();
    const name = f.name.trim().replace(/\s+/g, " "), id = metaId(name);
    if (!name) return;
    if (CATALOG.some(c => c.id !== (it && it.id) && (c.id === id || c.key === stripKey(name)))) { toast("Un ingrédient de ce nom existe déjà."); return; }
    if (add && f.inv && !player()) { toast("Choisis d'abord ton personnage (en haut de la page)."); return; }
    const ofGroup = g => f.sel.filter(cid => { const c = categories.find(x => x.id === cid); return c && groupOf(c) === g; });
    store.set("grimoire_ingredients", id, { name, clas: ofGroup("classification"), ...(ALCH ? { q: f.q || "" } : { family: f.f }), price: Math.max(0, parseInt(f.p, 10) || 0), desc: f.desc.trim(), props: ofGroup("propriete"), envs: ofGroup("environnement") });
    if (ALCH && !add && it.id !== id) libPot.filter(r => (r.ingredients || []).includes(it.id)).forEach(r => store.set("grimoire_potions", r.id, { ingredients: r.ingredients.map(x => x === it.id ? id : x) }));
    if (!add && it.id !== id) store.del("grimoire_ingredients", it.id);
    if (add && f.inv) {
      const me = player(), nm = norm(name), iid = invId(me, nm), ex = inventory.find(x => x.id === iid), rar = RARITIES.find(x => x.q && x.q === f.q);
      store.set("inventaire", iid, { player: me, name: nm, qty: (ex ? ex.qty : 0) + 1 });
      if (rar) setIngMeta(nm, { rarity: rar.id });
    }
    closeModal(); toast(add ? (f.inv ? "Ingrédient ajouté à la bibliothèque et à ton inventaire" : "Ingrédient ajouté à la bibliothèque") : "Ingrédient modifié");
  };
  $("li-name").focus();
}
function libRecModal(r) {
  const add = !r, cur = r ? (r.ingredients || []).map(id => (CATALOG.find(c => c.id === id) || { name: slotRaw(id) }).name) : ["", ""];
  const slotOpts = [...CATALOG.map(c => c.name), ...categories.filter(c => groupOf(c) === "classification").map(c => c.name), ...RECS.filter(x => !r || x.id !== r.id).map(x => x.name)];
  while (cur.length < 4) cur.push("");
  openModal(`<h2>${add ? "Nouvelle potion" : esc(r.name)}</h2>
    <form id="lr-form" autocomplete="off">
      <label class="muted" for="lr-name">Nom de la potion</label><input id="lr-name" required value="${esc(r ? r.name : "")}">
      <div class="muted" style="margin-top:12px">Ingrédients (deux à quatre) : un ingrédient précis, une classification (n'importe quel ingrédient de cette classification convient) ou une autre potion</div>
      <datalist id="lr-opts">${slotOpts.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      ${cur.map((n, i) => `<input class="lr-ing" list="lr-opts" aria-label="Ingrédient ${i + 1}" placeholder="Ingrédient ${i + 1}${i > 1 ? " (facultatif)" : ""}" value="${esc(n)}" style="margin-top:6px">`).join("")}
      <label class="muted" for="lr-text" style="display:block;margin-top:12px">Effets</label><textarea id="lr-text" rows="3" style="width:100%" required>${esc(r ? r.text : "")}</textarea>
      <label class="muted" for="lr-dur" style="display:block;margin-top:12px">Durée</label><input id="lr-dur" value="${esc(r ? r.duration || "" : "")}">
      <label class="muted" for="lr-fail" style="display:block;margin-top:12px">Effet secondaire ou conséquence d'un échec (facultatif)</label><textarea id="lr-fail" rows="2" style="width:100%">${esc(r ? r.fail || "" : "")}</textarea>
      <div class="actions-row">${add ? "" : '<button type="button" class="btn ghost danger" id="lr-del" style="margin-right:auto">Supprimer</button>'}
        <button type="button" class="btn ghost" id="lr-cancel">Annuler</button><button class="btn" type="submit">${add ? "Ajouter" : "Enregistrer"}</button></div>
    </form>`);
  $("lr-cancel").onclick = closeModal;
  if ($("lr-del")) $("lr-del").onclick = () => confirmBox(`Supprimer « ${r.name} » ?`, "<p>La potion quitte la bibliothèque. Les essais et potions déjà notés par les PJ ne sont pas touchés.</p>", "Supprimer", () => { store.del("grimoire_potions", r.id); toast("Potion supprimée"); });
  $("lr-form").onsubmit = e => {
    e.preventDefault();
    const names = [...document.querySelectorAll("#lr-form .lr-ing")].map(i => i.value.trim()).filter(Boolean);
    const idsAll = names.map(n => { const c = catalogItem(n); if (c) return c.id; const id = metaId(n); return resolveSlot(id).t !== "lit" || cur.includes(n) ? id : null; }), miss = names.find((_, k) => !idsAll[k]);
    if (miss) { toast(`« ${miss} » n'est ni dans la bibliothèque, ni une classification, ni une potion : ajoute-le d'abord.`, 4000); return; }
    if (names.length < 2) { toast("Il faut au moins deux ingrédients."); return; }
    const ids = idsAll;
    const data = { name: $("lr-name").value.trim(), ingredients: ids, text: $("lr-text").value.trim(), duration: $("lr-dur").value.trim() || null, fail: $("lr-fail").value.trim() };
    if (add) store.add("grimoire_potions", data); else store.set("grimoire_potions", r.id, data);
    closeModal(); toast(add ? "Potion ajoutée" : "Potion modifiée");
  };
  $("lr-name").focus();
}
function libPotModal(k) {
  const e = POT[k];
  openModal(`<h2>${esc(e.name)}</h2><p class="muted" style="margin:0 0 6px">${famNames(k)}</p>
    <form id="lp-form">
      <label class="muted" for="lp-name">Nom de l'effet</label><input id="lp-name" required value="${esc(e.name)}">
      ${RULES.TN.map((t, i) => `<label class="muted" for="lp-t${i}" style="display:block;margin-top:10px">${t}</label><textarea id="lp-t${i}" rows="2" style="width:100%" required>${esc(e.tiers[i])}</textarea>`).join("")}
      <label class="muted" for="lp-dur" style="display:block;margin-top:10px">Durée (vide = selon le niveau : 1 heure, 8 heures, 24 heures)</label><input id="lp-dur" value="${esc(e.duration || "")}">
      <label class="muted" for="lp-fail" style="display:block;margin-top:10px">Jet de préparation raté ({d} devient 2d6, 4d6 ou 8d6 selon le niveau)</label><textarea id="lp-fail" rows="3" style="width:100%">${esc(e.fail || "")}</textarea>
      <div class="actions-row"><button type="button" class="btn ghost" id="lp-cancel">Annuler</button><button class="btn" type="submit">Enregistrer</button></div>
    </form>`);
  $("lp-cancel").onclick = closeModal;
  $("lp-form").onsubmit = ev => {
    ev.preventDefault();
    store.set("grimoire_potions", k, { key: k, name: $("lp-name").value.trim(), tiers: [0, 1, 2].map(i => $("lp-t" + i).value.trim()), duration: $("lp-dur").value.trim() || null, fail: $("lp-fail").value.trim() });
    closeModal(); toast("Potion modifiée");
  };
}
function libAnecModal(k) {
  const y = ANEC[k];
  openModal(`<h2>${esc(y.name)}</h2><p class="muted" style="margin:0 0 6px">${famNames(k)}</p>
    <form id="la-form">
      <label class="muted" for="la-name">Nom de l'effet</label><input id="la-name" required value="${esc(y.name)}">
      <label class="muted" for="la-text" style="display:block;margin-top:10px">Description</label><textarea id="la-text" rows="3" style="width:100%" required>${esc(y.text)}</textarea>
      <label class="muted" for="la-type" style="display:block;margin-top:10px">Nature</label>
      <select id="la-type" class="full"><option value="f"${y.type === "f" ? " selected" : ""}>Amusant</option><option value="b"${y.type === "b" ? " selected" : ""}>Désastre mineur</option><option value="0"${y.type === "0" ? " selected" : ""}>Aucun effet</option></select>
      <div class="actions-row"><button type="button" class="btn ghost" id="la-cancel">Annuler</button><button class="btn" type="submit">Enregistrer</button></div>
    </form>`);
  $("la-cancel").onclick = closeModal;
  $("la-form").onsubmit = ev => {
    ev.preventDefault();
    store.set("grimoire_anecdotes", k, { key: k, name: $("la-name").value.trim(), text: $("la-text").value.trim(), type: $("la-type").value });
    closeModal(); toast("Effet modifié");
  };
}
$("lib-add").onclick = () => libIngModal();
$("lib-rec-add").onclick = () => libRecModal();
$("view-mj").addEventListener("click", e => {
  const b = e.target.closest("[data-lib]"); if (!b) return;
  if (b.dataset.lib === "ing") libIngModal(CATALOG.find(c => c.id === b.dataset.id));
  else if (b.dataset.lib === "pot") libPotModal(b.dataset.id);
  else if (b.dataset.lib === "rec") libRecModal(libPot.find(x => x.id === b.dataset.id));
  else if (b.dataset.lib === "anec") libAnecModal(b.dataset.id);
});


/* ============================================================
   Fiche de personnage (commune à Tisane et Alchimie), transfert d'ingrédients entre les deux pages, suggestions de recettes
   La fiche est rangée dans la collection « alch_fiches » : les règles Firestore l'autorisent déjà pour les deux pages.
   ============================================================ */
let FICHES = [];
const SPECS = ["", "Abstracteur", "Alkahest", "Apothicaire"];
const ficheOf = () => FICHES.find(f => f.id === (player() || "").replace(/[\/\s]+/g, "_")) || null;
const ficheId = () => (player() || "").replace(/[\/\s]+/g, "_");
function ficheModal() {
  const me = player(); if (!me) { toast("Choisis d'abord ton personnage."); $("player").focus(); return; }
  const f = ficheOf() || {};
  openModal(`<h2>Fiche de ${esc(me)}</h2><p class="muted" style="margin:0 0 8px">Renseignée une fois, elle sert sur Tisane &amp; Dragon et sur Alchimie &amp; Dragon.</p>
    <form id="fi-form" autocomplete="off"><label class="muted" for="fi-rank">Rang</label>
    <select id="fi-rank" class="full">${SR_RANKS.map(r => `<option value="${r[0]}"${r[0] === (f.rank || "Novice") ? " selected" : ""}>${r[0]} (bonus +${r[1]})</option>`).join("")}</select>
    <label class="muted" for="fi-spec" style="display:block;margin-top:12px">Spécialisation</label>
    <select id="fi-spec" class="full">${SPECS.map(x => `<option value="${x}"${x === (f.spec || "") ? " selected" : ""}>${x || "Aucune"}</option>`).join("")}</select>
    <label class="muted" for="fi-notes" style="display:block;margin-top:12px">Notes</label><textarea id="fi-notes" rows="4" style="width:100%">${esc(f.notes || "")}</textarea>
    <div class="actions-row"><button type="button" class="btn ghost" id="fi-cancel">Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>`);
  $("fi-cancel").onclick = closeModal;
  $("fi-form").onsubmit = e => {
    e.preventDefault();
    rawStore.set("alch_fiches", ficheId(), { player: me, rank: $("fi-rank").value, spec: $("fi-spec").value, notes: $("fi-notes").value.trim() });
    closeModal(); toast("Fiche enregistrée");
  };
}
$("fiche-btn").onclick = ficheModal;

/* Passer un ingrédient d'une page à l'autre : le PJ choisit au moment du clic la quantité et s'il copie ou déplace */
function transferModal(it) {
  const me = player(), other = ALCH ? "Tisane & Dragon" : "Alchimie & Dragon", col = (ALCH ? "" : "alch_") + "inventaire";
  openModal(`<h2>Envoyer vers ${esc(other)}</h2><p class="muted" style="margin:0 0 8px">${esc(cap(it.name))} : ${it.qty} en stock ici.</p>
    <form id="xf-form" autocomplete="off"><label class="muted" for="xf-qty">Quantité à envoyer</label><input id="xf-qty" type="number" min="1" max="${Math.max(1, it.qty)}" value="${Math.max(1, it.qty)}" style="width:100px">
    <label class="check2"><input type="radio" name="xf-mode" value="copy" checked><span>Copier : il reste aussi ici</span></label>
    <label class="check2"><input type="radio" name="xf-mode" value="move"><span>Déplacer : il sort de mon inventaire d'ici</span></label>
    <div class="actions-row"><button type="button" class="btn ghost" id="xf-cancel">Annuler</button><button class="btn" type="submit">Envoyer</button></div></form>`);
  $("xf-cancel").onclick = closeModal;
  $("xf-form").onsubmit = async e => {
    e.preventDefault();
    const q = Math.max(1, parseInt($("xf-qty").value, 10) || 1), move = document.querySelector("input[name=xf-mode]:checked").value === "move", id = invId(me, it.name);
    if (move && q > it.qty) { toast("Tu n'en as pas autant."); return; }
    let ex = null;
    try { ex = useFirebase ? await firebase.firestore().collection(col).doc(id).get().then(d => d.exists ? d.data() : null) : (JSON.parse(localStorage.getItem("tisane_" + col) || "{}")[id] || null); } catch (err) { ex = null; }
    rawStore.set(col, id, { player: me, name: it.name, qty: (ex ? ex.qty || 0 : 0) + q, cats: [...new Set([...((ex && ex.cats) || []), ...(it.cats || [])])] });
    if (move) store.set("inventaire", it.id, { qty: it.qty - q });
    closeModal(); toast(`${cap(it.name)} × ${q} envoyé vers ${other}`);
  };
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act=xfer]"); if (!b) return;
  const it = inventory.find(i => i.id === b.dataset.id); if (it) transferModal(it);
});
if ($("inv-suggest")) $("inv-suggest").onclick = () => {
  if (!player()) { toast("Choisis d'abord ton personnage."); $("player").focus(); return; }
  openModal(`<h2>Que puis-je préparer ?</h2><p class="muted" style="margin:0 0 4px">Tes recettes connues, d'après ton inventaire.</p>${srCraftHtml(null)}<div class="actions-row"><button type="button" class="btn ghost" id="sg-close">Fermer</button></div>`);
  $("sg-close").onclick = closeModal;
};

/* ============================================================
   6b. Recherche d'ingrédients (cueillette) : trois modes
   Tableau « Recherche Ingrédient » : d20 + bonus de rang -> rareté ; dé de recherche = nombre d'ingrédients de cette rareté dans l'environnement.
   Un PJ ne peut chercher que ce qu'il connaît (ingrédients de son inventaire, recettes qu'il a réussies).
   ============================================================ */
const SR_Q = ["Commun", "Peu commun", "Rare", "Épique", "Légendaire"];
const SR_MIN = { "Commun": 5, "Peu commun": 11, "Rare": 16, "Épique": 20, "Légendaire": 21 };
const SR_RANKS = [["Novice", 0], ["Apprenti", 1], ["Expert", 2], ["Compagnon", 3], ["Maître", 4]];
const SR = { mode: "gen", env: "", rank: localStorage.getItem("tisane_rank") || "Novice", d20: "", die: "", rec: "", ing: "" };
const srRank = () => { const f = ficheOf(); return f && f.rank ? f.rank : SR.rank; };
const srBonus = () => (SR_RANKS.find(r => r[0] === srRank()) || [0, 0])[1];
const srRarity = t => t >= 21 ? "Légendaire" : t >= 20 ? "Épique" : t >= 16 ? "Rare" : t >= 11 ? "Peu commun" : t >= 5 ? "Commun" : null;
const srEnvs = () => categories.filter(c => groupOf(c) === "environnement");
const srPool = (env, q) => CATALOG.filter(c => c.envs.includes(env) && c.q === q).sort((a, b) => a.name.localeCompare(b.name, "fr"));
const srKnown = () => { const me = player(); return inventory.filter(i => i.player === me).map(i => catalogItem(i.name)).filter(Boolean); };
const srQty = die => Math.max(1, Math.floor(die / 2));
function srNeed(it) {   // d20 minimum pour tomber sur cette rareté dans l'environnement choisi
  if (!SR.env) return null;
  if (!it.envs.includes(SR.env)) return { none: true };
  const th = SR_MIN[it.q]; if (!th) return { none: true };
  const d = Math.max(1, th - srBonus());
  return { th, d, ok: d <= 20, n: srPool(SR.env, it.q).length, q: it.q };
}
const srNeedTxt = (it, nd) => !nd ? "" : nd.none ? `<span class="muted">${esc(cap(it.name))} : introuvable dans cet environnement.</span>`
  : nd.ok ? `<b>${esc(cap(it.name))}</b> (${esc(nd.q)}) : d20 minimum <b>${nd.d}</b> <span class="muted">(total ${nd.th}${srBonus() ? ` − bonus ${srBonus()}` : ""}) · dé de recherche d${nd.n}</span>`
  : `<b>${esc(cap(it.name))}</b> (${esc(nd.q)}) : <span style="color:#e8618c">impossible avec ton rang</span> <span class="muted">(total ${nd.th} requis)</span>`;
function srSlotLines(rec) {
  const lines = []; let worst = 0, blocked = false;
  (rec.ingredients || []).forEach(id => {
    const s = resolveSlot(id);
    if (s.t === "prod" || s.t === "lit") { lines.push(`<div class="muted">${esc(slotRaw(id))} : à fabriquer ou à se procurer, pas de recherche.</div>`); return; }
    const known = srKnown().filter(it => slotFits(s, it));
    if (!known.length) { lines.push(`<div class="muted">${esc(s.t === "cls" ? slotRaw(id) : slotRaw(id))} : aucun ingrédient connu pour cet emplacement.</div>`); blocked = true; return; }
    const opts = known.map(it => ({ it, nd: srNeed(it) })).filter(o => o.nd && !o.nd.none).sort((a, b) => a.nd.th - b.nd.th);
    if (!opts.length) { lines.push(`<div class="muted">${esc(slotRaw(id))} : rien de connu à trouver ici.</div>`); blocked = true; return; }
    lines.push(`<div>${opts.map(o => srNeedTxt(o.it, o.nd)).join("<br>")}</div>`);
    if (!opts[0].nd.ok) blocked = true; else worst = Math.max(worst, opts[0].nd.d);
  });
  return { lines, worst, blocked };
}

/* Recettes connues réalisables avec le stock (et éventuellement l'ingrédient qui vient d'être trouvé), ou avec ce qu'il manque */
function srCraft(extra) {
  const me = player(); if (!me) return [];
  const done = [...new Set(trials.filter(t => t.player === me && statusOf(t) === "ok" && t.result).map(t => t.result))];
  const units = [];
  inventory.filter(i => i.player === me && i.qty > 0).forEach(i => { const c = alchItem(i.name); if (c) for (let k = 0; k < Math.min(i.qty, 4); k++) units.push(c); });
  if (extra) units.push(extra);
  const out = [];
  if (!ALCH) {   /* Tisane : une recette connue est un jeu d'ingrédients nommés */
    const have = new Set(inventory.filter(i => i.player === me && i.qty > 0).map(i => i.name)); if (extra) have.add(norm(extra.name));
    const seen = new Set();
    trials.filter(t => t.player === me && statusOf(t) === "ok" && t.result).forEach(t => {
      const names = [...new Set((t.ingredients || []).map(i => i.name))], key = setKey(t.ingredients || []); if (!names.length || seen.has(key)) return; seen.add(key);
      const missing = names.filter(n => !have.has(n));
      out.push({ name: t.result, missing, usesExtra: !!extra && names.includes(norm(extra.name)), total: names.length });
    });
    return out;
  }
  done.forEach(r => {
    const rec = RECS.find(x => norm(x.name) === norm(r)); if (!rec || !(rec.ingredients || []).length) return;
    const slots = rec.ingredients.map(id => ({ id, s: resolveSlot(id) })), owner = new Array(units.length).fill(-1);
    const tryS = (k, seen) => { for (let j = 0; j < units.length; j++) if (!seen[j] && slotFits(slots[k].s, units[j])) { seen[j] = true; if (owner[j] < 0 || tryS(owner[j], seen)) { owner[j] = k; return true; } } return false; };
    slots.forEach((_, k) => tryS(k, []));
    const got = new Set(owner.filter(x => x >= 0)), missing = slots.filter((_, k) => !got.has(k)).map(x => slotRaw(x.id));
    const usesExtra = !!extra && owner[units.length - 1] >= 0;
    out.push({ name: rec.name, missing, usesExtra, total: slots.length });
  });
  return out;
}
const srRecLine = (r, full) => `<div class="mjfx"><b>${esc(cap(r.name))}</b>${full ? "" : ` <span class="muted">· il manque : ${r.missing.map(m => esc(cap(m))).join(", ")}</span>`}</div>`;
function srCraftHtml(extra) {
  const all = srCraft(extra), ok = all.filter(r => !r.missing.length), part = all.filter(r => r.missing.length && r.missing.length < r.total).sort((a, b) => a.missing.length - b.missing.length);
  let h = "";
  if (extra) {
    const now = ok.filter(r => r.usesExtra);
    h += `<h3 style="margin-top:16px">Recettes possibles avec ${esc(cap(extra.name))}</h3>` + (now.length ? now.map(r => srRecLine(r, true)).join("") : `<p class="muted">Aucune recette connue ne devient réalisable avec cet ingrédient.</p>`);
  } else {
    h += `<h3 style="margin-top:16px">Réalisables avec ton stock</h3>` + (ok.length ? ok.map(r => srRecLine(r, true)).join("") : `<p class="muted">Aucune recette connue n'est réalisable pour l'instant.</p>`);
  }
  const part2 = extra ? part.filter(r => !r.usesExtra || true) : part;
  h += `<h3 style="margin-top:16px">Presque réalisables${extra ? " (avec ce que tu as + cet ingrédient)" : ""}</h3>` + (part2.length ? part2.slice(0, 15).map(r => srRecLine(r, false)).join("") : `<p class="muted">Rien à proposer.</p>`);
  return h;
}
function renderSearch() {
  const root = $("sr-root"); if (!root) return;
  const envs = srEnvs(), me = player();
  if (SR.env && !envs.some(e => e.id === SR.env)) SR.env = "";
  const sel = (id, opts, val, ph) => `<select id="${id}">${ph ? `<option value="">${ph}</option>` : ""}${opts.map(o => `<option value="${esc(o[0])}"${o[0] === val ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`;
  let h = `<div class="subtabs">${[["gen", "Recherche générale"], ["rec", "Par recette"], ["ing", "Par ingrédient"], ["mine", "Mes recettes"]].map(m => `<button type="button" class="subtab${SR.mode === m[0] ? " active" : ""}" data-srmode="${m[0]}">${m[1]}</button>`).join("")}</div>
    <div class="row" style="gap:12px;flex-wrap:wrap;align-items:end">
      <label>Environnement ${sel("sr-env", envs.map(e => [e.id, e.name]), SR.env, "— choisir —")}</label>
      <label>Rang ${sel("sr-rank", SR_RANKS.map(r => [r[0], `${r[0]} (+${r[1]})`]), srRank())}</label></div>`;
  if (SR.mode === "mine") { h = h.replace(/<div class="row"[\s\S]*$/, ""); h += me ? srCraftHtml(null) : `<p class="muted">Choisis d'abord ton personnage.</p>`; root.innerHTML = h; return; }
  if (!envs.length) h += `<p class="muted">Le grimoire n'a pas encore d'environnements.</p>`;
  else if (!SR.env) h += `<p class="muted">Choisis l'environnement dans lequel tu cherches.</p>`;
  else if (SR.mode === "gen") {
    const d20 = parseInt(SR.d20, 10), ok = d20 >= 1 && d20 <= 20, tot = ok ? d20 + srBonus() : null, q = ok ? srRarity(tot) : null;
    h += `<div class="row" style="gap:12px;flex-wrap:wrap;align-items:end;margin-top:10px"><label>Ton jet de d20 <input id="sr-d20" type="number" min="1" max="20" value="${esc(SR.d20)}" style="width:90px"></label></div>`;
    if (ok) {
      h += `<p>Total <b>${tot}</b> (${d20}${srBonus() ? ` + ${srBonus()}` : ""}) : `;
      if (!q) h += `<b>rien</b> n'est trouvé.</p>`;
      else {
        const pool = srPool(SR.env, q), n = pool.length;
        h += `rareté <b>${q}</b>.</p>`;
        if (!n) h += `<p class="muted">Aucun ingrédient ${q} n'existe dans cet environnement : rien trouvé.</p>`;
        else {
          h += `<p>Lance ton <b>dé de recherche d${n}</b> :</p><label>Résultat <input id="sr-die" type="number" min="1" max="${n}" value="${esc(SR.die)}" style="width:90px"></label>`;
          const die = parseInt(SR.die, 10);
          if (die >= 1 && die <= n) { const it = pool[die - 1], qt = srQty(die);
            h += `<div class="card" style="margin-top:12px;padding:12px"><div class="muted">Tu as trouvé</div><div style="font-size:1.3rem"><b>${esc(cap(it.name))}</b> × ${qt}</div>
              <div class="muted">${esc(it.q)}${it.desc ? " · " + esc(it.desc) : ""}</div>
              <button type="button" class="btn" id="sr-add" style="margin-top:8px">Ajouter à mon inventaire</button></div>` + (me ? srCraftHtml(it) : "");
          } else if (SR.die !== "") h += `<p class="muted">Le dé doit être entre 1 et ${n}.</p>`;
        }
      }
    } else h += `<p class="muted">Entre ton jet de d20 (1 à 20).</p>`;
  } else if (!me) h += `<p class="muted">Choisis d'abord ton personnage.</p>`;
  else if (SR.mode === "rec") {
    const done = [...new Set(trials.filter(t => t.player === me && statusOf(t) === "ok" && t.result).map(t => t.result))].filter(r => RECS.some(x => norm(x.name) === norm(r))).sort((a, b) => a.localeCompare(b, "fr"));
    h += `<div style="margin-top:10px"><label>Recette ${sel("sr-rec", done.map(r => [r, cap(r)]), SR.rec, "— choisir —")}</label></div>`;
    const rec = SR.rec && RECS.find(x => norm(x.name) === norm(SR.rec));
    if (!done.length) h += `<p class="muted">Tu ne connais encore aucune recette réussie (ou elles n'ont pas de fiche dans la bibliothèque).</p>`;
    else if (rec) { const r = srSlotLines(rec);
      h += `<div style="margin-top:10px">${r.lines.join("")}</div>` + (r.blocked ? `<p class="muted">Tu ne peux pas réunir tous les ingrédients ici.</p>` : `<p style="margin-top:10px">Pour viser le plus rare, il te faut au minimum <b>${r.worst || "—"}</b> au d20.</p>`); }
  } else {
    const known = [...new Map(srKnown().map(c => [c.id, c])).values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    h += `<div style="margin-top:10px"><label>Ingrédient ${sel("sr-ing", known.map(c => [c.id, cap(c.name)]), SR.ing, "— choisir —")}</label></div>`;
    const it = known.find(c => c.id === SR.ing);
    if (!known.length) h += `<p class="muted">Aucun ingrédient connu dans ton inventaire.</p>`;
    else if (it) h += `<p style="margin-top:10px">${srNeedTxt(it, srNeed(it))}</p>`;
  }
  root.innerHTML = h;
}
const srVisible = () => $("view-recherche") && !$("view-recherche").classList.contains("hidden");
const srRefresh = () => { qkRefresh(); if (srVisible() && !(document.activeElement && document.activeElement.type === "number")) renderSearch(); };
rawStore.subscribe("alch_fiches", d => { FICHES = d; srRefresh(); });
if ($("sr-root")) {
  $("sr-root").addEventListener("click", e => {
    const m = e.target.closest("[data-srmode]"); if (m) { SR.mode = m.dataset.srmode; renderSearch(); return; }
    if (e.target.id === "sr-add") {
      const me = player(); if (!me) { toast("Choisis d'abord ton personnage."); $("player").focus(); return; }
      const pool = srPool(SR.env, srRarity(parseInt(SR.d20, 10) + srBonus())), die = parseInt(SR.die, 10), it = pool[die - 1]; if (!it) return;
      const name = norm(it.name), id = invId(me, name), ex = inventory.find(i => i.id === id), qt = srQty(die);
      store.set("inventaire", id, { player: me, name, qty: (ex ? ex.qty : 0) + qt, cats: (ex && ex.cats) || [] });
      toast(`${cap(it.name)} × ${qt} ajouté à ton inventaire`);
    }
  });
  $("sr-root").addEventListener("change", e => {
    const t = e.target;
    if (t.id === "sr-env") { SR.env = t.value; SR.die = ""; }
    else if (t.id === "sr-rank") { SR.rank = t.value; localStorage.setItem("tisane_rank", t.value); SR.die = ""; if (player()) rawStore.set("alch_fiches", ficheId(), { player: player(), rank: t.value }); }
    else if (t.id === "sr-rec") SR.rec = t.value;
    else if (t.id === "sr-ing") SR.ing = t.value;
    else return;
    renderSearch();
  });
  $("sr-root").addEventListener("input", e => {
    const t = e.target;
    if (t.id === "sr-d20") { SR.d20 = t.value; SR.die = ""; } else if (t.id === "sr-die") SR.die = t.value; else return;
    const id = t.id, pos = t.selectionStart; renderSearch(); const n = $(id); if (n) { n.focus(); }
  });
}

/* ============================================================
   6b. Récolte : le parcours express des débutants.
   Deux gestes : « je pars cueillir » (3 récoltes au hasard, puis les recettes qu'elles rendent possibles)
   et « je veux préparer une recette » (un jet de d20 par ingrédient manquant, puis le verdict).
   Mêmes règles que l'onglet Recherche (rareté selon le d20 + bonus de rang) ; les dés sont lancés par l'appli.
   ============================================================ */
var qkOn = false;
const QK = { mode: "cueillir", env: localStorage.getItem("tisane_env") || "", finds: null, added: false, rec: "", rolls: null, fresh: false };
SR.env = QK.env;
const qkD = n => 1 + Math.floor(Math.random() * n);
const qkClean = s => String(s || "").replace(/\*\*/g, "");
const qkS = n => n > 1 ? "s" : "";

function qkRollGather() {
  const out = [];
  for (let k = 0; k < 3; k++) {
    const d20 = qkD(20), tot = d20 + srBonus(), q = srRarity(tot), pool = q ? srPool(QK.env, q) : [];
    if (!pool.length) { out.push({ d20, none: true }); continue; }
    const die = qkD(pool.length), it = pool[die - 1];
    out.push({ d20, q, it, qt: srQty(die) });
  }
  QK.finds = out; QK.added = false; QK.fresh = true;
}
const qkFound = () => (QK.finds || []).filter(f => !f.none);

/* Le sac du PJ sous forme d'unités (comme le fait Recherche), plus d'éventuelles trouvailles pas encore rangées */
function qkUnits(extras) {
  const me = player(), u = [];
  inventory.filter(i => i.player === me && i.qty > 0).forEach(i => { const c = alchItem(i.name); if (c) for (let k = 0; k < Math.min(i.qty, 6); k++) u.push({ it: c, from: "stock" }); });
  if (ALCH) tisanes.filter(x => x.player === me && x.qty > 0 && x.result).forEach(x => {
    const c = { id: "r_" + metaId(x.result), prod: true, name: x.result, key: stripKey(x.result), clas: [], q: "" };
    for (let k = 0; k < Math.min(x.qty, 6); k++) u.push({ it: c, from: "stock" });
  });
  (extras || []).forEach(f => { for (let k = 0; k < Math.min(f.qt, 6); k++) u.push({ it: f.it, from: "find" }); });
  return u;
}
function qkMatch(slots, units) {   // chaque emplacement de la recette reçoit au plus une unité (couplage maximal)
  const owner = new Array(units.length).fill(-1);
  const go = (k, seen) => { for (let j = 0; j < units.length; j++) if (!seen[j] && slotFits(slots[k], units[j].it)) { seen[j] = true; if (owner[j] < 0 || go(owner[j], seen)) { owner[j] = k; return true; } } return false; };
  slots.forEach((_, k) => go(k, []));
  const su = new Array(slots.length).fill(-1);
  owner.forEach((k, j) => { if (k >= 0) su[k] = j; });
  return su;
}

/* Recettes proposées : celles que le PJ a réussies (ou ajoutées au Grimoire), puis, pour l'alchimie, celles de l'apothicaire accessibles à son rang.
   Les ingrédients viennent de la bibliothèque du MJ ; le fichier recettes-apothicaire.js ne sert qu'à choisir les recettes et à donner outils, DD, durée et valeur. */
const APO = window.APO || [];
const qkApoOf = name => APO.find(a => norm(a.n) === norm(name)) || null;
function qkRecipes() {
  const me = player(); if (!me) return [];
  const seen = new Map(), favOf = name => trials.some(x => norm(x.result || "") === norm(name) && (x.favs || []).includes(me));
  trials.filter(t => t.player === me && statusOf(t) === "ok" && t.result).forEach(t => {
    const key = ALCH ? norm(t.result) : recipeKey(t.ingredients || [], t.result);
    if (seen.has(key)) return;
    let ids = null;
    if (ALCH) { const rec = RECS.find(x => norm(x.name) === norm(t.result)); if (rec && (rec.ingredients || []).length) ids = rec.ingredients; }
    else { const its = [...new Set((t.ingredients || []).map(i => i.name))].map(n => catalogItem(n)); if (its.length && its.every(Boolean)) ids = its.map(c => c.id); }
    if (!ids) return;
    seen.set(key, { key, name: t.result, ids, slots: ids.map(resolveSlot), fav: favOf(t.result), apo: ALCH ? qkApoOf(t.result) : null });
  });
  if (ALCH) {
    const idx = Math.max(0, SR_RANKS.findIndex(x => x[0] === srRank()));
    APO.filter(a => !a.f && a.r <= idx).forEach(a => {
      const key = norm(a.n); if (seen.has(key)) return;
      const rec = RECS.find(x => norm(x.name) === key);
      const ids = rec && (rec.ingredients || []).length ? rec.ingredients : a.i.map(([c, sp]) => sp ? c + " - " + sp : c);
      seen.set(key, { key, name: a.n, ids, slots: ids.map(resolveSlot), fav: favOf(a.n), apo: a });
    });
  }
  return [...seen.values()].sort((a, b) => (b.fav - a.fav) || ((a.apo ? a.apo.r : 0) - (b.apo ? b.apo.r : 0)) || a.name.localeCompare(b.name, "fr"));
}
function qkLabel(rec, k) {
  const s = rec.slots[k];
  if (s.t === "ing") { const c = CATALOG.find(x => x.id === s.id); if (c) return cap(c.name); }
  return cap(slotRaw(rec.ids[k]));
}
const QK_STAT = { Int: "Intelligence", Sag: "Sagesse", Dex: "Dextérité", For: "Force", Con: "Constitution", Cha: "Charisme" };
const qkHours = h => h >= 16 ? `${h} h (≈ ${Math.ceil(h / 8)} jours à 8 h)` : `${h} h`;
function qkMod(it) { const m = /modificateur du DD de fabrication\s*([−+-]?\s*\d+)/.exec(it.desc || ""); return m ? parseInt(m[1].replace("−", "-").replace(/\s/g, ""), 10) : 0; }
function qkInfo(rec, r, complete) {
  const a = rec.apo; if (!a) return "";
  const sum = complete ? r.su.map(j => r.units[j].it).filter(it => !it.prod && !it.lit).reduce((t, it) => t + qkMod(it), 0) : 0, dd = a.dd + sum;
  const note = !complete ? ` <span class="muted">(de base ; selon la qualité des ingrédients)</span>` : sum ? ` <span class="muted">(base ${a.dd}, ${sum > 0 ? "+" : "−"}${Math.abs(sum)} selon tes ingrédients)</span>` : "";
  return `<div class="qk-info">⚗️ ${esc(cap(a.o))} · test de ${esc(QK_STAT[a.s] || a.s)} <b>DD ${dd}</b>${note} · ${qkHours(a.h)} · valeur ${esc(a.v)}</div>`;
}
function qkReady(rec, extras) {
  const units = qkUnits(extras), su = qkMatch(rec.slots, units);
  return { units, su, missing: rec.slots.map((_, k) => k).filter(k => su[k] < 0), usesFind: su.some(j => j >= 0 && units[j].from === "find") };
}

/* Que peut-on chercher pour un emplacement manquant, ici, avec ce rang ? */
function qkTarget(slot) {
  if (slot.t === "prod" || slot.t === "lit") return { kind: "craft" };
  const cands = CATALOG.filter(c => slotFits(slot, c));
  if (!cands.length) return { kind: "unknown" };
  const here = cands.filter(c => c.envs.includes(QK.env) && SR_MIN[c.q]);
  if (!here.length) return { kind: "elsewhere" };
  const th = Math.min(...here.map(c => SR_MIN[c.q])), pool = here.filter(c => SR_MIN[c.q] === th), d = Math.max(1, th - srBonus());
  return { kind: "roll", pool, it: pool[0], th, d, ok: d <= 20 };
}
const qkRollable = (rec, k) => { const t = qkTarget(rec.slots[k]); return t.kind === "roll" && t.ok ? t : null; };
function qkRollRecipe(rec) {
  const rolls = {};
  qkReady(rec, qkPending()).missing.forEach(k => { const t = qkRollable(rec, k); if (!t) return; const d20 = qkD(20); rolls[k] = { d20, t, found: d20 + srBonus() >= t.th, it: t.pool[qkD(t.pool.length) - 1] }; });
  QK.rolls = rolls; QK.fresh = true;
}
const qkPending = () => QK.added ? [] : qkFound();
const qkRollExtras = () => Object.values(QK.rolls || {}).filter(r => r.found).map(r => ({ it: r.it, qt: 1 }));

function qkBag(list) {   // range des trouvailles dans l'inventaire (cumul si le même ingrédient sort deux fois)
  const me = player(); if (!me) { toast("Choisis d'abord ton personnage."); $("player").focus(); return false; }
  const sum = new Map(); list.forEach(f => { const n = norm(f.it.name); sum.set(n, (sum.get(n) || 0) + f.qt); });
  sum.forEach((qt, name) => { const id = invId(me, name), ex = inventory.find(i => i.id === id); store.set("inventaire", id, { player: me, name, qty: (ex ? ex.qty : 0) + qt, cats: (ex && ex.cats) || [] }); });
  return true;
}
function qkPrep(rec) {   // range ce qui a été trouvé, puis remplit le laboratoire avec les ingrédients de la recette
  const extras = [...qkPending(), ...qkRollExtras()], r = qkReady(rec, extras);
  if (r.missing.length) return;
  if (extras.length) { if (!qkBag(extras)) return; QK.added = true; QK.rolls = null; }
  const names = new Map(); r.su.forEach(j => { const n = r.units[j].it.name; names.set(n, (names.get(n) || 0) + 1); });
  resetLabRows([...names].map(([name, qty]) => ({ name, qty })));
  showTab("recette"); goLab(); toast(`Laboratoire prêt pour « ${rec.name} »`);
}

/* ---------- Affichage ---------- */
const qkDie = (d, bonus) => `<span class="qk-die" title="d20">🎲 ${d}${bonus ? `<small> +${bonus}</small>` : ""}</span>`;
function qkFindCard(f, i, fresh) {
  const style = fresh ? ` style="animation-delay:${i * 0.15}s"` : "";
  if (f.none) return `<div class="qk-card none${fresh ? " pop" : ""}"${style}>${qkDie(f.d20, srBonus())}<div class="qk-name">🍂 Rien cette fois</div><div class="muted">Les environs restent muets.</div></div>`;
  return `<div class="qk-card${fresh ? " pop" : ""}"${style}>${qkDie(f.d20, srBonus())}<div class="qk-name">${esc(cap(f.it.name))} <span class="qk-x">×${f.qt}</span></div>
    <div class="qk-q">${esc(f.q)}</div>${f.it.desc ? `<div class="muted qk-desc">${esc(qkClean(f.it.desc))}</div>` : ""}</div>`;
}
function qkRecLine(r, extra) { return `<div class="qk-rec"><span><b>${esc(cap(r.name))}</b>${extra || ""}</span><button type="button" class="btn ghost small" data-qk-open="${esc(r.key)}">Voir</button></div>`; }
function qkGatherOut() {
  const me = player(); if (!me) return "";
  const recs = qkRecipes();
  if (!recs.length) return `<p class="muted qk-hint">Tu ne connais pas encore de recette. Au laboratoire (à droite), mélange des ingrédients pour en découvrir : elles apparaîtront ici.</p>`;
  const extras = QK.added ? [] : qkFound(), now = [], before = [], almost = [];
  recs.forEach(r => { const a = qkReady(r, extras), b = qkReady(r, []); if (!a.missing.length) (b.missing.length ? now : before).push(r); else if (a.missing.length === 1) almost.push({ r, k: a.missing[0] }); });
  let h = `<h3>Tu peux concocter</h3>`;
  if (QK.added) h += before.length ? before.map(r => qkRecLine(r)).join("") : `<p class="muted">Rien pour l'instant avec ton sac.</p>`;
  else {
    h += now.map(r => qkRecLine(r, ` <span class="qk-new">✨ grâce à ta récolte</span>`)).join("") + before.map(r => qkRecLine(r)).join("");
    if (!now.length && !before.length) h += `<p class="muted">Aucune recette complète pour l'instant.</p>`;
  }
  if (almost.length) h += `<h3 style="margin-top:14px">Il ne manque presque rien</h3>` + almost.slice(0, 5).map(a => qkRecLine(a.r, ` <span class="muted">· il manque : ${esc(qkLabel(a.r, a.k))}</span>`)).join("");
  return h;
}
function qkSlotRow(rec, k, r, fresh) {
  const label = esc(qkLabel(rec, k)), rl = (QK.rolls || {})[k], j = r.su[k];
  if (j >= 0) {
    const u = r.units[j];
    return `<div class="qk-slot ok"><span class="qk-st">${u.from === "find" ? "✨" : "✅"}</span><span><b>${label}</b> <span class="muted">${u.from === "find" ? `trouvé : ${esc(cap(u.it.name))}` : u.it.name && norm(u.it.name) !== norm(label) ? `dans ton sac : ${esc(cap(u.it.name))}` : "dans ton sac"}</span></span>${rl ? qkDie(rl.d20, srBonus()) : ""}</div>`;
  }
  if (rl) return `<div class="qk-slot ko"><span class="qk-st">❌</span><span><b>${label}</b> <span class="muted">pas trouvé (il fallait ${rl.t.d} au d20)</span></span>${qkDie(rl.d20, srBonus())}</div>`;
  const t = qkTarget(rec.slots[k]);
  const why = t.kind === "roll" ? (t.ok ? `à chercher ici : ${t.d} minimum au d20` : "trop rare pour ton rang")
    : t.kind === "elsewhere" ? "introuvable dans cet endroit"
    : t.kind === "unknown" ? "aucun ingrédient de ce type dans le grimoire"
    : "à préparer ou à te procurer (pas de dé)";
  const sub = rec.slots[k].t === "prod" ? qkRecipes().find(x => stripKey(x.name) === rec.slots[k].key) : null;
  return `<div class="qk-slot"><span class="qk-st">${t.kind === "roll" && t.ok ? "🎲" : "➖"}</span><span><b>${label}</b> <span class="muted">${sub ? "une potion à préparer d'abord (pas de dé)" : why}</span></span>${sub ? `<button type="button" class="btn ghost small" style="margin-left:auto" data-qk-open="${esc(sub.key)}">Voir la recette</button>` : ""}</div>`;
}
function qkRecipeOut(fresh) {
  const me = player(), recs = qkRecipes();
  if (!me) return "";
  if (!recs.length) return `<p class="muted qk-hint">Tu ne connais pas encore de recette. Au laboratoire (à droite), mélange des ingrédients pour en découvrir : elles apparaîtront ici.</p>`;
  const sel = (id, opts, val, ph) => `<select id="${id}"><option value="">${ph}</option>${opts.map(o => `<option value="${esc(o[0])}"${o[0] === val ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`;
  let h = `<div class="qk-step"><span class="qk-n">3</span> Quelle recette ?</div>` + (recs.length > 10
    ? sel("qk-rec", recs.map(r => [r.key, (r.fav ? "★ " : "") + cap(r.name) + (r.apo ? " · " + SR_RANKS[r.apo.r][0] : "")]), QK.rec, "— choisir —")
    : `<div class="fchips qk-recs">${recs.map(r => `<button type="button" class="fchip qk-pill${QK.rec === r.key ? " on" : ""}" data-qk-rec="${esc(r.key)}">${r.fav ? "★ " : ""}${esc(cap(r.name))}</button>`).join("")}</div>`);
  const rec = recs.find(r => r.key === QK.rec); if (!rec) return h;
  const pend = qkPending(), extras = [...pend, ...qkRollExtras()], r = qkReady(rec, extras), plain = qkReady(rec, pend);
  const nRoll = plain.missing.filter(k => qkRollable(rec, k)).length, rolled = !!QK.rolls;
  h += `<h3 style="margin-top:14px">« ${esc(cap(rec.name))} » demande ${rec.slots.length} ingrédient${qkS(rec.slots.length)}</h3><div class="qk-slots${fresh ? " fresh" : ""}">${rec.slots.map((_, k) => qkSlotRow(rec, k, r, fresh)).join("")}</div>${qkInfo(rec, r, !r.missing.length)}`;
  if (!plain.missing.length) h += `<div class="qk-verdict good">🎉 Tu as déjà tout pour la préparer !</div><button type="button" class="btn qk-go" data-qk="prep">⚗️ Préparer au laboratoire</button>`;
  else {
    if (!rolled && nRoll) h += `<button type="button" class="btn qk-go" data-qk="rollrec">🎲 Lancer ${nRoll} dé${qkS(nRoll)} pour ce qui manque</button>`;
    if (!rolled && !nRoll) h += `<div class="qk-verdict bad">😕 ${plain.missing.every(k => rec.slots[k].t === "prod") ? "Il te faut d'abord préparer la potion indiquée ci-dessus." : "Rien de ce qui manque ne peut se chercher ici. Essaie un autre endroit."}</div>`;
    if (rolled) {
      if (!r.missing.length) h += `<div class="qk-verdict good">🎉 Bravo, tu as de quoi la préparer !</div><button type="button" class="btn qk-go" data-qk="prep">🎒 Ranger mes trouvailles et préparer</button>`;
      else h += `<div class="qk-verdict bad">😕 Il te manque encore : ${r.missing.map(k => esc(qkLabel(rec, k))).join(", ")}.</div>`;
      const extra = extras.length && r.missing.length;
      h += `<div class="row" style="margin-top:8px">${extra ? `<button type="button" class="btn" data-qk="bagrec">🎒 Ranger ce que j'ai trouvé</button>` : ""}<button type="button" class="btn ghost" data-qk="rollrec">Recommencer les dés</button></div>`;
    }
  }
  return h;
}
function renderQuick() {
  const root = $("qk-root"); if (!root) return;
  const envs = srEnvs(), me = player(), fresh = QK.fresh; QK.fresh = false;
  if (QK.env && !envs.some(e => e.id === QK.env)) QK.env = "";
  SR.env = QK.env;
  let h = `<h2>Que veux-tu faire aujourd'hui ?</h2>`;
  if (!me) h += `<div class="qk-note">👤 Commence par choisir ton personnage. <button type="button" class="btn small" data-qk="name">Choisir mon personnage</button></div>`;
  h += `<div class="qk-step"><span class="qk-n">1</span> Où es-tu ?<label class="qk-rank">Rang <select id="qk-rank">${SR_RANKS.map(r => `<option value="${esc(r[0])}"${r[0] === srRank() ? " selected" : ""}>${esc(r[0])} (+${r[1]})</option>`).join("")}</select></label></div>`;
  h += envs.length ? `<div class="fchips qk-envs">${envs.map(e => `<button type="button" class="fchip qk-pill${QK.env === e.id ? " on" : ""}" data-qk-env="${esc(e.id)}"><span class="dot" style="background:${esc(e.color)}"></span>${esc(e.name)}</button>`).join("")}</div>`
    : `<p class="muted">Le grimoire n'a pas encore d'environnements : le MJ doit en créer.</p>`;
  h += `<div class="qk-step"><span class="qk-n">2</span> Que fais-tu ?</div><div class="qk-modes">
    <button type="button" class="qk-mode${QK.mode === "cueillir" ? " on" : ""}" data-qk-mode="cueillir"><span class="qk-ico">🧺</span><b>Je pars cueillir</b><small>Je tente ma chance et je vois ce que je trouve</small></button>
    <button type="button" class="qk-mode${QK.mode === "recette" ? " on" : ""}" data-qk-mode="recette"><span class="qk-ico">📜</span><b>Je prépare une recette</b><small>Je choisis, puis je cherche ce qui me manque</small></button></div>`;
  if (!QK.env) h += `<p class="muted qk-hint">👆 Choisis d'abord l'endroit où tu te trouves.</p>`;
  else if (!CATALOG.some(c => c.envs.includes(QK.env))) h += `<p class="muted qk-hint">Aucun ingrédient n'est encore associé à cet endroit : le MJ doit les renseigner (onglet MJ, bibliothèque des ingrédients).</p>`;
  else if (QK.mode === "cueillir") {
    if (!QK.finds) h += `<button type="button" class="btn qk-go" data-qk="roll">🎲 Partir cueillir (3 récoltes)</button>`;
    else {
      h += `<h3 style="margin-top:6px">Ta récolte</h3><div class="qk-finds">${QK.finds.map((f, i) => qkFindCard(f, i, fresh)).join("")}</div><div class="row" style="margin-top:10px">`;
      if (qkFound().length) h += QK.added ? `<span class="qk-okline">✓ Rangé dans ton sac</span>` : `<button type="button" class="btn qk-go" data-qk="bag">🎒 Tout ranger dans mon sac</button>`;
      h += `<button type="button" class="btn ghost" data-qk="roll">Cueillir à nouveau</button></div><div style="margin-top:16px">${qkGatherOut()}</div>`;
    }
  } else h += qkRecipeOut(fresh);
  h += `<p class="qk-foot muted">Pour lancer tes propres dés ou explorer plus loin, va dans l'onglet Recherche.</p>`;
  root.innerHTML = h;
}
function qkRefresh() { if (!qkOn) return; const v = $("view-accueil"); if (v && !v.classList.contains("hidden")) renderQuick(); }
if ($("qk-root")) {
  $("qk-root").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset;
    if (d.qkEnv !== undefined) { QK.env = d.qkEnv; try { localStorage.setItem("tisane_env", QK.env); } catch (x) { /* ignoré */ } QK.finds = null; QK.rolls = null; QK.added = false; }
    else if (d.qkMode) { QK.mode = d.qkMode; }
    else if (d.qkRec !== undefined) { QK.rec = d.qkRec; QK.rolls = null; }
    else if (d.qkOpen !== undefined) { QK.mode = "recette"; QK.rec = d.qkOpen; QK.rolls = null; }
    else if (d.qk === "name") { $("player").focus(); return; }
    else if (d.qk === "roll") qkRollGather();
    else if (d.qk === "bag") { if (!qkBag(qkFound())) return; QK.added = true; toast("Trouvailles rangées dans ton sac"); }
    else if (d.qk === "rollrec") { const rec = qkRecipes().find(r => r.key === QK.rec); if (rec) qkRollRecipe(rec); }
    else if (d.qk === "bagrec") { if (!qkBag([...qkPending(), ...qkRollExtras()])) return; QK.added = true; toast("Trouvailles rangées dans ton sac"); QK.rolls = null; }
    else if (d.qk === "prep") { const rec = qkRecipes().find(r => r.key === QK.rec); if (rec) qkPrep(rec); return; }
    else return;
    renderQuick();
  });
  $("qk-root").addEventListener("change", e => {
    const t = e.target;
    if (t.id === "qk-rec") { QK.rec = t.value; QK.rolls = null; }
    else if (t.id === "qk-rank") { SR.rank = t.value; try { localStorage.setItem("tisane_rank", t.value); } catch (x) { /* ignoré */ } if (player()) rawStore.set("alch_fiches", ficheId(), { player: player(), rank: t.value }); QK.finds = null; QK.rolls = null; }
    else return;
    renderQuick();
  });
}
qkOn = true;

/* ============================================================
   7. Démarrage
   ============================================================ */
/* Nettoyage unique : la catégorie « Épique » créée d'office par une version précédente est retirée (Épique n'est plus qu'un nom de qualité : « Élevée »).
   Seule la catégorie intacte (même nom, même couleur) est supprimée ; une catégorie recréée ou modifiée à la main reste. */
let epicCleaned = false;
function cleanOldEpic() {
  if (epicCleaned || ALCH) return; epicCleaned = true;
  const c = categories.find(x => x.id === "epique");
  if (c && norm(c.name) === "épique" && String(c.color).toLowerCase() === OLD_EPIC_COLOR) store.del("categories", "epique");
}
$("lib-ing-q").addEventListener("input", () => { libView.ing = $("lib-ing-q").value; libView.ingN = LIB_PAGE; renderLib(); });
$("lib-pot-q").addEventListener("input", () => { libView.pot = $("lib-pot-q").value; libView.potN = LIB_PAGE; renderLib(); });
["lib-ing", "lib-pot"].forEach(id => $(id).addEventListener("click", e => {
  const b = e.target.closest("[data-more]"); if (!b) return;
  libView[b.dataset.more + "N"] += LIB_PAGE; renderLib();
}));
/* textes et éléments propres à chaque page */
$("rec-add").classList.toggle("hidden", !ALCH); $("lib-pot-q").classList.toggle("hidden", !ALCH);
$("lib-rec-add").classList.toggle("hidden", !ALCH);
$("qual-panel").classList.toggle("hidden", ALCH);   // le tableau de qualités (DD, valeurs) est une règle des tisanes
$("lib-anec-wrap").classList.toggle("hidden", ALCH);
["c", "d"].forEach(k => $("mj-" + k).classList.toggle("hidden", !ALCH));
if (!ALCH) fetch(GRIMOIRE_FILE, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).then(d => {
  if (!d || !Array.isArray(d.categories)) return;
  SHARED_CATS = d.categories.filter(c => c && c.id && c.name).map(c => ({ id: c.id, name: c.name, color: HEX.test(c.color) ? c.color : PALETTE[0], group: MANAGED.includes(c.group) ? c.group : "propriete" }));
  applyCats(); renderCategories(); renderInventory(); renderSocio(); renderMj(); renderLib(); qkRefresh();
}).catch(() => {});
if (ALCH) {
  document.querySelector("#lab .hint").textContent = "Propose des ingrédients : le MJ dit ce qu'ils donnent. Ou note toi-même un essai.";
  $("mj-file-title").textContent = "Fichier du grimoire d'alchimie";
  $("mj-file-help").textContent = "Tout ce que tu saisis pour l'alchimie (ingrédients, catégories, recettes) s'exporte dans " + GRIMOIRE_FILE + ". Remplace ce fichier dans ton dossier avant de redéployer : il devient le grimoire de départ du site. Tu peux aussi importer un fichier pour remplir la bibliothèque.";
  fetch(GRIMOIRE_FILE, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).then(d => { if (d) { fileToDefaults(d); rebuildLib(); renderMj(); renderInventory(); renderCategories(); qkRefresh(); } }).catch(() => {});
  $("lib-pot-help").textContent = "Une potion est une recette : un jeu d'ingrédients précis, ses effets, sa durée et un éventuel effet secondaire. Un mélange qui ne correspond à aucune recette ne donne rien.";
  $("mj-sim-help").textContent = "Ce que le laboratoire en mode automatique répondrait à un PJ pour ces ingrédients, sans rien enregistrer.";
  $("lib-ing-help").textContent = "La référence du MJ : description et catégories de chaque ingrédient. Les PJ voient la description, mais ni les catégories tant que tu ne les leur révèles pas, ni les effets des potions.";
}
resetLabRows(); syncLab(); applyMj();
store.subscribe("inventaire", d => { inventory = d; renderInventory(); renderSocio(); renderMj(); srRefresh(); });
store.subscribe("essais", d => { trials = d; qkRefresh(); renderRecipes(); renderSocio(); renderInventory(); });
store.subscribe("tisanes", d => { tisanes = d; renderTisanes(); });
store.subscribe("ingredients", d => { ingMeta = d; renderInventory(); renderCategories(); renderSocio(); renderRecipes(); renderTisanes(); renderMj(); });
store.subscribe("categories", d => { rawCats = d; applyCats(); qkRefresh(); renderCategories(); renderInventory(); renderSocio(); cleanOldEpic(); renderMj(); });
const onLib = () => { rebuildLib(); renderMj(); renderInventory(); srRefresh(); };
store.subscribe("grimoire_ingredients", d => { libIng = d; onLib(); });
store.subscribe("grimoire_potions", d => { libPot = d; onLib(); });
store.subscribe("grimoire_anecdotes", d => { libAnec = d; onLib(); });
renderQualTable(); renderInventory(); renderRecipes(); renderTisanes(); renderCategories();
showTab("accueil");