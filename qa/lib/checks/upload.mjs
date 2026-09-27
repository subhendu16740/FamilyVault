// ─── Upload: the whole ingest pipeline, end to end, every run ───
//
// A fresh document goes in exactly the way the app sends one, and each
// stage that has failed silently in this project's history is checked:
//
//   ingest-document succeeds with chunks        (the month-long "pending" PDF)
//   ...and with vectors                          (the HF 410: every chunk NULL)
//   metadata extraction finds expiry + policy    (what powers expiry alerts)
//   an expiry alert becomes a notification       (get_user_notifications had
//                                                 never worked until 023)
//
// Then a password-protected PDF, which must fail VISIBLY. Both are deleted
// afterwards. Cost: one small embedding call and one OCR.space request.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { invokeFunction } from '../supabase.mjs';
import { uploadDocument, deleteDocument, fetchCategories } from '../vault.mjs';
import { vehicleInsurance } from '../tiny-pdf.mjs';
import { documents } from '../../fixtures/documents.mjs';

const LOCKED = documents.find((d) => d.kind === 'locked-pdf');

export async function runUploadChecks(cfg, { a, vaultA }, results, today) {
  const categories = await fetchCategories(a);

  // ── 1. A born-digital PDF with an expiry 20 days out.
  const vehicle = vehicleInsurance({ today, runId: cfg.runId });
  const fileName = `qa_vehicle_insurance_${cfg.runId}.pdf`;
  const up = await uploadDocument(cfg, a, vaultA, { fileName, bytes: vehicle.bytes, categoryId: categories.get('Vehicle Insurance') });

  if (up.stage !== 'ingest') {
    results.add('upload', 'vehicle:ingest', 'Upload a PDF and index it', 'fail', { why: `${up.stage} failed: ${up.error}` });
    return;
  }
  const body = up.ingest.data ?? {};
  const ingested = up.ingest.status === 200 && body.success === true && Number(body.chunks) >= 1;
  results.add('upload', 'vehicle:ingest', 'Upload a PDF and index it (storage → insert → ingest-document)', ingested ? 'pass' : 'fail', {
    why: ingested ? `${body.chunks} chunk(s), ${body.metadata} metadata field(s) in ${(up.ingest.ms / 1000).toFixed(1)}s` : `HTTP ${up.ingest.status}: ${body.error ?? JSON.stringify(body).slice(0, 200)}`,
  });
  results.add('upload', 'vehicle:vectors', 'Its chunks got search vectors (HuggingFace embeddings)', ingested && !body.embed_error ? 'pass' : ingested ? 'fail' : 'skipped', {
    why: body.embed_error ? `NO VECTORS: ${body.embed_error}` : ingested ? 'no embed_error' : 'ingest failed',
  });

  const doc = { id: up.docId, storage_path: up.storagePath };
  try {
    if (!ingested) return;

    const { data: detail, error: detailErr } = await a.client.rpc('get_document_detail', { p_family_id: vaultA.id, p_document_id: up.docId });
    const row = detail?.[0];
    const meta = Array.isArray(row?.metadata) ? row.metadata : [];
    const values = (key) => meta.filter((m) => m.key === key).map((m) => m.value);
    const status = row?.ingestion_status;
    const expiries = values('expiry_date');
    const expiryOk = expiries.includes(vehicle.expiry);
    const policyOk = values('policy_number').includes(vehicle.policyNumber);
    results.add('upload', 'vehicle:metadata', 'It reads as completed, with its expiry date and policy number extracted',
      !detailErr && status === 'completed' && expiryOk && policyOk ? 'pass' : 'fail', {
        why: detailErr
          ? detailErr.message
          : `status ${status}; expiry_date ${expiries.join(' / ') || 'missing'} (want ${vehicle.expiry}); policy_number ${values('policy_number').join(' / ') || 'missing'} (want ${vehicle.policyNumber})`,
      });

    // KNOWN ISSUE: the second expiry pattern in _shared/ingest.ts
    // extractMetadata() is meant for YYYY-first dates, but also matches
    // DD/MM/YYYY and cuts the year: "Valid until: 17/10/2026" is stored
    // twice, as 17/10/2026 AND 17/10/20. The document viewer lists every
    // metadata row, so people see a bogus expiry. Passes once fixed.
    const bogus = expiries.filter((v) => v !== vehicle.expiry);
    if (expiryOk) {
      results.add('upload', 'vehicle:metadata-clean', 'No bogus second expiry date is stored', bogus.length ? 'known' : 'pass', {
        why: bogus.length
          ? `also stored ${bogus.join(', ')} — the YYYY-first expiry regex in _shared/ingest.ts matches DD/MM/YYYY and truncates the year; the viewer shows both`
          : 'known issue fixed: only the real expiry is stored',
      });
    }

    // An expiry inside 90 days must become a notification for every member.
    const { data: created, error: checkErr } = await a.client.rpc('check_expiry_notifications', { p_family_id: vaultA.id });
    const { data: inbox, error: inboxErr } = await a.client.rpc('get_user_notifications', { p_user_id: a.user.id, p_limit: 50, p_offset: 0 });
    const mine = (inbox ?? []).find((n) => n.document_ref === up.docId && n.type === 'expiry');
    results.add('upload', 'vehicle:notification', 'Its expiry alert became a notification (check_expiry_notifications → get_user_notifications)',
      !checkErr && !inboxErr && mine ? 'pass' : 'fail', {
        why: checkErr ? `check_expiry_notifications: ${checkErr.message}` : inboxErr ? `get_user_notifications: ${inboxErr.message}` : mine ? `"${mine.title}"` : `no notification for this document (check created ${created ?? 0})`,
      });
    if (mine) await a.client.rpc('mark_notification_read', { p_notification_id: mine.id, p_user_id: a.user.id });
  } finally {
    const err = await deleteDocument(a, vaultA, doc);
    if (err) results.note('upload', `could not delete ${fileName}: ${err}`);
  }

  // ── 2. A password-protected PDF must fail visibly.
  // Today PDF.js is never given a password, so ingest must answer 422
  // "empty". The failure mode this guards against is the quiet one: a 200
  // that stores junk from the encrypted bytes as if it were the document.
  // When password support ships, change this expectation — don't delete it.
  const locked = await uploadDocument(cfg, a, vaultA, {
    fileName: `qa_locked_statement_${cfg.runId}.pdf`,
    bytes: readFileSync(new URL(`../../fixtures/files/${LOCKED.file}`, import.meta.url)),
    categoryId: categories.get(LOCKED.category),
  });
  try {
    const lb = locked.ingest?.data ?? {};
    const refusedVisibly = locked.stage === 'ingest' && locked.ingest.status === 422 && lb.empty === true;
    results.add('upload', 'locked:visible', 'A password-protected PDF is reported unreadable, never stored as junk', refusedVisibly ? 'pass' : 'fail', {
      why: locked.stage !== 'ingest'
        ? `${locked.stage} failed: ${locked.error}`
        : refusedVisibly
          ? `422: ${String(lb.error ?? '').slice(0, 120)}`
          : `HTTP ${locked.ingest.status}${lb.success ? ` — INDEXED ${lb.chunks} chunk(s) of an encrypted file` : ''}: ${JSON.stringify(lb).slice(0, 160)}`,
    });
  } finally {
    if (locked.docId) {
      const err = await deleteDocument(a, vaultA, { id: locked.docId, storage_path: locked.storagePath });
      if (err) results.note('upload', `could not delete the locked test file: ${err}`);
    }
  }
}

