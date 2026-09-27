// ─── The synthetic documents the QA suite uploads ───────────────
//
// Every one is fictional and says so on its face. This repository is
// public: a real passport, policy or tax return must never be committed —
// not a family member's, not a "harmless old" one.
//
// Each entry keeps a document and the facts it carries side by side, so a
// change to one cannot silently leave the other behind:
//
//   tools/generate-fixtures.mjs  renders `html` into fixtures/files/<file>
//   tools/check-fixtures.mjs     proves every fact in `facts` survives the
//                                server's own PDF reader, before a single
//                                network call is spent
//   run.mjs                      uploads the `permanent` ones into QA Vault A
//                                once, and asks questions.yaml about them
//
// Bump FIXTURE_VERSION (and the _vN suffix in every file name) whenever a
// document's content changes. The runner removes QA Vault A documents that
// are not in this list, so the vault never answers from a stale copy.
//
// The Verma family: Rohan (self), Asha (spouse), Mira (daughter), Kamala
// (Rohan's mother). Pune addresses, Indian formats — the shapes this app
// actually has to read.
// ────────────────────────────────────────────────────────────────

export const FIXTURE_VERSION = 1;

const BANNER =
  'SPECIMEN — FICTIONAL DOCUMENT CREATED FOR FAMILYVAULT AUTOMATED TESTING — NOT VALID FOR ANY PURPOSE';

/**
 * kinds:
 *   text-pdf    born-digital PDF with a text layer (the common case by email)
 *   scan-pdf    image-only PDF with a small signature-stamp text layer — the
 *               shape that once looked ingested while holding only the stamp
 *   photo       a phone photo of a card (JPG), read by server-side OCR
 *   locked-pdf  password-protected PDF; must fail visibly, never look indexed
 *
 * facts: strings that must appear in the extracted text (whitespace-insensitive).
 * rows:  groups of strings that must share ONE line — proof a table kept its rows.
 */
