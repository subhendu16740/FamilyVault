// Offline self-test of the QA machinery itself — no network, no budget.
//
//   node tools/selftest.mjs
//
// Proves the answer matchers accept the forms real answers take (and reject
// near misses), that judgeAnswer() flags what it should, that the run-time
// vehicle PDF is read by the server's own layout code, that the server's
// metadata extraction and text cleaning behave (imported from
// supabase/functions/_shared/, not copied), and that questions.yaml is valid
// and each suite stays inside its Groq budget.
// CI runs it before any live check, so a broken matcher can never show up
// as a "failing app".

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-serverless';
import { reconstructLayout } from '../../supabase/functions/_shared/pdf-text.ts';
import { extractMetadata, parseFlexibleDate } from '../../supabase/functions/_shared/metadata.ts';
import { cleanText } from '../../supabase/functions/_shared/text.ts';
import { mentionsDate, mentionsAmount, mentionsPhone, mentionsText, refuses, devanagariShare, hasMarkdown } from '../lib/match.mjs';
import { judgeAnswer } from '../lib/checks/ask.mjs';
import { vehicleInsurance } from '../lib/tiny-pdf.mjs';
import { loadQuestions, selectQuestions, groupCount, rotationGroup, estimateFor } from '../lib/questions.mjs';
import { documents, permanentDocuments } from '../fixtures/documents.mjs';

let passed = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; })
    .catch((err) => failures.push(`${name}: ${err.message}`));
}

await test('dates in every common form', () => {
  for (const s of ['on 19/07/2033', 'on 19-07-2033', '19.7.2033', 'expires 19 July 2033.', '19th July, 2033', 'July 19, 2033', '2033-07-19', '19 जुलाई 2033 को', '१९/०७/२०३३']) {
    assert.ok(mentionsDate(s, '2033-07-19'), s);
  }
  for (const s of ['on 20/07/2033', 'July 2033', '19/07/2032', '119/07/2033']) assert.ok(!mentionsDate(s, '2033-07-19'), s);
});

await test('amounts with Indian grouping and lakh', () => {
  for (const s of ['₹3,00,000', 'Rs. 300000', 'INR 300,000', '3 lakh', '₹ 3.0 lakhs', '३,००,०००']) assert.ok(mentionsAmount(s, 300000), s);
  assert.ok(!mentionsAmount('₹10,00,000', 300000));
  assert.ok(mentionsAmount('₹10,00,000', 1000000));
  assert.ok(mentionsAmount('the rent is Rs. 32,000 a month', 32000));
});

await test('phones, identifiers, refusals, script, markdown', () => {
  assert.ok(mentionsPhone('Her number is +91 98220 41937.', '9822041937'));
  assert.ok(!mentionsPhone('+91 90110 23452', '9822041937'));
  assert.ok(mentionsText('Passport no. z 739-1046', 'Z7391046'));
  assert.ok(mentionsText('declared: Hypothyroidism', 'hypothyroidism'));
  for (const s of ["I couldn't find anything in your documents that answers that.", 'None of your documents mention a chassis number.', 'The blood group is not mentioned in the documents.', 'There is no vehicle document in your vault.']) {
    assert.ok(refuses(s), s);
  }
  assert.ok(!refuses("Asha Verma's passport expires on 19 July 2033."));
  assert.ok(devanagariShare('आशा वर्मा का पासपोर्ट 19 जुलाई 2033 को समाप्त होगा।') > 0.9);
  assert.ok(devanagariShare('The passport expires in 2033.') === 0);
  assert.ok(hasMarkdown('**19 July 2033**') && hasMarkdown('- item') && !hasMarkdown('It expires on 19 July 2033.'));
});

const questions = loadQuestions(new URL('../questions.yaml', import.meta.url));
const byId = new Map(questions.map((q) => [q.id, q]));
const passport = [{ file_name: 'passport_asha_verma_specimen_v1.pdf' }];
const healthy = { embedded: true, models: { answer: 'openai/gpt-oss-120b' } };

