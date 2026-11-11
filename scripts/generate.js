// Seeded synthetic visits: a doctor-patient transcript, a chart, and an AI-style SOAP note
// written from the same facts. About half the notes get 1-2 planted errors (the labels are
// stored separately and are used only for training/calibration/evaluation and the answer key).
// Run: node scripts/generate.js -> data/visits.json
import { writeFileSync } from 'node:fs';

const SEED = 20261111;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + words(n % 100) : '');
  if (n === 1000) return 'one thousand';
  return String(n);
}
const unitDays = { day: 1, week: 7, month: 30 };
const durPt = (n, u) => n === 1 ? pick([`about a ${u}`, `a ${u}`, `since about a ${u} ago`]) : pick([`about ${words(n)} ${u}s`, `${words(n)} ${u}s now`, `the last ${words(n)} ${u}s`, `maybe ${words(n)} ${u}s`]);
const durNote = (n, u) => pick([`for ${n} ${u}${n > 1 ? 's' : ''}`, `for the past ${n} ${u}${n > 1 ? 's' : ''}`, `x ${n} ${u}${n > 1 ? 's' : ''}`]);
const durHist = (n, u) => `${n === 1 ? 'one' : n}-${u} history of`;
const FREQ_PT = { 1: ['once a day', 'every morning', 'once daily'], 2: ['twice a day', 'two times a day', 'morning and night'], 3: ['three times a day'], prn: ['as needed', 'when you need it'] };
const FREQ_NOTE = { 1: ['daily', 'once daily'], 2: ['twice daily', 'BID'], 3: ['three times daily', 'TID'], prn: ['as needed', 'PRN'] };

