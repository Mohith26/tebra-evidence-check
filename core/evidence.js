// Evidence Check: verify each sentence of an AI-generated note against the visit transcript
// and the patient's chart before the provider signs.
//   1. Normalize text (lowercase, spoken numbers -> digits, clinical synonyms -> concept ids).
//   2. Extract typed facts: concepts with polarity (NegEx-style scope) and laterality,
//      medications with dose/frequency/duration, durations, follow-up interval, vitals,
//      allergy statements. In the transcript, a "no"/"yes" answer inherits the concepts
//      of the question it answers.
//   3. Compare each note fact with transcript facts (and the chart): supported,
//      contradicted (with the transcript value as a suggested fix) or unsupported.
//   4. BM25 picks the best transcript turn to show as evidence.
//   5. A logistic model turns sentence findings into a risk score; the flag threshold is
//      set by conformal risk control so the expected share of missed errors per note stays
//      under a target (Angelopoulos et al., 2022).
import { CONCEPTS, MEDS, MED_CLASS, ALLERGY_CLASS, SIDED, NUM_WORDS, FREQ, NEG_PRE, NEG_TERM, NO_ANSWER, YES_ANSWER } from './lexicon.js';

const DIAGNOSES = new Set(['hypertension', 'diabetes', 'sinusitis', 'uti', 'bronchitis', 'sprain', 'osteoarthritis', 'anxiety', 'hyperlipidemia', 'radiculopathy', 'cystitis']);
const NOT_VERIFIABLE = new Set(['alert_oriented']); // general appearance is documented without being said aloud