await test('judgeAnswer accepts correct answers', () => {
  assert.deepEqual(judgeAnswer(byId.get('passport-expiry'), { answer: "Asha Verma's passport expires on 19 July 2033.", sources: passport, debug: healthy }), []);
  assert.deepEqual(judgeAnswer(byId.get('hindi-question'), { answer: 'आशा वर्मा का पासपोर्ट 19 जुलाई 2033 को समाप्त होगा।', sources: passport, answer_language: 'hi-IN', debug: healthy }), []);
  assert.deepEqual(judgeAnswer(byId.get('no-such-document'), { answer: "I couldn't find anything in your documents that answers that.", sources: [], debug: healthy }), []);
  assert.deepEqual(judgeAnswer(byId.get('policy-table-row'), { answer: 'The sum insured for Kamala Verma is ₹3,00,000.', sources: [{ file_name: 'health_policy_verma_specimen_v1.pdf' }], debug: healthy }), []);
});

await test('judgeAnswer catches wrong answers', () => {
  const wrongDate = judgeAnswer(byId.get('passport-expiry'), { answer: 'It expires on 20 July 2033.', sources: passport, debug: healthy });
  assert.ok(wrongDate.some((r) => r.includes('2033-07-19')));
  const invented = judgeAnswer(byId.get('no-such-document'), { answer: 'The chassis number is MA3EWDE1S00123456.', sources: [], debug: healthy });
  assert.equal(invented.length, 2);
  const otherRow = judgeAnswer(byId.get('policy-table-row'), { answer: 'Kamala Verma is covered for ₹10,00,000.', sources: [{ file_name: 'health_policy_verma_specimen_v1.pdf' }], debug: healthy });
  assert.equal(otherRow.length, 2);
  const fathers = judgeAnswer(byId.get('mobile-among-crowding-document'), { answer: 'Her mobile number is +91 90110 23452.', sources: [{ file_name: 'income_tax_return_rohan_ay2026_specimen_v1.pdf' }], debug: healthy });
  assert.equal(fathers.length, 3);
  const noVectors = judgeAnswer(byId.get('passport-expiry'), { answer: 'It expires on 19 July 2033.', sources: passport, debug: { embedded: false, embed_error: 'HTTP 410' } });
  assert.ok(noVectors.some((r) => r.includes('NOT embedded')));
  const markdown = judgeAnswer(byId.get('voice-mode'), { answer: 'It expires on **19 July 2033**.', sources: passport, debug: healthy });
  assert.ok(markdown.some((r) => r.includes('markdown')));
});