// ---------- scenario library ----------
const S = [
  { key: 'sinusitis', cc: 'stuffy nose and facial pressure', dx: ['Acute sinusitis', 'J01.90'],
    complaint: { pt: ['I have had a stuffy nose and pressure in my cheeks for {dur}', "My nose has been stuffed up and there's this pressure in my face, {dur}"], note: ['nasal congestion and facial pressure'], concepts: ['congestion'], dur: [[3, 10, 'day'], [1, 2, 'week']] },
    assoc: [{ c: 'headache', pt: ['and I get a headache when I bend over'], note: 'headache worse with bending forward' }, { c: 'cough', pt: ['also a little cough at night'], note: 'mild nocturnal cough' }],
    negs: [{ c: 'fever', ask: ['Any fevers?', 'Have you had a fever?'], note: 'fever' }, { c: 'dyspnea', ask: ['Any trouble breathing?', 'Are you short of breath at all?'], note: 'shortness of breath' }, { c: 'vision', ask: ['Any changes in your vision?'], note: 'vision changes' }],
    exam: [{ c: 'sinus_tender', dr: ["You're tender over the sinuses here.", 'Your sinuses are tender when I press.'], note: 'Tenderness over the maxillary sinuses.' }, { c: 'lungs_clear', dr: ['Lungs sound clear.', 'Your lungs are clear.'], note: 'Lungs clear to auscultation bilaterally.' }],
    meds: [{ m: 'saline', name: 'saline nasal spray', dose: null, freq: [2, 3], dr: 'Use a saline nasal spray {freq}', note: 'Saline nasal spray {freq}' }, { m: 'fluticasone', name: 'fluticasone', dose: [50], unit: 'mcg', freq: [1], dr: 'and start fluticasone, two sprays {freq}', note: 'Fluticasone nasal spray, 2 sprays {freq}' }],
    fu: [7, 10, 14] },
  { key: 'knee', cc: 'knee pain', dx: ['Primary osteoarthritis of knee', 'M17.1'], sided: true,
    complaint: { pt: ['My {side} knee has been hurting for {dur}', "It's my {side} knee, it's been bothering me {dur}"], note: ['{side} knee pain'], concepts: ['knee_pain'], dur: [[2, 6, 'week'], [2, 4, 'month']] },
    assoc: [{ c: 'swelling', pt: ['and it gets swollen after I walk'], note: 'swelling after walking' }],
    negs: [{ c: 'fever', ask: ['Any fever or chills?'], note: 'fever' }, { c: 'numbness', ask: ['Any numbness or tingling in the leg?'], note: 'numbness or tingling' }],
    exam: [{ c: 'joint_tender', dr: ["There's tenderness along the joint line on the {side} side.", "You're tender along the joint here on the {side}."], note: 'Tenderness along the medial joint line of the {side} knee.' }, { c: 'effusion', dr: ["I don't feel any fluid in the knee.", 'No fluid on the knee.'], note: 'No effusion.', neg: true }],
    meds: [{ m: 'naproxen', name: 'naproxen', dose: [250, 500], unit: 'mg', freq: [2], dr: "Let's try naproxen, {dose} milligrams {freq} with food", note: 'Naproxen {dose} mg {freq} with food' }, { m: 'acetaminophen', name: 'acetaminophen', dose: [500, 650], unit: 'mg', freq: [3, 'prn'], dr: 'you can add Tylenol, {dose} milligrams {freq}', note: 'Acetaminophen {dose} mg {freq}' }],
    fu: [14, 28, 42] },
  { key: 'htn', cc: 'blood pressure follow-up', dx: ['Essential hypertension', 'I10'], chartProblems: ['Hypertension'], vitals: true,
    complaint: { pt: ["I'm here for my blood pressure check", "Just following up on the blood pressure"], note: ['follow-up of hypertension'], concepts: ['hypertension'], dur: null },
    assoc: [{ c: 'headache', pt: ["I've had a few headaches in the mornings"], note: 'occasional morning headaches' }],
    negs: [{ c: 'chest_pain', ask: ['Any chest pain?', 'Have you had any chest pain?'], note: 'chest pain' }, { c: 'dyspnea', ask: ['Any shortness of breath?'], note: 'shortness of breath' }, { c: 'dizziness', ask: ['Any dizziness or lightheadedness?'], note: 'dizziness' }],
    exam: [{ c: 'lungs_clear', dr: ['Lungs sound clear.', 'Lungs are clear.'], note: 'Lungs clear to auscultation.' }, { c: 'swelling', dr: ['No swelling in your ankles.', "I don't see any swelling in the legs."], note: 'No lower extremity edema.', neg: true }],
    meds: [{ m: 'lisinopril', name: 'lisinopril', dose: [20, 40], unit: 'mg', freq: [1], change: [10, 20], dr: "I'd like to increase your lisinopril from {from} to {dose} milligrams {freq}", note: 'Increase lisinopril to {dose} mg {freq}' }],
    fu: [14, 28, 30] },
  { key: 'back', cc: 'low back pain', dx: ['Lumbar radiculopathy', 'M54.16'], sided: true,
    complaint: { pt: ['My lower back has been hurting for {dur}', "I've had this low back pain for {dur}"], note: ['low back pain'], concepts: ['back_pain'], dur: [[3, 10, 'day'], [1, 3, 'week']] },
    assoc: [{ c: 'radiation_leg', pt: ['and it shoots down my {side} leg'], note: 'radiating down the {side} leg', sided: true }],
    negs: [{ c: 'bladder', ask: ['Any trouble controlling your bladder or bowels?'], note: 'bowel or bladder incontinence' }, { c: 'fever', ask: ['Any fevers?'], note: 'fever' }, { c: 'numbness', ask: ['Any numbness in the groin area?', 'Any numbness?'], note: 'numbness' }],
    exam: [{ c: 'slr', dr: ['Straight leg raise is positive on the {side}.', 'The leg raise test is positive on your {side} side.'], note: 'Positive straight leg raise on the {side}.' }],
    meds: [{ m: 'naproxen', name: 'naproxen', dose: [500], unit: 'mg', freq: [2], dur: [7, 10, 14], dr: "Let's do naproxen {dose} milligrams {freq} for {mdur} days", note: 'Naproxen {dose} mg {freq} for {mdur} days' }],
    fu: [14, 21, 28] },
  { key: 'uti', cc: 'burning with urination', dx: ['Acute cystitis', 'N30.00'], allergyBias: 'sulfa',
    complaint: { pt: ['It burns when I pee and it started {dur}', "I've had burning when I pee for {dur}"], note: ['dysuria'], concepts: ['dysuria'], dur: [[2, 5, 'day']] },
    assoc: [{ c: 'frequency', pt: ["and I'm going to the bathroom a lot"], note: 'urinary frequency' }],
    negs: [{ c: 'fever', ask: ['Any fever?', 'Fevers or chills?'], note: 'fever' }, { c: 'flank_pain', ask: ['Any pain in your side or back?'], note: 'flank pain' }, { c: 'hematuria', ask: ['Have you seen any blood in the urine?'], note: 'hematuria' }],
    exam: [{ c: 'cva_tender', dr: ['No tenderness when I tap your back.', 'No CVA tenderness.'], note: 'No CVA tenderness.', neg: true }],
    meds: [{ m: 'nitrofurantoin', name: 'nitrofurantoin', dose: [100], unit: 'mg', freq: [2], dur: [5, 7], dr: "I'll send nitrofurantoin, {dose} milligrams {freq} for {mdur} days", note: 'Nitrofurantoin {dose} mg {freq} for {mdur} days' }],
    fu: [3, 7] },
  { key: 'dm', cc: 'diabetes follow-up', dx: ['Type 2 diabetes mellitus without complications', 'E11.9'], chartProblems: ['Type 2 diabetes mellitus'], a1c: true,
    complaint: { pt: ["I'm here to go over my sugars", 'Here for my diabetes follow up'], note: ['follow-up of type 2 diabetes'], concepts: ['diabetes'], dur: null },
    assoc: [{ c: 'fatigue', pt: ["I've been more tired lately"], note: 'increased fatigue' }],
    negs: [{ c: 'hypoglycemia', ask: ['Any low blood sugars?', 'Any episodes of low blood sugar?'], note: 'hypoglycemic episodes' }, { c: 'vision', ask: ['Any blurry vision?'], note: 'vision changes' }, { c: 'numbness', ask: ['Any numbness or tingling in your feet?'], note: 'numbness in the feet' }],
    exam: [{ c: 'numbness', dr: ['Sensation in your feet is normal.'], note: 'Monofilament sensation intact bilaterally.', skipCheck: true }],
    meds: [{ m: 'metformin', name: 'metformin', dose: [1000], unit: 'mg', freq: [2], change: [500, 1000], dr: "Let's increase metformin from {from} to {dose} milligrams {freq}", note: 'Increase metformin to {dose} mg {freq}' }],
    fu: [84, 90] },
  { key: 'ankle', cc: 'ankle injury', dx: ['Sprain of ankle', 'S93.409A'], sided: true,
    complaint: { pt: ['I rolled my {side} ankle {dur} ago playing basketball', 'I twisted my {side} ankle {dur} ago'], note: ['{side} ankle pain after an inversion injury'], concepts: ['ankle_pain'], dur: [[1, 4, 'day']] , ago: true },
    assoc: [{ c: 'swelling', pt: ["and it's pretty swollen"], note: 'swelling' }],
    negs: [{ c: 'numbness', ask: ['Any numbness in the foot?'], note: 'numbness' }, { c: 'knee_pain', ask: ['Does your knee hurt at all?'], note: 'knee pain' }],
    exam: [{ c: 'swelling', dr: ["There's swelling over the outside of the {side} ankle."], note: 'Swelling over the lateral {side} ankle.' }],
    meds: [{ m: 'ibuprofen', name: 'ibuprofen', dose: [400, 600], unit: 'mg', freq: [3], dr: 'Take ibuprofen {dose} milligrams {freq} with food', note: 'Ibuprofen {dose} mg {freq} with food' }],
    fu: [7, 14] },
  { key: 'anxiety', cc: 'anxiety and sleep follow-up', dx: ['Generalized anxiety disorder', 'F41.1'], chartProblems: ['Generalized anxiety disorder'],
    complaint: { pt: ["The anxiety has been a little better but I'm still having trouble sleeping", "I'm still anxious and I can't sleep well"], note: ['follow-up of anxiety with ongoing insomnia'], concepts: ['anxiety', 'insomnia'], dur: null },
    assoc: [{ c: 'fatigue', pt: ["I'm tired during the day"], note: 'daytime fatigue' }],
    negs: [{ c: 'si', ask: ['Any thoughts of hurting yourself?'], note: 'suicidal ideation' }, { c: 'chest_pain', ask: ['Any chest pain or racing heart?'], note: 'chest pain' }],
    exam: [],
    meds: [{ m: 'sertraline', name: 'sertraline', dose: [50, 100], unit: 'mg', freq: [1], change: [25, 50], dr: "Let's go up on the sertraline from {from} to {dose} milligrams {freq}", note: 'Increase sertraline to {dose} mg {freq}' }],
    fu: [28, 42] },
  { key: 'migraine', cc: 'headaches', dx: ['Migraine without aura', 'G43.009'], sided: true,
    complaint: { pt: ["I've been getting bad headaches on the {side} side for {dur}", 'These headaches on my {side} side started {dur} ago'], note: ['{side}-sided headaches'], concepts: ['headache'], dur: [[2, 8, 'week']] },
    assoc: [{ c: 'photophobia', pt: ['and the light bothers me when they come'], note: 'photophobia' }, { c: 'nausea', pt: ['and I feel sick to my stomach with them'], note: 'nausea' }],
    negs: [{ c: 'vision', ask: ['Any loss of vision?'], note: 'vision loss' }, { c: 'numbness', ask: ['Any numbness or weakness?'], note: 'numbness or weakness' }, { c: 'fever', ask: ['Any fevers?'], note: 'fever' }],
    exam: [],
    meds: [{ m: 'sumatriptan', name: 'sumatriptan', dose: [50, 100], unit: 'mg', freq: ['prn'], dr: 'Take sumatriptan {dose} milligrams {freq} at the start of a headache', note: 'Sumatriptan {dose} mg {freq} at headache onset' }],
    fu: [28, 42] },
  { key: 'bronchitis', cc: 'cough', dx: ['Acute bronchitis', 'J20.9'],
    complaint: { pt: ["I've had this cough for {dur}", 'This cough has been going on {dur}'], note: ['cough'], concepts: ['cough'], dur: [[7, 14, 'day'], [2, 3, 'week']] },
    assoc: [{ c: 'sore_throat', pt: ['and my throat is sore'], note: 'sore throat' }],
    negs: [{ c: 'fever', ask: ['Any fevers?'], note: 'fever' }, { c: 'dyspnea', ask: ['Any shortness of breath?'], note: 'shortness of breath' }, { c: 'chest_pain', ask: ['Any chest pain?'], note: 'chest pain' }],
    exam: [{ c: 'lungs_clear', dr: ['Your lungs sound clear, no wheezing.', 'Lungs are clear.'], note: 'Lungs clear to auscultation, no wheezes.' }],
    meds: [{ m: 'benzonatate', name: 'benzonatate', dose: [100, 200], unit: 'mg', freq: [3], dr: "I'll give you benzonatate {dose} milligrams {freq} for the cough", note: 'Benzonatate {dose} mg {freq} as needed for cough' }],
    fu: [7, 14] },
];

