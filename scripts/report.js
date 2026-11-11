// Prints the evaluation numbers the demo shows (same code path as the page).
import { readFileSync } from 'node:fs';
import { runPipeline, crcThreshold, FEATURE_NAMES } from '../core/evidence.js';
const data = JSON.parse(readFileSync(new URL('../data/visits.json', import.meta.url)));
const t0 = Date.now();
const P = runPipeline(data);
console.log(`ms=${Date.now() - t0} split train/cal/test=${P.split.a}/${P.split.b - P.split.a}/${P.split.n - P.split.b}`);
console.log('weights', FEATURE_NAMES.map((n, i) => `${n}=${P.w[i].toFixed(2)}`).join(' '));
for (const alpha of [0.05, 0.1, 0.2]) {
  const c = crcThreshold(P.calUnits, alpha);
  const e = P.evaluate(c.lambda, P.test);
  console.log(`alpha=${alpha} lambda=${c.lambda.toFixed(3)} nCal=${c.n} calMiss=${c.empiricalMiss.toFixed(3)} | test recall=${(e.recall * 100).toFixed(1)}% (${e.caught}/${e.errs}) meanNoteMiss=${(e.meanNoteMiss * 100).toFixed(1)}% precision=${(e.precision * 100).toFixed(1)}% falseFlags/note=${e.falsePerNote.toFixed(2)} flags/cleanNote=${e.flagsPerCleanNote.toFixed(2)}`);
  if (alpha === 0.1) console.log('  byType', JSON.stringify(e.byType));
}