await test('the run-time vehicle PDF reads as a text layer with its facts', async () => {
  const v = vehicleInsurance({ today: new Date('2026-09-27T12:00:00Z'), runId: 'selftest' });
  assert.equal(v.expiry, '17/10/2026');
  const doc = await getDocument({ data: new Uint8Array(v.bytes), useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  const text = reconstructLayout(content.items.filter((i) => typeof i.str === 'string').map((i) => ({
    str: i.str, x: i.transform[4], y: i.transform[5], width: i.width ?? 0, height: Math.abs(i.transform[3]) || 10,
  })));
  assert.ok(text.length >= 200, `only ${text.length} characters — the server would treat it as a scan`);
  assert.ok(text.includes('Policy No: SMV2026990177'), 'policy number line');
  assert.ok(text.includes('Valid until: 17/10/2026'), 'expiry line');
  // What the live upload check then expects ingest to store.
  const meta = extractMetadata(text);
  assert.deepEqual(meta.filter((m) => m.key === 'expiry_date').map((m) => m.value), ['17/10/2026']);
  assert.ok(meta.some((m) => m.key === 'policy_number' && m.value === 'SMV2026990177'), 'policy number extracted');
});

await test('metadata: one expiry per date, never a truncated twin', () => {
  const expiries = (t) => extractMetadata(t).filter((m) => m.key === 'expiry_date').map((m) => m.value);
  // The YYYY-first pattern used to match these too, as "17/10/20".
  assert.deepEqual(expiries('Valid until: 17/10/2026'), ['17/10/2026']);
  assert.deepEqual(expiries('Date of Expiry: 19/07/2033'), ['19/07/2033']);
  assert.deepEqual(expiries('Expiry: 2033-07-19'), ['2033-07-19']);
  assert.deepEqual(expiries('valid thru 17.10.26'), ['17.10.26']);
  assert.deepEqual(expiries('Expiration: 2026-10-171'), [], 'a run of digits is not a date');
  assert.equal(parseFlexibleDate('17/10/2026'), '2026-10-17');
  assert.equal(parseFlexibleDate('2033-07-19'), '2033-07-19');
  assert.equal(parseFlexibleDate('19 July 2033'), '2033-07-19');
  assert.equal(parseFlexibleDate('17.10.26'), '2026-10-17');
});

await test('cleanText makes extracted text storable', () => {
  assert.equal(cleanText('आशा व\u0000मा'), 'आशा वमा', 'NUL removed, word kept whole');
  assert.equal(cleanText('a\uD800b\uDC00c'), 'abc', 'lone surrogates removed');
  assert.equal(cleanText('😀 ok'), '😀 ok', 'a real surrogate pair survives');
  assert.equal(cleanText('page 1\fpage 2'), 'page 1\npage 2');
  assert.equal(cleanText('tab\tnew\nline\r\n'), 'tab\tnew\nline\r\n');
  assert.equal(cleanText('bell\u0007!'), 'bell !');
});

await test('the Hindi PDF: the server reads NULs, and cleanText makes it storable', async () => {
  // PDF.js gives U+0000 for Devanagari glyphs it cannot map; Postgres refuses
  // a NUL in text/jsonb, and that failed the whole ingestion (HTTP 500).
  const hindi = documents.find((d) => d.file.startsWith('property_tax_notice_hindi'));
  const bytes = readFileSync(new URL(`../fixtures/files/${hindi.file}`, import.meta.url));
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
  let text = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    text += reconstructLayout(content.items.filter((i) => typeof i.str === 'string').map((i) => ({
      str: i.str, x: i.transform[4], y: i.transform[5], width: i.width ?? 0, height: Math.abs(i.transform[3]) || 10,
    })));
  }
  assert.ok(text.includes('\u0000'), 'no NUL in the raw text — the fixture no longer exercises the fix');
  const clean = cleanText(text);
  assert.ok(!JSON.stringify(clean).includes('\\u0000'), 'a NUL survived cleaning');
  for (const fact of hindi.facts) assert.ok(clean.replace(/\s+/g, ' ').includes(fact), `lost "${fact}"`);
});

await test('questions.yaml is consistent with the fixtures', () => {
  const files = new Set(permanentDocuments.map((d) => d.file));
  for (const q of questions) if (q.expect.source) assert.ok(files.has(q.expect.source), `${q.id} cites ${q.expect.source}, which is not a permanent fixture`);
  assert.equal(documents.filter((d) => d.kind === 'locked-pdf').length, 1, 'exactly one locked fixture');
});

await test('every suite stays inside its Groq budget', () => {
  const groups = groupCount(questions);
  assert.equal(selectQuestions(questions, 'smoke', 1).length, 3);
  assert.equal(selectQuestions(questions, 'no-questions', 1).length, 0);
  for (let g = 1; g <= groups; g++) {
    const nightly = selectQuestions(questions, 'nightly', g);
    assert.ok(nightly.length <= 10, `nightly group ${g} asks ${nightly.length}`);
    assert.ok(estimateFor(nightly).helperShare <= 0.4, `nightly group ${g} would spend ${Math.round(estimateFor(nightly).helperShare * 100)}% of the helper model's day`);
    for (const q of nightly) if (q.after) assert.ok(nightly.some((p) => p.id === q.after), `${q.id} follows ${q.after}, not in the same run`);
  }
  // Two post-deploy runs plus the nightly: the most QA spends in one day.
  const worst = 2 * estimateFor(selectQuestions(questions, 'smoke', 1)).helperShare
    + Math.max(...Array.from({ length: groups }, (_, i) => estimateFor(selectQuestions(questions, 'nightly', i + 1)).helperShare));
  assert.ok(worst <= 0.6, `worst day would spend ${Math.round(worst * 100)}% of the helper model's free allowance`);
  const seen = new Set(Array.from({ length: groups }, (_, i) => rotationGroup(new Date(Date.UTC(2026, 8, 27 + i)), groups)));
  assert.equal(seen.size, groups, 'consecutive days cover every rotation group');
});

if (failures.length) {
  console.error(failures.map((f) => `✗ ${f}`).join('\n'));
  console.error(`\n${failures.length} self-test(s) failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`✓ ${passed} self-tests passed — matchers, judge, run-time PDF, metadata, text cleaning, questions and budget.`);