function phraseList(dict) {
  const out = [];
  for (const [id, ps] of Object.entries(dict)) for (const p of ps) out.push([p, id]);
  return out.sort((a, b) => b[0].length - a[0].length);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compile = (list) => list.map(([p, id]) => [p, id, new RegExp(`(?<![a-z])${esc(p)}(?![a-z])`, 'g')]);
const CONCEPT_PHRASES = compile(phraseList(CONCEPTS));
const MED_PHRASES = compile(phraseList(MEDS));
const NEG_RES = NEG_PRE.map((n) => new RegExp(`(?<![a-z'])${esc(n)}(?![a-z'])`, 'g'));
const TERM_RES = NEG_TERM.map((n) => new RegExp(`(?<![a-z])${esc(n)}(?![a-z])`, 'g'));

// ---------- normalization ----------
export function spokenToDigits(text) {
  const toks = text.split(/(\s+|[,.;:!?()])/);
  const out = [];
  let acc = null, cur = 0;
  const flush = () => { if (acc !== null) { out.push(String(acc + cur)); acc = null; cur = 0; } };
  for (let i = 0; i < toks.length; i++) {
    const raw = toks[i], w = raw.toLowerCase();
    if (w === 'a' || w === 'an' || w === 'couple' || w === 'few') {
      // "about a week", "for a couple of days" -> numbers, but never "twice a day"
      const rest = toks.slice(i + 1).join('').trim().toLowerCase();
      const prev = toks.slice(0, i).join('').trim().toLowerCase().split(/\s+/).pop() || '';
      const durCtx = ['for', 'about', 'around', 'maybe', 'past', 'last', 'in', 'since', 'nearly', 'almost', 'than', 'over', 'roughly', 'a', 'of', 'just'].includes(prev) || prev === '';
      if ((durCtx && /^(of )?(day|week|month)s?\b/.test(rest)) || /^(day|week|month)s? ago\b/.test(rest)) { flush(); out.push(String(NUM_WORDS[w])); continue; }
      flush(); out.push(raw); continue;
    }
    if (w in NUM_WORDS && !['a', 'an'].includes(w)) {
      const v = NUM_WORDS[w];
      if (acc === null) { acc = 0; cur = 0; }
      if (v === 100) { cur = (cur || 1) * 100; } else if (v === 1000) { acc += (cur || 1) * 1000; cur = 0; } else cur += v;
      continue;
    }
    if (w === 'thousand' && acc !== null) { acc += (cur || 1) * 1000; cur = 0; continue; }
    if (acc !== null && /^\s+$/.test(raw)) { const nxt = (toks[i + 1] || '').toLowerCase(); if (nxt in NUM_WORDS || nxt === 'thousand' || nxt === 'point') continue; }
    if (w === 'point' && acc !== null) { const nx = (toks[i + 2] || '').toLowerCase(); if (nx in NUM_WORDS) { const v = acc + cur; acc = null; cur = 0; out.push(`${v}.${NUM_WORDS[nx]}`); i += 2; continue; } }
    flush();
    out.push(raw);
  }
  flush();
  return out.join('');
}

export function norm(text) {
  return ' ' + spokenToDigits(text).toLowerCase().replace(/[“”"]/g, '').replace(/(\d)-(day|week|month|year)/g, '$1 $2').replace(/\s+/g, ' ') + ' ';
}

// ---------- fact extraction ----------
function findAll(t, phrases) {
  const hits = [];
  const taken = new Array(t.length).fill(false);
  for (const [p, id, re] of phrases) {
    if (!t.includes(p)) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const s = m.index, e = s + p.length;
      let clash = false;
      for (let k = s; k < e; k++) if (taken[k]) { clash = true; break; }
      if (clash) continue;
      for (let k = s; k < e; k++) taken[k] = true;
      hits.push({ id, s, e, phrase: p });
    }
  }
  return hits.sort((a, b) => a.s - b.s);
}

function negated(t, pos) {
  // clause = text since the last sentence boundary
  const before = t.slice(0, pos);
  const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '), before.lastIndexOf('? '));
  const clause = before.slice(cut + 1);
  let lastNeg = -1, lastTerm = -1;
  for (const re of NEG_RES) { re.lastIndex = 0; let m; while ((m = re.exec(clause))) lastNeg = Math.max(lastNeg, m.index); }
  for (const re of TERM_RES) { re.lastIndex = 0; let m; while ((m = re.exec(clause))) lastTerm = Math.max(lastTerm, m.index); }
  return lastNeg >= 0 && lastNeg > lastTerm;
}

function sideNear(t, s, e) {
  const pre = t.slice(Math.max(0, s - 28), s).match(/\b(left|right|bilateral)\b/g);
  if (pre) return pre[pre.length - 1];
  const post = t.slice(e, Math.min(t.length, e + 32)).match(/\b(left|right|bilateral)\b/);
  return post ? post[1] : null;
}

const DUR_RE = /(\d+(?:\.\d+)?)\s*(?:-|\s)?(?:of\s+)?(day|week|month)s?/g;
function durations(t) {
  const out = [];
  let m;
  DUR_RE.lastIndex = 0;
  while ((m = DUR_RE.exec(t))) {
    const pre = t.slice(Math.max(0, m.index - 30), m.index);
    if (/(follow up|see me|come back|return)[a-z ]* in\s*$/.test(pre)) continue;
    out.push({ days: Number(m[1]) * { day: 1, week: 7, month: 30 }[m[2]], s: m.index, text: m[0].trim() });
  }
  return out;
}
function followup(t) {
  const m = t.match(/(follow up in|see me in|come back[a-z ]* in|return in)\s+(\d+)\s*(day|week|month)s?/);
  return m ? { days: Number(m[2]) * { day: 1, week: 7, month: 30 }[m[3]], text: `${m[2]} ${m[3]}${m[2] === '1' ? '' : 's'}` } : null;
}
function freqOf(t) { for (const [re, v] of FREQ) if (re.test(t)) return v; return null; }

export function extract(text, opts = {}) {
  const t = norm(text);
  const facts = { concepts: [], meds: [], durations: [], followup: followup(t), vitals: {}, nkda: /no known (drug )?allergies|\bnkda\b/.test(t), raw: t };
  for (const h of findAll(t, CONCEPT_PHRASES)) {
    const pol = opts.question ? 0 : negated(t, h.s) ? -1 : 1;
    facts.concepts.push({ c: h.id, pol, side: SIDED.has(h.id) ? sideNear(t, h.s, h.e) : null, s: h.s });
  }
  const medHits = findAll(t, MED_PHRASES);
  medHits.forEach((h, k) => {
    const end = k + 1 < medHits.length ? medHits[k + 1].s : t.length;
    const win = t.slice(h.e, Math.min(end, h.e + 90));
    const fromTo = win.match(/from (\d+(?:\.\d+)?)\s*(?:mg|milligrams)?\s*to (\d+(?:\.\d+)?)/);
    const dm = win.match(/(\d+(?:\.\d+)?)\s*(mg|milligrams|mcg)/);
    const dose = fromTo ? Number(fromTo[2]) : dm ? Number(dm[1]) : (win.match(/^\s*(?:to )?(\d+)\s/) ? null : null);
    const md = win.match(/for (\d+) days?/);
    facts.meds.push({ m: h.id, dose, from: fromTo ? Number(fromTo[1]) : null, freq: freqOf(win), days: md ? Number(md[1]) : null, s: h.s, neg: negated(t, h.s) });
  });
  facts.durations = durations(t).filter((d) => !facts.meds.some((m) => m.days && d.s > m.s && d.s - m.s < 90 && d.days === m.days));
  const bp = t.match(/(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})/);
  if (bp) facts.vitals.bp = `${bp[1]}/${bp[2]}`;
  const a1c = t.match(/a1c[^0-9]{0,24}(\d+(?:\.\d)?)/);
  if (a1c) facts.vitals.a1c = Number(a1c[1]);
  return facts;
}

// ---------- transcript index ----------
export function indexTranscript(turns) {
  const facts = [];
  turns.forEach((turn, i) => {
    const isQ = /\?\s*$/.test(turn.text.trim()) && turn.spk === 'Dr';
    const f = extract(turn.text, { question: isQ });
    f.turn = i;
    // A short yes/no answer inherits the question's concepts with that polarity.
    if (turn.spk === 'Pt' && i > 0 && /\?\s*$/.test(turns[i - 1].text.trim())) {
      const a = turn.text.trim().toLowerCase();
      const q = extract(turns[i - 1].text, { question: true });
      const pol = NO_ANSWER.test(a) ? -1 : YES_ANSWER.test(a) ? 1 : 0;
      if (pol) for (const c of q.concepts) f.concepts.push({ ...c, pol, viaQuestion: i - 1 });
    }
    facts.push(f);
  });
  // BM25 over turns
  const docs = turns.map((t) => tokens(norm(t.text)));
  const df = new Map();
  docs.forEach((d) => new Set(d).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const avg = docs.reduce((a, d) => a + d.length, 0) / Math.max(1, docs.length);
  return { turns, facts, docs, df, avg };
}

const STOP = new Set('a an the and or of to in on for with at by is are was were be been it its this that i you he she we they my your his her our their me him us them as from but not no do does did have has had will would can could should may might also patient presents reports denies about some any just so if then there here what how when which who'.split(' '));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');
export function tokens(t) { return (t.match(/[a-z0-9.]+/g) || []).filter((w) => !STOP.has(w)).map(stem); }

export function bm25(index, qTokens, k1 = 1.2, b = 0.75) {
  const N = index.docs.length;
  return index.docs.map((d, i) => {
    let s = 0;
    const tf = new Map();
    d.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    for (const q of new Set(qTokens)) {
      const f = tf.get(q);
      if (!f) continue;
      const n = index.df.get(q) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / index.avg));
    }
    return { i, s };
  }).sort((a, b2) => b2.s - a.s);
}

