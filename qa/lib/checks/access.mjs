// ─── Access: a stranger must not reach QA Vault A ───────────────
//
// Two strangers: a logged-out visitor with only the public anon key, and QA
// account B, signed in and a member of a DIFFERENT family. Every function
// the app calls, the Edge Functions (Gmail import's included) and storage
// are tried against account A's vault. Migrations 019, 022 and 023 each
// closed a hole of exactly this shape; these probes keep them closed.
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
//
// B's writes to its OWN rows (migration 025's holes) are built so a hole
// can never leave damage: a change that goes through is read back and
// undone at once, and an insert is aimed at a key that already exists, so
// an open policy shows up as a duplicate-key error instead of a new row.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { invokeFunction } from '../supabase.mjs';
import { permanentDocuments } from '../../fixtures/documents.mjs';

// The phrasings this app's refusals actually use: 42501 from the 023
// asserts and from column privileges (025), "Access denied" (P0001) from the
// read RPCs in 024, delete_family_document's own permission check, the RLS
// and storage messages, and the Edge Functions' own 401/403 bodies.
const AUTH_REFUSAL =
  /permission denied|access denied|not allowed|not a member|does not have permission|row-level security|jwt|sign in required|not authori[sz]ed|unauthori[sz]ed|forbidden|upload permission|object not found/i;
const AUTH_CODES = new Set(['42501', '401', '403', 'PGRST301', 'PGRST302']);