const FIRST_F = ['Maria', 'Priya', 'Grace', 'Hannah', 'Emily', 'Sofia', 'Aisha', 'Chloe', 'Leah', 'Nina'];
const FIRST_M = ['James', 'Daniel', 'Luis', 'Omar', 'Marcus', 'Ethan', 'Noah', 'Kevin', 'Victor', 'Samuel'];
const LAST = ['Alvarez', 'Chen', 'Patel', 'Brooks', 'Nguyen', 'Romero', 'Fischer', 'Haddad', 'Sullivan', 'Okafor', 'Kim', 'Morales', 'Bennett', 'Ward', 'Foster', 'Ibrahim', 'Cole', 'Reyes', 'Price', 'Shah'];
const PROVIDERS = ['Diana Hudson', 'Michael Torres', 'Anjali Rao', 'Robert Lin'];
const FILLER = [[['Dr', 'How has work been going?'], ['Pt', 'Pretty busy, but okay.']], [['Pt', 'Um, sorry, my phone keeps buzzing.'], ['Dr', 'No problem at all.']], [['Dr', 'Let me pull up your chart here.'], ['Pt', 'Sure.']], [['Dr', 'You look comfortable today.'], ['Pt', 'I feel alright right now.']]];
const FAB_SYM = [['dizziness', 'intermittent dizziness'], ['chest_pain', 'chest pain with exertion'], ['nausea', 'nausea'], ['rash', 'a new rash on the forearm'], ['numbness', 'numbness in both hands'], ['vomiting', 'two episodes of vomiting']];
const FAB_EXAM = ['Expiratory wheezing heard in both lung fields.', 'Mild erythema of the pharynx.', 'Trace bilateral lower extremity edema.', 'Mild tenderness to palpation of the abdomen.'];
const ALT_MED = { naproxen: 'ibuprofen', ibuprofen: 'naproxen', sumatriptan: 'rizatriptan', sertraline: 'escitalopram', nitrofurantoin: 'cephalexin', benzonatate: 'guaifenesin', lisinopril: 'amlodipine', metformin: 'glipizide', fluticasone: 'cetirizine', acetaminophen: 'ibuprofen', saline: 'fluticasone' };
const ERRTYPES = ['negation', 'laterality', 'duration', 'dose', 'frequency', 'medication', 'fabricated', 'chart', 'followup'];