// ---------- checking one sentence ----------
const FREQ_LABEL = { 1: 'once daily', 2: 'twice daily', 3: 'three times daily', 4: 'four times daily', prn: 'as needed' };
const daysLabel = (d) => (d % 30 === 0 && d >= 30 ? `${d / 30} month${d > 30 ? 's' : ''}` : d % 7 === 0 && d >= 7 ? `${d / 7} week${d > 7 ? 's' : ''}` : `${d} day${d > 1 ? 's' : ''}`);

export function checkSentence(sentence, section, index, chart) {
  const f = extract(sentence);
  const out = [];
  const support = [];
  const tf = index.facts;
  const chartText = norm([...chart.problems, ...chart.meds].join('. '));
  const chartFacts = extract([...chart.problems, ...chart.meds].join('. '));
  // concepts
  for (const c of f.concepts) {
    if (NOT_VERIFIABLE.has(c.c)) { support.push({ kind: 'info', c: c.c, info: true }); continue; }
    if (section === 'Assessment' && DIAGNOSES.has(c.c)) {
      const hit = tf.find((x) => x.concepts.some((y) => y.c === c.c)) ;
      const inChart = chartFacts.concepts.some((y) => y.c === c.c);
      if (hit || inChart) support.push({ kind: 'concept', c: c.c, turn: hit ? hit.turn : null, chart: !hit && inChart });
      continue;
    }
    if (DIAGNOSES.has(c.c) && chartFacts.concepts.some((y) => y.c === c.c)) { support.push({ kind: 'concept', c: c.c, chart: true }); continue; }
    const ments = [];
    tf.forEach((x) => x.concepts.forEach((y) => { if (y.c === c.c && y.pol !== 0) ments.push({ ...y, turn: x.turn }); }));
    const same = ments.filter((m) => m.pol === c.pol);
    const opp = ments.filter((m) => m.pol === -c.pol);
    if (same.length) {
      if (c.side && c.pol === 1) {
        const sided = same.filter((m) => m.side);
        if (sided.length && !sided.some((m) => m.side === c.side)) {
          out.push({ kind: 'contradicted', type: 'laterality', c: c.c, turn: sided[0].turn, msg: `Note says ${c.side}; the visit says ${sided[0].side}.`, fix: { from: c.side, to: sided[0].side } });
          continue;
        }
      }
      support.push({ kind: 'concept', c: c.c, turn: same[0].turn, q: same[0].viaQuestion });
    } else if (opp.length) {
      out.push({ kind: 'contradicted', type: 'negation', c: c.c, turn: opp[0].turn, q: opp[0].viaQuestion, msg: c.pol === 1 ? 'Note says present; the patient said no.' : 'Note says denied; the patient reported it.' });
    } else {
      out.push({ kind: 'unsupported', type: section === 'Objective' ? 'exam' : c.pol === -1 ? 'negative' : 'symptom', c: c.c, msg: section === 'Objective' ? 'Finding was not said aloud during the visit.' : c.pol === -1 ? 'This was never asked about in the visit.' : 'Not mentioned in the visit.' });
    }
  }
  // medications
  for (const m of f.meds) {
    const tm = [];
    tf.forEach((x) => x.meds.forEach((y) => { if (y.m === m.m) tm.push({ ...y, turn: x.turn }); }));
    const allergy = chart.allergies.find((a) => (ALLERGY_CLASS[a.toLowerCase().split(' ')[0]] || []).some((k) => m.m.includes(k) || MED_CLASS[m.m] === a.toLowerCase().split(' ')[0]));
    if (allergy && !m.neg) out.push({ kind: 'chart', type: 'allergy', msg: `Chart lists a ${allergy} allergy.` });
    if (!tm.length) {
      if (chartText.includes(m.m)) support.push({ kind: 'med', chart: true });
      else out.push({ kind: 'unsupported', type: 'medication', msg: 'This medication was not discussed in the visit.' });
      continue;
    }
    const t0 = tm[tm.length - 1];
    if (m.dose && t0.dose && m.dose !== t0.dose) out.push({ kind: 'contradicted', type: 'dose', turn: t0.turn, msg: `Note says ${m.dose} mg; the visit says ${t0.dose} mg.`, fix: { from: `${m.dose} mg`, to: `${t0.dose} mg` } });
    else if (m.freq && t0.freq && m.freq !== t0.freq) out.push({ kind: 'contradicted', type: 'frequency', turn: t0.turn, msg: `Note says ${FREQ_LABEL[m.freq]}; the visit says ${FREQ_LABEL[t0.freq]}.`, fix: { fromFreq: m.freq, to: FREQ_LABEL[t0.freq] } });
    else if (m.days && t0.days && m.days !== t0.days) out.push({ kind: 'contradicted', type: 'duration', turn: t0.turn, msg: `Note says ${m.days} days; the visit says ${t0.days} days.`, fix: { from: `${m.days} days`, to: `${t0.days} days` } });
    else support.push({ kind: 'med', turn: t0.turn });
  }
  // symptom durations
  if (f.durations.length && section === 'Subjective') {
    const cands = [];
    tf.forEach((x) => { if (index.turns[x.turn].spk === 'Pt') x.durations.forEach((d) => cands.push({ ...d, turn: x.turn })); });
    for (const d of f.durations) {
      if (!cands.length) { out.push({ kind: 'unsupported', type: 'duration', msg: 'The visit never mentions how long this has been going on.' }); continue; }
      const ok = cands.find((c) => c.days === d.days);
      if (ok) support.push({ kind: 'duration', turn: ok.turn });
      else out.push({ kind: 'contradicted', type: 'duration', turn: cands[0].turn, msg: `Note says ${daysLabel(d.days)}; the patient said ${daysLabel(cands[0].days)}.`, fix: { from: d.text, to: daysLabel(cands[0].days) } });
    }
  }
  // follow-up interval
  if (f.followup) {
    const tfu = tf.map((x) => (x.followup ? { ...x.followup, turn: x.turn } : null)).filter(Boolean);
    if (!tfu.length) out.push({ kind: 'unsupported', type: 'followup', msg: 'No follow-up interval was discussed.' });
    else if (tfu[tfu.length - 1].days !== f.followup.days) out.push({ kind: 'contradicted', type: 'followup', turn: tfu[tfu.length - 1].turn, msg: `Note says ${daysLabel(f.followup.days)}; the visit says ${daysLabel(tfu[tfu.length - 1].days)}.`, fix: { from: f.followup.text, to: daysLabel(tfu[tfu.length - 1].days) } });
    else support.push({ kind: 'followup', turn: tfu[tfu.length - 1].turn });
  }
  // vitals
  for (const [k, v] of Object.entries(f.vitals)) {
    const tv = tf.map((x) => (x.vitals[k] !== undefined ? { v: x.vitals[k], turn: x.turn } : null)).filter(Boolean);
    if (!tv.length) continue;
    if (tv.some((x) => x.v === v)) support.push({ kind: 'vital', turn: tv[0].turn });
    else out.push({ kind: 'contradicted', type: 'vital', turn: tv[0].turn, msg: `Note says ${v}; the visit says ${tv[0].v}.`, fix: { from: String(v), to: String(tv[0].v) } });
  }
  // allergy statement vs chart
  if (f.nkda) {
    if (chart.allergies.length) out.push({ kind: 'chart', type: 'allergy', msg: `Chart lists: ${chart.allergies.join(', ')}.` });
    else support.push({ kind: 'chart', chart: true });
  }
  // best evidence turn by BM25 (for display and as a feature)
  const q = tokens(f.raw);
  const ranked = bm25(index, q);
  const best = ranked[0];
  const selfScore = q.length ? q.length * 2.2 : 1;
  const nFacts = f.concepts.length + f.meds.length + f.durations.length + (f.followup ? 1 : 0) + Object.keys(f.vitals).length + (f.nkda ? 1 : 0);
  return { findings: out, support, evidenceTurn: best && best.s > 0 ? best.i : null, bm25: best ? Math.min(1, best.s / selfScore) : 0, nFacts };
}