export function refusedByAuth(error) {
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

export const short = (error) => String(error?.message ?? error?.error ?? error).slice(0, 90);

// For a write that must be refused: an authorization error passes; a
// duplicate-key error (23505) means the policy LET IT THROUGH and only a
// constraint stopped this particular row; no error at all is judged by
// what the probe read back.
function judgeWrite(open) {
  return ({ error, allowed, reverted }) => {
    if (error) {
      if (refusedByAuth(error)) return ['pass', short(error)];
      if (String(error.code) === '23505') return ['fail', `ALLOWED — only a duplicate key stopped this row: ${open}`];
      return ['fail', `stopped for another reason (${short(error)}) — update this probe`];
    }
    if (allowed) return ['fail', `ALLOWED: ${open} (${reverted === false ? 'COULD NOT UNDO IT' : 'undone'})`];
    return ['pass', 'no row changed'];
  };
}

// The Gmail functions ship with migration 026: until they are deployed to
// DEV the gateway answers 404, and until 026 is applied they answer
// needs_migration. Both are skips — a refusal from a function that is not
// there proves nothing.
const gmailJudge = (check) => ({ status, data }) => {
  if (status === 404 && !data?.status) return ['skipped', 'not deployed to DEV yet'];
  if (status === 503 && data?.status === 'needs_migration') return ['skipped', 'migration 026 is not applied to DEV yet'];
  return check(status, data);
};
const http401 = (status, data) => (status === 401 || status === 403
  ? ['pass', `HTTP ${status}`]
  : ['fail', `HTTP ${status}${status >= 200 && status < 300 ? ' — the function served a stranger' : ''}: ${JSON.stringify(data).slice(0, 160)}`]);

function gmailCallbackJudge({ status, data }) {
  if (status === 404) return ['skipped', 'not deployed to DEV yet'];
  if (data?.location) return ['fail', `REDIRECTED to ${data.location} for a state it never issued`];
  if (status === 401) return ['fail', "deployed WITH JWT verification, so Google's redirect back is refused — deploy gmail-callback with --no-verify-jwt"];
  if (status === 503) return ['skipped', 'migration 026 is not applied to DEV yet'];
  if (status === 400) return ['pass', 'no such attempt: nowhere to go'];
  return ['fail', `HTTP ${status}: the state lookup failed`];
}

// public.feedback ships with migration 027. Until it is applied to DEV the
// table does not exist, and a refusal from a table that is not there proves
// nothing — so that is a skip, like the Gmail probes before 026.
const missingTable = (error) => !!error && (['PGRST205', '42P01'].includes(String(error.code))
  || /could not find the table|does not exist/i.test(String(error.message ?? '')));
const feedbackJudge = (expect) => (outcome) => (missingTable(outcome.error)
  ? ['skipped', 'migration 027 is not applied to DEV yet']
  : judge(expect, outcome));

// public.saved_chats ships with migration 028: skipped until it is applied.
const savedChatsJudge = (expect, needsChat) => (outcome) => {
  if (missingTable(outcome.error) || outcome.missing) return ['skipped', 'migration 028 is not applied to DEV yet'];
  if (needsChat && outcome.noTarget) return ['skipped', "no saved chat of account A's to aim at (see its control)"];
  return typeof expect === 'function' ? expect(outcome) : judge(expect, outcome);
};

// Account deletion ships with migration 029 and the delete-account function:
// skipped until both are on DEV, like the Gmail probes before 026.
const accountFnJudge = (check) => ({ status, data }) => {
  if (status === 404 && !data?.status) return ['skipped', 'delete-account is not deployed to DEV yet'];
  if (status === 503 && data?.status === 'needs_migration') return ['skipped', 'migration 029 is not applied to DEV yet'];
  return check(status, data);
};
const accountRpcJudge = (expect) => (outcome) => (String(outcome.error?.code) === 'PGRST202'
  ? ['skipped', 'migration 029 is not applied to DEV yet']
  : judge(expect, outcome));

// Linking someone in the tree to an account ships with migration 033 and the
// link-account function: skipped until both are on DEV, likewise.
const linkFnJudge = (check) => ({ status, data }) => {
  if (status === 404 && !data?.status) return ['skipped', 'link-account is not deployed to DEV yet'];
  if (status === 503 && data?.status === 'needs_migration') return ['skipped', 'migration 033 is not applied to DEV yet'];
  return check(status, data);
};
const linkRpcJudge = (expect) => (outcome) => (String(outcome.error?.code) === 'PGRST202'
  ? ['skipped', 'migration 033 is not applied to DEV yet']
  : judge(expect, outcome));

// The family tree ships with migration 031: skipped until it is applied, like
// saved chats before 028. PGRST202 is its functions missing, a missing table
// its tables.
const treeJudge = (expect, needsPerson) => (outcome) => {
  if (outcome.missing || missingTable(outcome.error) || String(outcome.error?.code) === 'PGRST202') {
    return ['skipped', 'migration 031 is not applied to DEV yet'];
  }
  if (needsPerson && outcome.noTarget) return ['skipped', "no person in account A's tree to aim at (see its control)"];
  return judge(expect, outcome);
};

// Emergency cards ship with migration 032, on top of 031's tree: skipped
// until it is applied, the same way.
const emergencyJudge = (expect, needsCard) => (outcome) => {
  if (outcome.missing || missingTable(outcome.error) || String(outcome.error?.code) === 'PGRST202') {
    return ['skipped', 'migration 032 is not applied to DEV yet'];
  }
  if (needsCard && outcome.noTarget) return ['skipped', "no emergency card in account A's tree to aim at (see its control)"];
  return judge(expect, outcome);
};

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

  // ── A saved chat of account A's for the saved-chat probes to aim at (028).
  let chatA = null;
  let chatsMissing = false;
  {
    const { data, error } = await a.client.from('saved_chats')
      .insert({ family_id: A.family, title: `QA probe ${cfg.runId}`, messages: [{ role: 'user', text: 'SPECIMEN question' }] })
      .select('id').single();
    if (missingTable(error)) {
      chatsMissing = true;
      results.add('access', 'control:saved-chat', 'Control — account A saves a chat and reads it back', 'skipped', { why: 'migration 028 is not applied to DEV yet' });
    } else if (error) {
      results.add('access', 'control:saved-chat', 'Control — account A saves a chat and reads it back', 'fail', { why: error.message });
    } else {
      const { data: back } = await a.client.from('saved_chats').select('id').eq('id', data.id);
      chatA = back?.length ? data.id : null;
      results.add('access', 'control:saved-chat', 'Control — account A saves a chat and reads it back', chatA ? 'pass' : 'fail',
        chatA ? {} : { why: 'saved, but A cannot read its own chat back' });
    }
  }
  const onChatA = (run) => async () => {
    if (chatsMissing) return { missing: true };
    if (!chatA) return { noTarget: true };
    return run();
  };
  const unchanged = (open) => savedChatsJudge(judgeWrite(open), true);

  // ── A person in account A's family tree for the tree probes to aim at (031).
  const personName = `QA probe ${cfg.runId}`;
  let personA = null;
  let treeMissing = false;
  {
    const { data, error } = await a.client.rpc('add_family_person', { p_family_id: A.family, p_display_name: personName });
    if (missingTable(error) || String(error?.code) === 'PGRST202') {
      treeMissing = true;
      results.add('access', 'control:tree', 'Control — account A adds a person to its family tree and reads it back', 'skipped', { why: 'migration 031 is not applied to DEV yet' });
    } else if (error) {
      results.add('access', 'control:tree', 'Control — account A adds a person to its family tree and reads it back', 'fail', { why: error.message });
    } else {
      const { data: back } = await a.client.from('family_people').select('id').eq('id', data);
      personA = back?.length ? data : null;
      results.add('access', 'control:tree', 'Control — account A adds a person to its family tree and reads it back', personA ? 'pass' : 'fail',
        personA ? {} : { why: 'added, but A cannot read the person back' });
    }
  }
  const onPersonA = (run) => async () => {
    if (treeMissing) return { missing: true };
    if (!personA) return { noTarget: true };
    return run();
  };

  // ── An emergency card on that person for the card probes to aim at (032).
  const cardBody = { blood_group: 'B+', allergies: `QA SPECIMEN ${cfg.runId}` };
  let cardA = false;
  let cardsMissing = treeMissing;
  if (personA) {
    const { error } = await a.client.rpc('save_emergency_card', { p_person_id: personA, p_card: cardBody });
    if (missingTable(error) || String(error?.code) === 'PGRST202') {
      cardsMissing = true;
      results.add('access', 'control:emergency', 'Control — account A saves an emergency card in its tree and reads it back', 'skipped', { why: 'migration 032 is not applied to DEV yet' });
    } else if (error) {
      results.add('access', 'control:emergency', 'Control — account A saves an emergency card in its tree and reads it back', 'fail', { why: error.message });
    } else {
      const { data: back } = await a.client.from('family_emergency_cards').select('allergies').eq('person_id', personA);
      cardA = back?.length === 1 && back[0].allergies === cardBody.allergies;
      results.add('access', 'control:emergency', 'Control — account A saves an emergency card in its tree and reads it back', cardA ? 'pass' : 'fail',
        cardA ? {} : { why: 'saved, but A cannot read the card back' });
    }
  }
  const onCards = (run) => async () => (cardsMissing ? { missing: true } : run());
  const onCardA = (run) => async () => {
    if (cardsMissing) return { missing: true };
    if (!cardA) return { noTarget: true };
    return run();
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

    // Its own rows, which RLS lets it reach — so only column privileges
    // (025) stand in the way.
    ['B', 'change its own profile email', judgeWrite("an address held in public.users blocks that person's sign-up (users_email_key)"), async () => {
      const { data: before } = await b.client.from('users').select('email').eq('id', b.user.id).single();
      const probe = `qa-probe-${cfg.runId}@example.invalid`;
      const { error } = await b.client.from('users').update({ email: probe }).eq('id', b.user.id);
      if (error) return { error };
      const { data: now } = await b.client.from('users').select('email').eq('id', b.user.id).single();
      if (now?.email !== probe) return {};
      const { error: undo } = await b.client.from('users').update({ email: before?.email }).eq('id', b.user.id);
      return { allowed: true, reverted: !undo };
    }],
    // Since 027 a person may change their own name — and only their own:
    // users_update_own is what keeps that grant to one row.
    ['B', "rename account A", judgeWrite("users_update_own is what limits 027's name grant to the person's own row"), async () => {
      const { data: before } = await a.client.from('users').select('display_name').eq('id', A.user).single();
      const probe = `QA intrusion ${cfg.runId}`;
      const { error } = await b.client.from('users').update({ display_name: probe }).eq('id', A.user);
      if (error) return { error };
      const { data: now } = await a.client.from('users').select('display_name').eq('id', A.user).single();
      if (now?.display_name !== probe) return {};
      const { error: undo } = await a.client.from('users').update({ display_name: before?.display_name }).eq('id', A.user);
      return { allowed: true, reverted: !undo };
    }],
    ['B', 'create a user row', judgeWrite('anyone can insert into public.users, and a row with a fresh id and someone else\'s email blocks their sign-up'),
      () => b.client.from('users').insert({ id: b.user.id, email: `qa-probe-${cfg.runId}@example.invalid`, display_name: 'QA probe' })],
    ['B', 'create a family row directly', judgeWrite('families_insert lets a client create a family with no schema behind it'),
      () => b.client.from('families').insert({ name: 'QA intrusion', created_by: b.user.id, storage_namespace: vaultB.namespace, vector_namespace: `qa_probe_${cfg.runId}` })],
    ['B', "point its own vault at QA Vault A's storage namespace", judgeWrite('an admin can rewrite families.storage_namespace, which every family RPC and storage policy resolves'), async () => {
      const { error } = await b.client.from('families').update({ storage_namespace: A.ns }).eq('id', vaultB.id);
      if (error) return { error };
      const { data } = await b.client.from('families').select('storage_namespace').eq('id', vaultB.id).single();
      if (data?.storage_namespace !== A.ns) return {};
      const { error: undo } = await b.client.from('families').update({ storage_namespace: vaultB.namespace }).eq('id', vaultB.id);
      return { allowed: true, reverted: !undo };
    }],
    // Gmail import (026). A person's mailbox findings belong to them alone,
    // and a Gmail token must only ever land with the account that asked.
    ['anon', 'read anyone\'s Gmail connection', gmailJudge(http401), fn(anon, 'gmail-connect', { action: 'status' })],
    ['anon', 'list what a Gmail scan found', gmailJudge(http401), fn(anon, 'gmail-scan', { action: 'list' })],
    ['anon', 'import a Gmail attachment into QA Vault A', gmailJudge(http401), fn(anon, 'gmail-import', { item_id: randomUUID(), family_id: A.family })],
    ['anon', 'be sent anywhere by gmail-callback with a state it never issued', gmailCallbackJudge, async () => {
      // As Google's redirect arrives: a plain GET, no session, no apikey.
      const res = await fetch(`${cfg.url}/functions/v1/gmail-callback?state=qa-${cfg.runId}&code=qa`, { redirect: 'manual' });
      return { status: res.status, data: { location: res.headers.get('location') } };
    }],
    ['B', 'import a Gmail attachment into QA Vault A', gmailJudge(http401), fn(b, 'gmail-import', { item_id: randomUUID(), family_id: A.family })],
    ['B', 'finish a Gmail connection it did not start', gmailJudge((s, d) =>
      (s === 400 && d?.status === 'expired' ? ['pass', 'no such attempt for this account'] : ['fail', `HTTP ${s}: ${JSON.stringify(d).slice(0, 160)}`])),
    fn(b, 'gmail-connect', { action: 'finish', state: `qa-${cfg.runId}`, code: 'qa' })],
    ['B', 'get a Gmail consent link that returns to another website', gmailJudge((s, d) => {
      if (d?.url) return ['fail', 'GOT A CONSENT LINK returning to https://evil.example: GMAIL_RETURN_ORIGINS is not being enforced'];
      if ((s === 400 && d?.status === 'origin_not_allowed') || (s === 503 && d?.status === 'not_configured')) return ['pass', d.status];
      return ['fail', `HTTP ${s}: ${JSON.stringify(d).slice(0, 160)}`];
    }), fn(b, 'gmail-connect', { action: 'start', return_origin: 'https://evil.example' })],

    // Feedback (027): anyone signed in may send one as themselves, and nobody
    // but the team reads them back.
    ['anon', 'send feedback', feedbackJudge('refused'), () => anon.client.from('feedback').insert({ message: `QA probe ${cfg.runId}` })],
    ['B', 'send feedback as account A', feedbackJudge('refused'), () => b.client.from('feedback').insert({ user_id: A.user, message: `QA probe ${cfg.runId}` })],
    ['B', 'read the feedback people have sent', feedbackJudge('refused-or-empty'), () => b.client.from('feedback').select('id, message').limit(5)],

    // Saved chats (028): only their owner reads, adds to, changes or deletes them.
    ['anon', 'read saved chats', savedChatsJudge('refused-or-empty'), () => anon.client.from('saved_chats').select('id, title').limit(5)],
    ['anon', 'save a chat into QA Vault A', savedChatsJudge('refused'), () => anon.client.from('saved_chats').insert({ family_id: A.family, title: 'QA probe', messages: [] })],
    ['B', "read account A's saved chat", savedChatsJudge('refused-or-empty', true), onChatA(() => b.client.from('saved_chats').select('id, title, messages').eq('id', chatA))],
    ['B', 'save a chat into QA Vault A', savedChatsJudge('refused'), () => b.client.from('saved_chats').insert({ family_id: A.family, title: 'QA probe', messages: [] })],
    ['B', 'save a chat as account A', savedChatsJudge('refused'), () => b.client.from('saved_chats').insert({ user_id: A.user, family_id: vaultB.id, title: 'QA probe', messages: [] })],
    ['B', "change account A's saved chat", unchanged("B rewrote a chat only A should see"), onChatA(async () => {
      const { data, error } = await b.client.from('saved_chats').update({ title: 'QA intrusion' }).eq('id', chatA).select('id');
      return error ? { error } : data?.length ? { allowed: true, reverted: false } : {};
    })],
    ['B', "delete account A's saved chat", unchanged("B deleted a chat only A should see"), onChatA(async () => {
      const { data, error } = await b.client.from('saved_chats').delete().eq('id', chatA).select('id');
      return error ? { error } : data?.length ? { allowed: true, reverted: false } : {};
    })],

    // The family tree (031): its members read it; only its admins change it,
    // through functions that take the caller from the session.
    ['anon', "read QA Vault A's family tree", treeJudge('refused-or-empty'), () => anon.client.from('family_people').select('id, display_name').eq('family_id', A.family)],
    ['anon', "add a person to QA Vault A's tree", treeJudge('refused'), rpc(anon, 'add_family_person', { p_family_id: A.family, p_display_name: 'QA intrusion' })],
    ['B', "read QA Vault A's family tree", treeJudge('refused-or-empty'), () => b.client.from('family_people').select('id, display_name').eq('family_id', A.family)],
    ['B', "read how QA Vault A's people are related", treeJudge('refused-or-empty'), () => b.client.from('family_links').select('id').eq('family_id', A.family)],
    ['B', "add a person to QA Vault A's tree", treeJudge('refused'), rpc(b, 'add_family_person', { p_family_id: A.family, p_display_name: 'QA intrusion' })],
    ['B', "write QA Vault A's tree directly", treeJudge('refused'), () => b.client.from('family_people').insert({ family_id: A.family, display_name: 'QA intrusion' })],
    ['B', "rename a person in A's tree", treeJudge('refused', true), onPersonA(() => b.client.rpc('update_family_person', { p_person_id: personA, p_display_name: 'QA intrusion' }))],
    ['B', "connect people in A's tree", treeJudge('refused', true), onPersonA(() => b.client.rpc('link_family_people', { p_family_id: A.family, p_person: personA, p_relation: 'sibling', p_relative: randomUUID() }))],
    ['B', "take a person out of A's tree", treeJudge('refused', true), onPersonA(() => b.client.rpc('remove_family_person', { p_person_id: personA }))],
    ['B', "list the documents marked as A's people (server-only)", treeJudge('refused'), rpc(b, 'rag_documents_for_people', { p_schema: A.ns, p_people: [randomUUID()] })],
    // Emergency cards (032): the family's members read them; only an admin,
    // or the person themselves, changes one, and nobody writes the table.
    ['anon', "read QA Vault A's emergency cards", emergencyJudge('refused-or-empty'), onCards(() => anon.client.from('family_emergency_cards').select('person_id').eq('family_id', A.family))],
    ['anon', "change an emergency card in A's tree", emergencyJudge('refused', true), onCardA(() => anon.client.rpc('save_emergency_card', { p_person_id: personA, p_card: { blood_group: 'O-' } }))],
    ['B', "read QA Vault A's emergency cards", emergencyJudge('refused-or-empty'), onCards(() => b.client.from('family_emergency_cards').select('person_id, allergies').eq('family_id', A.family))],
    ['B', "change an emergency card in A's tree", emergencyJudge('refused', true), onCardA(() => b.client.rpc('save_emergency_card', { p_person_id: personA, p_card: { blood_group: 'O-' } }))],
    ['B', "delete an emergency card in A's tree", emergencyJudge('refused', true), onCardA(() => b.client.rpc('save_emergency_card', { p_person_id: personA, p_card: {} }))],
    ['B', "write QA Vault A's emergency cards directly", emergencyJudge('refused'), onCards(() => b.client.from('family_emergency_cards').insert({ person_id: personA ?? randomUUID(), family_id: A.family, blood_group: 'O-' }))],

    // Linking someone in the tree to an account (033): an admin's job, through
    // link-account. B's two attempts come near the end, below.
    ['anon', "link a person in A's tree to an account", linkFnJudge(http401), fn(anon, 'link-account', { family_id: A.family, person_id: randomUUID(), email: cfg.b.email })],
    ['anon', 'link an account through the database (server-only)', linkRpcJudge('refused'), rpc(anon, 'link_family_person_account', { p_family_id: A.family, p_linked_by: A.user, p_person_id: randomUUID(), p_email: cfg.b.email })],

    // Deleting an account (029): only ever the caller's own, and the database
    // side is the server's alone. Nothing here can delete anything even if the
    // protection failed: the database probes aim at ids that belong to nobody,
    // and no probe asks for a real deletion.
    ['anon', 'see what deleting an account would do', accountFnJudge(http401), fn(anon, 'delete-account', { action: 'preview' })],
    ['anon', 'delete an account', accountFnJudge(http401), fn(anon, 'delete-account', { action: 'delete', confirm: 'DELETE', user_id: A.user })],
    ['anon', 'delete an account through the database (server-only)', accountRpcJudge('refused'), rpc(anon, 'delete_account_data', { p_user_id: randomUUID() })],
    ['B', "read account A's deletion plan (server-only)", accountRpcJudge('refused'), rpc(b, 'account_deletion_plan', { p_user_id: A.user })],
    ['B', 'delete an account through the database (server-only)', accountRpcJudge('refused'), rpc(b, 'delete_account_data', { p_user_id: randomUUID() })],
    ['B', 'delete a family through the database (server-only)', accountRpcJudge('refused'), rpc(b, 'purge_family', { p_family_id: randomUUID() })],
    ['B', "list QA Vault A's files through the database (server-only)", accountRpcJudge('refused'), rpc(b, 'family_storage_objects', { p_storage_namespace: A.ns })],
    ['B', "get account A's deletion preview by naming A", accountFnJudge((status, data) => {
      if (status !== 200) return ['fail', `HTTP ${status}: ${JSON.stringify(data).slice(0, 160)}`];
      const ids = (data?.families ?? []).map((f) => f.family_id);
      return ids.includes(A.family)
        ? ['fail', 'LISTED QA Vault A: the preview answered for the account named in the body, not the caller']
        : ['pass', `only its own families (${ids.length})`];
    }), fn(b, 'delete-account', { action: 'preview', user_id: A.user })],

    // Late, like the last probe: were linking open, B naming its own email
    // would be in QA Vault A as that person, with their documents and card,
    // and every probe after it would be testing an insider.
    ['B', "link a person in A's tree to its own account", linkFnJudge(http401), async () => fn(b, 'link-account', { family_id: A.family, person_id: personA ?? randomUUID(), email: cfg.b.email })()],
    ['B', 'link an account through the database (server-only)', linkRpcJudge('refused'), async () => b.client.rpc('link_family_person_account', { p_family_id: A.family, p_linked_by: A.user, p_person_id: personA ?? randomUUID(), p_email: cfg.b.email })],

    // Undone the moment it is seen: a superuser B would make every read
    // probe above meaningless, so this runs after them.
    ['B', 'make itself superuser', judgeWrite("is_superuser() then opens every family's members, invitations, notifications and profiles"), async () => {
      const { error } = await b.client.from('users').update({ is_superuser: true }).eq('id', b.user.id);
      if (error) return { error };
      const { data } = await b.client.from('users').select('is_superuser').eq('id', b.user.id).single();
      if (!data?.is_superuser) return {};
      const { error: undo } = await b.client.from('users').update({ is_superuser: false }).eq('id', b.user.id);
      return { allowed: true, reverted: !undo };
    }],
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
    const [status, why] = typeof expect === 'function' ? expect(outcome) : judge(expect, outcome);
    results.add('access', `probe:${n}`, `${who === 'anon' ? 'Logged-out visitor' : 'Account B'} cannot ${what}`, status, { why });
  }

  // ── Clean up anything a probe managed to create, and verify the target survived.
  // (Superuser first: harmless when refused, essential if a probe died mid-way.)
  await b.client.from('users').update({ is_superuser: false }).eq('id', b.user.id);
  await a.client.storage.from('documents').remove([intrusionPath]);
  await b.client.from('family_members').delete().eq('family_id', A.family).eq('user_id', b.user.id);
  await a.client.from('invitations').delete().eq('family_id', A.family).eq('token', `qa-${cfg.runId}`);

  if (chatA) {
    const { data: chatStill } = await a.client.from('saved_chats').select('title').eq('id', chatA);
    const intact = chatStill?.length === 1 && chatStill[0].title === `QA probe ${cfg.runId}`;
    results.add('access', 'control:saved-chat-intact', "Control — account A's saved chat survived every probe", intact ? 'pass' : 'fail',
      intact ? {} : { why: chatStill?.length ? 'its title was CHANGED' : 'it is GONE' });
    await a.client.from('saved_chats').delete().eq('id', chatA);
  }

  if (cardA) {
    const { data: cardStill } = await a.client.from('family_emergency_cards').select('blood_group, allergies').eq('person_id', personA);
    const intact = cardStill?.length === 1 && cardStill[0].blood_group === cardBody.blood_group && cardStill[0].allergies === cardBody.allergies;
    results.add('access', 'control:emergency-intact', "Control — the emergency card in account A's tree survived every probe", intact ? 'pass' : 'fail',
      intact ? {} : { why: cardStill?.length ? 'it was CHANGED' : 'it is GONE' });
  }

  if (personA) {   // taking the person out takes their card with it
    const { data: personStill } = await a.client.from('family_people').select('display_name').eq('id', personA);
    const intact = personStill?.length === 1 && personStill[0].display_name === personName;
    results.add('access', 'control:tree-intact', "Control — the person in account A's tree survived every probe", intact ? 'pass' : 'fail',
      intact ? {} : { why: personStill?.length ? 'their name was CHANGED' : 'they are GONE' });
    const { error: rmErr } = await a.client.rpc('remove_family_person', { p_person_id: personA });
    if (rmErr) results.note('access', `could not remove the probe person from the tree: ${rmErr.message}`);
  }

  const { data: still } = await a.client.rpc('get_document_detail', { p_family_id: A.family, p_document_id: sacrificialId });
  results.add('access', 'control:target-intact', "Control — the sacrificial document survived every probe", still?.length ? 'pass' : 'fail',
    still?.length ? {} : { why: 'it is GONE — one of the delete probes succeeded' });
  const { error: delErr } = await a.client.rpc('delete_family_document', { p_family_id: A.family, p_document_id: sacrificialId, p_user_id: A.user });
  if (delErr && still?.length) results.note('access', `could not remove the sacrificial document: ${delErr.message}`);
}
