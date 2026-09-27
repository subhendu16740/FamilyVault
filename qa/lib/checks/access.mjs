// ─── Access: a stranger must not reach QA Vault A ───────────────
//
// Two strangers: a logged-out visitor with only the public anon key, and QA
// account B, signed in and a member of a DIFFERENT family. Every function
// the app calls, the four Edge Functions and storage are tried against
// account A's vault. Migrations 019, 022 and 023 each closed a hole of
// exactly this shape; these probes keep them closed.
//
// Two rules keep a probe honest:
//   - A refusal only counts if it is an AUTHORIZATION refusal. "Could not
//     find the function" also stops the call, but means the probe no longer
//     tests anything — so it fails, and says to update the probe.
//   - Each kind of probe has a positive control: account A doing the same
//     thing to its own vault must work. A refusal is meaningless if the
//     request could not have succeeded for anyone.
//
// Writes are aimed at a SACRIFICIAL document created for the purpose, so a
// regression cannot damage the permanent fixtures; anything a probe manages
// to create is removed again, and the probe fails loudly.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { invokeFunction } from '../supabase.mjs';
import { permanentDocuments } from '../../fixtures/documents.mjs';

// The phrasings this app's refusals actually use: 42501 from the 023
// asserts, "Access denied" (P0001) from the read RPCs in 024, the RLS and
// storage messages, and the Edge Functions' own 401/403 bodies.
const AUTH_REFUSAL =
  /permission denied|access denied|not allowed|not a member|row-level security|jwt|sign in required|not authori[sz]ed|unauthori[sz]ed|forbidden|upload permission|object not found/i;
const AUTH_CODES = new Set(['42501', '401', '403', 'PGRST301', 'PGRST302']);

function refusedByAuth(error) {
  if (!error) return false;
  const code = String(error.code ?? error.statusCode ?? error.status ?? '');
  // PGRST202 is "no such function": the call never reached an access check.
  if (code === 'PGRST202') return false;
  return AUTH_CODES.has(code) || AUTH_REFUSAL.test(String(error.message ?? error.error ?? ''));
}

const isEmpty = (data) => data == null || (Array.isArray(data) && data.length === 0);

function judge(expect, outcome) {
  const { error, data, status } = outcome;
  switch (expect) {
    case 'refused':
      if (!error) return ['fail', 'was ALLOWED'];
      return refusedByAuth(error) ? ['pass', short(error)] : ['fail', `stopped for another reason (${short(error)}) — update this probe`];
    case 'refused-or-empty':
      if (error) return refusedByAuth(error) ? ['pass', short(error)] : ['fail', `stopped for another reason (${short(error)}) — update this probe`];
      return isEmpty(data) ? ['pass', 'nothing returned'] : ['fail', `RETURNED DATA: ${JSON.stringify(data).slice(0, 160)}`];
    case 'refused-or-zero':
      if (error) return refusedByAuth(error) ? ['pass', short(error)] : ['fail', `stopped for another reason (${short(error)})`];
      return isEmpty(data) || Number(data?.[0]?.doc_count ?? 0) === 0 ? ['pass', 'nothing returned'] : ['fail', `RETURNED ${JSON.stringify(data).slice(0, 160)}`];
    case 'http-401-403':
      if (status === 401 || status === 403) return ['pass', `HTTP ${status}`];
      return ['fail', `HTTP ${status}${status >= 200 && status < 300 ? ' — the function served a stranger' : ''}: ${JSON.stringify(data).slice(0, 160)}`];
    default:
      throw new Error(`unknown expectation ${expect}`);
  }
}

const short = (error) => String(error?.message ?? error?.error ?? error).slice(0, 90);

async function attempt(fn) {
  try {
    const out = await fn();
    return out ?? {};
  } catch (err) {
    return { error: err };
  }
}