// ---------- scoring ----------
export function features(r, section) {
  const nC = r.findings.filter((x) => x.kind === 'contradicted').length;
  const nCh = r.findings.filter((x) => x.kind === 'chart').length;
  const nU = r.findings.filter((x) => x.kind === 'unsupported').length;
  const exam = r.findings.some((x) => x.type === 'exam') ? 1 : 0;
  const neg = r.findings.some((x) => x.type === 'negative') ? 1 : 0;
  const sup = r.support.filter((x) => !x.info).length;
  const tot = r.findings.length + sup;
  const allOk = r.findings.length === 0 && sup > 0 ? 1 : 0;
  return [1, Math.min(nC, 2), nCh, Math.min(nU, 2), tot ? sup / tot : 0.5, r.nFacts ? 1 : 0, r.bm25, exam, neg, section === 'Plan' ? 1 : 0, allOk, Math.min(sup, 3) / 3];
}
export const FEATURE_NAMES = ['bias', 'contradictions', 'chart conflicts', 'unsupported facts', 'share supported', 'has checkable facts', 'BM25 support', 'unspoken exam finding', 'unasked negative', 'plan section', 'every fact verified', 'verified facts'];

export function trainLogistic(X, y, { iters = 600, lr = 0.5, l2 = 1e-3 } = {}) {
  const p = X[0].length;
  let w = new Array(p).fill(0);
  const sig = (z) => 1 / (1 + Math.exp(-z));
  const pos = y.reduce((a, b) => a + b, 0), wPos = (y.length - pos) / Math.max(1, pos); // class balance
  for (let it = 0; it < iters; it++) {
    const g = new Array(p).fill(0);
    let W = 0;
    for (let i = 0; i < X.length; i++) {
      const wt = y[i] ? wPos : 1;
      const pr = sig(X[i].reduce((s, v, j) => s + v * w[j], 0));
      for (let j = 0; j < p; j++) g[j] += wt * (pr - y[i]) * X[i][j];
      W += wt;
    }
    w = w.map((wj, j) => wj - lr * (g[j] / W + (j ? l2 * wj : 0)));
  }
  return w;
}
export const score = (w, x) => 1 / (1 + Math.exp(-x.reduce((s, v, j) => s + v * w[j], 0)));

