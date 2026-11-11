// Small clinical lexicon: surface phrases (clinical and colloquial) -> concept ids.
// Longest phrases are matched first. This is a hand-built stand-in for a UMLS-style
// concept normalizer; it deliberately does not cover every phrasing the simulator uses.

export const CONCEPTS = {
  fever: ['fever', 'fevers', 'febrile', 'running a temperature'],
  chills: ['chills', 'chill'],
  cough: ['cough', 'coughing'],
  congestion: ['nasal congestion', 'congestion', 'stuffy nose', 'stuffed up', 'blocked nose', 'congested'],
  facial_pressure: ['facial pressure', 'pressure in my cheeks', 'pressure in my face', 'sinus pressure', 'face pressure'],
  headache: ['headache', 'headaches', 'head hurts', 'head pain', 'migraine', 'migraines'],
  sore_throat: ['sore throat', 'throat hurts', 'throat is sore'],
  dyspnea: ['shortness of breath', 'short of breath', 'dyspnea', 'trouble breathing', 'winded', 'catch my breath'],
  chest_pain: ['chest pain', 'chest pains', 'pain in my chest', 'chest hurts'],
  wheezing: ['wheezing', 'wheeze', 'wheezes'],
  nausea: ['nausea', 'nauseous', 'sick to my stomach'],
  vomiting: ['vomiting', 'throwing up', 'threw up', 'emesis'],
  dysuria: ['dysuria', 'burning with urination', 'burns when i pee', 'burning when i pee', 'painful urination', 'burns when i urinate'],
  frequency: ['urinary frequency', 'frequency', 'going to the bathroom a lot', 'peeing a lot', 'urinating frequently', 'have to go all the time'],
  flank_pain: ['flank pain', 'pain in my side', 'side pain', 'back on the side'],
  hematuria: ['hematuria', 'blood in my urine', 'blood in the urine', 'blood in urine'],
  knee_pain: ['knee pain', 'knee hurts', 'knee has been hurting', 'knee is hurting', 'pain in my knee', 'knee'],
  ankle_pain: ['ankle pain', 'ankle hurts', 'ankle', 'rolled my ankle', 'ankle sprain', 'sprained ankle'],
  back_pain: ['low back pain', 'lower back pain', 'back pain', 'back hurts', 'my back', 'lower back'],
  radiation_leg: ['radiating down', 'radiates down', 'shoots down', 'goes down my', 'down the leg', 'down my leg', 'radiation'],
  swelling: ['swelling', 'swollen', 'edema', 'puffy'],
  numbness: ['numbness', 'numb', 'tingling', 'pins and needles'],
  bladder: ['bowel or bladder', 'bladder control', 'loss of bladder', 'incontinence', 'trouble controlling your bladder'],
  photophobia: ['photophobia', 'light sensitivity', 'sensitive to light', 'light bothers me', 'bright lights'],
  vision: ['vision changes', 'vision loss', 'blurry vision', 'trouble seeing', 'loss of vision'],
  dizziness: ['dizziness', 'dizzy', 'lightheaded', 'light headed'],
  fatigue: ['fatigue', 'tired', 'exhausted', 'low energy'],
  insomnia: ['insomnia', 'trouble sleeping', 'difficulty sleeping', "can't sleep", 'not sleeping'],
  anxiety: ['anxiety', 'anxious', 'worried all the time', 'on edge'],
  si: ['suicidal ideation', 'thoughts of hurting yourself', 'thoughts of self-harm', 'suicidal thoughts', 'hurting myself'],
  hypoglycemia: ['hypoglycemia', 'low blood sugar', 'low blood sugars', 'sugar drops', 'shaky and sweaty'],
  polyuria: ['polyuria', 'excessive urination'],
  rash: ['rash', 'hives'],
  lungs_clear: ['lungs clear', 'lungs are clear', 'lungs sound clear', 'clear to auscultation', 'lungs sound good'],
  sinus_tender: ['sinus tenderness', 'sinuses are tender', 'tender over the sinuses', 'tender over your sinuses', 'tenderness over the maxillary sinuses'],
  cva_tender: ['cva tenderness', 'costovertebral angle tenderness', 'tender when i tap your back', 'tenderness when i tap'],
  joint_tender: ['joint line tenderness', 'tender along the joint', 'tenderness along the joint line'],
  effusion: ['effusion', 'fluid in the knee', 'fluid on the knee'],
  slr: ['straight leg raise', 'leg raise'],
  alert_oriented: ['alert and oriented', 'no acute distress'],
  hypertension: ['hypertension', 'high blood pressure', 'htn'],
  diabetes: ['type 2 diabetes', 'diabetes', 't2dm'],
  sinusitis: ['sinusitis', 'sinus infection'],
  uti: ['urinary tract infection', 'uti', 'bladder infection'],
  bronchitis: ['bronchitis', 'chest cold'],
  sprain: ['sprain', 'sprained'],
  osteoarthritis: ['osteoarthritis', 'arthritis'],
  hyperlipidemia: ['hyperlipidemia', 'high cholesterol'],
  radiculopathy: ['radiculopathy', 'pinched nerve'],
  cystitis: ['cystitis'],
};