export const documents = [
  {
    file: 'passport_asha_verma_specimen_v1.pdf',
    kind: 'text-pdf',
    category: 'Passport',
    permanent: true,
    facts: ['Passport No: Z7391046', 'Date of Issue: 20/07/2023', 'Date of Expiry: 19/07/2033', 'Place of Issue: PUNE', 'Name: Asha Verma'],
    html: () => page(`
      <h1>REPUBLIC OF INDIA — PASSPORT</h1>
      <p class="sub">Ministry of External Affairs · Data page (specimen)</p>
      <div class="lines">
        <p>Type: P &nbsp;&nbsp; Country Code: IND &nbsp;&nbsp; Passport No: Z7391046</p>
        <p>Surname: VERMA</p>
        <p>Given Name(s): ASHA</p>
        <p>Name: Asha Verma</p>
        <p>Nationality: INDIAN &nbsp;&nbsp; Sex: F</p>
        <p>Date of Birth: 12/03/1978</p>
        <p>Place of Birth: NAGPUR, MAHARASHTRA</p>
        <p>Place of Issue: PUNE</p>
        <p>Date of Issue: 20/07/2023</p>
        <p>Date of Expiry: 19/07/2033</p>
        <p>File No: PN1067231234521</p>
        <p>Name of Father / Legal Guardian: MOHAN LAL SHARMA</p>
        <p>Name of Spouse: ROHAN VERMA</p>
        <p>Address: FLAT 402, SHANTI HEIGHTS, BANER, PUNE 411045, MAHARASHTRA, INDIA</p>
      </div>
      <p class="mrz">P&lt;INDVERMA&lt;&lt;ASHA&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;<br>
      Z7391046&lt;8IND7803124F3307191&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;04</p>`),
  },

  {
    file: 'health_policy_verma_specimen_v1.pdf',
    kind: 'text-pdf',
    category: 'Health Insurance',
    permanent: true,
    facts: ['Policy Number: SGH2026448120', 'Policy valid until: 31/03/2027', 'Hypothyroidism'],
    rows: [['Kamala Verma', '3,00,000'], ['Asha Verma', 'Hypothyroidism']],
    html: () => page(`
      <h1>Specimen General Insurance Co. Ltd.</h1>
      <p class="sub">Family Health Insurance — Policy Schedule</p>
      <div class="lines">
        <p>Policy Number: SGH2026448120</p>
        <p>Plan: Family Floater Gold</p>
        <p>Policy Period: From 01/04/2026 To 31/03/2027 (both days inclusive)</p>
        <p>Policy valid until: 31/03/2027</p>
        <p>Proposer: Rohan Verma</p>
        <p>Address: Flat 402, Shanti Heights, Baner, Pune 411045</p>
        <p>Total Annual Premium: ₹ 38,450 (inclusive of GST)</p>
      </div>
      <h2>Insured Members</h2>
      <table>
        <tr><th>Member Name</th><th>Relationship</th><th>Date of Birth</th><th>Sum Insured</th><th>Pre-existing Condition</th></tr>
        <tr><td>Rohan Verma</td><td>Self</td><td>04/11/1975</td><td>₹ 10,00,000</td><td>None declared</td></tr>
        <tr><td>Asha Verma</td><td>Spouse</td><td>12/03/1978</td><td>₹ 10,00,000</td><td>Hypothyroidism</td></tr>
        <tr><td>Mira Verma</td><td>Daughter</td><td>22/08/2008</td><td>₹ 5,00,000</td><td>None declared</td></tr>
        <tr><td>Kamala Verma</td><td>Mother</td><td>15/01/1950</td><td>₹ 3,00,000</td><td>Type 2 Diabetes</td></tr>
      </table>
      <p class="note">The sum insured shown against each member is the maximum payable for that member in the policy year.</p>`,
    `
      <h2>Key Terms</h2>
      <div class="prose">
        <p>Room rent: single private air-conditioned room. Intensive care is covered up to the sum insured of the member admitted.</p>
        <p>Co-payment: 20% of every admissible claim for insured members aged 60 years or above at the start of the policy year. This applies to Kamala Verma.</p>
        <p>Waiting periods: 30 days from the policy start date for any illness except accidents; 24 months for declared pre-existing conditions, which were served under the previous policy with this insurer and are therefore covered from the first day of this policy.</p>
        <p>No claim bonus: 10% of the base sum insured for every claim-free policy year, up to a maximum of 50%.</p>
        <p>Cashless treatment is available at network hospitals. For planned admissions, request pre-authorisation at least 72 hours in advance. For emergencies, inform the insurer within 24 hours of admission.</p>
        <p>Claims helpline (specimen number, not in service): 1800-000-0000. Email: claims@specimen-insurance.example</p>
      </div>`),
  },

  {
    // The flood document. Every page says "Mobile Number" and "Number" over
    // and over, the way Indian tax forms do — the shape that once took 36 of
    // the top 40 keyword hits while the résumé carrying the actual answer
    // scored none. It also names Mira, so the model has to prefer her own
    // number from her résumé over her father's number printed here.
    file: 'income_tax_return_rohan_ay2026_specimen_v1.pdf',
    kind: 'text-pdf',
    category: 'Tax Returns',
    permanent: true,
    facts: ['PAN: ABCPV1234K', '+91 90110 23452', 'Mira Verma'],
    html: () => page(...taxPages()),
  },

  {
    file: 'resume_mira_verma_specimen_v1.pdf',
    kind: 'text-pdf',
    category: 'Other',
    permanent: true,
    facts: ['MIRA VERMA', 'Mobile: +91 98220 41937', 'Fergusson College'],
    html: () => page(`
      <h1>MIRA VERMA</h1>
      <p class="sub">Mobile: +91 98220 41937 &nbsp;·&nbsp; Email: mira.verma@example.com &nbsp;·&nbsp; Pune, Maharashtra</p>
      <p class="note">Fictional person. This résumé exists only to test FamilyVault.</p>
      <h2>Profile</h2>
      <div class="prose"><p>Final-year computer science student who enjoys turning messy data into clear answers. Looking for a graduate role in data engineering or analytics, starting July 2026.</p></div>
      <h2>Education</h2>
      <div class="prose">
        <p>B.Sc. Computer Science — Fergusson College, Pune — 2023 to 2026 — CGPA 8.7 / 10</p>
        <p>Higher Secondary Certificate (HSC), Maharashtra State Board — 2023 — 91.2%</p>
      </div>
      <h2>Experience</h2>
      <div class="prose"><p>Data Analyst Intern — Specimen Analytics Pvt Ltd, Pune — May to July 2025. Built weekly sales dashboards in Power BI, automated a manual reconciliation in Python that saved the finance team six hours a week, and documented the data model for new joiners.</p></div>
      <h2>Projects</h2>
      <div class="prose">
        <p>Family budget tracker: a Python and SQLite app that categorises bank-statement lines and flags unusual spends.</p>
        <p>Bus arrival predictor for Pune routes using open data and a gradient-boosted model; presented at the college tech fest.</p>
      </div>
      <h2>Skills</h2>
      <div class="prose"><p>Python, SQL, pandas, Git, Power BI, basic React. Languages: English, Hindi, Marathi.</p></div>`),
  },

  {
    // An image-only scan whose ONLY text layer is a digital-signature stamp:
    // the exact shape of "Harrier Insurance 2026-27.pdf", which sat in this
    // vault for a month looking ingested on 149 characters of stamp.
    file: 'rent_agreement_scan_specimen_v1.pdf',
    kind: 'scan-pdf',
    category: 'Legal Documents',
    permanent: true,
    stamp: 'Digitally Signed by: SPECIMEN e-Stamp Authority   Date: 28/05/2026   Location: Pune',
    // Read by OCR on the server, so they cannot be checked offline; the
    // questions about this document are what prove OCR ran.
    ocrFacts: ['32,000', 'Baner'],
    html: () => scanPage(`
      <h1>LEAVE AND LICENCE AGREEMENT</h1>
      <p class="sub">Specimen — not a real agreement</p>
      <div class="prose">
        <p>This agreement is made at Pune on 28/05/2026 between Mr. Suresh Patil, the Licensor, and Mr. Rohan Verma, the Licensee.</p>
        <p>Property: Flat 402, Shanti Heights, Baner, Pune 411045.</p>
        <p>Period: 11 months, from 01/06/2026 to 30/04/2027.</p>
        <p>Monthly licence fee (rent): Rs. 32,000 (Rupees Thirty Two Thousand only), payable on or before the 5th day of every month.</p>
        <p>Security deposit: Rs. 1,50,000 (Rupees One Lakh Fifty Thousand only), refundable at the end of the licence period.</p>
        <p>Notice period: one month by either party.</p>
        <p>Society maintenance charges are paid by the Licensor. Electricity and gas are paid by the Licensee.</p>
        <p>Signed: Suresh Patil (Licensor) &nbsp;&nbsp;&nbsp; Rohan Verma (Licensee)</p>
        <p>Witness: A. Kulkarni</p>
      </div>`),
  },

  {
    // KNOWN ISSUE, found by tools/check-fixtures.mjs: the server's PDF reader
    // (pdfjs-serverless) loses Devanagari conjuncts, reph and the pre-base
    // vowel sign from a browser-made PDF — "आशा वर्मा" reads as "आशा वमा",
    // "संपत्ति" as "संप", "विभाग" as "वभाग". The glyphs carry no ToUnicode
    // mapping, and PDF.js does not recover them (poppler does). Digits and
    // Latin survive, so the facts below are the ones a question can rely on;
    // `canaryWords` are reported on every check and flip to intact the day
    // Hindi PDF extraction is fixed.
    file: 'property_tax_notice_hindi_specimen_v1.pdf',
    kind: 'text-pdf',
    category: 'Property Documents',
    permanent: true,
    facts: ['₹ 14,250', '30/11/2026', 'PMC/BNR/2026/7781'],
    canaryWords: ['आशा वर्मा', 'संपत्ति', 'विभाग', 'महानगरपालिका'],
    html: () => page(`
      <h1 lang="hi">पुणे महानगरपालिका</h1>
      <p class="sub" lang="hi">संपत्ति कर विभाग — संपत्ति कर सूचना (नमूना दस्तावेज़, केवल स्वचालित परीक्षण हेतु)</p>
      <div class="lines" lang="hi">
        <p>सूचना क्रमांक: PMC/BNR/2026/7781</p>
        <p>संपत्ति धारक का नाम: आशा वर्मा</p>
        <p>संपत्ति का पता: प्लॉट 17, गणेश नगर, कोथरूड, पुणे 411038</p>
        <p>वित्तीय वर्ष: 2026-27</p>
        <p>कुल देय संपत्ति कर: ₹ 14,250</p>
        <p>भुगतान की अंतिम तिथि: 30/11/2026</p>
      </div>
      <div class="prose" lang="hi">
        <p>अंतिम तिथि के बाद भुगतान करने पर प्रति माह दो प्रतिशत की दर से दंड लगाया जाएगा।</p>
        <p>भुगतान ऑनलाइन या किसी भी नागरिक सुविधा केंद्र पर किया जा सकता है। रसीद को सुरक्षित रखें।</p>
        <p>यह सूचना संपत्ति धारक को उनके पंजीकृत पते पर भेजी गई है।</p>
      </div>`),
  },

  {
    file: 'warranty_card_photo_specimen_v1.jpg',
    kind: 'photo',
    category: 'Warranty Cards',
    permanent: true,
    ocrFacts: ['SXA2609114', '13/05/2027'],
    html: () => photoPage(`
      <h1>SPECIMEN ELECTRONICS</h1>
      <p class="sub">WARRANTY CARD — specimen, not a real warranty</p>
      <p>Product: 1.5 Ton Inverter Split Air Conditioner</p>
      <p>Model No: SX-18INV</p>
      <p class="big">Serial No: SXA2609114</p>
      <p>Date of Purchase: 14/05/2026</p>
      <p>Dealer: Specimen Appliances, Aundh, Pune</p>
      <p>Warranty: 1 year comprehensive, 5 years on compressor</p>
      <p>Comprehensive warranty valid till: 13/05/2027</p>
      <p>Customer: Rohan Verma</p>`),
  },

  {
    // Not permanent: the upload check sends it each run and expects a visible
    // failure. Today PDF.js is never given a password, so the file must come
    // back "unreadable" — what must NEVER happen is a success that stores the
    // encrypted bytes' junk as searchable text.
    file: 'bank_statement_locked_specimen_v1.pdf',
    kind: 'locked-pdf',
    category: 'Bank Statements',
    permanent: false,
    password: 'ASHA1978',
    facts: ['Statement of Account', 'Closing balance: ₹ 2,41,380.55'],
    html: () => page(`
      <h1>Specimen Bank Ltd. — Statement of Account</h1>
      <div class="lines">
        <p>Account holder: Asha Verma</p>
        <p>Account Number: 60221457883 &nbsp;&nbsp; IFSC: SPEC0000417 &nbsp;&nbsp; Branch: Baner, Pune</p>
        <p>Statement period: 01/08/2026 to 31/08/2026</p>
        <p>Opening balance: ₹ 1,98,210.30</p>
        <p>Closing balance: ₹ 2,41,380.55</p>
      </div>
      <table>
        <tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr>
        <tr><td>01/08/2026</td><td>Salary credit — Specimen Tech Solutions</td><td></td><td>1,12,500.00</td><td>3,10,710.30</td></tr>
        <tr><td>05/08/2026</td><td>Rent — Suresh Patil</td><td>32,000.00</td><td></td><td>2,78,710.30</td></tr>
        <tr><td>14/08/2026</td><td>Electricity bill</td><td>3,410.75</td><td></td><td>2,75,299.55</td></tr>
        <tr><td>22/08/2026</td><td>SIP — Specimen Mutual Fund</td><td>25,000.00</td><td></td><td>2,50,299.55</td></tr>
        <tr><td>29/08/2026</td><td>Groceries</td><td>8,919.00</td><td></td><td>2,41,380.55</td></tr>
      </table>
      <p class="note">This statement is password protected. Password: the first four letters of your name in capitals followed by your year of birth.</p>`),
  },
];

