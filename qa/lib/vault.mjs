// ─── The QA vaults, and uploading exactly the way the app does ──
//
// QA Vault A (account A) holds the permanent SPECIMEN documents the
// questions are about. QA Vault B (account B) exists so B is an ordinary
// member of SOME family — a realistic stranger for the access checks.
// Both are created on the first run and reused after that.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { invokeFunction } from './supabase.mjs';
import { permanentDocuments } from '../fixtures/documents.mjs';

export const VAULT_A = 'QA Vault A';
export const VAULT_B = 'QA Vault B';
const DESCRIPTION = 'Automated QA: synthetic SPECIMEN documents only. Managed by qa/run.mjs — do not store real documents here.';
const FIXTURES = new URL('../fixtures/files/', import.meta.url);

// Names the runner gives to throwaway documents. Anything left with one of
// these prefixes is debris from a run that died before cleaning up.
export const EPHEMERAL = /^qa_(vehicle|locked|sacrificial)_/;

export async function ensureVault(actor, name) {
  const findMembership = async () => {
    const { data, error } = await actor.client.from('family_members').select('id, family_id, role').eq('user_id', actor.user.id);
    if (error) throw new Error(`${actor.label}: could not read memberships: ${error.message}`);
    return data ?? [];
  };

  let memberships = await findMembership();
  let family = null;
  if (memberships.length) {
    const { data, error } = await actor.client.from('families').select('id, name, storage_namespace').in('id', memberships.map((m) => m.family_id));
    if (error) throw new Error(`${actor.label}: could not read families: ${error.message}`);
    family = (data ?? []).find((f) => f.name === name) ?? null;
  }

  let created = false;
  if (!family) {
    const { data: id, error } = await actor.client.rpc('create_family', {
      p_user_id: actor.user.id,
      p_family_name: name,
      p_description: DESCRIPTION,
      p_family_icon: '🧪',
    });
    if (error) throw new Error(`${actor.label}: create_family failed: ${error.message}`);
    const { data, error: readErr } = await actor.client.from('families').select('id, name, storage_namespace').eq('id', id).single();
    if (readErr) throw new Error(`${actor.label}: created ${name} but cannot read it back: ${readErr.message}`);
    family = data;
    created = true;
    memberships = await findMembership();
  }

  const member = memberships.find((m) => m.family_id === family.id);
  return { id: family.id, name: family.name, namespace: family.storage_namespace, memberId: member?.id, role: member?.role, created };
}

export async function listDocuments(actor, vault) {
  const { data, error } = await actor.client.rpc('get_family_documents', { p_family_id: vault.id, p_limit: 200, p_offset: 0 });
  if (error) throw new Error(`${actor.label}: get_family_documents failed: ${error.message}`);
  return data ?? [];
}

