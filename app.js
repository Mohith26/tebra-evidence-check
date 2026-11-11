import { runPipeline, crcThreshold, FEATURE_NAMES } from './core/evidence.js';
import { FREQ } from './core/lexicon.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';

const data = await (await fetch('data/visits.json')).json();
const P = runPipeline(data);
const SAMPLES = ['V0967', 'V0940', 'V0995', 'V1087', 'V0998', 'V0926'];
const DATES = ['11/09/2026', '11/09/2026', '11/06/2026', '11/05/2026', '11/03/2026', '10/30/2026'];
const LEVELS = [[0.05, 'Catch at least 95% of errors'], [0.1, 'Catch at least 90% of errors'], [0.2, 'Catch at least 80% of errors']];
const qs = new URLSearchParams(location.search);
let cur = Math.max(0, SAMPLES.indexOf(qs.get('v')));
let alpha = LEVELS.some(([a]) => a === Number(qs.get('a'))) ? Number(qs.get('a')) : 0.05;
let showKey = qs.get('key') === '1';
let focus = null;
const state = new Map(); // per visit: { fixed: Map(sentKey->text), dismissed: Set, removed: Set }
const crc = new Map();
const lam = () => { if (!crc.has(alpha)) crc.set(alpha, crcThreshold(P.calUnits, alpha)); return crc.get(alpha).lambda; };

const visitIndex = (id) => data.visits.findIndex((v) => v.id === id);
const keyOf = (s) => `${s.section}:${s.k}`;
const TYPE_LABEL = { negation: 'Negation', laterality: 'Laterality', dose: 'Dose', frequency: 'Frequency', duration: 'Duration', followup: 'Follow-up', vital: 'Vitals', medication: 'Medication', symptom: 'Symptom', negative: 'Pertinent negative', exam: 'Exam finding', allergy: 'Allergy' };

function flagsFor(i) {
  const r = P.analyzed[i];
  const st = state.get(i) || { fixed: new Map(), dismissed: new Set(), removed: new Set() };
  state.set(i, st);
  const L = lam();
  return { r, st, flagged: r.sentences.filter((s) => s.score >= L && !st.dismissed.has(keyOf(s)) && !st.fixed.has(keyOf(s)) && !st.removed.has(keyOf(s))) };
}
const severity = (s) => (s.findings.some((f) => f.kind === 'contradicted' || f.kind === 'chart') ? 'c' : 'u');

function fixText(s) {
  const f = s.findings.find((x) => x.kind === 'contradicted' || x.kind === 'chart');
  if (!f) return null;
  let t = s.text;
  if (f.type === 'negation') {
    if (/^(Also )?[Rr]eports /.test(t)) return t.replace(/^(Also )?[Rr]eports /, 'Denies ');
    if (/^Denies /.test(t)) return t.replace(/^Denies /, 'Reports ');
    return null;
  }
  if (f.type === 'allergy' && /no known drug allergies|nkda/i.test(t)) { const v = data.visits[visitIndex(SAMPLES[cur])]; return `Allergies: ${v.chart.allergies.join(', ')}.`; }
  if (f.fix && f.fix.fromFreq !== undefined) {
    const low = t.toLowerCase();
    for (const [re] of FREQ) { const m = low.match(re); if (m) return t.slice(0, m.index) + f.fix.to + t.slice(m.index + m[0].length); }
    return null;
  }
  if (f.fix && f.fix.from) {
    const idx = t.toLowerCase().indexOf(String(f.fix.from).toLowerCase());
    if (idx >= 0) return t.slice(0, idx) + f.fix.to + t.slice(idx + String(f.fix.from).length);
    const num = String(f.fix.from).match(/\d+/);
    if (num) return t.replace(new RegExp(`\\b${num[0]}[- ]?(day|week|month)s?`), String(f.fix.to));
  }
  return null;
}

