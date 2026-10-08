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
import { ticketCodeNotes, ticketSearchTerms } from '../../supabase/functions/_shared/tickets.ts';
import { digitsFromWords, restoreCodes } from '../../supabase/functions/_shared/numbers.ts';
import { takeInTurn, uniqueRelatives } from '../../supabase/functions/_shared/vaults.ts';
import { passagesUsed, splitUsedPassages } from '../../supabase/functions/_shared/used-passages.ts';
import { toSpeech } from '../../src/lib/speech-text.ts';
import { acceptedCurrencies, hmacSha256Hex, paymentSignatureOk, plusOrderAmount, plusOrderDescription, sameText, webhookSignatureOk, ORDER_ID, PAYMENT_ID } from '../../supabase/functions/_shared/razorpay.ts';
import { createHmac } from 'node:crypto';
import {
  attachmentParts, classifyAttachment, allowedReturnOrigin, sniffType, storageFileName, senderDomain,
} from '../../supabase/functions/_shared/gmail-rules.ts';
import {
  importTokenKey, sealToken, openToken, pkceChallenge, sha256Hex, base64url, fromBase64,
} from '../../supabase/functions/_shared/gmail-crypto.ts';
import { buildGraph, relationTo, relationLabel, relativesForPrompt, relativesNamedIn, buildForest, shortName, siblingsSharingParents } from '../../supabase/functions/_shared/kinship.ts';
import { encryptPayload, vapidAuthorization, generateVapidKeys, isPushServiceEndpoint, MAX_PLAINTEXT } from '../../supabase/functions/_shared/webpush.ts';
import { phoneLooksRight, cardProblem, cardIsEmpty, emptyCard, bloodGroupLabel, bloodGroupSpoken, telHref } from '../../src/lib/emergency.ts';
import { allowanceJson, givenBack, parseAllowance, questionLimitMessage, questionsLeftText, resetDay } from '../../supabase/functions/_shared/questions.ts';
import { DEFAULT_PLAN_LIMITS, PLUS_FOR_SALE, PLUS_PRICE, chatStorageFullMessage, fits, formatBytes, plusAmount, plusPrice, plusPrices, plusTwelveMonths, plusYearlyOffer, plusYearlySaving, storageFullMessage } from '../../supabase/functions/_shared/plan-text.ts';
import { mentionsDate, mentionsAmount, mentionsPhone, mentionsText, refuses, devanagariShare, scriptShare, hasMarkdown } from '../lib/match.mjs';
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

await test('asking across vaults: each vault\'s best first, in turn (046)', () => {
  assert.deepEqual(takeInTurn([[1, 2, 3], ['a'], ['x', 'y']]), [1, 'a', 'x', 2, 'y', 3]);
  assert.deepEqual(takeInTurn([[], [1, 2]]), [1, 2]);
  assert.deepEqual(takeInTurn([]), []);
  // A family's long tax return cannot push a personal vault's one passage
  // out of the judge's fifteen places: it comes second, not sixteenth.
  const taxReturn = Array.from({ length: 40 }, (_, i) => `tax-${i}`);
  const merged = takeInTurn([taxReturn, ['passport']]);
  assert.equal(merged[1], 'passport');
  assert.equal(merged.length, 41);
});

await test('the same relative named in two vaults\' trees is one note (046)', () => {
  const said = (term, name) => ({ term, name, label: 'Mother', personId: `${name}-id` });
  const notes = uniqueRelatives([said('mom', 'Meena Rao'), said('mom', 'Meena Rao'), said('mom', 'Meena R.'), said('nani', 'Kamala Verma')]);
  assert.deepEqual(notes.map((n) => `${n.term}=${n.name}`), ['mom=Meena Rao', 'mom=Meena R.', 'nani=Kamala Verma']);
});

await test('dates in every common form', () => {
  for (const s of ['on 19/07/2033', 'on 19-07-2033', '19.7.2033', 'expires 19 July 2033.', '19th July, 2033', 'July 19, 2033', '2033-07-19', '19 जुलाई 2033 को', '१९/०७/२०३३']) {
    assert.ok(mentionsDate(s, '2033-07-19'), s);
  }
  for (const s of ['on 20/07/2033', 'July 2033', '19/07/2032', '119/07/2033', '19 / 07 / 2032']) assert.ok(!mentionsDate(s, '2033-07-19'), s);
  // Spaced separators, as the answer model copied them from the Hindi notice's
  // text layer: "The final deadline … is **30 / 11 / 2026**".
  for (const s of ['**30 / 11 / 2026**', '30 - 11 - 2026', '30. 11. 2026']) assert.ok(mentionsDate(s, '2026-11-30'), s);
  assert.ok(!mentionsDate('30 / 11 / 2025', '2026-11-30'));
});