export async function fetchCategories(actor) {
  const { data, error } = await actor.client.from('document_categories').select('id, name');
  if (error) throw new Error(`could not read document categories: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.name, c.id]));
}

/**
 * Mirrors uploadDocument() in src/lib/api.ts step for step — storage path,
 * content type, the insert RPC, then ingest-document — so a change that
 * breaks uploading in the app breaks it here too. The one difference: no
 * client OCR text is sent, so images and scans take the server's OCR path.
 */
export async function uploadDocument(cfg, actor, vault, { fileName, bytes, categoryId }) {
  const fileType = fileName.split('.').pop().toLowerCase();
  const storagePath = `${vault.namespace}/${Date.now()}_${fileName}`;
  const mimeType = fileType === 'pdf' ? 'application/pdf' : `image/${fileType}`;

  const { error: storageErr } = await actor.client.storage
    .from('documents')
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (storageErr) return { stage: 'storage', error: storageErr.message, storagePath };

  const { data: docId, error: insertErr } = await actor.client.rpc('insert_family_document', {
    p_family_id: vault.id,
    p_uploaded_by: actor.user.id,
    p_file_name: fileName,
    p_file_type: fileType,
    p_file_size_bytes: bytes.length,
    p_storage_path: storagePath,
    p_category_id: categoryId ?? undefined,
  });
  if (insertErr) {
    await actor.client.storage.from('documents').remove([storagePath]);
    return { stage: 'insert', error: insertErr.message, storagePath };
  }

  const ingest = await invokeFunction(cfg, actor, 'ingest-document', {
    family_id: vault.id,
    document_id: docId,
    storage_path: storagePath,
  });
  return { stage: 'ingest', docId, storagePath, ingest };
}

export async function deleteDocument(actor, vault, { id, storage_path: storagePath }) {
  const { error } = await actor.client.rpc('delete_family_document', {
    p_family_id: vault.id,
    p_document_id: id,
    p_user_id: actor.user.id,
  });
  if (storagePath) await actor.client.storage.from('documents').remove([storagePath]);
  return error?.message ?? null;
}

/**
 * Bring QA Vault A to exactly the permanent fixture set: remove debris and
 * superseded fixture versions, then upload whatever is missing or failed.
 * Idempotent, and cheap once done — later runs upload nothing.
 */
export async function syncFixtures(cfg, actor, vault, results) {
  const categories = await fetchCategories(actor);
  const wanted = new Set(permanentDocuments.map((d) => d.file));

  for (const doc of await listDocuments(actor, vault)) {
    const debris = EPHEMERAL.test(doc.file_name);
    const superseded = !wanted.has(doc.file_name) && /_specimen_v\d+\.(pdf|jpg)$/.test(doc.file_name);
    if (debris || superseded) {
      const err = await deleteDocument(actor, vault, doc);
      results.note('setup', `${err ? 'could not remove' : 'removed'} ${debris ? 'leftover' : 'superseded'} ${doc.file_name}${err ? `: ${err}` : ''}`);
    }
  }

  const present = await listDocuments(actor, vault);
  let uploaded = 0;
  let ocrOutage = false;
  // Fixtures that are not indexed, with why: the index check and the
  // questions use this so one failure is reported once, not three times.
  const notIndexed = new Map();

  for (const fixture of permanentDocuments) {
    const existing = present.find((d) => d.file_name === fixture.file);
    if (existing?.ingestion_status === 'completed') continue;
    if (existing) await deleteDocument(actor, vault, existing); // failed or stuck: start again

    const bytes = readFileSync(new URL(fixture.file, FIXTURES));
    const up = await uploadDocument(cfg, actor, vault, { fileName: fixture.file, bytes, categoryId: categories.get(fixture.category) });
    uploaded++;
    const body = up.ingest?.data ?? {};
    const ok = up.stage === 'ingest' && up.ingest.status === 200 && body.success === true;
    const error = String(body.error ?? up.error ?? '');
    let [status, why] = ok
      ? [body.embed_error ? 'fail' : 'pass', `${body.chunks} chunk(s)${body.embed_error ? `, NO VECTORS: ${body.embed_error}` : ''}`]
      : ['fail', up.stage === 'ingest' ? `ingest-document answered ${up.ingest.status}: ${error || JSON.stringify(body).slice(0, 200)}` : `${up.stage} failed: ${error}`];

    if (!ok) {
      const known = KNOWN_INGEST_FAILURES.find((k) => k.match.test(error));
      if (OCR_OUTAGE.test(error)) {
        // OCR.space's free tier is down or refusing — outside the app.
        ocrOutage = true;
        [status, why] = ['inconclusive', `OCR.space unavailable (${error}) — an outage outside the app; retried on the next run`];
      } else if (fixture.kind === 'photo' && ocrOutage && /nothing readable/i.test(error)) {
        [status, why] = ['inconclusive', 'OCR.space was down this run, so this photo could not be read; retried on the next run'];
        results.add('setup', 'known:image-ocr-reason', 'An OCR outage is reported as an OCR outage for images too', 'known', {
          why: 'for images, ingest says "Nothing readable could be extracted" and drops the OCR error (PDFs keep it), so an outage looks like a bad file and is not marked retryable — extractTextFromImage() in _shared/ingest.ts discards ocrWithOcrSpace().error',
        });
      } else if (known) {
        [status, why] = ['known', known.why];
      }
    }
    results.add('setup', `fixture:${fixture.file}`, `Upload ${fixture.file}`, status, { why });
    if (!ok) notIndexed.set(fixture.file, { status, why });
  }

  const final = await listDocuments(actor, vault);
  for (const f of permanentDocuments) {
    const row = final.find((d) => d.file_name === f.file);
    if (row?.ingestion_status !== 'completed' && !notIndexed.has(f.file)) notIndexed.set(f.file, { status: 'fail', why: `status ${row?.ingestion_status ?? 'missing'}` });
  }
  const indexed = permanentDocuments.length - notIndexed.size;
  const statuses = [...notIndexed.values()].map((v) => v.status);
  const status = statuses.length === 0 ? 'pass' : statuses.includes('fail') ? 'fail' : statuses.includes('inconclusive') ? 'inconclusive' : 'known';
  results.add('setup', 'vault-ready', `${vault.name} holds all ${permanentDocuments.length} SPECIMEN documents, indexed`, status, {
    why: `${indexed}/${permanentDocuments.length} indexed${uploaded ? `, ${uploaded} uploaded this run` : ''}${notIndexed.size ? `; not indexed: ${[...notIndexed.keys()].join(', ')}` : ''}`,
  });
  return { docs: final, notIndexed };
}

// OCR.space's free tier answering 5xx, or not answering at all.
const OCR_OUTAGE = /OCR service (returned HTTP 5\d\d|unreachable)/i;

// Failures already diagnosed, matched by their exact signature so any OTHER
// failure of the same document still fails the run.
const KNOWN_INGEST_FAILURES = [
  {
    match: /unsupported Unicode escape sequence/i,
    why: 'the whole ingestion fails (500): PDF.js emits U+0000 for Devanagari glyphs it cannot map, and Postgres refuses a NUL in text/jsonb, so complete_document_ingestion rejects the chunks and the document never becomes searchable — strip \\u0000 from extracted text in _shared/ingest.ts',
  },
];