/** Documents uploaded once into QA Vault A and kept there. */
export const permanentDocuments = documents.filter((d) => d.permanent);

export function documentByFile(file) {
  const doc = documents.find((d) => d.file === file);
  if (!doc) throw new Error(`No fixture named ${file}`);
  return doc;
}

// ─── Rendering helpers ──────────────────────────────────────────
// Plain HTML and CSS: Chromium renders it, which gets Hindi shaping right
// (conjuncts, matras) where hand-built PDF libraries do not.
//
// No rotated "SPECIMEN" watermark on the text PDFs, deliberately: a rotated
// text run lands on some line's baseline and splices itself into it
// ("Date of Expiry:  SPECIMEN  19/07/2033"), breaking both the facts and the
// server's metadata extraction. The banner says it instead.

function page(...pages) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${pages
    .map((body) => `<section class="page"><div class="specimen">${BANNER}</div>${body}</section>`)
    .join('')}</body></html>`;
}

function scanPage(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${SCAN_CSS}</style></head><body><section class="scan"><div class="specimen">${BANNER}</div>${body}<div class="wm">SPECIMEN</div></section></body></html>`;
}

function photoPage(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${PHOTO_CSS}</style></head><body><div class="desk"><div class="card"><div class="specimen">SPECIMEN — FICTIONAL — FOR AUTOMATED TESTING ONLY</div>${body}</div></div></body></html>`;
}

function taxPages() {
  const strip = `
    <div class="strip">
      <p>INCOME TAX RETURN ACKNOWLEDGEMENT (ITR-1 SAHAJ) — ASSESSMENT YEAR 2026-27</p>
      <p>Name: Rohan Verma &nbsp;|&nbsp; PAN: ABCPV1234K &nbsp;|&nbsp; Mobile Number: +91 90110 23452 &nbsp;|&nbsp; Email: rohan.verma@example.com</p>
      <p>Acknowledgement Number: 482917360150726 &nbsp;|&nbsp; Date of filing: 22/07/2026</p>
    </div>`;
  const pages = [
    `<h2>Part A — General Information</h2>
     <div class="lines">
       <p>Name: Rohan Verma</p><p>Date of Birth: 04/11/1975</p>
       <p>Address: Plot 17, Ganesh Nagar, Kothrud, Pune 411038</p>
       <p>Aadhaar Number: XXXX XXXX 4417 (masked)</p>
       <p>Registered mobile number for OTP: +91 90110 23452</p>
       <p>Filed under section 139(1) — original return — resident individual</p>
       <p>Number of dependants declared: 2 (spouse Asha Verma, daughter Mira Verma)</p>
     </div>`,
    `<h2>Schedule S — Details of Income from Salary</h2>
     <table>
       <tr><th>Item</th><th>Amount</th></tr>
       <tr><td>Employer: Specimen Tech Solutions Pvt Ltd (TAN: PNES12345F)</td><td></td></tr>
       <tr><td>Gross salary</td><td>₹ 18,40,000</td></tr>
       <tr><td>Standard deduction</td><td>₹ 75,000</td></tr>
       <tr><td>Professional tax</td><td>₹ 2,500</td></tr>
       <tr><td>Income chargeable under the head Salaries</td><td>₹ 17,62,500</td></tr>
     </table>
     <p class="note">Mobile Number on record with the employer matches the registered number.</p>`,
    `<h2>Schedule HP — Income from House Property</h2>
     <div class="lines">
       <p>Property type: self-occupied</p>
       <p>Address of property: Plot 17, Ganesh Nagar, Kothrud, Pune 411038</p>
       <p>Interest payable on housing loan: ₹ 1,85,000</p>
       <p>Lender: Specimen Housing Finance — Loan Account Number: HL0098221743</p>
       <p>Number of co-owners: 1 (Asha Verma, 50% share)</p>
     </div>`,
    `<h2>Chapter VI-A — Deductions</h2>
     <table>
       <tr><th>Section</th><th>Details</th><th>Amount</th></tr>
       <tr><td>80C</td><td>Public Provident Fund — Account Number PPF7761023</td><td>₹ 60,000</td></tr>
       <tr><td>80C</td><td>Life insurance premium — Policy Number LIC883402117</td><td>₹ 32,000</td></tr>
       <tr><td>80C</td><td>Tuition fees for daughter Mira Verma — Fergusson College, Pune</td><td>₹ 58,000</td></tr>
       <tr><td>80D</td><td>Health insurance premium — Specimen General Insurance, Policy Number SGH2026448120</td><td>₹ 38,450</td></tr>
     </table>`,
    `<h2>Part B — Computation of Tax</h2>
     <div class="lines">
       <p>Gross total income: ₹ 15,77,500</p>
       <p>Total deductions under Chapter VI-A: ₹ 1,88,450</p>
       <p>Total taxable income: ₹ 13,89,050</p>
       <p>Tax payable including health and education cess: ₹ 2,03,760</p>
       <p>Number of the challan for self-assessment tax: nil</p>
     </div>`,
    `<h2>Schedule TDS — Tax Deducted at Source</h2>
     <table>
       <tr><th>TAN of deductor</th><th>Name of deductor</th><th>Tax deducted</th></tr>
       <tr><td>PNES12345F</td><td>Specimen Tech Solutions Pvt Ltd</td><td>₹ 2,12,400</td></tr>
     </table>
     <p class="note">Mobile Number and email for TDS correspondence: as registered above.</p>`,
    `<h2>Bank Account for Refund</h2>
     <div class="lines">
       <p>Bank: Specimen Bank Ltd., Kothrud branch</p>
       <p>IFSC: SPEC0000388</p>
       <p>Account Number: 50100234567890 (savings)</p>
       <p>Refund due: ₹ 8,640</p>
     </div>`,
    `<h2>Verification</h2>
     <div class="prose">
       <p>I, Rohan Verma, son of Kishore Verma, solemnly declare that to the best of my knowledge and belief the information given in this return is correct and complete and is in accordance with the provisions of the Income-tax Act.</p>
       <p>Verified electronically using an Aadhaar OTP sent to the registered Mobile Number +91 90110 23452 on 22/07/2026.</p>
       <p>This acknowledgement is computer generated and does not need a signature. Keep the Acknowledgement Number for any future correspondence.</p>
     </div>`,
  ];
  return pages.map((p) => strip + p);
}

const BASE_CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: 'Noto Sans', 'Noto Sans Devanagari', sans-serif; color: #1a1a1a; font-size: 11pt; line-height: 1.5; }
  .page { width: 210mm; height: 297mm; padding: 16mm 16mm 14mm; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .specimen { border: 1.5px dashed #b91c1c; color: #b91c1c; font-weight: 700; font-size: 8pt; padding: 4px 8px; margin-bottom: 12px; text-align: center; }
  h1 { font-size: 16pt; margin: 0 0 2px; }
  h2 { font-size: 12.5pt; margin: 16px 0 6px; }
  .sub { color: #444; margin: 0 0 12px; }
  .lines p, .prose p { margin: 0 0 5px; }
  .prose p { margin-bottom: 8px; }
  .note { font-size: 9.5pt; color: #444; margin-top: 10px; }
  .strip { border-bottom: 1px solid #999; margin-bottom: 8px; font-size: 9pt; }
  .strip p { margin: 0 0 2px; }
  .mrz { font-family: monospace; font-size: 10pt; margin-top: 18px; letter-spacing: 0.08em; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; margin-top: 4px; }
  th, td { border: 1px solid #999; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #eef1f6; }
`;

// Rendered to a JPEG, so what matters is that OCR can read it: dark text,
// generous size, a faint paper tint and a slight skew rather than noise.
const SCAN_CSS = `
  body { width: 1240px; height: 1754px; background: #f4f2ec; }
  .scan { width: 1240px; height: 1754px; padding: 110px 120px; transform: rotate(0.35deg); font-size: 22px; line-height: 1.6; color: #202020; position: relative; }
  .scan h1 { font-size: 34px; }
  .scan .specimen { font-size: 15px; }
  .wm { position: absolute; top: 760px; left: 220px; font-size: 160px; font-weight: 700; color: rgba(185, 28, 28, 0.06); transform: rotate(-28deg); }
`;

const PHOTO_CSS = `
  body { width: 1400px; height: 1000px; }
  .desk { width: 1400px; height: 1000px; display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #6b4a2f, #8a6441 45%, #5d3f27); }
  .card { width: 1080px; padding: 44px 56px; background: #fbf7ee; border-radius: 14px; transform: rotate(-2deg);
          box-shadow: 0 18px 40px rgba(0,0,0,0.45); font-size: 25px; line-height: 1.55; color: #1c1c1c; }
  .card h1 { font-size: 38px; letter-spacing: 0.04em; }
  .card p { margin: 0 0 4px; }
  .card .big { font-size: 30px; font-weight: 700; margin: 8px 0; }
  .card .specimen { font-size: 15px; }
`;