export async function runAccessChecks(cfg, { a, b, anon, vaultA, vaultB, docsA }, results) {
  const passport = docsA.find((d) => d.file_name === permanentDocuments[0].file);
  if (!passport) {
    results.add('access', 'setup', 'Access checks', 'skipped', { why: 'the passport fixture is not in QA Vault A, so there is nothing to aim at' });
    return;
  }

  // ── B must start as a stranger. A membership left by an earlier run that
  // died mid-probe would make every refusal below meaningless.
  await b.client.from('family_members').delete().eq('family_id', vaultA.id).eq('user_id', b.user.id);
  const { data: roster } = await a.client.from('family_members').select('user_id').eq('family_id', vaultA.id);
  const strangerOk = (roster ?? []).every((m) => m.user_id !== b.user.id);
  results.add('access', 'control:b-is-stranger', 'Control — account B is not a member of QA Vault A', strangerOk ? 'pass' : 'fail',
    strangerOk ? {} : { why: 'B is still a member and could not be removed — the refusals below would prove nothing' });
  if (!strangerOk) return;

  // ── Positive controls: A can do all of this to its own vault.
  const controls = [
    ['documents', 'Account A lists its own documents', async () => {
      const { data, error } = await a.client.rpc('get_family_documents', { p_family_id: vaultA.id, p_limit: 50, p_offset: 0 });
      return error ? `error: ${error.message}` : (data?.length ?? 0) >= permanentDocuments.length ? null : `only ${data?.length ?? 0} documents`;
    }],
    ['storage-list', 'Account A lists its own files', async () => {
      const { data, error } = await a.client.storage.from('documents').list(vaultA.namespace, { limit: 100 });
      return error ? `error: ${error.message}` : data?.length ? null : 'no files listed';
    }],
    ['storage-download', 'Account A downloads its own passport file', async () => {
      const { error } = await a.client.storage.from('documents').download(passport.storage_path);
      return error ? `error: ${error.message}` : null;
    }],
    ['family', 'Account A reads its own family', async () => {
      const { data, error } = await a.client.from('families').select('id').eq('id', vaultA.id);
      return error ? `error: ${error.message}` : data?.length === 1 ? null : 'family not visible';
    }],
    ['b-works', 'Account B reads its own vault', async () => {
      const { error } = await b.client.rpc('get_family_documents', { p_family_id: vaultB.id, p_limit: 5, p_offset: 0 });
      return error ? `error: ${error.message}` : null;
    }],
  ];
  let controlsOk = true;
  for (const [id, title, run] of controls) {
    const problem = await run().catch((err) => `threw: ${err.message}`);
    if (problem) controlsOk = false;
    results.add('access', `control:${id}`, `Control — ${title}`, problem ? 'fail' : 'pass', problem ? { why: problem } : {});
  }
  if (!controlsOk) {
    results.add('access', 'probes', 'Access probes', 'skipped', { why: 'a positive control failed, so a refusal would prove nothing' });
    return;
  }

  // ── The sacrificial document every write probe aims at.
  const sacrificialPath = `${vaultA.namespace}/qa_sacrificial_${cfg.runId}.pdf`;
  const { data: sacrificialId, error: sacErr } = await a.client.rpc('insert_family_document', {
    p_family_id: vaultA.id,
    p_uploaded_by: a.user.id,
    p_file_name: `qa_sacrificial_${cfg.runId}.pdf`,
    p_file_type: 'pdf',
    p_file_size_bytes: 1,
    p_storage_path: sacrificialPath,
  });
  if (sacErr) {
    results.add('access', 'sacrificial', 'Create the sacrificial document for write probes', 'fail', { why: sacErr.message });
    return;
  }

  const A = { family: vaultA.id, user: a.user.id, ns: vaultA.namespace };
  const intrusionPath = `${A.ns}/qa_probe_${cfg.runId}.pdf`;
  const rpc = (actor, name, args) => () => actor.client.rpc(name, args);
  const fn = (actor, name, body) => async () => {
    const r = await invokeFunction(cfg, actor, name, body, { timeoutMs: 30_000 });
    return { status: r.status, data: r.data };
  };

  const probes = [
    // Logged out
    ['anon', 'list QA Vault A', 'refused-or-empty', rpc(anon, 'get_family_documents', { p_family_id: A.family, p_limit: 5, p_offset: 0 })],
    ['anon', 'insert a document as account A', 'refused', rpc(anon, 'insert_family_document', { p_family_id: A.family, p_uploaded_by: A.user, p_file_name: 'x.pdf', p_file_type: 'pdf', p_file_size_bytes: 1, p_storage_path: `${A.ns}/x.pdf` })],
    ['anon', "read account A's notifications", 'refused', rpc(anon, 'get_user_notifications', { p_user_id: A.user, p_limit: 5, p_offset: 0 })],
    ['anon', 'create a family owned by account A', 'refused', rpc(anon, 'create_family', { p_user_id: A.user, p_family_name: 'QA intrusion' })],
    ['anon', 'ask rag-search about QA Vault A', 'http-401-403', fn(anon, 'rag-search', { family_id: A.family, query: 'passport' })],
    ['anon', "list QA Vault A's files", 'refused-or-empty', () => anon.client.storage.from('documents').list(A.ns)],
    ['anon', "read QA Vault A's family row", 'refused-or-empty', () => anon.client.from('families').select('id').eq('id', A.family)],

    // Signed in as B, a member of another family
    ['B', 'list QA Vault A', 'refused-or-empty', rpc(b, 'get_family_documents', { p_family_id: A.family, p_limit: 5, p_offset: 0 })],
    ['B', "open A's passport record", 'refused-or-empty', rpc(b, 'get_document_detail', { p_family_id: A.family, p_document_id: passport.id })],
    ['B', "read QA Vault A's stats", 'refused-or-zero', rpc(b, 'get_family_stats', { p_family_id: A.family })],
    ['B', 'upload into QA Vault A as itself', 'refused', rpc(b, 'insert_family_document', { p_family_id: A.family, p_uploaded_by: b.user.id, p_file_name: 'x.pdf', p_file_type: 'pdf', p_file_size_bytes: 1, p_storage_path: `${A.ns}/x.pdf` })],
    ['B', 'upload into QA Vault A posing as A', 'refused', rpc(b, 'insert_family_document', { p_family_id: A.family, p_uploaded_by: A.user, p_file_name: 'x.pdf', p_file_type: 'pdf', p_file_size_bytes: 1, p_storage_path: `${A.ns}/x.pdf` })],
    ['B', "rename A's document posing as A", 'refused', rpc(b, 'update_family_document', { p_family_id: A.family, p_document_id: sacrificialId, p_user_id: A.user, p_file_name: `qa_sacrificial_${cfg.runId}.pdf` })],
    ['B', "delete A's document posing as A", 'refused', rpc(b, 'delete_family_document', { p_family_id: A.family, p_document_id: sacrificialId, p_user_id: A.user })],
    ['B', "delete A's document as itself", 'refused', rpc(b, 'delete_family_document', { p_family_id: A.family, p_document_id: sacrificialId, p_user_id: b.user.id })],
    ['B', "read A's notifications", 'refused', rpc(b, 'get_user_notifications', { p_user_id: A.user, p_limit: 5, p_offset: 0 })],
    ['B', "mark A's notification read", 'refused', rpc(b, 'mark_notification_read', { p_notification_id: randomUUID(), p_user_id: A.user })],
    ['B', "trigger QA Vault A's expiry notifications", 'refused', rpc(b, 'check_expiry_notifications', { p_family_id: A.family })],
    ['B', "overwrite A's document text (server-only)", 'refused', rpc(b, 'complete_document_ingestion', { p_family_id: A.family, p_document_id: sacrificialId, p_ocr_text: 'QA intrusion', p_chunks: [], p_metadata: [] })],
    ['B', 'plant an expiry alert (server-only)', 'refused', rpc(b, 'create_expiry_alert', { p_family_id: A.family, p_document_id: sacrificialId, p_expiry_date: '2030-01-01' })],
    ['B', "read A's chunks by schema name (server-only)", 'refused', rpc(b, 'rag_retrieve_chunks', { p_schema: A.ns, p_tsquery: 'passport', p_query_pattern: '%passport%' })],
    ['B', 'ask rag-search about QA Vault A', 'http-401-403', fn(b, 'rag-search', { family_id: A.family, query: 'passport' })],
    ['B', "re-ingest A's document", 'http-401-403', fn(b, 'ingest-document', { family_id: A.family, document_id: sacrificialId, storage_path: sacrificialPath })],
    ['B', "read QA Vault A's index status", 'http-401-403', fn(b, 'reembed-index', { family_id: A.family, status_only: true })],
    ['B', "list QA Vault A's files", 'refused-or-empty', () => b.client.storage.from('documents').list(A.ns)],
    ['B', "download A's passport file", 'refused', () => b.client.storage.from('documents').download(passport.storage_path)],
    // A PDF, because the bucket only accepts document types: a text file is
    // stopped by the MIME whitelist before the folder policy is ever tested.
    ['B', "write a file into QA Vault A's folder", 'refused', () => b.client.storage.from('documents').upload(intrusionPath, Buffer.from('%PDF-1.4\n% FamilyVault QA probe\n'), { contentType: 'application/pdf' })],
    ['B', "read QA Vault A's family row", 'refused-or-empty', () => b.client.from('families').select('id').eq('id', A.family)],
    ['B', "read QA Vault A's member list", 'refused-or-empty', () => b.client.from('family_members').select('id').eq('family_id', A.family)],
    ['B', "read A's rows in the notifications table", 'refused-or-empty', () => b.client.from('notifications').select('id').eq('user_id', A.user)],
    ['B', "read A's user profile", 'refused-or-empty', () => b.client.from('users').select('id').eq('id', A.user)],
    ['B', 'invite itself into QA Vault A as admin', 'refused', () => b.client.from('invitations').insert({ family_id: A.family, invited_by: b.user.id, invitee_email: cfg.b.email, role: 'admin', token: `qa-${cfg.runId}`, expires_at: new Date(Date.now() + 86_400_000).toISOString() })],
    // LAST, deliberately: if this succeeds B becomes an admin of QA Vault A,
    // and every probe after it would be testing an insider, not a stranger.
    // (Run 1 learned this the hard way: the invitation probe above "passed"
    // for B only because B had just made itself admin here.)
    ['B', 'add itself to QA Vault A as admin', 'refused', () => b.client.from('family_members').insert({ family_id: A.family, user_id: b.user.id, role: 'admin' })],
  ];

  let n = 0;
  for (const [who, what, expect, run] of probes) {
    n++;
    const outcome = await attempt(run);
    const [status, why] = judge(expect, outcome);
    results.add('access', `probe:${n}`, `${who === 'anon' ? 'Logged-out visitor' : 'Account B'} cannot ${what}`, status, { why });
  }

  // ── Clean up anything a probe managed to create, and verify the target survived.
  await a.client.storage.from('documents').remove([intrusionPath]);
  await b.client.from('family_members').delete().eq('family_id', A.family).eq('user_id', b.user.id);
  await a.client.from('invitations').delete().eq('family_id', A.family).eq('token', `qa-${cfg.runId}`);

  const { data: still } = await a.client.rpc('get_document_detail', { p_family_id: A.family, p_document_id: sacrificialId });
  results.add('access', 'control:target-intact', "Control — the sacrificial document survived every probe", still?.length ? 'pass' : 'fail',
    still?.length ? {} : { why: 'it is GONE — one of the delete probes succeeded' });
  const { error: delErr } = await a.client.rpc('delete_family_document', { p_family_id: A.family, p_document_id: sacrificialId, p_user_id: A.user });
  if (delErr && still?.length) results.note('access', `could not remove the sacrificial document: ${delErr.message}`);
}