function render() {
  const i = visitIndex(SAMPLES[cur]);
  const v = data.visits[i];
  const labels = data.labels[i];
  const { r, st, flagged } = flagsFor(i);
  const pr = v.patient.sex === 'F' ? 'She/Her' : 'He/Him';
  const dob = `${String(1 + ((v.patient.age * 7) % 12)).padStart(2, '0')}/${String(1 + ((v.patient.age * 13) % 27)).padStart(2, '0')}/${2026 - v.patient.age}`;
  const mrn = `TEB-${1000 + ((i * 37) % 9000)}`;
  $('pname').innerHTML = `${esc(v.patient.first)} ${esc(v.patient.last)} <span>(${pr})</span>`;
  $('psub').textContent = `Legal Name: ${v.patient.first} ${v.patient.last} • MRN: ${mrn} • DOB: ${dob} (${v.patient.age} yo)`;
  $('lname').textContent = `${v.patient.first} ${v.patient.last}`;
  $('pcard').innerHTML = `<div class="avatar">${v.patient.first[0]}${v.patient.last[0]}</div><div>${dob} (${v.patient.age} yo)<br>Sex: ${v.patient.sex === 'F' ? 'Female' : 'Male'}<br>${['Blue Cross - California (Anthem)', 'Aetna PPO', 'UnitedHealthcare', 'Cigna PPO'][i % 4]}<br><b>Allergies:</b> ${v.chart.allergies.length ? esc(v.chart.allergies.join(', ')) : 'NKDA'}</div>`;
  $('nlist').innerHTML = SAMPLES.map((id, k) => {
    const j = visitIndex(id);
    const n = flagsFor(j).flagged.length;
    return `<div data-k="${k}" class="${k === cur ? 'on' : ''}"><span class="tx">${DATES[k].slice(0, 5)}/26 - ${esc(data.visits[j].cc)}</span><span class="fl ${n ? 'r' : 'g'}">${n || '✓'}</span></div>`;
  }).join('');
  $('nlist').querySelectorAll('div').forEach((d) => (d.onclick = () => { cur = Number(d.dataset.k); focus = null; render(); }));
  const secs = ['CC', 'Subjective', 'Mental/Functional', 'Objective', 'Assessment', 'Plan'];
  $('labs').innerHTML = ['10/02/26 - CBC; Lipid Panel', '06/11/26 - CMP', '01/20/26 - CBC; BUN; A1c'].map((t) => `<div style="color:#004852">${t}</div>`).join('');
  $('slist').innerHTML = secs.map((s, k) => `<div class="${k === 1 ? 'on' : ''}">${s} <i class="ti ti-square-minus"></i></div>`).join('');
  $('ntype').innerHTML = `${v.noteType} <i class="ti ti-chevron-down"></i>`;
  $('ndate').innerHTML = `${DATES[cur]} <i class="ti ti-calendar"></i>`;
  $('assign').innerHTML = `${esc(v.provider)} <i class="ti ti-chevron-down"></i>`;

  // Note body with highlights
  const flaggedKeys = new Map(flagged.map((s, n) => [keyOf(s), n + 1]));
  const sentHtml = (s) => {
    const k = keyOf(s);
    const txt = st.removed.has(k) ? '' : esc(st.fixed.get(k) || s.text);
    if (!txt) return '';
    const n = flaggedKeys.get(k);
    const cls = ['s'];
    if (n) cls.push(severity(s) === 'c' ? 'flag-c' : 'flag-u');
    if (st.fixed.has(k)) cls.push('fixed');
    if (focus === k) cls.push('focus');
    if (showKey && labels[s.section][s.k]) cls.push('key');
    return `<span class="${cls.join(' ')}" data-k="${k}">${txt}${n ? `<sup>${n}</sup>` : ''}</span> `;
  };
  const bySec = (name) => r.sentences.filter((s) => s.section === name);
  let html = `<div class="title">${v.noteType}</div><div class="ccbox"><div class="h">CC <span class="cct"><button class="btn"><i class="ti ti-arrows-vertical"></i>Text Shortcut</button><i class="ti ti-x"></i></span></div><div class="t">Patient presents with ${esc(v.cc)}.</div></div>`;
  for (const name of ['Subjective', 'Mental/Functional', 'Objective', 'Assessment', 'Plan']) {
    const ss = bySec(name);
    if (!ss.length) { html += `<div class="sec"><div class="h">${name}</div><div class="t" style="min-height:14px"></div></div>`; continue; }
    html += `<div class="sec"><div class="h">${name}</div><div class="t">${ss.map(sentHtml).join('')}</div></div>`;
  }
  html += `<div class="sig">${esc(v.provider)}, MD</div>`;
  $('note').innerHTML = html;
  $('note').querySelectorAll('.s.flag-c, .s.flag-u').forEach((el) => (el.onclick = () => { focus = el.dataset.k; render(); document.querySelector(`.flag[data-k="${focus}"]`)?.scrollIntoView({ block: 'nearest' }); }));

  // Right panel
  const nC = flagged.filter((s) => severity(s) === 'c').length;
  const nU = flagged.length - nC;
  const verified = r.sentences.filter((s) => !flaggedKeys.has(keyOf(s)) && s.support.length && !st.removed.has(keyOf(s)));
  const turnHtml = (ti, hl) => { const t = v.transcript[ti]; return `<div class="ln"><span class="ts">${t.ts}</span><span class="sp">${t.spk === 'Dr' ? 'Dr' : 'Pt'}</span><span>${hl ? `<mark>${esc(t.text)}</mark>` : esc(t.text)}</span></div>`; };
  const cards = flagged.map((s, n) => {
    const k = keyOf(s);
    const sev = severity(s);
    const main = s.findings.find((f) => f.kind === 'contradicted' || f.kind === 'chart') || s.findings[0];
    let ev = '';
    if (main && main.turn !== undefined && main.turn !== null) {
      if (main.q !== undefined && main.q !== null) ev += turnHtml(main.q, false);
      ev += turnHtml(main.turn, true);
    } else if (main && main.kind === 'chart') {
      ev = `<div class="ln"><span class="sp" style="min-width:auto">Chart</span><span><mark>Allergies: ${esc(v.chart.allergies.join(', '))}</mark></span></div>`;
    } else if (s.evidenceTurn !== null) {
      ev = `<div class="ln" style="color:#7d8d8f">Closest passage (BM25):</div>` + turnHtml(s.evidenceTurn, false);
    } else ev = '<div class="ln" style="color:#7d8d8f">No related passage in the visit transcript.</div>';
    const fx = fixText(s);
    const kindLabel = main?.kind === 'chart' ? 'Conflicts with chart' : sev === 'c' ? 'Contradicts visit' : 'Not in visit';
    return `<div class="rcard flag ${sev === 'u' ? 'u' : ''} ${focus === k ? 'focus' : ''}" data-k="${k}">
      <div class="top"><span class="pill ${sev}">${kindLabel}</span><span class="pill k">${TYPE_LABEL[main?.type] || 'Statement'}</span><span class="num">#${n + 1} · ${s.section} · risk ${s.score.toFixed(2)}</span></div>
      <div class="q">“${esc(s.text)}”</div><div class="why">${esc(main ? main.msg : 'Low support in the transcript.')}</div>
      <div class="ev">${ev}</div>
      <div class="act">${fx ? `<button class="btn-o" data-fix="${k}">Apply fix</button>` : sev === 'u' ? `<button class="btn-o" data-rm="${k}">Remove sentence</button>` : ''}<button class="btn-l" data-ok="${k}">Keep as written</button></div></div>`;
  }).join('');
  const reviewed = st.fixed.size + st.dismissed.size + st.removed.size;
  $('rp').innerHTML = `<div class="tabs"><div>Chart Details</div><div class="on">Evidence Check <span class="new">New</span></div></div>
    <div class="rcard"><div class="hd">Before you sign <i class="ti ti-chevron-up"></i></div>
      <div class="sum"><div class="c"><b>${nC}</b><span>contradict the visit or chart</span></div><div class="u"><b>${nU}</b><span>not found in the visit</span></div><div class="ok"><b>${verified.length}</b><span>matched to the visit</span></div></div>
      <div class="sens"><span>Sensitivity</span><select id="lev">${LEVELS.map(([a, l]) => `<option value="${a}" ${a === alpha ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="fine">Every sentence is checked against this visit's transcript and the chart. The flag threshold (risk ≥ ${lam().toFixed(2)}) is calibrated on ${crc.get(alpha).n} held-out notes so that, on average, at most ${pct(alpha)} of a note's errors go unflagged.${reviewed ? ` ${reviewed} reviewed.` : ''}</div></div>
    ${cards || '<div class="rcard"><div class="empty"><i class="ti ti-circle-check"></i> Every statement traced to the visit or chart.</div></div>'}
    <div class="rcard"><div class="hd">Matched statements (${verified.length}) <i class="ti ti-chevron-down"></i></div><div class="vlist">${verified.map((s) => { const sp = s.support.find((x) => x.turn !== undefined && x.turn !== null); return `<div><i class="ti ti-circle-check"></i><span>${esc(st.fixed.get(keyOf(s)) || s.text)} <span style="color:#9aa9aa">${sp ? '· ' + v.transcript[sp.turn].ts : s.support.some((x) => x.chart) ? '· chart' : s.support.some((x) => x.info) ? '· general appearance, not checked' : ''}</span></span></div>`; }).join('')}</div></div>`;
  $('lev').onchange = (e) => { alpha = Number(e.target.value); render(); };
  $('rp').querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => { const s = r.sentences.find((x) => keyOf(x) === b.dataset.fix); st.fixed.set(b.dataset.fix, fixText(s)); focus = null; render(); }));
  $('rp').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { st.removed.add(b.dataset.rm); render(); }));
  $('rp').querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => { st.dismissed.add(b.dataset.ok); render(); }));
  $('rp').querySelectorAll('.flag').forEach((c) => (c.onmouseenter = () => { document.querySelectorAll('.s.focus').forEach((x) => x.classList.remove('focus')); document.querySelector(`.s[data-k="${c.dataset.k}"]`)?.classList.add('focus'); }));

  // Bottom bar
  $('bbar').innerHTML = `<span class="dot"></span><button class="btn">Sign <i class="ti ti-chevron-up"></i></button>${flagged.length ? `<span class="warn"><i class="ti ti-alert-triangle"></i>${flagged.length} statement${flagged.length > 1 ? 's' : ''} to review before signing</span>` : '<span class="ok"><i class="ti ti-circle-check"></i>Evidence Check passed</span>'}
    <button class="btn">Capture Charge</button><button class="btn">Copy</button><b style="font-size:12px">ToC:</b><span class="chk"><i></i>Receiving</span><span class="chk"><i></i>Transferring</span>
    <div class="sel" style="min-width:130px">Care Coordination <i class="ti ti-chevron-down"></i></div><button class="btn">Care Checklist</button><span class="chk"><i></i>Mark as Confidential Note</span><button class="btn r">Save &amp; Close <i class="ti ti-chevron-up"></i></button>`;

  renderValidation();
}

function renderValidation() {
  const L = lam();
  const e = P.evaluate(L, P.test);
  const c = crc.get(alpha);
  const types = Object.entries(e.byType).sort((a, b) => b[1].n - a[1].n);
  const curve = P.curve;
  const W = 300, H = 150, m = { l: 34, r: 16, t: 8, b: 26 };
  const maxF = 1;
  const X = (f) => m.l + (Math.min(f, maxF) / maxF) * (W - m.l - m.r);
  const Yc = (rc) => m.t + ((1 - rc) / 0.5) * (H - m.t - m.b);
  const pts = curve.filter((p) => p.recall >= 0.5 && p.fpn <= maxF).map((p) => `${X(p.fpn).toFixed(1)},${Yc(p.recall).toFixed(1)}`).join(' ');
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  for (const rc of [0.5, 0.75, 1]) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Yc(rc)}" y2="${Yc(rc)}" stroke="#eceeee"/><text x="${m.l - 4}" y="${Yc(rc) + 3}" text-anchor="end" class="ylab">${pct(rc)}</text>`;
  for (const f of [0, maxF / 2, maxF]) svg += `<text x="${X(f)}" y="${H - 10}" text-anchor="middle" class="ylab">${f.toFixed(2)}</text>`;
  svg += `<text x="${(m.l + W - m.r) / 2}" y="${H}" text-anchor="middle" class="ylab">false flags per note</text>`;
  svg += `<polyline points="${pts}" fill="none" stroke="#2b768b" stroke-width="2"/>`;
  svg += `<circle cx="${X(e.falsePerNote)}" cy="${Yc(e.recall)}" r="5" fill="#ff8d6e" stroke="#fff" stroke-width="1.5"/></svg>`;
  $('val').innerHTML = `<div class="hd">How Evidence Check was validated <label><input type="checkbox" id="key" ${showKey ? 'checked' : ''}> Show planted errors in this note</label></div>
    <div class="grid"><div>
      <div class="kpis"><div><b>${pct(e.recall, 1)}</b><span>of ${e.errs} planted errors flagged</span></div><div><b>${e.falsePerNote.toFixed(2)}</b><span>false flags per note</span></div><div><b>${pct(e.meanNoteMiss, 1)}</b><span>errors missed per note (target ≤ ${pct(alpha)})</span></div></div>
      <table class="t"><thead><tr><th>Planted error</th><th class="n">Errors</th><th>Flagged</th></tr></thead><tbody>${types.map(([t, x]) => `<tr><td>${TYPE_LABEL[t] || t[0].toUpperCase() + t.slice(1)}</td><td class="n">${x.n}</td><td>${x.caught}/${x.n} <span class="bar"><i style="width:${(100 * x.caught) / x.n}%"></i></span></td></tr>`).join('')}</tbody></table>
    </div><div>
      <div style="font-weight:600;font-size:12.5px;margin-bottom:4px">Errors caught vs. false flags (held-out notes)</div>${svg}
      <div class="fine" style="padding:6px 0 0">Orange dot: the threshold chosen by conformal risk control on the calibration notes (n = ${c.n} notes with errors, risk ≥ ${L.toFixed(2)}). Precision of flags: ${pct(e.precision, 1)}.</div>
    </div></div>
    <div class="method"><b>Data.</b> ${data.visits.length} synthetic visits (10 visit types) with a doctor-patient transcript, a chart, and an AI-style note written from the same facts; about half the notes carry 1-3 planted errors: flipped negations, wrong side, dose, frequency, duration, follow-up, swapped medication, invented findings, and "no known drug allergies" when the chart lists one. Split ${P.split.a} train / ${P.split.b - P.split.a} calibration / ${P.split.n - P.split.b} test by visit; numbers above are on the ${e.notes} test notes.
    <b>Checker.</b> Typed facts (concepts with NegEx-style negation and laterality, medication dose/frequency/duration, durations, follow-up, vitals, allergies) are extracted from each note sentence and from the transcript, where a "no" answer inherits the question's concepts. Mismatches become findings; BM25 picks the evidence turn. A logistic model over ${FEATURE_NAMES.length - 1} finding features scores each sentence; conformal risk control picks the threshold.</div>`;
  $('key').onchange = (ev) => { showKey = ev.target.checked; render(); };
}

render();
