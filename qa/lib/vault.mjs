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
  for (const fixture of permanentDocuments) {
    const existing = present.find((d) => d.file_name === fixture.file);
    if (existing?.ingestion_status === 'completed') continue;
    if (existing) await deleteDocument(actor, vault, existing); // failed or stuck: start again

    const bytes = readFileSync(new URL(fixture.file, FIXTURES));
    const up = await uploadDocument(cfg, actor, vault, { fileName: fixture.file, bytes, categoryId: categories.get(fixture.category) });
    uploaded++;
    const ok = up.stage === 'ingest' && up.ingest.status === 200 && up.ingest.data?.success === true;
    const why = ok
      ? `${up.ingest.data.chunks} chunk(s)${up.ingest.data.embed_error ? `, NO VECTORS: ${up.ingest.data.embed_error}` : ''}`
      : up.stage === 'ingest'
        ? `ingest-document answered ${up.ingest.status}: ${up.ingest.data?.error ?? JSON.stringify(up.ingest.data).slice(0, 200)}`
        : `${up.stage} failed: ${up.error}`;
    results.add('setup', `fixture:${fixture.file}`, `Upload ${fixture.file}`, ok && !up.ingest.data.embed_error ? 'pass' : 'fail', { why });
  }

  const final = await listDocuments(actor, vault);
  const indexed = permanentDocuments.filter((f) => final.some((d) => d.file_name === f.file && d.ingestion_status === 'completed'));
  const status = indexed.length === permanentDocuments.length ? 'pass' : 'fail';
  results.add('setup', 'vault-ready', `${vault.name} holds all ${permanentDocuments.length} SPECIMEN documents, indexed`, status, {
    why: `${indexed.length}/${permanentDocuments.length} indexed${uploaded ? `, ${uploaded} uploaded this run` : ''}`,
  });
  return final;
}
