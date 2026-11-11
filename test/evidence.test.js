import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spokenToDigits, extract, indexTranscript, checkSentence, crcThreshold, trainLogistic, score, runPipeline, bm25, tokens, norm } from '../core/evidence.js';

const data = JSON.parse(readFileSync(new URL('../data/visits.json', import.meta.url)));
const T = (pairs) => pairs.map(([spk, text], i) => ({ spk, text, ts: `00:${String(10 + i).padStart(2, '0')}` }));
const chart0 = { allergies: [], problems: [], meds: [] };

test('spoken numbers become digits without breaking frequencies', () => {
  assert.equal(spokenToDigits('five hundred milligrams twice a day'), '500 milligrams twice a day');
  assert.equal(spokenToDigits('for about a week'), 'for about 1 week');
  assert.equal(spokenToDigits('A1c came back at eight point four'), 'A1c came back at 8.4');
  assert.equal(spokenToDigits('increase from five hundred to one thousand milligrams'), 'increase from 500 to 1000 milligrams');
  assert.equal(spokenToDigits('I twisted it a day ago'), 'I twisted it 1 day ago');
});

test('NegEx-style scope negates a whole list and stops at "no" boundaries correctly', () => {
  const f = extract('Denies fever, chills, or shortness of breath.');
  assert.deepEqual(f.concepts.map((c) => [c.c, c.pol]), [['fever', -1], ['chills', -1], ['dyspnea', -1]]);
  const g = extract('Lungs clear to auscultation, no wheezes.');
  assert.deepEqual(g.concepts.map((c) => [c.c, c.pol]), [['lungs_clear', 1], ['wheezing', -1]]);
});

test('frequency parsing prefers the specific pattern', () => {
  const freq = (s) => extract(s).meds[0].freq;
  assert.equal(freq('Naproxen 500 mg TID with food.'), 3);
  assert.equal(freq('Naproxen 500 mg three times daily.'), 3);
  assert.equal(freq('naproxen, 500 milligrams twice a day'), 2);
  assert.equal(freq('Benzonatate 100 mg TID as needed for cough.'), 3);
  assert.equal(freq('Sumatriptan 50 mg PRN.'), 'prn');
});

test('a "no" answer inherits the question concepts; the question itself asserts nothing', () => {
  const idx = indexTranscript(T([['Dr', 'Any fevers?'], ['Pt', 'Nope.']]));
  assert.deepEqual(idx.facts[0].concepts.map((c) => c.pol), [0]);
  assert.deepEqual(idx.facts[1].concepts.map((c) => [c.c, c.pol]), [['fever', -1]]);
});

test('checker finds dose, laterality, negation, follow-up and chart conflicts with fixes', () => {
  const idx = indexTranscript(T([
    ['Pt', 'My left knee has been hurting for about three weeks.'], ['Dr', 'Any fevers?'], ['Pt', 'No.'],
    ['Dr', "Let's try naproxen, five hundred milligrams twice a day with food."], ['Dr', 'Come back and see me in two weeks.'],
  ]));
  const chart = { allergies: ['Sulfa drugs'], problems: [], meds: [] };
  const one = (t, sec) => checkSentence(t, sec, idx, chart).findings;
  assert.deepEqual(one('Naproxen 250 mg twice daily with food.', 'Plan').map((f) => [f.type, f.fix.to]), [['dose', '500 mg']]);
  assert.equal(one('Naproxen 500 mg TID with food.', 'Plan')[0].type, 'frequency');
  assert.deepEqual(one('Right knee pain for 3 weeks.', 'Subjective').map((f) => [f.type, f.fix?.to]), [['laterality', 'left']]);
  assert.equal(one('Reports fever.', 'Subjective')[0].type, 'negation');
  assert.equal(one('Knee pain for 3 months.', 'Subjective')[0].type, 'duration');
  assert.equal(one('Follow up in 4 weeks.', 'Plan')[0].type, 'followup');
  assert.equal(one('No known drug allergies.', 'Subjective')[0].kind, 'chart');
  assert.equal(one('Start ibuprofen 600 mg TID.', 'Plan')[0].type, 'medication');
  assert.deepEqual(one('Naproxen 500 mg twice daily with food.', 'Plan'), []);
  assert.deepEqual(one('Left knee pain for 3 weeks.', 'Subjective'), []);
});

test('BM25 ranks the matching turn first', () => {
  const idx = indexTranscript(T([['Dr', 'How is work?'], ['Pt', 'My lower back has been hurting for a week.'], ['Dr', 'Lungs sound clear.']]));
  assert.equal(bm25(idx, tokens(norm('low back pain for one week')))[0].i, 1);
});

test('logistic regression separates a simple signal', () => {
  const X = [], y = [];
  for (let i = 0; i < 200; i++) { const v = (i % 10) / 10; X.push([1, v]); y.push(v > 0.5 ? 1 : 0); }
  const w = trainLogistic(X, y, { iters: 800 });
  assert.ok(score(w, [1, 0.9]) > 0.7 && score(w, [1, 0.1]) < 0.3);
});

test('conformal risk control picks the largest threshold that satisfies the corrected bound', () => {
  let a = 3; const rnd = () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
  const units = Array.from({ length: 200 }, () => ({ errs: Array.from({ length: 1 + Math.floor(rnd() * 3) }, rnd) }));
  const alpha = 0.1;
  const { lambda, n } = crcThreshold(units, alpha);
  const loss = (l) => units.reduce((s, u) => s + u.errs.filter((x) => x < l).length / u.errs.length, 0) / n;
  assert.ok((n / (n + 1)) * loss(lambda) + 1 / (n + 1) <= alpha + 1e-12);
  assert.ok((n / (n + 1)) * loss(lambda + 0.01) + 1 / (n + 1) > alpha);
});

const P = runPipeline(data);

test('held-out results meet the 95% target and thresholds are monotone in the target', () => {
  const l05 = crcThreshold(P.calUnits, 0.05).lambda, l20 = crcThreshold(P.calUnits, 0.2).lambda;
  assert.ok(l20 >= l05);
  const e = P.evaluate(l05, P.test);
  assert.ok(e.recall >= 0.9, `recall ${e.recall}`);
  assert.ok(e.meanNoteMiss <= 0.1, `per-note miss ${e.meanNoteMiss}`);
  assert.ok(e.falsePerNote < 0.25, `false flags/note ${e.falsePerNote}`);
});

test('no label leakage: test-set labels never change scores or the threshold', () => {
  const shuffled = { ...data, labels: data.labels.map((l, i) => (i >= P.split.b ? data.labels[(i * 7) % P.split.b] : l)) };
  const Q = runPipeline(shuffled);
  const a = P.test.flatMap((r) => r.sentences.map((s) => s.score));
  const b = Q.test.flatMap((r) => r.sentences.map((s) => s.score));
  assert.deepEqual(a, b);
  assert.equal(crcThreshold(P.calUnits, 0.05).lambda, crcThreshold(Q.calUnits, 0.05).lambda);
});