function makeVisit(i) {
  const sc = pick(S);
  const side = sc.sided ? pick(['left', 'right']) : null;
  const other = side === 'left' ? 'right' : 'left';
  const sex = chance(0.5) ? 'F' : 'M';
  const patient = { first: pick(sex === 'F' ? FIRST_F : FIRST_M), last: pick(LAST), age: 22 + Math.floor(rnd() * 55), sex };
  const allergies = sc.allergyBias && chance(0.5) ? ['Sulfa drugs'] : chance(0.3) ? [pick(['Penicillin', 'Sulfa drugs', 'Codeine'])] : [];
  const chart = { allergies, problems: [...(sc.chartProblems || []), ...(chance(0.3) ? ['Hyperlipidemia'] : [])], meds: chance(0.4) ? ['Atorvastatin 20 mg daily'] : [] };
  let dur = null;
  if (sc.complaint.dur) { const [lo, hi, u] = pick(sc.complaint.dur); dur = { n: lo + Math.floor(rnd() * (hi - lo + 1)), u }; }
  const assoc = sc.assoc.filter(() => chance(0.75));
  const negs = sc.negs.filter(() => chance(0.85));
  if (!negs.length) negs.push(sc.negs[0]);
  const exam = sc.exam.filter(() => chance(0.85));
  const meds = sc.meds.filter((m, j) => j === 0 || chance(0.6)).map((m) => {
    const dose = m.dose ? pick(m.dose) : null;
    const freq = pick(m.freq);
    const mdur = m.dur ? pick(m.dur) : null;
    return { ...m, doseV: dose, freqV: freq, mdur, from: m.change ? dose / 2 : null };
  });
  const fu = pick(sc.fu);
  const vit = sc.vitals ? { s: 138 + Math.floor(rnd() * 20), d: 86 + Math.floor(rnd() * 10) } : null;
  const a1c = sc.a1c ? (72 + Math.floor(rnd() * 18)) / 10 : null;

  // ---------- transcript ----------
  const T = [];
  const say = (spk, text) => T.push([spk, text]);
  say('Dr', pick([`Hi ${patient.first}, what brings you in today?`, `Hi ${patient.first}, how can I help today?`]));
  const sub = (s) => s.replace(/{side}/g, side || '').replace(/{dur}/g, dur ? durPt(dur.n, dur.u) : '');
  let first = sub(pick(sc.complaint.pt));
  if (assoc[0] && chance(0.6)) first += ', ' + sub(pick(assoc[0].pt));
  say('Pt', first + '.');
  if (chance(0.5)) for (const f of pick(FILLER)) say(...f);
  for (const [k, a] of assoc.entries()) if (!(k === 0 && first.includes(sub(a.pt[0]).slice(4, 18)))) { say('Dr', pick(['Anything else going on?', 'Any other symptoms?'])); say('Pt', cap(sub(pick(a.pt)).replace(/^and |^also /, '')) + '.'); }
  for (const n of shuffle(negs)) { say('Dr', pick(n.ask)); say('Pt', pick(['No.', 'Nope.', 'No, none of that.', "Not that I've noticed.", 'No, not really.'])); }
  if (chance(0.5)) for (const f of pick(FILLER)) say(...f);
  if (vit) say('Dr', `Your blood pressure today is ${words(vit.s)} over ${words(vit.d)}.`);
  if (a1c) say('Dr', `Your A1c came back at ${words(Math.floor(a1c))} point ${words(Math.round((a1c % 1) * 10))}.`);
  if (exam.length) say('Dr', pick(["Let me take a look.", "I'm going to examine you now."]));
  for (const e of exam) say('Dr', pick(e.dr).replace(/{side}/g, side || ''));
  say('Dr', `I think this is ${pick([sc.dx[0].toLowerCase(), sc.cc.includes('follow') ? sc.dx[0].toLowerCase() : sc.dx[0].toLowerCase()])}.`);
  for (const m of meds) {
    const fq = pick(FREQ_PT[m.freqV]);
    say('Dr', cap(m.dr.replace('{dose}', m.doseV ? words(m.doseV) : '').replace('{freq}', fq).replace('{from}', m.from ? words(m.from) : '').replace('{mdur}', m.mdur ? words(m.mdur) : '')) + '.');
  }
  say('Dr', pick([`Let's follow up in ${fu % 7 === 0 && fu >= 14 ? words(fu / 7) + ' weeks' : words(fu) + ' days'}.`, `Come back and see me in ${fu % 7 === 0 && fu >= 14 ? words(fu / 7) + ' weeks' : words(fu) + ' days'}.`]));
  say('Pt', pick(['Sounds good, thank you.', 'Okay, thanks doctor.']));
  let sec = 30 + Math.floor(rnd() * 20);
  const transcript = T.map(([spk, text]) => { const ts = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; sec += 6 + Math.floor(rnd() * 22); return { spk, ts, text }; });

  // ---------- note (facts -> sentences) ----------
  const note = { Subjective: [], Objective: [], Assessment: [], Plan: [] };
  const add = (secName, text, err = null) => note[secName].push({ text, err });
  // decide errors first
  const applicable = ['negation', 'fabricated', 'dose', 'followup', 'medication', 'frequency'];
  if (side) applicable.push('laterality');
  if (dur) applicable.push('duration');
  if (allergies.length) applicable.push('chart');
  const errs = new Set();
  if (chance(0.5)) { errs.add(pick(applicable)); if (chance(0.3)) errs.add(pick(applicable)); }
  if (errs.has('dose') && !meds.some((m) => m.doseV)) errs.delete('dose');
  if (errs.has('frequency') && !meds.some((m) => m.freqV !== 'prn')) errs.delete('frequency');

  const nSide = errs.has('laterality') ? other : side;
  let nDur = dur;
  if (errs.has('duration')) nDur = chance(0.5) ? { n: dur.n, u: dur.u === 'day' ? 'week' : dur.u === 'week' ? 'month' : 'week' } : { n: dur.n + (dur.n > 2 ? -1 : 2) * (1 + Math.floor(rnd() * 2)), u: dur.u };
  const cTxt = pick(sc.complaint.note).replace(/{side}/g, nSide || '');
  const age = `${patient.age}-year-old ${sex === 'F' ? 'female' : 'male'}`;
  let open;
  if (nDur && !sc.complaint.ago) open = chance(0.5) ? `${age} presents with a ${durHist(nDur.n, nDur.u)} ${cTxt}.` : `${age} presents with ${cTxt} ${durNote(nDur.n, nDur.u)}.`;
  else if (nDur) open = `${age} presents with ${cTxt} that began ${nDur.n} ${nDur.u}${nDur.n > 1 ? 's' : ''} ago.`;
  else open = `${age} presents for ${cTxt}.`;
  add('Subjective', cap(open), errs.has('laterality') || errs.has('duration') ? (errs.has('laterality') ? 'laterality' : 'duration') : null);
  // assoc positives (maybe flipped to "denies")
  let flipPos = errs.has('negation') && assoc.length && chance(0.5) ? assoc[Math.floor(rnd() * assoc.length)] : null;
  for (const a of assoc) {
    const t = a.note.replace(/{side}/g, nSide || '');
    if (a === flipPos) add('Subjective', `Denies ${t}.`, 'negation');
    else add('Subjective', `Also reports ${t}.`);
  }
  let flipNeg = errs.has('negation') && !flipPos ? negs[Math.floor(rnd() * negs.length)] : null;
  const negList = negs.filter((n) => n !== flipNeg).map((n) => n.note);
  if (negList.length) add('Subjective', `Denies ${negList.length > 2 ? negList.slice(0, -1).join(', ') + ', or ' + negList[negList.length - 1] : negList.join(' or ')}.`);
  if (flipNeg) add('Subjective', `Reports ${flipNeg.note}.`, 'negation');
  if (errs.has('fabricated') && chance(0.5)) { const f = pick(FAB_SYM.filter(([c]) => !negs.some((n) => n.c === c) && !assoc.some((a) => a.c === c))); add('Subjective', `Also reports ${f[1]}.`, 'fabricated'); errs.add('_fabSub'); }
  if (chart.problems.length && chance(0.6)) add('Subjective', `History of ${chart.problems.map((p) => p.toLowerCase()).join(' and ')}.`);
  if (errs.has('chart')) add('Subjective', pick(['No known drug allergies.', 'NKDA.']), 'chart');
  else if (!allergies.length && chance(0.5)) add('Subjective', 'No known drug allergies.');
  // objective
  if (vit) add('Objective', `BP ${vit.s}/${vit.d}.`);
  if (a1c) add('Objective', `Hemoglobin A1c ${a1c.toFixed(1)}%.`);
  if (chance(0.3)) add('Objective', 'Alert and oriented, in no acute distress.');
  for (const e of exam) add('Objective', e.note.replace(/{side}/g, nSide || ''), errs.has('laterality') && /{side}/.test(e.note) ? 'laterality' : null);
  if (errs.has('fabricated') && !errs.has('_fabSub')) add('Objective', pick(FAB_EXAM), 'fabricated');
  // assessment
  add('Assessment', `${sc.dx[0]} (ICD-10: ${sc.dx[1]}).`);
  // plan
  let medErrDone = false;
  for (const m of meds) {
    let name = m.name, dose = m.doseV, freq = m.freqV, label = null;
    if (!medErrDone && errs.has('dose') && dose) { dose = dose === 1000 ? 500 : dose * 2; label = 'dose'; medErrDone = true; }
    else if (!medErrDone && errs.has('frequency') && freq !== 'prn') { freq = freq === 2 ? 3 : 2; label = 'frequency'; medErrDone = true; }
    else if (!medErrDone && errs.has('medication')) { name = ALT_MED[m.m]; label = 'medication'; medErrDone = true; }
    let t = m.note.replace('{dose}', dose ?? '').replace('{freq}', pick(FREQ_NOTE[freq])).replace('{mdur}', m.mdur ?? '');
    if (label === 'medication') t = t.replace(/^Saline nasal spray/i, cap(name)).replace(new RegExp('^' + m.name, 'i'), cap(name)).replace(new RegExp(m.name, 'i'), name);
    add('Plan', cap(t) + '.', label);
  }
  if (errs.has('medication') && !medErrDone) errs.delete('medication');
  let nfu = fu;
  if (errs.has('followup')) nfu = fu >= 14 ? fu + 14 : fu * 2;
  const fuTxt = nfu % 7 === 0 && nfu >= 14 ? `${nfu / 7} weeks` : `${nfu} days`;
  add('Plan', `Follow up in ${fuTxt}.`, errs.has('followup') ? 'followup' : null);

  return { id: `V${String(i + 1).padStart(4, '0')}`, scenario: sc.key, cc: sc.cc, dx: sc.dx, patient, provider: pick(PROVIDERS), noteType: sc.key === 'anxiety' ? 'Psych Progress' : 'SOAP', chart, transcript, note };
}

const visits = Array.from({ length: 1200 }, (_, i) => makeVisit(i));
// Answer key kept in a separate array so the checker never reads it.
const labels = visits.map((v) => Object.fromEntries(Object.entries(v.note).map(([k, ss]) => [k, ss.map((s) => s.err)])));
for (const v of visits) for (const k of Object.keys(v.note)) v.note[k] = v.note[k].map((s) => s.text);
writeFileSync(new URL('../data/visits.json', import.meta.url), JSON.stringify({ meta: { seed: SEED, n: visits.length, generated: '2026-11-10' }, visits, labels }));
const nErr = labels.reduce((a, l) => a + Object.values(l).flat().filter(Boolean).length, 0);
const byType = {};
labels.forEach((l) => Object.values(l).flat().filter(Boolean).forEach((t) => (byType[t] = (byType[t] || 0) + 1)));
console.log(`visits=${visits.length} errors=${nErr} notesWithErrors=${labels.filter((l) => Object.values(l).flat().some(Boolean)).length}`, byType);