await test('amounts with Indian grouping and lakh', () => {
  for (const s of ['₹3,00,000', 'Rs. 300000', 'INR 300,000', '3 lakh', '₹ 3.0 lakhs', '३,००,०००']) assert.ok(mentionsAmount(s, 300000), s);
  assert.ok(!mentionsAmount('₹10,00,000', 300000));
  assert.ok(mentionsAmount('₹10,00,000', 1000000));
  assert.ok(mentionsAmount('the rent is Rs. 32,000 a month', 32000));
  // Answers in other Indian languages may write their own digits.
  for (const [s, v] of [['মোট ২,৮৪৫ টাকা', 2845], ['₹ ૧,૧૦૩ ચૂકવ્યા', 1103], ['௫,௧௨௦ ரூபாய்', 5120], ['₹೭೫,೦೦೦', 75000], ['൧൨,൬൦൦ രൂപ', 12600], ['₹ ੪,੩੭੫', 4375], ['₹౧౮,౫౦౦', 18500]]) {
    assert.ok(mentionsAmount(s, v), s);
  }
  assert.ok(!mentionsAmount('₹ ૧,૧૪૫', 1103), 'another receipt\'s amount');
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
  assert.ok(scriptShare('সুমিতা ঘোষের বিদ্যুৎ বিলে মোট ২,৮৪৫ টাকা দিতে হবে।', 'bengali') > 0.9);
  assert.ok(scriptShare('மீனா சுப்பிரமணியம் ₹5,120 செலுத்த வேண்டும்.', 'tamil') > 0.9);
  assert.ok(scriptShare('மீனா சுப்பிரமணியம் ₹5,120 செலுத்த வேண்டும்.', 'malayalam') === 0, 'Tamil is not Malayalam');
  assert.ok(scriptShare('Meena Subramaniam has to pay ₹5,120.', 'tamil') === 0);
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

await test('judgeAnswer in other Indian languages', () => {
  const bengali = [{ file_name: 'electricity_bill_bengali_specimen_v1.pdf' }];
  const tamilPhoto = [{ file_name: 'water_tax_receipt_tamil_photo_specimen_v1.jpg' }];
  assert.deepEqual(judgeAnswer(byId.get('lang-bengali-voice'), { answer: 'সুমিতা ঘোষের বিদ্যুৎ বিলে মোট ২,৮৪৫ টাকা দিতে হবে।', sources: bengali, answer_language: 'bn-IN', debug: healthy }), []);
  assert.deepEqual(judgeAnswer(byId.get('lang-tamil-photo-voice'), { answer: 'மீனா சுப்பிரமணியம் ₹5,120 குடிநீர் வரி செலுத்த வேண்டும்.', sources: tamilPhoto, answer_language: 'ta-IN', debug: healthy }), []);
  // The other Tamil bill's amount, for the wrong person.
  const other = judgeAnswer(byId.get('lang-tamil-photo-voice'), { answer: 'அவர் ₹6,480 செலுத்த வேண்டும்.', sources: [{ file_name: 'water_tax_receipt_tamil_specimen_v1.pdf' }], answer_language: 'ta-IN', debug: healthy });
  assert.equal(other.length, 3, other.join('; '));
  // Right amount, but in English: a Bengali speaker asked aloud.
  const english = judgeAnswer(byId.get('lang-bengali-voice'), { answer: 'Sumita Ghosh has to pay ₹2,845.', sources: bengali, answer_language: 'bn-IN', debug: healthy });
  assert.ok(english.some((r) => r.includes('Bengali script')), english.join('; '));
  // A typed question sends no language, so its answer's language is not judged.
  assert.deepEqual(judgeAnswer(byId.get('lang-tamil-typed'), { answer: 'Karthik Rajan has to pay ₹6,480.', sources: [{ file_name: 'water_tax_receipt_tamil_specimen_v1.pdf' }], debug: healthy }), []);
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

await test('tickets: a seat question searches a ticket\'s words, and its codes are read out in words', () => {
  // A train ticket never says "seat": the berth is a code under Booking Status.
  assert.deepEqual(ticketSearchTerms('whats my seat number'), ['seat', 'berth', 'coach', 'status']);
  assert.deepEqual(ticketSearchTerms('Which coach and berth am I in?'), ['seat', 'berth', 'coach', 'status']);
  assert.deepEqual(ticketSearchTerms('What is the PNR of the Pune train?'), ['pnr']);
  assert.deepEqual(ticketSearchTerms('ticket number and seats'), ['seat', 'berth', 'coach', 'status', 'pnr']);
  for (const q of ['When does my passport expire?', 'research grant', 'Kamala\'s PAN']) assert.deepEqual(ticketSearchTerms(q), [], q);

  // SPECIMEN lines, laid out as the server reads an e-ticket: the same code
  // under Booking Status and Current Status is one note.
  const ticket = [
    'PNR No.  2400000001   Train No./Name  10001/SPECIMEN MAIL   Class  AC 3 TIER (3A)',
    'Quota  GENERAL (GN)   Distance  500 KM',
    'Booking Status  Current Status',
    'CNF/B4/17 UB  CNF/B4/17 UB',
  ].join('\n');
  assert.deepEqual(ticketCodeNotes([ticket]), ['CNF/B4/17 UB means confirmed: coach B4, berth 17, upper berth.']);
  assert.deepEqual(ticketCodeNotes(['CNF/B3/45/LOWER', 'CNF/S10/63/SIDE UPPER', 'CNF/C2/14/WS']), [
    'CNF/B3/45/LOWER means confirmed: coach B3, berth 45, lower berth.',
    'CNF/S10/63/SIDE UPPER means confirmed: coach S10, berth 63, side upper berth.',
    'CNF/C2/14/WS means confirmed: coach C2, berth 14, window seat.',
  ]);
  assert.deepEqual(ticketCodeNotes(['RAC/S4/45']), ['RAC/S4/45 means RAC, not yet a berth of their own (shared until confirmed): coach S4, berth 45.']);
  assert.deepEqual(ticketCodeNotes(['GNWL/25  WL 12  RAC 14']), [
    'GNWL/25 means waitlisted, number 25: no berth yet.',
    'WL 12 means waitlisted, number 12: no berth yet.',
    'RAC 14 means RAC number 14: a shared berth, not yet confirmed.',
  ]);
  assert.deepEqual(ticketCodeNotes(['Policy No. 2400000001, BOWL 12, MAIL 3, Quota GN, Class SL']), [], 'nothing that is not a status code');
  assert.equal(ticketCodeNotes(['WL 1 WL 2 WL 3 WL 4 WL 5 WL 6 WL 7 WL 8']).length, 6, 'at most six notes');
});

await test('numbers stay in digits on the screen, and are read out digit by digit from those digits', () => {
  // A model told to write for the ear once wrote a train number in words and
  // swapped two digits. Words go back to digits, in English and Hindi…
  assert.equal(digitsFromWords('Your train number is One six seven eight two.'), 'Your train number is 16782.');
  assert.equal(digitsFromWords('Call nine-eight-seven-six now'), 'Call 9876 now');
  assert.equal(digitsFromWords('Six, one, two, zero is the code'), '6120 is the code');
  assert.equal(digitsFromWords('ट्रेन नंबर एक छह सात आठ दो है।'), 'ट्रेन नंबर 16782 है।');
  assert.equal(digitsFromWords('PNR 4 5 1 2 6 7 is confirmed'), 'PNR 451267 is confirmed', 'single digits spaced apart join up');
  // …and ordinary words stay words.
  for (const plain of ['It takes one or two days.', 'two three days', 'Seats one, two and three', 'someone, everyone, no one two',
    'मुझे दो तीन दिन चाहिए', 'Pages 1 2 3 only', 'Aadhaar 1234 5678 9012', 'Policy SMV2026990177 and ₹3,00,000']) {
    assert.equal(digitsFromWords(plain), plain, plain);
  }
  const once = digitsFromWords('one two three four and 5 6 7 8');
  assert.equal(digitsFromWords(once), once, 'idempotent');

  // A code spelled out comes back exactly as the document writes it — letters too…
  const ticket = 'Train No./Name: 16782AB SPECIMEN EXPRESS  PAN: ABCD123456J  Vehicle: MH-12-AB-1234';
  const shown = (answer) => digitsFromWords(restoreCodes(answer, ticket));
  assert.equal(shown('Your train number is one six seven eight two A B.'), 'Your train number is 16782AB.');
  assert.equal(shown('Your train number is 16782 A B.'), 'Your train number is 16782AB.');
  assert.equal(shown('Your PAN is A B C D one two three four five six J.'), 'Your PAN is ABCD123456J.');
  assert.equal(shown('It is registered as M H 1 2 A B 1 2 3 4.'), 'It is registered as MH-12-AB-1234.');
  assert.equal(shown('The PAN is a A B C D 1 2 3 4 5 6 J'), 'The PAN is a ABCD123456J', 'a stray "a" before it stays a word');
  // …but only a code that is really there: digits out of order are not "corrected" into it.
  assert.equal(shown('Your train number is one six seven two eight A B.'), 'Your train number is 16728 A B.');
  // Codes already exact, amounts, seats and ordinary words are left alone.
  for (const plain of ['Your train number is 16782AB.', 'Your PAN is ABCD123456J.', 'Seats 23, 24 cost ₹ 1,100.',
    'Plan a 2 day trip', 'It takes one or two days.']) {
    assert.equal(shown(plain), plain, plain);
  }
  assert.equal(restoreCodes('one six seven eight two A B', ''), 'one six seven eight two A B', 'no passages, no change');

  // Read aloud: a number named as one is spelled out, by the app, from the digits.
  assert.equal(toSpeech('Your train number is 16782.'), 'Your train number is 1 6 7 8 2.');
  assert.equal(toSpeech('Train No. 16782 leaves at 5:40 from platform 3.'), 'Train No. 1 6 7 8 2 leaves at 5:40 from platform 3.');
  assert.equal(toSpeech('ट्रेन का नंबर 16782 है।'), 'ट्रेन का नंबर 1 6 7 8 2 है।');
  assert.equal(toSpeech('PIN code 751001'), 'PIN code 7 5 1 0 0 1');
  assert.equal(toSpeech('PNR 4512678901 is confirmed.'), 'PNR 4 5 1 2, 6 7 8 9, 0 1 is confirmed.', 'long numbers in groups of four');
  assert.equal(toSpeech('Your train number is 16782AB.'), 'Your train number is 1 6 7 8 2 A B.', 'a code letter by letter');
  assert.equal(toSpeech('Your PAN is ABCD123456J.'), 'Your PAN is A B C D, 1 2 3 4, 5 6 J.');
  // Seat and berth numbers, amounts and years are left to the voice.
  for (const plain of ['Seat number 17, coach B4, upper berth.', 'The fee is ₹18500.', 'It expires in 2027.', 'There is no 2027 renewal.']) {
    assert.equal(toSpeech(plain), plain, plain);
  }
});

await test('sources: only the passages the answer says it used', () => {
  // The answer ends with "USED: …"; the line is taken off and the chips come from it.
  const hotel = splitUsedPassages('आप होटल Luxe 8 Stayz में ठहरेंगे। बुकिंग आईडी NH90000000000000 है।\nUSED: 1');
  assert.equal(hotel.answer, 'आप होटल Luxe 8 Stayz में ठहरेंगे। बुकिंग आईडी NH90000000000000 है।');
  assert.deepEqual(hotel.used, [1]);
  assert.deepEqual(passagesUsed(['booking', 'bank statement'], hotel.used), ['booking'], 'the bank statement is not a source');
  // However the model writes it: same line, bold, "and", other scripts' digits, "none".
  assert.deepEqual(splitUsedPassages('Your hotel is Luxe 8 Stayz. USED: 2, 3'), { answer: 'Your hotel is Luxe 8 Stayz.', used: [2, 3] });
  assert.deepEqual(splitUsedPassages('Answer.\n**USED:** 1 and 3.').used, [1, 3]);
  assert.deepEqual(splitUsedPassages('Answer.\nUsed passages: 2').used, [2]);
  assert.deepEqual(splitUsedPassages('उत्तर।\nUSED: १ और ३'), { answer: 'उत्तर।', used: [1, 3] });
  assert.deepEqual(splitUsedPassages("I couldn't find that.\nUSED: none"), { answer: "I couldn't find that.", used: [] });
  assert.deepEqual(splitUsedPassages('Answer.\nUSED: 1\nNote: dates are in IST.'), { answer: 'Answer.\n\nNote: dates are in IST.', used: [1] });
  // No line: every passage sent stays a source, as before. Words are not the line.
  for (const plain of ['Just an answer.', 'This is the policy you used: the Harrier one.', 'Here is what I used:',
    'Used: 2019 Honda City, 40,000 km']) {
    assert.deepEqual(splitUsedPassages(plain), { answer: plain, used: null }, plain);
  }
  assert.deepEqual(passagesUsed(['a', 'b'], null), ['a', 'b']);
  assert.deepEqual(passagesUsed(['a', 'b'], []), [], 'none: no chips');
  assert.deepEqual(passagesUsed(['a', 'b', 'c'], [3, 1]), ['c', 'a']);
  assert.deepEqual(passagesUsed(['a', 'b'], [9]), ['a', 'b'], 'numbers that point nowhere say nothing');
  assert.deepEqual(passagesUsed(['a', 'b'], [2, 9]), ['b']);
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

await test('gmail: the attachments of a message, at any depth', () => {
  // A forwarded email: the PDF sits two levels down; a logo and a Word file do not count.
  const payload = {
    partId: '', mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'Asha <asha@example.com>' }],
    parts: [
      { partId: '0', mimeType: 'text/plain', filename: '', body: { size: 120 } },
      { partId: '1', mimeType: 'image/png', filename: 'image001.png', headers: [{ name: 'Content-ID', value: '<logo>' }], body: { size: 9000, attachmentId: 'A1' } },
      { partId: '2', mimeType: 'message/rfc822', filename: '', parts: [
        { partId: '2.0', mimeType: 'multipart/mixed', parts: [
          { partId: '2.0.1', mimeType: 'application/octet-stream', filename: 'Policy Schedule.PDF', body: { size: 245000, attachmentId: 'A2' } },
          { partId: '2.0.2', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'notes.docx', body: { size: 5000, attachmentId: 'A3' } },
        ] },
      ] },
    ],
  };
  const parts = attachmentParts(payload);
  assert.deepEqual(parts.map((p) => [p.partId, p.mimeType, p.inline]), [['1', 'image/png', true], ['2.0.1', 'application/pdf', false]]);
  assert.equal(parts[1].attachmentId, 'A2');
});

await test('gmail: suggest documents, drop email furniture, never read "company" as PAN', () => {
  const c = (fileName, extra = {}) => classifyAttachment({
    fileName, mimeType: /\.pdf$/i.test(fileName) ? 'application/pdf' : 'image/jpeg', size: 250_000, inline: false,
    from: 'Friend <friend@example.com>', subject: '', labelIds: ['INBOX'], ...extra,
  });
  assert.deepEqual(c('passport_scan.jpg'), { suggestion: 'suggested', reason: 'file name says passport', category: 'Passport' });
  assert.equal(c('Offer_Letter_Mira.pdf').suggestion, 'suggested', 'an offer LETTER is not marketing');
  assert.equal(c('Offer_Letter_Mira.pdf').category, 'Employment Letters');
  assert.equal(c('Sale_Deed_Flat402.pdf').category, 'Property Documents', 'a sale DEED is not marketing');
  assert.equal(c('Form16_FY2025-26.pdf').category, 'Tax Returns');
  assert.equal(c('e-Aadhaar.pdf').category, 'National ID / Aadhaar');
  assert.equal(c('aadhar card.jpg').category, 'National ID / Aadhaar', 'the common spelling');
  assert.equal(c('PAN_card.jpg').category, 'PAN Card');
  assert.equal(c('company_profile.pdf').category, null, '"company" does not contain the word PAN');
  assert.equal(c('company_profile.pdf').suggestion, 'maybe');
  // The subject is weaker evidence than the file name.
  assert.deepEqual(c('IMG_20260512_101010.jpg', { subject: 'Aadhaar card copy' }),
    { suggestion: 'maybe', reason: 'email is about Aadhaar', category: 'National ID / Aadhaar' });
  // A known issuer, and a lookalike of one.
  assert.equal(c('document.pdf', { from: 'HDFC Bank <alerts@hdfcbank.net>' }).suggestion, 'suggested');
  assert.equal(c('document.pdf', { from: 'HDFC Bank <alerts@hdfcbank.net>' }).category, 'Bank Statements');
  assert.equal(c('document.pdf', { from: 'HDFC <alerts@hdfcbank.net.example.com>' }).suggestion, 'maybe');
  assert.equal(senderDomain('"Passport Seva" <noreply@passportindia.gov.in>'), 'passportindia.gov.in');
  assert.equal(c('document.pdf', { from: 'noreply@passportindia.gov.in' }).reason, 'from a government (passportindia.gov.in)');
  // Marketing, and furniture.
  assert.equal(c('Diwali_Sale_Catalogue.pdf').suggestion, 'unlikely');
  assert.equal(c('brochure.pdf', { from: 'alerts@hdfcbank.net', subject: 'Exclusive offers for you' }).suggestion, 'unlikely');
  assert.equal(c('logo.png', { size: 8000, mimeType: 'image/png' }), null);
  assert.equal(c('image001.png', { size: 60_000, inline: true, mimeType: 'image/png' }), null);
  assert.equal(c('company-logo.jpg', { size: 90_000 }), null);
  assert.equal(c('passport.pdf', { size: 20 * 1024 * 1024 }).suggestion, 'unlikely', 'too big to import');
  assert.equal(c('passport.pdf', { labelIds: ['CATEGORY_PROMOTIONS'] }).suggestion, 'unlikely');
});

await test('gmail: Google\'s answer returns only to an allowed origin', () => {
  const dev = 'https://family-vault-git-dev-subhendu16740.vercel.app';
  assert.equal(allowedReturnOrigin(dev, `${dev}/`), dev, 'a trailing slash in the secret is fine');
  assert.equal(allowedReturnOrigin(`${dev}/gmail-import?x=1`, dev), dev, 'only the origin is kept');
  assert.equal(allowedReturnOrigin('https://family-vault-cyan.vercel.app', dev), null, 'not listed');
  assert.equal(allowedReturnOrigin('https://family-vault-cyan.vercel.app', ` ${dev} , https://family-vault-cyan.vercel.app`), 'https://family-vault-cyan.vercel.app');
  const pattern = 'https://family-vault-*-subhendu16740.vercel.app';
  assert.equal(allowedReturnOrigin('https://family-vault-dbmzqbq0v-subhendu16740.vercel.app', pattern), 'https://family-vault-dbmzqbq0v-subhendu16740.vercel.app');
  assert.equal(allowedReturnOrigin('https://family-vault-a.evil.com-subhendu16740.vercel.app', pattern), null, '* never spans a dot');
  assert.equal(allowedReturnOrigin('https://evil.example/family-vault-x-subhendu16740.vercel.app', pattern), null);
  assert.equal(allowedReturnOrigin('http://localhost:8081', ''), 'http://localhost:8081', 'local development needs no configuration');
  assert.equal(allowedReturnOrigin('http://evil.example', 'http://evil.example'), null, 'plain http only for localhost');
  assert.equal(allowedReturnOrigin(`https://user:pw@${dev.slice(8)}`, dev), null, 'no credentials');
  assert.equal(allowedReturnOrigin('javascript:alert(1)', dev), null);
  assert.equal(allowedReturnOrigin(undefined, dev), null);
});

await test('gmail: stored files are what their bytes say, under a safe name', () => {
  const bytes = (...b) => new Uint8Array(b);
  assert.equal(sniffType(new TextEncoder().encode('%PDF-1.7\n...')), 'pdf');
  assert.equal(sniffType(new TextEncoder().encode('\r\n  junk %PDF-1.4')), 'pdf', 'a little junk before %PDF- is allowed');
  assert.equal(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'jpg');
  assert.equal(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'png');
  assert.equal(sniffType(new TextEncoder().encode('PK\u0003\u0004 a zip named .pdf')), null);
  assert.equal(storageFileName('My Passport (2024).PDF', 'pdf'), 'My_Passport_2024.pdf');
  assert.equal(storageFileName('scan.pdf', 'jpg'), 'scan.jpg', 'the bytes decide the extension');
  assert.equal(storageFileName('पासपोर्ट.pdf', 'pdf'), 'document.pdf');
  assert.equal(storageFileName('../../etc/passwd.jpg', 'jpg'), 'etc_passwd.jpg', 'no path survives');
});

await test('gmail: refresh tokens are sealed, and PKCE matches RFC 7636', async () => {
  const key = await importTokenKey(base64url(crypto.getRandomValues(new Uint8Array(32))));
  const sealed = await sealToken(key, '1//refresh-token-value');
  assert.ok(sealed.startsWith('v1.') && !sealed.includes('refresh-token-value'));
  assert.equal(await openToken(key, sealed), '1//refresh-token-value');
  assert.notEqual(await sealToken(key, 'same'), await sealToken(key, 'same'), 'a fresh IV every time');
  const [v, iv, data] = sealed.split('.');
  // Change the second-to-last character (the last may hold only padding bits).
  const flipped = `${v}.${iv}.${data.slice(0, -2)}${data.at(-2) === 'A' ? 'B' : 'A'}${data.slice(-1)}`;
  await assert.rejects(openToken(key, flipped), 'a tampered token must not open');
  const other = await importTokenKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'));
  await assert.rejects(openToken(other, sealed), 'another key must not open it');
  await assert.rejects(importTokenKey('c2hvcnQ='), /32 random bytes/);
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.deepEqual([...fromBase64(base64url(new Uint8Array([251, 255, 0, 1])))], [251, 255, 0, 1]);
});

// A fictional family, three generations on both sides (SPECIMEN names).
const kin = (() => {
  const P = (id, name, gender, birthDate) => ({ id, name, gender, birthDate });
  const people = [
    P('ramesh', 'Ramesh Verma', 'male', '1945-01-01'), P('kamala', 'Kamala Verma', 'female', '1948-01-01'),
    P('suresh', 'Suresh Rao', 'male', '1950-01-01'), P('meena', 'Meena Rao', 'female', '1952-01-01'),
    P('vinod', 'Vinod Verma', 'male', '1970-01-01'), P('sunita', 'Sunita Verma', 'female', '1972-01-01'),
    P('rohan', 'Rohan Verma', 'male', '1975-01-01'), P('priya', 'Priya Singh', 'female', '1978-01-01'),
    P('vikram', 'Vikram Singh', 'male', '1976-01-01'),
    P('asha', 'Asha Verma', 'female', '1977-01-01'), P('anil', 'Anil Rao', 'male', '1980-01-01'),
    P('neha', 'Neha Rao', 'female', '1982-01-01'), P('kavita', 'Kavita Iyer', 'female', '1983-01-01'),
    P('manoj', 'Manoj Iyer', 'male', '1981-01-01'),
    P('aarav', 'Aarav Verma', 'male', '2005-01-01'), P('diya', 'Diya Verma', 'female', '2008-01-01'),
    P('kunal', 'Kunal Verma', 'male', '2000-01-01'), P('kabir', 'Kabir Singh', 'male', '2010-01-01'),
    P('riya', 'Riya Verma', 'female', '2006-01-01'), P('ishaan', 'Ishaan Verma', 'male', '2026-01-01'),
    P('guest', 'A Guest', null, null),
  ];
  const par = (from, ...tos) => tos.map((to) => ({ from, to, kind: 'parent' }));
  const sp = (a, b) => ({ from: a, to: b, kind: 'spouse' });
  const links = [
    sp('ramesh', 'kamala'), sp('suresh', 'meena'), sp('vinod', 'sunita'), sp('rohan', 'asha'),
    sp('priya', 'vikram'), sp('anil', 'neha'), sp('kavita', 'manoj'), sp('aarav', 'riya'),
    ...par('ramesh', 'vinod', 'rohan', 'priya'), ...par('kamala', 'vinod', 'rohan', 'priya'),
    ...par('suresh', 'asha', 'anil', 'kavita'), ...par('meena', 'asha', 'anil', 'kavita'),
    ...par('rohan', 'aarav', 'diya'), ...par('asha', 'aarav', 'diya'),
    ...par('vinod', 'kunal'), ...par('sunita', 'kunal'), ...par('priya', 'kabir'), ...par('vikram', 'kabir'),
    ...par('aarav', 'ishaan'), ...par('riya', 'ishaan'),
  ];
  return buildGraph(people, links);
})();
// The relation and its Hindi term, both still worked out: the term is what Ask
// understands ("Nani's pension"). The screens show only the English (045).
const said = (me, other) => {
  const rel = relationTo(kin, me, other);
  return rel ? `${rel.en}${rel.hi ? ` (${rel.hi})` : ''}` : null;
};

await test('kinship: parents, grandparents, aunts and uncles on each side', () => {
  const expected = {
    rohan: 'Father (Papa)', asha: 'Mother (Maa)', diya: 'Sister (Behen)',
    ramesh: 'Grandfather (Dada)', kamala: 'Grandmother (Dadi)', suresh: 'Grandfather (Nana)', meena: 'Grandmother (Nani)',
    vinod: 'Uncle (Tau)', priya: 'Aunt (Bua)', anil: 'Uncle (Mama)', kavita: 'Aunt (Mausi)',
    sunita: 'Aunt (Tai)', vikram: 'Uncle (Phupha)', neha: 'Aunt (Mami)', manoj: 'Uncle (Mausa)',
    kunal: 'Cousin', kabir: 'Cousin', riya: 'Wife (Patni)', ishaan: 'Son (Beta)',
  };
  for (const [who, label] of Object.entries(expected)) assert.equal(said('aarav', who), label, `Aarav → ${who}`);
  assert.equal(said('diya', 'aarav'), 'Brother (Bhaiya)', 'an elder brother');
  assert.equal(relationTo(kin, 'aarav', 'guest'), null, 'not connected');
  assert.equal(relationTo(kin, 'aarav', 'aarav').en, 'You');
});

await test('kinship: in-laws and the next generation, named from each side', () => {
  const cases = [
    ['asha', 'rohan', 'Husband (Pati)'], ['asha', 'ramesh', 'Father-in-law (Sasur)'], ['asha', 'kamala', 'Mother-in-law (Saas)'],
    ['asha', 'priya', 'Sister-in-law (Nanad)'], ['asha', 'vinod', 'Brother-in-law (Jeth)'], ['asha', 'riya', 'Daughter-in-law (Bahu)'],
    ['asha', 'ishaan', 'Grandson (Pota)'], ['asha', 'anil', 'Brother (Bhai)'], ['asha', 'neha', 'Sister-in-law (Bhabhi)'],
    ['asha', 'manoj', 'Brother-in-law (Jija)'], ['rohan', 'anil', 'Brother-in-law (Saala)'], ['rohan', 'kavita', 'Sister-in-law (Saali)'],
    ['ramesh', 'aarav', 'Grandson (Pota)'], ['ramesh', 'kabir', 'Grandson (Nati)'], ['priya', 'aarav', 'Nephew (Bhatija)'],
    ['priya', 'diya', 'Niece (Bhatiji)'], ['anil', 'aarav', 'Nephew (Bhanja)'], ['ramesh', 'ishaan', 'Great-grandson'],
    ['ishaan', 'ramesh', 'Great-grandfather (Pardada)'], ['ishaan', 'meena', 'Great-grandmother'],
  ];
  for (const [me, other, label] of cases) assert.equal(said(me, other), label, `${me} → ${other}`);
});

await test('kinship: the family as rag-search hands it to the model', () => {
  const lines = relativesForPrompt(kin, 'aarav');
  assert.ok(lines.includes('Aarav Verma: you'));
  assert.ok(lines.includes('Meena Rao: your grandmother (Nani)'));
  assert.ok(lines.includes('Asha Verma: your mother (Maa)'));
  assert.ok(lines.includes('A Guest'), 'unconnected people keep their name');
  assert.ok(relativesForPrompt(kin, null).every((l) => !l.includes('your')), 'no viewer, no relations');
});

await test('kinship: relations named in a question become names, with no model call', () => {
  const named = (me, ...texts) => relativesNamedIn(kin, me, ...texts).map((r) => `${r.term}=${r.name}`).sort();
  assert.deepEqual(named('aarav', "When does Nani's pension renew?"), ['nani=Meena Rao']);
  assert.deepEqual(named('aarav', 'Mummy ka passport kab expire hoga'), ['mummy=Asha Verma']);
  assert.deepEqual(named('aarav', 'my dad and my mom'), ['dad=Rohan Verma', 'mom=Asha Verma']);
  assert.deepEqual(named('aarav', 'Buaji ka Aadhaar'), ['buaji=Priya Singh']);
  assert.deepEqual(named('aarav', 'नानी की पेंशन कब आएगी'), ['नानी=Meena Rao'], 'Hindi in Devanagari');
  assert.deepEqual(named('aarav', 'my grandmother'), ['grandmother=Kamala Verma', 'grandmother=Meena Rao'], 'both grandmothers: the answer sorts it out');
  assert.deepEqual(named('aarav', "Mama's car insurance"), ['mama=Anil Rao'], "Mama is Maa's brother, never Maa");
  assert.deepEqual(named('asha', "my mother-in-law's PAN"), ['mother in law=Kamala Verma'], 'mother-in-law is not also mother');
  assert.deepEqual(named('asha', 'Saasu maa'), ['maa=Meena Rao'], 'Maa is still her own mother');
  assert.deepEqual(named('aarav', 'my MA degree certificate', 'the person who signed'), [], 'no MA, no "son" inside "person"');
  assert.deepEqual(named('aarav', 'the house papers'), []);
  assert.deepEqual(named(null, "Nani's pension"), [], 'no place in the tree, nothing to resolve');
  assert.deepEqual(named('guest', "Nani's pension"), [], 'connected to nobody');
  // No gender recorded: "mother" can only mean one of the parents.
  const plain = buildGraph([{ id: 'k', name: 'Kid', gender: null }, { id: 'p', name: 'Pat Rao', gender: null }],
    [{ from: 'p', to: 'k', kind: 'parent' }]);
  assert.deepEqual(relativesNamedIn(plain, 'k', "my mother's passport").map((r) => r.name), ['Pat Rao']);
});

await test('kinship: the family\'s nickname names its person, on screen and in a question (045)', () => {
  const g = buildGraph([
    { id: 'me', name: 'Aarav Verma', gender: 'male' },
    { id: 'dad', name: 'Rohan Verma', gender: 'male' },
    { id: 'mom', name: 'Asha Verma', gender: 'female', nickname: 'Mummy Ji' },
    { id: 'sis', name: 'Priya Singh', gender: 'female', nickname: 'Pinky' },
    { id: 'friend', name: 'Ravi Kumar', gender: 'male', nickname: 'Bablu' },
    { id: 'short', name: 'Om Das', gender: 'male', nickname: 'Om' },
  ], [
    { from: 'dad', to: 'me', kind: 'parent' }, { from: 'mom', to: 'me', kind: 'parent' },
    { from: 'dad', to: 'sis', kind: 'parent' }, { from: 'mom', to: 'sis', kind: 'parent' },
    { from: 'dad', to: 'mom', kind: 'spouse' },
  ]);
  const named = (...texts) => relativesNamedIn(g, 'me', ...texts).map((r) => `${r.term}=${r.name}:${r.label}`).sort();
  assert.deepEqual(named("When does Pinky's passport expire?"), ['pinky=Priya Singh:Sister']);
  assert.deepEqual(named('Bablu ka PAN'), ['bablu=Ravi Kumar:family member'], 'named by nickname, with no relation to the asker');
  assert.deepEqual(named("Mummy Ji's Aadhaar"), ['mummy ji=Asha Verma:Mother'], 'a nickname of two words, longest first');
  assert.deepEqual(named('Om Shanti Om'), [], 'a nickname of two letters names nobody');
  assert.equal(relationLabel(relationTo(g, 'me', 'sis')), 'Sister', 'the screen shows the relation, and the nickname beside it');
  const prompt = relativesForPrompt(g, 'me');
  assert.ok(prompt.some((l) => l.startsWith('Priya Singh (called "Pinky"): your sister')), prompt.join(' | '));
  assert.ok(prompt.includes('Ravi Kumar (called "Bablu")'), prompt.join(' | '));
});

await test('kinship: the tree starts from each pair of ancestors, the viewer\'s own first', () => {
  const forest = buildForest(kin, 'aarav');
  assert.deepEqual(forest.branches.map((b) => b.title), ['Ramesh & Kamala', 'Suresh & Meena']);
  assert.equal(forest.first, 0);
  assert.equal(buildForest(kin, 'anil').first, 1, "Anil descends from Suresh & Meena");
  assert.equal(buildForest(kin, 'vikram').first, 0, 'married in: shown with his wife\'s family');
  const verma = forest.branches[0].roots[0];
  assert.deepEqual(verma.children.map((c) => c.person.name), ['Vinod Verma', 'Rohan Verma', 'Priya Singh'], 'eldest first');
  const rohan = verma.children[1];
  assert.deepEqual(rohan.spouses.map((s) => s.name), ['Asha Verma']);
  assert.deepEqual(rohan.children.map((c) => c.person.name), ['Aarav Verma', 'Diya Verma']);
  assert.deepEqual(forest.loose.map((p) => p.name), ['A Guest']);
  // A loop in bad data must not hang the screen.
  const loop = buildGraph([{ id: 'x', name: 'X', gender: null }, { id: 'y', name: 'Y', gender: null }],
    [{ from: 'x', to: 'y', kind: 'parent' }, { from: 'y', to: 'x', kind: 'parent' }]);
  assert.ok(buildForest(loop, 'x'));
});

await test('kinship: a sister added before Papa is drawn beside her brother, under Papa', () => {
  // As a family really builds it: "Shatabdi is Subhendu's sister" first, then
  // "K C Das Mohapatra is Subhendu's father". Nobody said she is his daughter.
  const P = (id, name, gender) => ({ id, name, gender });
  const g = buildGraph(
    [P('papa', 'K C Das Mohapatra', 'male'), P('me', 'Subhendu', 'male'), P('sis', 'Shatabdi', 'female')],
    [{ from: 'sis', to: 'me', kind: 'sibling' }, { from: 'papa', to: 'me', kind: 'parent' }],
  );
  const forest = buildForest(g, 'me');
  assert.deepEqual(forest.branches.map((b) => b.title), ['K C Das Mohapatra'], 'one branch, named in full: "K" says nothing');
  assert.deepEqual(forest.branches[0].roots[0].children.map((c) => c.person.name).sort(), ['Shatabdi', 'Subhendu']);
  assert.deepEqual(forest.loose, []);
  assert.equal(relationTo(g, 'me', 'sis').hi, 'Behen');
  assert.equal(relationLabel(relationTo(g, 'me', 'sis')), 'Sister', 'the screens show the English relation alone');
  // Adding Maa now reaches her too, with the Papa she was missing.
  assert.deepEqual(siblingsSharingParents(g, 'me'), [{ id: 'sis', missing: ['papa'] }]);
  // A half-brother with a different mother recorded is left alone.
  const half = buildGraph(
    [P('papa', 'Papa', 'male'), P('me', 'Me', null), P('bro', 'Bro', 'male'), P('other', 'Other Mother', 'female')],
    [{ from: 'bro', to: 'me', kind: 'sibling' }, { from: 'papa', to: 'me', kind: 'parent' }, { from: 'other', to: 'bro', kind: 'parent' }],
  );
  assert.deepEqual(siblingsSharingParents(half, 'me'), []);
  assert.equal(shortName('K C Das Mohapatra'), 'K C Das Mohapatra');
  assert.equal(shortName('Dr. Meena Rao'), 'Meena');
  assert.equal(shortName('Ramesh Verma'), 'Ramesh');
});

await test('emergency card: the form checks what save_emergency_card() checks (032)', () => {
  for (const ok of ['+91 98765 43210', '(011) 2345-6789', '112', '9876543210', '+44 20 7946 0958']) assert.ok(phoneLooksRight(ok), ok);
  for (const bad of ['call me', '12', '+', '98765 ext 5', '1234567890123456', '']) assert.ok(!phoneLooksRight(bad), bad);
  const wrongPhone = "doesn't look right. Use digits, like +91 98765 43210.";
  assert.equal(cardProblem({ ...emptyCard(), doctorPhone: 'call me' }), `The doctor's phone number ${wrongPhone}`);
  assert.equal(cardProblem({ ...emptyCard(), contacts: [{ name: 'Asha', relation: null, phone: 'call' }] }), `Asha's phone number ${wrongPhone}`);
  assert.equal(cardProblem({ ...emptyCard(), contacts: [{ name: 'Rohan', relation: 'Son', phone: '' }] }),
    'Each person to call needs a name and a phone number.');
  const four = ['111', '112', '113', '114'].map((phone, i) => ({ name: `P${i}`, relation: null, phone }));
  assert.equal(cardProblem({ ...emptyCard(), contacts: four }), 'Add at most three people to call.');
  // An empty row on the form is not a contact, and a card of empty rows is empty.
  const blankRow = { ...emptyCard(), allergies: '  ', contacts: [{ name: ' ', relation: '', phone: '' }] };
  assert.equal(cardProblem(blankRow), null);
  assert.ok(cardIsEmpty(blankRow));
  assert.ok(!cardIsEmpty({ ...emptyCard(), bloodGroup: 'O+' }));
  assert.equal(bloodGroupLabel('A-'), 'A−');
  assert.equal(bloodGroupLabel('hh'), 'Bombay (hh)');
  assert.equal(bloodGroupLabel(null), 'Not known');
  assert.equal(bloodGroupSpoken('AB+'), 'AB positive');
  assert.equal(telHref('+91 98765-43210'), 'tel:+919876543210');
});

await test('web push: encryption matches RFC 8291\'s example, byte for byte', async () => {
  // RFC 8291 section 5 and appendix A: "When I grow up, I want to be a watermelon".
  const target = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
  const fixed = {
    salt: fromBase64('DGv6ra1nlYgDCS1FRnbzlw'),
    publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  };
  const message = await encryptPayload(fromBase64('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'), target, fixed);
  const header = fromBase64('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const ciphertext = fromBase64('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ');
  assert.equal(base64url(message), base64url(new Uint8Array([...header, ...ciphertext])));
  // A real message: a fresh salt and key every time, never the same bytes twice.
  const plain = new TextEncoder().encode('{"title":"Passport expires in 30 days"}');
  assert.notEqual(base64url(await encryptPayload(plain, target)), base64url(await encryptPayload(plain, target)));
  await assert.rejects(encryptPayload(new Uint8Array(MAX_PLAINTEXT + 1), target), /at most/);
  await assert.rejects(encryptPayload(plain, { ...target, auth: 'c2hvcnQ' }), /16 bytes/);
});

await test('web push: VAPID signs for the push service, and only push services are posted to', async () => {
  const keys = await generateVapidKeys();
  assert.equal(fromBase64(keys.publicKey).length, 65);
  const auth = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'https://example.org' }, 1_900_000_000);
  const [, token, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
  assert.equal(k, keys.publicKey);
  const [h, c, sig] = token.split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromBase64(c))), { aud: 'https://fcm.googleapis.com', exp: 1_900_000_000, sub: 'https://example.org' });
  const pub = await crypto.subtle.importKey('raw', fromBase64(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromBase64(sig), new TextEncoder().encode(`${h}.${c}`)), 'the signature verifies');
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Q', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
    assert.ok(isPushServiceEndpoint(ok), ok);
  }
  for (const bad of ['https://evil.example/fcm.googleapis.com', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:8443/x', 'not a url']) {
    assert.ok(!isPushServiceEndpoint(bad), bad);
  }
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

await test('plans: every limit is finite, and a full vault says why and what to do (038–048)', () => {
  const GB = 1024 ** 3, MB = 1024 ** 2;
  // What 039–048 leave in plan_limits: one row per plan; Free 200 MB for a
  // family and 100 MB for a personal vault (048), Plus 10 GB for either;
  // 30 days after Plus ends before anything above Free goes, 4 members on
  // Free and 8 on Plus (049), 10 voice chats for each person on Free (043),
  // and 20 questions a month for each person on Free, none on Plus up to
  // fair use (049).
  assert.deepEqual(DEFAULT_PLAN_LIMITS, {
    free: 200 * MB, freePersonal: 100 * MB, plus: 10 * GB, graceDays: 30,
    members: { free: 4, plus: 8 },
    voiceAnswers: { free: 10, plus: null },
    questions: { free: 20, plus: null },
    questionsFairUse: 500,
  });
  assert.deepEqual(PLUS_PRICE, { monthly: { inr: 100, usd: 10 }, yearly: { inr: 1100, usd: 110 } });
  // The Plus page says what a year saves in months ("1 month free"): a year
  // must cost a whole number of months, fewer than twelve.
  for (const c of ['inr', 'usd']) {
    const months = PLUS_PRICE.yearly[c] / PLUS_PRICE.monthly[c];
    assert.ok(Number.isInteger(months) && months < 12, `${c}: a year costs ${months} months`);
  }
  assert.equal(plusYearlySaving('inr'), '1 month free');
  assert.equal(plusYearlySaving('usd'), '1 month free');
  assert.equal(plusPrice('inr'), '₹100 a month');
  assert.equal(plusPrice('usd'), '$10 a month');
  assert.equal(plusPrice('inr', 'yearly'), '₹1,100 a year');
  assert.equal(plusPrice('usd', 'yearly'), '$110 a year');
  assert.equal(plusPrices('inr'), '₹100 a month or ₹1,100 a year');
  assert.equal(plusAmount('inr', 'yearly'), '₹1,100');
  assert.equal(plusAmount('usd', 'monthly'), '$10');
  // The yearly price is shown against twelve months at the monthly price,
  // crossed out: a real price, worked out, so the discount is a real one.
  assert.equal(plusTwelveMonths('inr'), '₹1,200');
  assert.equal(plusTwelveMonths('usd'), '$120');
  assert.equal(plusYearlyOffer('inr'), '₹1,100 a year instead of ₹1,200');
  assert.equal(plusYearlyOffer('usd'), '$110 a year instead of $120');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(1.25 * MB), '1.3 MB');
  assert.equal(formatBytes(250 * MB), '250 MB');
  assert.equal(formatBytes(DEFAULT_PLAN_LIMITS.free), '200 MB');
  assert.equal(formatBytes(DEFAULT_PLAN_LIMITS.freePersonal), '100 MB');
  assert.equal(formatBytes(GB), '1 GB');
  assert.equal(formatBytes(1.5 * GB), '1.5 GB');
  const free = { plan: 'free', limitBytes: GB, usedBytes: GB - 2 * MB };
  assert.ok(fits(free, 2 * MB), 'a file that exactly fills the space fits');
  assert.ok(!fits(free, 3 * MB));
  const tooBig = storageFullMessage(free, 3 * MB);
  assert.match(tooBig, /^This file is 3 MB, and your family has 2 MB left of 1 GB on the free plan\./);
  assert.match(tooBig, /Delete documents you no longer need/);
  const full = storageFullMessage({ ...free, usedBytes: GB + 10 * MB }, 0, { price: plusPrice('inr') });
  assert.match(full, /^Your family's storage is full: 1\.01 GB used of 1 GB on the free plan\./);
  // Until Plus can be bought, nothing offers to sell it.
  if (!PLUS_FOR_SALE) {
    assert.match(full, /Family Plus, coming soon, gives 10 GB for ₹100 a month\.$/);
    assert.doesNotMatch(full, /move to/);
  }
  assert.match(storageFullMessage({ ...free, usedBytes: GB }, 0, { price: plusPrices('inr') }), /gives 10 GB for ₹100 a month or ₹1,100 a year\.$/);
  // The server cannot tell where the person is, so it names no price.
  assert.match(storageFullMessage({ ...free, usedBytes: GB }), /gives 10 GB\.$/);
  const plus = storageFullMessage({ plan: 'plus', limitBytes: 10 * GB, usedBytes: 10 * GB }, 0, { price: plusPrice('usd') });
  assert.equal(plus, "Your family's storage is full: 10 GB used of 10 GB on Family Plus. Delete documents you no longer need to make room.");
  // Plus has ended and the family holds more than Free: the day it loses the excess, and how to keep it.
  const ended = storageFullMessage({ plan: 'free', limitBytes: GB, usedBytes: 3 * GB }, 0, { price: plusPrice('inr'), removalOn: '3 Nov 2026' });
  assert.equal(ended, "Your family's storage is full: 3 GB used of 1 GB on the free plan. Family Plus has ended: on 3 Nov 2026, the newest documents above 1 GB will be removed, unless it is renewed or you delete documents to get under 1 GB.");
  // Saved chats take the family's storage too (042): on the free plan a chat
  // with no room needs Family Plus; on Plus, room is made by deleting.
  const chatFree = chatStorageFullMessage({ plan: 'free', limitBytes: GB, usedBytes: GB }, { price: plusPrices('inr') });
  assert.match(chatFree, /^There is no room to save this chat: your family has used 1 GB of its 1 GB\. Saving more needs Family Plus/);
  assert.match(chatFree, /10 GB for ₹100 a month or ₹1,100 a year\./);
  if (!PLUS_FOR_SALE) assert.match(chatFree, /Family Plus, coming soon: .*Until then, delete documents you no longer need\.$/);
  assert.equal(chatStorageFullMessage({ plan: 'plus', limitBytes: 10 * GB, usedBytes: 10 * GB }, { price: plusPrice('usd') }),
    'There is no room to save this chat: your family has used 10 GB of its 10 GB. Delete documents or saved chats you no longer need to make room.');
  // A personal vault (048) is "your personal vault", never "your family".
  const mine = { plan: 'free', limitBytes: 100 * MB, usedBytes: 99 * MB, personal: true };
  assert.match(storageFullMessage(mine, 3 * MB), /^This file is 3 MB, and your personal vault has 1 MB left of 100 MB on the free plan\./);
  assert.match(storageFullMessage({ ...mine, usedBytes: 100 * MB }), /^Your personal vault is full: 100 MB used of 100 MB on the free plan\./);
  assert.match(chatStorageFullMessage({ ...mine, usedBytes: 100 * MB }), /^There is no room to save this chat: your personal vault has used 100 MB of its 100 MB\./);
  for (const text of [storageFullMessage(mine, 3 * MB), storageFullMessage({ ...mine, usedBytes: 100 * MB }), chatStorageFullMessage(mine)]) {
    assert.doesNotMatch(text, /your family/i, 'a personal vault is not called a family');
  }
});

await test('razorpay: the server sets the price, and only Razorpay\'s signature makes a payment count (044)', async () => {
  // The amounts are PLUS_PRICE's, in paise and cents: what the Plus page shows is what is charged.
  assert.equal(plusOrderAmount('monthly', 'INR'), 10000);
  assert.equal(plusOrderAmount('yearly', 'INR'), 110000);
  assert.equal(plusOrderAmount('monthly', 'USD'), 1000);
  assert.equal(plusOrderAmount('yearly', 'USD'), 11000);
  assert.equal(plusOrderDescription('monthly'), 'Family Plus — 1 month');
  assert.equal(plusOrderDescription('yearly'), 'Family Plus — 1 year');
  // Rupees unless dollars are switched on; nothing else, ever.
  assert.deepEqual(acceptedCurrencies(undefined), ['INR']);
  assert.deepEqual(acceptedCurrencies(''), ['INR']);
  assert.deepEqual(acceptedCurrencies('inr, usd'), ['INR', 'USD']);
  assert.deepEqual(acceptedCurrencies('EUR,GBP'), ['INR']);
  // WebCrypto's HMAC agrees with Node's, so the signatures are Razorpay's scheme.
  const secret = 'specimen_key_secret_not_real';
  const expected = createHmac('sha256', secret).update('order_Specimen000001|pay_Specimen000001').digest('hex');
  assert.equal(await hmacSha256Hex(secret, 'order_Specimen000001|pay_Specimen000001'), expected);
  assert.ok(await paymentSignatureOk('order_Specimen000001', 'pay_Specimen000001', expected, secret), 'the checkout\'s signature is accepted');
  assert.ok(!(await paymentSignatureOk('order_Specimen000002', 'pay_Specimen000001', expected, secret)), 'not for another order');
  assert.ok(!(await paymentSignatureOk('order_Specimen000001', 'pay_Specimen000001', expected, 'another_secret')), 'not under another secret');
  assert.ok(!(await paymentSignatureOk('order_Specimen000001', 'pay_Specimen000001', expected.toUpperCase(), secret)), 'hex as Razorpay sends it, lowercase');
  assert.ok(!(await paymentSignatureOk('order_Specimen000001', 'pay_Specimen000001', expected, '')), 'never without a secret');
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_Specimen000001', order_id: 'order_Specimen000001', amount: 10000, currency: 'INR', status: 'captured' } } } });
  const hook = createHmac('sha256', 'specimen_webhook_secret').update(body).digest('hex');
  assert.ok(await webhookSignatureOk(body, hook, 'specimen_webhook_secret'));
  assert.ok(!(await webhookSignatureOk(body + ' ', hook, 'specimen_webhook_secret')), 'one byte changed is refused');
  assert.ok(!(await webhookSignatureOk(body, '', 'specimen_webhook_secret')), 'no signature is refused');
  assert.ok(sameText('abc', 'abc') && !sameText('abc', 'abd') && !sameText('abc', 'ab'));
  assert.ok(ORDER_ID.test('order_Specimen000001') && !ORDER_ID.test('order_x') && !ORDER_ID.test('pay_Specimen000001'));
  assert.ok(PAYMENT_ID.test('pay_Specimen000001') && !PAYMENT_ID.test('pay_ bad'));
});

await test('the languages suite: by hand only, every language, half a day at most', () => {
  const languages = selectQuestions(questions, 'languages', 1);
  assert.equal(languages.length, 12);
  assert.ok(estimateFor(languages).helperShare <= 0.45, `the languages suite would spend ${Math.round(estimateFor(languages).helperShare * 100)}% of the helper model's day`);
  for (let g = 1; g <= groupCount(questions); g++) {
    assert.ok(!selectQuestions(questions, 'nightly', g).some((q) => q.tier === 'languages'), `nightly group ${g} asks a languages question`);
  }
  assert.ok(!selectQuestions(questions, 'full', 1).some((q) => q.tier === 'languages'), 'full asks a languages question');
  assert.ok(!selectQuestions(questions, 'smoke', 1).some((q) => q.tier === 'languages'));
  // Every language the app offers beyond English and Hindi has a question.
  const fixtureLanguage = new Map(permanentDocuments.map((d) => [d.file, d.language]));
  const covered = new Set(languages.map((q) => fixtureLanguage.get(q.expect.source)));
  for (const lang of ['Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi']) assert.ok(covered.has(lang), `no question about the ${lang} document`);
  // A voice-mode question says what it expects back, in which script.
  const script = { bn: 'bengali', ta: 'tamil', te: 'telugu', mr: 'devanagari', hi: 'devanagari', gu: 'gujarati', kn: 'kannada', ml: 'malayalam', pa: 'gurmukhi' };
  for (const q of languages.filter((x) => x.language)) {
    const base = q.language.split('-')[0];
    assert.ok(q.voice, `${q.id}: the app sends a language only in voice mode`);
    assert.equal(q.expect.answer_language, base, `${q.id}: answer_language`);
    assert.equal(q.expect.script, script[base], `${q.id}: script`);
    assert.ok(q.expect.no_markdown, `${q.id}: a voice answer must be speakable`);
  }
});

await test('questions each month: the count, and the words when they are used up (049)', () => {
  // As claim_question() answers on Free: no `left`, worked out from the ceiling.
  const free = parseAllowance({ allowed: false, used: 20, limit: 20, ceiling: 20, plus: false, resets_on: '2026-11-01' });
  assert.deepEqual(free, { used: 20, limit: 20, ceiling: 20, left: 0, plus: false, resetsOn: '2026-11-01' });
  assert.equal(questionLimitMessage(free),
    'You have asked your 20 free questions for this month. They start again on 1 November. With Family Plus there is no monthly limit.');
  assert.match(questionLimitMessage(free, 'hi-IN'), /20 मुफ़्त सवाल/);
  assert.match(questionLimitMessage(free, 'hi-IN'), /1 नवंबर/);
  assert.equal(questionsLeftText(free), 'You have used your 20 free questions this month');
  // A few left: said, with the plan's number.
  const few = parseAllowance({ used: 17, limit: 20, ceiling: 20, left: 3, plus: false, resets_on: '2026-11-01' });
  assert.equal(questionsLeftText(few), '3 of 20 free questions left this month');
  // Plus: nothing said until fair use is near; then its own words.
  const plus = parseAllowance({ used: 12, limit: null, ceiling: 500, left: 488, plus: true, resets_on: '2026-11-01' });
  assert.equal(questionsLeftText(plus), null);
  const plusFull = parseAllowance({ allowed: false, used: 500, limit: null, ceiling: 500, plus: true, resets_on: '2026-12-01' });
  assert.equal(questionLimitMessage(plusFull),
    'You have asked 500 questions this month, the most one person can ask. They start again on 1 December.');
  // A question given back: one fewer used, one more left; never below zero.
  assert.deepEqual(givenBack(few), { ...few, used: 16, left: 4 });
  assert.equal(givenBack({ ...few, used: 0, left: 20 }).used, 0);
  // What rag-search sends is what the app reads back.
  assert.deepEqual(parseAllowance(allowanceJson(few)), few);
  // Before 049, or anything else: not an allowance.
  assert.equal(parseAllowance(null), null);
  assert.equal(parseAllowance({ allowed: true }), null);
  assert.equal(resetDay('2027-01-01'), '1 January');
  assert.equal(resetDay('soon'), null);
});

if (failures.length) {
  console.error(failures.map((f) => `✗ ${f}`).join('\n'));
  console.error(`\n${failures.length} self-test(s) failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`✓ ${passed} self-tests passed — matchers, judge, run-time PDF, metadata, ticket codes, text cleaning, Gmail rules and token sealing, kinship and the family tree, emergency card checks, web push, plan limits, questions each month, Razorpay signatures, numbers in digits, sources the answer used, questions and budget.`);