/**
 * Nothing stuck, nothing unindexed, vectors from the current model.
 * Documents setup already reported are excluded — one failure, one report.
 */
export async function checkIndex(cfg, a, vaultA, results, notIndexed = new Map()) {
  const r = await invokeFunction(cfg, a, 'reembed-index', { family_id: vaultA.id, status_only: true });
  const d = r.data ?? {};
  const unindexed = Array.isArray(d.unindexed) ? d.unindexed : [];
  const unexplained = unindexed.filter((f) => !notIndexed.has(f));
  const explained = unindexed.filter((f) => notIndexed.has(f));
  const ok = r.status === 200 && d.up_to_date === true && unexplained.length === 0;
  results.add('index', 'healthy', 'QA Vault A has no unexplained unindexed documents and an up-to-date search index', ok ? 'pass' : 'fail', {
    why: r.status !== 200
      ? `reembed-index answered ${r.status}: ${d.error ?? JSON.stringify(d).slice(0, 160)}`
      : [
          `${d.up_to_date ? 'up to date' : `REBUILDING ${d.done_count}/${d.total_count}`} on ${d.model}`,
          unexplained.length && `UNINDEXED: ${unexplained.join(', ')}`,
          explained.length && `already reported in setup: ${explained.join(', ')}`,
        ].filter(Boolean).join('; '),
  });
}
