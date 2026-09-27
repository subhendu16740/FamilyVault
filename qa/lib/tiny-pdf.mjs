// ─── A one-page PDF, built at run time ──────────────────────────
//
// The upload check needs a document whose expiry is ~20 days from TODAY:
// that is what makes check_expiry_notifications fire, and a committed file
// would stop firing a few weeks after it was made. Writing the PDF here, by
// hand, keeps CI free of a browser. Helvetica and plain ASCII are enough for
// PDF.js to read it back, which tools/selftest.mjs proves offline.
// ────────────────────────────────────────────────────────────────

export function textPdf(lines, { fontSize = 11, leading = 16 } = {}) {
  const escape = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');
  const content = [
    'BT',
    `/F1 ${fontSize} Tf`,
    `${leading} TL`,
    '56 780 Td',
    ...lines.map((line, i) => `${i ? 'T* ' : ''}(${escape(line)}) Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(out, 'latin1');
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const ddmmyyyy = (d) =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

/**
 * The vehicle insurance certificate the upload check sends. Laid out so the
 * server's own metadata regexes find exactly one policy number and one
 * expiry: "Policy No:" is the first place any of policy / account / member /
 * certificate is followed by an identifier, and "Valid until:" is the only
 * expiry phrase.
 */
export function vehicleInsurance({ today, runId }) {
  const end = new Date(today.getTime() + 20 * 86_400_000);
  const start = new Date(end.getTime() - 364 * 86_400_000);
  const lines = [
    'SPECIMEN MOTOR INSURANCE CO. - SPECIMEN, NOT A REAL DOCUMENT',
    `Created by the FamilyVault QA suite (run ${runId}) and deleted again at the end of the run.`,
    'Private Car Package - Schedule and Certificate of Insurance',
    'Policy No: SMV2026990177',
    'Insured: Rohan Verma',
    'Vehicle Registration Number: MH12QA2026   Make and Model: Specimen Hatchback VXi',
    `Period of Insurance: ${ddmmyyyy(start)} to ${ddmmyyyy(end)}`,
    `Valid until: ${ddmmyyyy(end)}`,
    'Insured Declared Value: Rs. 4,85,000   Premium paid: Rs. 11,240',
    'Nominee: Asha Verma (spouse)',
    'In case of an accident, call the claims helpline within 24 hours and keep this document in the vehicle.',
  ];
  return { bytes: textPdf(lines), expiry: ddmmyyyy(end), expiryIso: end.toISOString().slice(0, 10), policyNumber: 'SMV2026990177' };
}