export const MEDS = {
  acetaminophen: ['acetaminophen', 'tylenol'],
  ibuprofen: ['ibuprofen', 'advil', 'motrin'],
  naproxen: ['naproxen', 'aleve', 'naprosyn'],
  lisinopril: ['lisinopril'],
  amlodipine: ['amlodipine', 'norvasc'],
  metformin: ['metformin'],
  nitrofurantoin: ['nitrofurantoin', 'macrobid'],
  smx_tmp: ['sulfamethoxazole-trimethoprim', 'bactrim', 'sulfamethoxazole'],
  amoxicillin: ['amoxicillin', 'augmentin', 'amoxicillin-clavulanate'],
  cephalexin: ['cephalexin', 'keflex'],
  sertraline: ['sertraline', 'zoloft'],
  escitalopram: ['escitalopram', 'lexapro'],
  sumatriptan: ['sumatriptan', 'imitrex'],
  rizatriptan: ['rizatriptan', 'maxalt'],
  benzonatate: ['benzonatate', 'tessalon'],
  fluticasone: ['fluticasone', 'flonase'],
  saline: ['saline nasal spray', 'saline spray', 'saline rinse', 'nasal saline'],
  trazodone: ['trazodone'],
  guaifenesin: ['guaifenesin', 'mucinex'],
  glipizide: ['glipizide'],
  cetirizine: ['cetirizine', 'zyrtec'],
};
export const MED_CLASS = { amoxicillin: 'penicillin', cephalexin: 'cephalosporin', smx_tmp: 'sulfa' };
export const ALLERGY_CLASS = { penicillin: ['penicillin', 'amoxicillin'], sulfa: ['sulfa', 'bactrim', 'sulfamethoxazole'], codeine: ['codeine'] };

export const SIDES = { left: ['left'], right: ['right'], bilateral: ['bilateral', 'both'] };
export const SIDED = new Set(['knee_pain', 'ankle_pain', 'radiation_leg', 'swelling', 'headache', 'flank_pain', 'joint_tender', 'effusion', 'slr']);

export const NUM_WORDS = { a: 1, an: 1, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, couple: 2, few: 3 };

export const FREQ = [
  [/\b(every (6|six) hours|(four|4) times (a|per) day|(four|4) times daily|qid)\b/, 4],
  [/\b((three|3) times (a|per) day|(three|3) times daily|tid|t\.i\.d\.)\b/, 3],
  [/\b(twice (a|per) day|twice daily|(two|2) times (a|per) day|(two|2) times daily|bid|b\.i\.d\.|morning and night)\b/, 2],
  [/\b(once (a|per) day|once daily|daily|every day|every morning|qd|each day)\b/, 1],
  [/\b(as needed|prn|when you need it|if needed)\b/, 'prn'],
];

// Negation triggers (NegEx-style). Pre-triggers negate concepts that follow within the scope;
// a scope ends at a terminator or the end of the clause.
export const NEG_PRE = ['denies', 'denied', 'no', 'not', 'without', 'negative for', 'free of', 'never', "doesn't", "don't", "didn't", 'absence of', 'none'];
export const NEG_TERM = ['but', 'however', 'reports', 'endorses', 'although', 'except', 'which', 'and reports', 'positive for'];
export const NO_ANSWER = /^(no|nope|nah|not really|not that i've noticed|none|not at all|i don't think so|no,|no\.)/;
export const YES_ANSWER = /^(yes|yeah|yep|a little|some|kind of|actually yes|sometimes|uh huh|definitely)/;