// Conformal risk control: choose the largest threshold whose corrected miss rate is <= alpha.
// units: per-note arrays of {score, err} for sentences that carry a planted error.
export function crcThreshold(units, alpha) {
  const withErr = units.filter((u) => u.errs.length);
  const n = withErr.length;
  const loss = (lam) => withErr.reduce((a, u) => a + u.errs.filter((s) => s < lam).length / u.errs.length, 0) / n;
  const cands = [...new Set(withErr.flatMap((u) => u.errs))].sort((a, b) => b - a);
  let best = 0;
  for (const lam of [...cands.map((c) => c + 1e-9), ...cands]) {
    if ((n / (n + 1)) * loss(lam) + 1 / (n + 1) <= alpha) { best = Math.max(best, lam); }
  }
  return { lambda: best, n, empiricalMiss: loss(best) };
}

export function analyzeVisit(v) {
  const index = indexTranscript(v.transcript);
  const sentences = [];
  for (const [section, ss] of Object.entries(v.note)) ss.forEach((text, k) => {
    const r = checkSentence(text, section, index, v.chart);
    sentences.push({ section, k, text, ...r, x: features(r, section) });
  });
  return { index, sentences };
}

export function runPipeline(data, { split = [0.5, 0.25] } = {}) {
  const n = data.visits.length;
  const a = Math.floor(n * split[0]), b = Math.floor(n * (split[0] + split[1]));
  const analyzed = data.visits.map((v, i) => {
    const r = analyzeVisit(v);
    r.sentences.forEach((s) => (s.err = data.labels[i][s.section][s.k]));
    return r;
  });
  const train = analyzed.slice(0, a), cal = analyzed.slice(a, b), test = analyzed.slice(b);
  const X = [], Y = [];
  train.forEach((r) => r.sentences.forEach((s) => { X.push(s.x); Y.push(s.err ? 1 : 0); }));
  const w = trainLogistic(X, Y);
  analyzed.forEach((r) => r.sentences.forEach((s) => (s.score = score(w, s.x))));
  const units = (set) => set.map((r) => ({ errs: r.sentences.filter((s) => s.err).map((s) => s.score), all: r.sentences }));
  const calUnits = units(cal), testUnits = units(test);
  const evaluate = (lambda, set) => {
    let errs = 0, caught = 0, flags = 0, falseFlags = 0, notes = set.length, cleanNotes = 0, flagsOnClean = 0;
    const byType = {};
    for (const r of set) {
      const hasErr = r.sentences.some((s) => s.err);
      if (!hasErr) cleanNotes++;
      for (const s of r.sentences) {
        const f = s.score >= lambda;
        if (f) { flags++; if (!s.err) falseFlags++; if (!hasErr) flagsOnClean++; }
        if (s.err) { errs++; byType[s.err] = byType[s.err] || { n: 0, caught: 0 }; byType[s.err].n++; if (f) { caught++; byType[s.err].caught++; } }
      }
    }
    const perNoteMiss = set.filter((r) => r.sentences.some((s) => s.err)).map((r) => { const e = r.sentences.filter((s) => s.err); return e.filter((s) => s.score < lambda).length / e.length; });
    return { notes, errs, caught, recall: caught / errs, flags, falseFlags, precision: flags ? (flags - falseFlags) / flags : 1, falsePerNote: falseFlags / notes, flagsPerCleanNote: flagsOnClean / Math.max(1, cleanNotes), cleanNotes, byType, meanNoteMiss: perNoteMiss.reduce((x, y) => x + y, 0) / perNoteMiss.length };
  };
  const curve = [];
  const lams = [...new Set(test.flatMap((r) => r.sentences.map((s) => Math.round(s.score * 1000) / 1000)))].sort((x, y) => x - y);
  for (const l of lams) { const e = evaluate(l, test); curve.push({ l, recall: e.recall, fpn: e.falsePerNote }); }
  return { w, analyzed, split: { a, b, n }, calUnits, testUnits, evaluate, curve, cal, test, train };
}
