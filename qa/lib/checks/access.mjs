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

import { createHmac, randomUUID } from 'node:crypto';
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

// Reminders on devices ship with migration 034 and the push function:
// skipped until both are on DEV, like the Gmail probes before 026.
const pushJudge = (expect, needsDevice) => (outcome) => {
  if (outcome.missing || missingTable(outcome.error) || String(outcome.error?.code) === 'PGRST202') {
    return ['skipped', 'migration 034 is not applied to DEV yet'];
  }
  if (needsDevice && outcome.noTarget) return ['skipped', "no device of account A's to aim at (see its control)"];
  return typeof expect === 'function' ? expect(outcome) : judge(expect, outcome);
};
const pushFnJudge = (check) => ({ status, data }) => {
  if (status === 404 && !data?.status) return ['skipped', 'push is not deployed to DEV yet'];
  if (status === 503 && data?.status === 'needs_migration') return ['skipped', 'migration 034 is not applied to DEV yet'];
  return check(status, data);
};
// Share links ship with migration 036 and the share function: skipped until
// both are on DEV.
const shareFnJudge = (check) => ({ status, data }) => {
  if (status === 404 && !data?.status) return ['skipped', 'share is not deployed to DEV yet'];
  if (status === 503 && data?.status === 'needs_migration') return ['skipped', 'migration 036 is not applied to DEV yet'];
  return check(status, data);
};
const shareJudge = (expect, needsLink) => (outcome) => {
  if (outcome.missing || missingTable(outcome.error) || String(outcome.error?.code) === 'PGRST202') {
    return ['skipped', 'migration 036 is not applied to DEV yet'];
  }
  if (needsLink && outcome.noTarget) return ['skipped', "no link of account A's to aim at (see its control)"];
  return typeof expect === 'function' ? expect(outcome) : judge(expect, outcome);
};
// Invitations ship with migration 037: skipped until it is on DEV.
const inviteJudge = (expect) => (outcome) => {
  if (outcome.missing || missingTable(outcome.error) || String(outcome.error?.code) === 'PGRST202') {
    return ['skipped', 'migration 037 is not applied to DEV yet'];
  }
  return judge(expect, outcome);
};
// Plans and storage limits ship with migration 038: skipped until it is on DEV.
const planJudge = (expect) => (outcome) => {
  if (outcome.missing || missingTable(outcome.error) || String(outcome.error?.code) === 'PGRST202') {
    return ['skipped', 'migration 038 is not applied to DEV yet'];
  }
  return typeof expect === 'function' ? expect(outcome) : judge(expect, outcome);
};
// When Family Plus ends (040): the countdown and the clean-up are the
// server's alone. Skipped until 040 is on DEV, and the plans function until
// it is deployed there.
const lapseJudge = (expect) => (outcome) => {
  if (String(outcome.error?.code) === 'PGRST202') return ['skipped', 'migration 040 is not applied to DEV yet'];
  return judge(expect, outcome);
};
const plansFnJudge = ({ status, data }) => {
  if (status === 404 && !data?.status) return ['skipped', 'plans is not deployed to DEV yet'];
  if (status === 503 && data?.status === 'needs_migration') return ['skipped', 'migration 040 is not applied to DEV yet'];
  // Open by design, like push's send: it removes only what the database says
  // is due, and QA Vault A has never been on Plus. The sacrificial-document
  // control at the end proves nothing of A's went.
  return status === 200 && typeof data?.families === 'number'
    ? ['pass', `ran; nothing of QA Vault A's was due (${data.families} famil${data.families === 1 ? 'y' : 'ies'} on DEV)`]
    : ['fail', `HTTP ${status}: ${JSON.stringify(data).slice(0, 160)}`];
};
// What each plan allows (041): the count of voice chats and the plan helper
// are the server's; a member claims voice chats in their own family only, and
// nobody raises a plan's member limit. Skipped until 041 is on DEV
// (PGRST204: plan_limits has no max_members column yet).
const limitsJudge = (expect) => (outcome) => {
  if (missingTable(outcome.error) || ['PGRST202', 'PGRST204'].includes(String(outcome.error?.code))) {
    return ['skipped', 'migration 041 is not applied to DEV yet'];
  }
  return judge(expect, outcome);
};
// Saved chats in storage and voice chats left (042): the count of a family's
// voice chats is its members' to read, and what its saved chats add up to is
// the server's. Skipped until 042 is on DEV (PGRST202: no such function).
const chatsVoiceJudge = (expect) => (outcome) => {
  if (String(outcome.error?.code) === 'PGRST202') return ['skipped', 'migration 042 is not applied to DEV yet'];
  return judge(expect, outcome);
};
// Voice chats per person (043): each person's count is in member_usage,
// which no client reads. Skipped until 043 is on DEV (the table is missing).
const perPersonJudge = (expect) => (outcome) => {
  if (missingTable(outcome.error)) return ['skipped', 'migration 043 is not applied to DEV yet'];
  return judge(expect, outcome);
};
// Paying for Family Plus (044): the payments function makes an order only for
// a member's own family and confirms only a payment Razorpay signed; the
// ledger (plan_payments) and the function that adds the time are the
// server's. Skipped until the function is deployed to DEV, and the database
// probes until 044 is applied there.
const paymentsFnJudge = (check) => ({ status, data }) => {
  if (status === 404 && !data?.status) return ['skipped', 'payments is not deployed to DEV yet'];
  if (status === 503 && data?.status === 'needs_migration') return ['skipped', 'migration 044 is not applied to DEV yet'];
  return check(status, data);
};
const paymentsDbJudge = (expect) => (outcome) => {
  if (missingTable(outcome.error) || String(outcome.error?.code) === 'PGRST202') {
    return ['skipped', 'migration 044 is not applied to DEV yet'];
  }
  return typeof expect === 'function' ? expect(outcome) : judge(expect, outcome);
};
// razorpay-webhook is deployed WITHOUT the gateway's JWT check, because
// Razorpay calls it with none, so its own signature check is all that stands
// between a stranger and a free Family Plus. Its refusal says bad_signature;
// a 401 without that is the gateway's, and Razorpay would be refused too.
const webhookJudge = (forged) => ({ status, data }) => {
  if (status === 404) return ['skipped', 'razorpay-webhook is not deployed to DEV yet'];
  if (status === 401 && data?.status === 'bad_signature') return ['pass', 'HTTP 401 bad_signature'];
  if (status === 401) return ['fail', "deployed WITH JWT verification, so Razorpay's own reports are refused — deploy razorpay-webhook with --no-verify-jwt"];
  if (status === 503 && data?.status === 'not_configured') {
    return forged
      ? ['skipped', 'RAZORPAY_WEBHOOK_SECRET is not set on DEV, so there is no signature to forge yet']
      : ['pass', 'no webhook secret on DEV yet, so it refuses every report'];
  }
  return ['fail', `HTTP ${status}${status >= 200 && status < 300 ? ` — it ACCEPTED ${forged ? 'a forged' : 'an unsigned'} payment report` : ''}: ${JSON.stringify(data).slice(0, 160)}`];
};
// A well-formed device key and secret: RFC 8291's own example.
const PROBE_P256DH = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const PROBE_AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';

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

// Nicknames ship with migration 045, on top of 031's tree: skipped until it
// is applied (the function, or the column, is missing).
const nicknameJudge = (expect) => (outcome) => {
  if (outcome.missing) return ['skipped', 'migration 031 is not applied to DEV yet'];
  if (outcome.noTarget) return ['skipped', "no person in account A's tree to aim at (see its control)"];
  if (['PGRST202', 'PGRST204', '42703'].includes(String(outcome.error?.code))) return ['skipped', 'migration 045 is not applied to DEV yet'];
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

// Personal vaults (046): nobody but its owner sees one, joins one or is
// invited to one, and Ask searches only vaults the asker is in. Skipped
// until 046 is on DEV, and the rag-search probes until the rag-search that
// searches across vaults is deployed there: before it, a request that names
// vaults and no family_id is a 400 ("Missing family_id").
const personalJudge = (expect, needsVault) => (outcome) => {
  if (outcome.missing || String(outcome.error?.code) === 'PGRST202') return ['skipped', 'migration 046 is not applied to DEV yet'];
  if (needsVault && outcome.noTarget) return ['skipped', "no personal vault of account A's to aim at (see its control)"];
  return judge(expect, outcome);
};
const vaultsJudge = (outcome) => {
  if (outcome.missing) return ['skipped', 'migration 046 is not applied to DEV yet'];
  if (outcome.noTarget) return ['skipped', "no personal vault of account A's to aim at (see its control)"];
  if (outcome.status === 400 && /missing family_id/i.test(String(outcome.data?.error ?? ''))) {
    return ['skipped', 'rag-search on DEV does not search across vaults yet'];
  }
  return judge('http-401-403', outcome);
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

  // ── A nickname for that person (045), set by account A and read back — the
  // control for the nickname probes below.
  const nicknameA = `QA ${cfg.runId}`.slice(0, 40);
  let nicknameSet = false;
  if (personA) {
    const { error } = await a.client.rpc('set_family_person_nickname', { p_person_id: personA, p_nickname: nicknameA });
    if (String(error?.code) === 'PGRST202') {
      results.add('access', 'control:nickname', "Control — account A gives someone in its tree a nickname and reads it back", 'skipped', { why: 'migration 045 is not applied to DEV yet' });
    } else if (error) {
      results.add('access', 'control:nickname', "Control — account A gives someone in its tree a nickname and reads it back", 'fail', { why: error.message });
    } else {
      const { data: back } = await a.client.from('family_people').select('nickname').eq('id', personA).single();
      nicknameSet = back?.nickname === nicknameA;
      results.add('access', 'control:nickname', "Control — account A gives someone in its tree a nickname and reads it back", nicknameSet ? 'pass' : 'fail',
        nicknameSet ? {} : { why: `read back ${JSON.stringify(back?.nickname)}` });
    }
  }

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

  // ── A notification device of account A's for the device probes to aim at
  // (034): an address at Google's push service that leads nowhere — Google
  // answers 410, and the sender forgets a device that answers so. So nothing
  // may be waiting for it: A's notifications are marked read first, and the
  // device is removed straight after the probes.
  const deviceEndpoint = `https://fcm.googleapis.com/fcm/send/qa-probe-${cfg.runId}`;
  let deviceA = false;
  let pushMissing = false;
  {
    await a.client.from('notifications').update({ is_read: true }).eq('user_id', A.user).eq('is_read', false);
    const { error } = await a.client.rpc('save_push_subscription', {
      p_endpoint: deviceEndpoint, p_p256dh: PROBE_P256DH, p_auth: PROBE_AUTH, p_label: 'QA probe',
    });
    if (missingTable(error) || String(error?.code) === 'PGRST202') {
      pushMissing = true;
      results.add('access', 'control:push-device', 'Control — account A turns notifications on for a device and reads it back', 'skipped', { why: 'migration 034 is not applied to DEV yet' });
    } else if (error) {
      results.add('access', 'control:push-device', 'Control — account A turns notifications on for a device and reads it back', 'fail', { why: error.message });
    } else {
      const { data: back } = await a.client.from('push_subscriptions').select('id').eq('endpoint', deviceEndpoint);
      deviceA = back?.length === 1;
      results.add('access', 'control:push-device', 'Control — account A turns notifications on for a device and reads it back', deviceA ? 'pass' : 'fail',
        deviceA ? {} : { why: 'saved, but A cannot read its own device back' });
    }
    // The push function hands a signed-in account this project's public key.
    const key = await invokeFunction(cfg, a, 'push', { action: 'key' }, { timeoutMs: 30_000 });
    const [state, why] = pushFnJudge((status, data) => {
      const bytes = typeof data?.public_key === 'string' ? Buffer.from(data.public_key, 'base64url') : null;
      return status === 200 && bytes?.length === 65 && bytes[0] === 4
        ? ['pass', 'a P-256 public key']
        : ['fail', `HTTP ${status}: ${JSON.stringify(data).slice(0, 160)}`];
    })({ status: key.status, data: key.data });
    results.add('access', 'control:push-key', 'Control — account A gets the key to turn notifications on with', state, { why });
  }
  const onPush = (run) => async () => (pushMissing ? { missing: true } : run());

  // ── A share link of account A's for the link probes to aim at (036): made
  // for the passport, opened by a logged-out visitor through `share`, and
  // turned off after the probes — when it must stop opening.
  let shareA = null;
  let sharesMissing = false;
  {
    const { data, error } = await a.client.rpc('create_document_share', {
      p_family_id: A.family, p_document_id: passport.id, p_days: 1, p_note: `QA probe ${cfg.runId}`,
    });
    if (missingTable(error) || String(error?.code) === 'PGRST202') {
      sharesMissing = true;
      results.add('access', 'control:share-link', 'Control — a link account A made opens its document for a logged-out visitor', 'skipped', { why: 'migration 036 is not applied to DEV yet' });
    } else if (error) {
      results.add('access', 'control:share-link', 'Control — a link account A made opens its document for a logged-out visitor', 'fail', { why: error.message });
    } else {
      shareA = { id: data.id, token: data.token };
      const opened = await invokeFunction(cfg, anon, 'share', { token: data.token }, { timeoutMs: 30_000 });
      const [state, why] = shareFnJudge((status, body) => (status === 200 && body?.file_name === passport.file_name && /^https:\/\//.test(body?.url ?? '')
        ? ['pass', `opened "${body.file_name}" with a five-minute address`]
        : ['fail', `HTTP ${status}: ${JSON.stringify(body).slice(0, 160)}`]))({ status: opened.status, data: opened.data });
      results.add('access', 'control:share-link', 'Control — a link account A made opens its document for a logged-out visitor', state, { why });
      // Not even the family reads a link's secret, hashed or not.
      const { error: hashErr } = await a.client.from('document_shares').select('token_hash').eq('id', data.id);
      results.add('access', 'control:share-hash', "Control — not even the family can read a link's hashed secret", refusedByAuth(hashErr) ? 'pass' : 'fail',
        { why: hashErr ? short(hashErr) : 'the hash was READABLE' });
    }
  }
  const onShares = (run) => async () => (sharesMissing ? { missing: true } : run());
  const onShareA = (run) => async () => {
    if (sharesMissing) return { missing: true };
    if (!shareA) return { noTarget: true };
    return run();
  };
  // ── Invitations (037): a signed-in person lists their own — the positive
  // control for the probes below, which aim at invitations that are not
  // theirs (or do not exist), and at the server-only functions that ask.
  let invitesMissing = false;
  {
    const { data, error } = await a.client.rpc('get_my_invitations');
    if (String(error?.code) === 'PGRST202' || missingTable(error)) {
      invitesMissing = true;
      results.add('access', 'control:invitations', 'Control — account A lists its own invitations', 'skipped', { why: 'migration 037 is not applied to DEV yet' });
    } else {
      results.add('access', 'control:invitations', 'Control — account A lists its own invitations', error ? 'fail' : 'pass',
        { why: error ? short(error) : `${data?.length ?? 0} waiting` });
    }
  }
  const onInvites = (run) => async () => (invitesMissing ? { missing: true } : run());

  // ── Plans and storage (038): account A reads its own family's plan and room,
  // and its family has room — the positive control for the probes below.
  let plansMissing = false;
  let planOfA = null;
  {
    const { data, error } = await a.client.rpc('family_storage_status', { p_family_id: A.family });
    if (String(error?.code) === 'PGRST202' || missingTable(error)) {
      plansMissing = true;
      results.add('access', 'control:storage', "Control — account A reads its family's plan and storage", 'skipped', { why: 'migration 038 is not applied to DEV yet' });
    } else {
      const row = data?.[0];
      planOfA = row?.plan ?? null;
      const ok = !error && row && Number(row.limit_bytes) > 0 && Number(row.used_bytes) > 0 && ['free', 'plus'].includes(row.plan);
      results.add('access', 'control:storage', "Control — account A reads its family's plan and storage", ok ? 'pass' : 'fail',
        { why: error ? short(error) : row ? `${row.plan}: ${Math.round(Number(row.used_bytes) / 1048576)} MB of ${Math.round(Number(row.limit_bytes) / 1048576)} MB` : 'no row' });
      const { data: room, error: roomErr } = await a.client.rpc('family_storage_has_room', { p_folder: A.ns });
      results.add('access', 'control:storage-room', 'Control — QA Vault A has room for its uploads', !roomErr && room === true ? 'pass' : 'fail',
        { why: roomErr ? short(roomErr) : `has room: ${room}` });
    }
  }
  const onPlans = (run) => async () => (plansMissing ? { missing: true } : run());

  // ── What each plan allows (041): account A reads every plan's limits, and
  // claims one voice chat in its own family — the positive control for the
  // probes below. The numbers are checked against each other, not pinned:
  // they change in the Table editor. Each run claims one of account A's own
  // free voice chats (per person since 043); once they are used the answer
  // is a no, which is right.
  {
    const { data: rows, error } = await a.client.from('plan_limits').select('plan, max_members, voice_answers');
    if (error && (['PGRST204', '42703'].includes(String(error.code)) || /max_members|voice_answers/.test(error.message ?? ''))) {
      results.add('access', 'control:limits', "Control — account A reads every plan's member and voice-chat limits", 'skipped', { why: 'migration 041 is not applied to DEV yet' });
    } else {
      const plans = Object.fromEntries((rows ?? []).map((r) => [r.plan, r]));
      const limitsOk = !error && ['free', 'plus'].every((p) => Number.isInteger(plans[p]?.max_members) && plans[p].max_members >= 1);
      results.add('access', 'control:limits', "Control — account A reads every plan's member and voice-chat limits", limitsOk ? 'pass' : 'fail',
        { why: error ? short(error) : `members ${plans.free?.max_members}/${plans.plus?.max_members}, voice chats ${plans.free?.voice_answers ?? 'no limit'}/${plans.plus?.voice_answers ?? 'no limit'}` });
      const { data: claim, error: claimErr } = await a.client.rpc('claim_voice_answer', { p_family_id: A.family });
      const limit = plans[planOfA ?? 'free']?.voice_answers ?? null;
      const used = claim?.used == null ? null : Number(claim.used);
      const claimOk = !claimErr && claim && (claim.limit ?? null) === limit && (limit == null
        ? claim.allowed === true && used == null
        : (claim.allowed ? used >= 1 && used <= limit : used === limit));
      results.add('access', 'control:voice', 'Control — account A claims a voice chat in its own family, never past its plan\'s number', claimOk ? 'pass' : 'fail',
        { why: claimErr ? short(claimErr) : JSON.stringify(claim) });
    }
  }

  // ── Saved chats in storage, voice chats left (042): account A reads how many
  // voice chats its family has left — without using one — and its storage
  // counts its saved chats. The positive controls for the probes below.
  {
    const { data: left, error } = await a.client.rpc('family_voice_status', { p_family_id: A.family });
    if (String(error?.code) === 'PGRST202') {
      results.add('access', 'control:voice-left', "Control — account A reads how many voice chats its family has left", 'skipped', { why: 'migration 042 is not applied to DEV yet' });
      results.add('access', 'control:storage-chats', "Control — account A's storage counts its family's saved chats", 'skipped', { why: 'migration 042 is not applied to DEV yet' });
    } else {
      const again = error ? null : (await a.client.rpc('family_voice_status', { p_family_id: A.family })).data;
      const n = (v) => (v == null ? null : Number(v));
      const leftOk = !error && left && 'limit' in left && (left.limit == null
        ? left.used == null && left.left == null
        : n(left.left) === Math.max(n(left.limit) - n(left.used), 0) && n(again?.used) === n(left.used));
      results.add('access', 'control:voice-left', "Control — account A reads how many voice chats its family has left, using none", leftOk ? 'pass' : 'fail',
        { why: error ? short(error) : JSON.stringify(left) });
      const { data: rows, error: roomErr } = await a.client.rpc('family_storage_status', { p_family_id: A.family });
      const row = rows?.[0];
      const chatsOk = !roomErr && row && Number(row.chats_bytes) >= 0 && Number(row.used_bytes) >= Number(row.chats_bytes);
      results.add('access', 'control:storage-chats', "Control — account A's storage counts its family's saved chats", chatsOk ? 'pass' : 'fail',
        { why: roomErr ? short(roomErr) : row ? `${row.chats_bytes} bytes of chats in ${row.used_bytes}` : 'no row' });
    }
  }

  // ── Paying for Family Plus (044): the payments function says whether DEV
  // takes payments — the control for the probes below. DEV may only ever
  // hold Razorpay's TEST keys: a live key there would charge real money from
  // the test project.
  {
    const r = await invokeFunction(cfg, a, 'payments', { action: 'status' }, { timeoutMs: 30_000 });
    const [state, why] = paymentsFnJudge((status, data) => {
      if (status !== 200 || typeof data?.available !== 'boolean') return ['fail', `HTTP ${status}: ${JSON.stringify(data).slice(0, 160)}`];
      if (!data.available) return ['pass', 'no Razorpay keys on DEV yet: Family Plus is "coming soon"'];
      if (!/^rzp_test_/.test(String(data.key_id ?? ''))) return ['fail', `DEV must use Razorpay TEST keys, not ${String(data.key_id).slice(0, 9)}…`];
      return ['pass', `takes test payments in ${(data.currencies ?? []).join(', ')}`];
    })({ status: r.status, data: r.data });
    results.add('access', 'control:payments', 'Control — account A asks whether Family Plus can be paid for (test keys only on DEV)', state, { why });
  }

  // A payment report as Razorpay sends one, for an order and a payment that
  // never existed — so nothing could be added even if a check failed.
  const fakeOrder = `order_QA${randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const fakePayment = `pay_QA${randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const report = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: fakePayment, order_id: fakeOrder, amount: 110000, currency: 'INR', status: 'captured' } } },
  });
  const toWebhook = (signature) => async () => {
    // As Razorpay sends it: a plain POST, no session, no apikey.
    const res = await fetch(`${cfg.url}/functions/v1/razorpay-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Razorpay-Signature': signature } : {}) },
      body: report,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
    return { status: res.status, data };
  };
  const forgedSignature = createHmac('sha256', `qa-not-the-secret-${cfg.runId}`).update(report).digest('hex');

  const onDeviceA = (run) => async () => {
    if (pushMissing) return { missing: true };
    if (!deviceA) return { noTarget: true };
    return run();
  };

  // ── Personal vaults (046): account A's own, made the first time it is
  // asked for and the same one every time after; and Ask across every vault
  // A is in, which must be exactly A's. The controls for the probes below.
  // Ask is given a one-letter question, which searches nothing: no model
  // runs, so it costs no Groq budget.
  let personalA = null;
  let personalMissing = false;
  {
    const title = 'Control — account A has a personal vault, the same one every time, with A alone in it';
    const first = await a.client.rpc('ensure_personal_vault');
    if (String(first.error?.code) === 'PGRST202') {
      personalMissing = true;
      results.add('access', 'control:personal-vault', title, 'skipped', { why: 'migration 046 is not applied to DEV yet' });
    } else {
      const again = first.error ? null : await a.client.rpc('ensure_personal_vault');
      const row = first.data
        ? (await a.client.from('families').select('id, is_personal').eq('id', first.data).maybeSingle()).data : null;
      const inIt = first.data
        ? (await a.client.from('family_members').select('user_id, role').eq('family_id', first.data)).data : null;
      const ok = !first.error && !!first.data && again?.data === first.data && row?.is_personal === true
        && inIt?.length === 1 && inIt[0].user_id === a.user.id && inIt[0].role === 'admin';
      personalA = ok ? first.data : null;
      results.add('access', 'control:personal-vault', title, ok ? 'pass' : 'fail',
        ok ? {} : { why: first.error ? short(first.error) : JSON.stringify({ same: again?.data === first.data, row, inIt }).slice(0, 160) });
    }
  }
  {
    const title = 'Control — account A asks across all its vaults, and exactly its own are searched';
    if (!personalA) {
      results.add('access', 'control:ask-all-vaults', title, 'skipped', {
        why: personalMissing ? 'migration 046 is not applied to DEV yet' : "no personal vault of A's (see its control)",
      });
    } else {
      const r = await invokeFunction(cfg, a, 'rag-search', { family_id: A.family, scope: 'all', query: 'a' }, { timeoutMs: 60_000 });
      const { data: mine } = await a.client.from('family_members').select('family_id').eq('user_id', a.user.id);
      const want = (mine ?? []).map((m) => m.family_id).sort();
      const got = (r.data?.debug?.vaults ?? []).map((v) => v.family_id).sort();
      const [state, why] = r.status !== 200
        ? ['fail', `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 160)}`]
        : !r.data?.debug?.vaults
          ? ['skipped', 'rag-search on DEV does not search across vaults yet']
          : JSON.stringify(got) === JSON.stringify(want)
            ? ['pass', `${got.length} vaults searched: QA Vault A and A's personal vault${got.length > 2 ? ', and more' : ''}`]
            : ['fail', `searched ${got.length} vaults; A is in ${want.length}`];
      results.add('access', 'control:ask-all-vaults', title, state, { why });
    }
  }
  const onPersonalA = (run) => async () => {
    if (personalMissing) return { missing: true };
    if (!personalA) return { noTarget: true };
    return run();
  };

  const probes = [
    // Logged out
    ['anon', 'list QA Vault A', 'refused-or-empty', rpc(anon, 'get_family_documents', { p_family_id: A.family, p_limit: 5, p_offset: 0 })],
    ['anon', 'insert a document as account A', 'refused', rpc(anon, 'insert_family_document', { p_family_id: A.family, p_uploaded_by: A.user, p_file_name: 'x.pdf', p_file_type: 'pdf', p_file_size_bytes: 1, p_storage_path: `${A.ns}/x.pdf` })],
    ['anon', "read account A's notifications", 'refused', rpc(anon, 'get_user_notifications', { p_user_id: A.user, p_limit: 5, p_offset: 0 })],
    ['anon', 'create a family owned by account A', 'refused', rpc(anon, 'create_family', { p_user_id: A.user, p_family_name: 'QA intrusion' })],
    ['anon', 'ask rag-search about QA Vault A', 'http-401-403', fn(anon, 'rag-search', { family_id: A.family, query: 'passport' })],
    ['anon', 'ask rag-search across every vault', vaultsJudge, fn(anon, 'rag-search', { scope: 'all', query: 'passport' })],
    ['anon', 'make a personal vault', personalJudge('refused'), rpc(anon, 'ensure_personal_vault', {})],
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
    // Ask across vaults (046): every vault searched must be the asker's own.
    ['B', 'ask rag-search about QA Vault A beside its own vault', vaultsJudge, fn(b, 'rag-search', { family_ids: [vaultB.id, A.family], query: 'passport' })],
    ['B', "ask rag-search about A's personal vault", vaultsJudge, onPersonalA(fn(b, 'rag-search', { family_ids: [personalA], query: 'passport' }))],
    ['B', "read A's personal vault", personalJudge('refused-or-empty', true), onPersonalA(() => b.client.from('families').select('id').eq('id', personalA))],
    ['B', "re-ingest A's document", 'http-401-403', fn(b, 'ingest-document', { family_id: A.family, document_id: sacrificialId, storage_path: sacrificialPath })],
    ['B', "read QA Vault A's index status", 'http-401-403', fn(b, 'reembed-index', { family_id: A.family, status_only: true })],
    ['B', "list QA Vault A's files", 'refused-or-empty', () => b.client.storage.from('documents').list(A.ns)],
    ['B', "download A's passport file", 'refused', () => b.client.storage.from('documents').download(passport.storage_path)],
    // A PDF, because the bucket only accepts document types: a text file is
    // stopped by the MIME whitelist before the folder policy is ever tested.
    ['B', "write a file into QA Vault A's folder", 'refused', () => b.client.storage.from('documents').upload(intrusionPath, Buffer.from('%PDF-1.4\n% AskLocker QA probe\n'), { contentType: 'application/pdf' })],
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
    // Birthday reminders (035): your own switch only. Before 035 the column is
    // not there, which is a skip.
    ['B', "switch off account A's birthday reminders", (outcome) => (outcome.missing
      ? ['skipped', 'migration 035 is not applied to DEV yet']
      : judgeWrite("users_update_own is what keeps 035's birthday switch to the person's own row")(outcome)), async () => {
      const { data: before, error: readErr } = await a.client.from('users').select('birthday_reminders').eq('id', A.user).single();
      if (readErr && /birthday_reminders/.test(String(readErr.message))) return { missing: true };
      const { error } = await b.client.from('users').update({ birthday_reminders: !before?.birthday_reminders }).eq('id', A.user);
      if (error) return { error };
      const { data: now } = await a.client.from('users').select('birthday_reminders').eq('id', A.user).single();
      if (now?.birthday_reminders === before?.birthday_reminders) return {};
      const { error: undo } = await a.client.from('users').update({ birthday_reminders: before?.birthday_reminders }).eq('id', A.user);
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
    // Nicknames (045): an admin's, or the person's own, to give.
    ['anon', "give someone in A's tree a nickname", nicknameJudge('refused'), onPersonA(() => anon.client.rpc('set_family_person_nickname', { p_person_id: personA, p_nickname: 'QA intrusion' }))],
    ['B', "give someone in A's tree a nickname", nicknameJudge('refused'), onPersonA(() => b.client.rpc('set_family_person_nickname', { p_person_id: personA, p_nickname: 'QA intrusion' }))],
    ['B', "write a nickname into A's tree directly", nicknameJudge('refused'), onPersonA(() => b.client.from('family_people').update({ nickname: 'QA intrusion' }).eq('id', personA))],
    // Emergency cards (032): the family's members read them; only an admin,
    // or the person themselves, changes one, and nobody writes the table.
    ['anon', "read QA Vault A's emergency cards", emergencyJudge('refused-or-empty'), onCards(() => anon.client.from('family_emergency_cards').select('person_id').eq('family_id', A.family))],
    ['anon', "change an emergency card in A's tree", emergencyJudge('refused', true), onCardA(() => anon.client.rpc('save_emergency_card', { p_person_id: personA, p_card: { blood_group: 'O-' } }))],
    ['B', "read QA Vault A's emergency cards", emergencyJudge('refused-or-empty'), onCards(() => b.client.from('family_emergency_cards').select('person_id, allergies').eq('family_id', A.family))],
    ['B', "change an emergency card in A's tree", emergencyJudge('refused', true), onCardA(() => b.client.rpc('save_emergency_card', { p_person_id: personA, p_card: { blood_group: 'O-' } }))],
    ['B', "delete an emergency card in A's tree", emergencyJudge('refused', true), onCardA(() => b.client.rpc('save_emergency_card', { p_person_id: personA, p_card: {} }))],
    ['B', "write QA Vault A's emergency cards directly", emergencyJudge('refused'), onCards(() => b.client.from('family_emergency_cards').insert({ person_id: personA ?? randomUUID(), family_id: A.family, blood_group: 'O-' }))],

    // Reminders on devices (034): only your own devices, and everything
    // behind them is the server's. (push's `send` is open to anyone by design:
    // it reads nothing from the request and returns only counts.)
    ['anon', 'turn notifications on for a device', pushJudge('refused'), onPush(() => anon.client.rpc('save_push_subscription', { p_endpoint: `https://fcm.googleapis.com/fcm/send/qa-anon-${cfg.runId}`, p_p256dh: PROBE_P256DH, p_auth: PROBE_AUTH }))],
    ['anon', "list anyone's notification devices", pushJudge('refused-or-empty'), onPush(() => anon.client.from('push_subscriptions').select('endpoint'))],
    ['anon', 'get the notification key without signing in', pushFnJudge(http401), fn(anon, 'push', { action: 'key' })],
    ['anon', 'send a test notification', pushFnJudge(http401), fn(anon, 'push', { action: 'test' })],
    ['B', "list account A's notification devices", pushJudge('refused-or-empty', true), onDeviceA(() => b.client.from('push_subscriptions').select('endpoint').eq('endpoint', deviceEndpoint))],
    ['B', "remove account A's notification device", pushJudge(judgeWrite("B removed a device of A's"), true), onDeviceA(async () => {
      const { data, error } = await b.client.from('push_subscriptions').delete().eq('endpoint', deviceEndpoint).select('id');
      return error ? { error } : data?.length ? { allowed: true, reverted: false } : {};
    })],
    ['B', 'write a notification device directly', pushJudge('refused'), onPush(() => b.client.from('push_subscriptions').insert({ user_id: A.user, endpoint: `https://fcm.googleapis.com/fcm/send/qa-direct-${cfg.runId}`, p256dh: PROBE_P256DH, auth: PROBE_AUTH }))],
    ['B', "read the server's notification keys (server-only)", pushJudge('refused'), onPush(() => b.client.rpc('push_keys'))],
    // Nulls: even were it open, this would change nothing.
    ['B', "replace the server's notification keys (server-only)", pushJudge('refused'), onPush(() => b.client.rpc('push_setup', { p_vapid_public: 'x', p_vapid_private: 'x', p_subject: 'https://example.invalid', p_functions_url: null, p_anon_key: null }))],
    ['B', "read every family's waiting notifications (server-only)", pushJudge('refused'), onPush(() => b.client.rpc('push_pending', { p_limit: 5 }))],
    ['B', 'mark notifications sent and remove devices (server-only)', pushJudge('refused'), onPush(() => b.client.rpc('push_done', { p_notifications: [randomUUID()], p_gone: [randomUUID()], p_delivered: [] }))],
    ['B', "make QA Vault A's reminders (server-only)", pushJudge('refused'), onPush(() => b.client.rpc('queue_family_expiry_reminders', { p_family_id: A.family }))],
    ['B', 'run the reminder clock (server-only)', pushJudge('refused'), onPush(() => b.client.rpc('run_reminders'))],
    ['B', "make every family's birthday reminders (server-only)", (outcome) => (String(outcome.error?.code) === 'PGRST202'
      ? ['skipped', 'migration 035 is not applied to DEV yet']
      : judge('refused', outcome)), rpc(b, 'queue_birthday_reminders', {})],

    // Share links (036): only the family sees its links, only a member who may
    // share makes one, and only the server opens one, by its secret.
    ['anon', "read QA Vault A's share links", shareJudge('refused-or-empty'), onShares(() => anon.client.from('document_shares').select('id').eq('family_id', A.family))],
    ['anon', 'make a share link', shareJudge('refused'), onShares(() => anon.client.rpc('create_document_share', { p_family_id: A.family, p_document_id: passport.id, p_days: 1 }))],
    ['anon', 'open a link that was never made', shareFnJudge((status, data) => (status === 404 && data?.status === 'gone'
      ? ['pass', 'HTTP 404: gone']
      : ['fail', `HTTP ${status}: ${JSON.stringify(data).slice(0, 160)}`])), fn(anon, 'share', { token: 'f'.repeat(64) })],
    ['B', "read QA Vault A's share links", shareJudge('refused-or-empty', true), onShareA(() => b.client.from('document_shares').select('id, note').eq('id', shareA.id))],
    ['B', "share A's passport by link", shareJudge('refused'), onShares(() => b.client.rpc('create_document_share', { p_family_id: A.family, p_document_id: passport.id, p_days: 30 }))],
    ['B', "turn off account A's link", shareJudge('refused', true), onShareA(() => b.client.rpc('revoke_document_share', { p_share_id: shareA.id }))],
    ['B', 'open a link through the database (server-only)', shareJudge('refused'), onShares(() => b.client.rpc('open_document_share', { p_token_hash: '0'.repeat(64) }))],

    // Invitations (037): only the person asked answers, only an admin of the
    // family withdraws, only the server asks, and only the family sees them.
    ['anon', "read QA Vault A's invitations", inviteJudge('refused-or-empty'), onInvites(() => anon.client.from('family_invites').select('id, email').eq('family_id', A.family))],
    ['anon', 'list invitations', inviteJudge('refused'), onInvites(() => anon.client.rpc('get_my_invitations'))],
    ['anon', 'accept an invitation', inviteJudge('refused'), onInvites(() => anon.client.rpc('accept_family_invite', { p_invite_id: randomUUID() }))],
    ['B', 'accept an invitation that is not its own', inviteJudge('refused'), onInvites(() => b.client.rpc('accept_family_invite', { p_invite_id: randomUUID() }))],
    ['B', 'decline an invitation that is not its own', inviteJudge('refused'), onInvites(() => b.client.rpc('decline_family_invite', { p_invite_id: randomUUID() }))],
    ['B', "withdraw one of QA Vault A's invitations", inviteJudge('refused'), onInvites(() => b.client.rpc('cancel_family_invite', { p_invite_id: randomUUID() }))],
    ['B', 'invite into QA Vault A through the database (server-only)', inviteJudge('refused'), onInvites(() => b.client.rpc('invite_family_member', { p_family_id: A.family, p_invited_by: A.user, p_email: `qa-probe-${cfg.runId}@example.invalid` }))],
    // Plans and storage (038): a family's plan is its members' to read and the
    // server's to write; nobody learns another family's room or raises a limit.
    ['anon', "read QA Vault A's plan", planJudge('refused-or-empty'), onPlans(() => anon.client.from('family_plans').select('family_id').eq('family_id', A.family))],
    ['anon', "ask QA Vault A's storage", planJudge('refused'), onPlans(() => anon.client.rpc('family_storage_status', { p_family_id: A.family }))],
    ['B', "ask QA Vault A's storage", planJudge('refused'), onPlans(() => b.client.rpc('family_storage_status', { p_family_id: A.family }))],
    ['B', 'ask whether QA Vault A has room', planJudge((o) => (o.error
      ? (refusedByAuth(o.error) ? ['pass', short(o.error)] : ['fail', `stopped for another reason (${short(o.error)})`])
      : o.data === false ? ['pass', 'no — not its family'] : ['fail', `ANSWERED: ${JSON.stringify(o.data)}`])), onPlans(() => b.client.rpc('family_storage_has_room', { p_folder: A.ns }))],
    ['B', "read QA Vault A's plan", planJudge('refused-or-empty'), onPlans(() => b.client.from('family_plans').select('family_id, paid_until').eq('family_id', A.family))],
    ['B', 'give its own family Family Plus', planJudge('refused'), onPlans(() => b.client.from('family_plans').insert({ family_id: vaultB.id, paid_until: new Date(Date.now() + 31 * 86_400_000).toISOString() }))],
    ['B', 'give a family Family Plus through the database (server-only)', planJudge('refused'), onPlans(async () => {
      // 039's arguments, then 038's (with a period) on a project without 039.
      const until = new Date(Date.now() + 31 * 86_400_000).toISOString();
      const now = await b.client.rpc('set_family_plan', { p_family_id: vaultB.id, p_paid_until: until });
      return String(now.error?.code) === 'PGRST202'
        ? b.client.rpc('set_family_plan', { p_family_id: vaultB.id, p_period: 'monthly', p_paid_until: until })
        : now;
    })],
    ['B', "raise every plan's storage limit", planJudge('refused'), onPlans(() => b.client.from('plan_limits').update({ storage_bytes: 1099511627776 }).eq('plan', 'free'))],
    ['anon', "end a family's Family Plus (server-only)", lapseJudge('refused'), rpc(anon, 'end_family_plan', { p_family_id: A.family })],
    ['B', "end QA Vault A's Family Plus (server-only)", lapseJudge('refused'), rpc(b, 'end_family_plan', { p_family_id: A.family })],
    ['B', 'make the Family Plus notices (server-only)', lapseJudge('refused'), rpc(b, 'queue_plan_notices', {})],
    ['B', 'claim families for removal (server-only)', lapseJudge('refused'), rpc(b, 'plan_cleanup_due', { p_max: 10 })],
    ['B', "take documents from QA Vault A (server-only)", lapseJudge('refused'), rpc(b, 'plan_take_excess', { p_family_id: A.family, p_max: 500 })],
    ['B', "close QA Vault A's clean-up (server-only)", lapseJudge('refused'), rpc(b, 'plan_settle', { p_family_id: A.family })],
    ['B', 'make the plans function remove a document of account A\'s', plansFnJudge, fn(b, 'plans', { action: 'cleanup' })],
    ['anon', 'use a voice chat in QA Vault A', limitsJudge('refused'), rpc(anon, 'claim_voice_answer', { p_family_id: A.family })],
    ['B', "use up voice chats in QA Vault A", limitsJudge('refused'), rpc(b, 'claim_voice_answer', { p_family_id: A.family })],
    ['B', "read QA Vault A's members' voice-chat counts", perPersonJudge('refused-or-empty'), () => b.client.from('member_usage').select('voice_answers').eq('family_id', A.family)],
    ['B', "ask which plan QA Vault A is on (server-only)", limitsJudge('refused'), rpc(b, 'family_plan_now', { p_family_id: A.family })],
    ['B', "raise every plan's member limit", limitsJudge('refused'), () => b.client.from('plan_limits').update({ max_members: 100 }).eq('plan', 'free')],
    ['anon', "read how many voice chats QA Vault A has left", chatsVoiceJudge('refused'), rpc(anon, 'family_voice_status', { p_family_id: A.family })],
    ['B', "read how many voice chats QA Vault A has left", chatsVoiceJudge('refused'), rpc(b, 'family_voice_status', { p_family_id: A.family })],
    ['B', "add up QA Vault A's saved chats (server-only)", chatsVoiceJudge('refused'), rpc(b, 'family_chats_bytes', { p_family_id: A.family })],
    // Paying for Family Plus (044): an order only for your own family, Plus
    // only for a payment Razorpay signed, and the ledger is the server's.
    ['anon', 'start paying for QA Vault A', paymentsFnJudge(http401), fn(anon, 'payments', { action: 'order', family_id: A.family, period: 'monthly', currency: 'INR' })],
    ['B', 'start paying for QA Vault A', paymentsFnJudge(http401), fn(b, 'payments', { action: 'order', family_id: A.family, period: 'monthly', currency: 'INR' })],
    ['B', 'confirm a payment that was never made', paymentsFnJudge((status, data) => (status === 404 && data?.status === 'no_order'
      ? ['pass', 'no such order']
      : ['fail', `HTTP ${status}${status >= 200 && status < 300 ? ' — it CONFIRMED a made-up payment' : ''}: ${JSON.stringify(data).slice(0, 160)}`])),
    fn(b, 'payments', { action: 'verify', order_id: fakeOrder, payment_id: fakePayment, signature: forgedSignature })],
    ['anon', 'report a payment to razorpay-webhook without a signature', webhookJudge(false), toWebhook(null)],
    ['anon', 'report a payment to razorpay-webhook with a forged signature', webhookJudge(true), toWebhook(forgedSignature)],
    ['anon', 'add a payment through the database (server-only)', paymentsDbJudge('refused'), rpc(anon, 'apply_plan_payment', { p_order_id: fakeOrder, p_payment_id: fakePayment })],
    ['B', 'add a payment through the database (server-only)', paymentsDbJudge('refused'), rpc(b, 'apply_plan_payment', { p_order_id: fakeOrder, p_payment_id: fakePayment })],
    ['B', "read the families' payments", paymentsDbJudge('refused-or-empty'), () => b.client.from('plan_payments').select('order_id, family_id').limit(5)],
    // Aimed so a hole cannot leave a row: an order id the table's CHECK refuses,
    // which only comes into play once the write itself was allowed.
    ['B', 'write a payment into the ledger', paymentsDbJudge((o) => {
      if (!o.error) return ['fail', 'ALLOWED'];
      if (refusedByAuth(o.error)) return ['pass', short(o.error)];
      if (String(o.error.code) === '23514') return ['fail', 'ALLOWED — only a CHECK constraint stopped this row'];
      return ['fail', `stopped for another reason (${short(o.error)}) — update this probe`];
    }), () => b.client.from('plan_payments').insert({ order_id: 'qa-probe', family_id: vaultB.id, period: 'yearly', currency: 'INR', amount: 1 })],

    ['B', "invite someone to be a person in A's tree through the database (server-only)", inviteJudge('refused'), onInvites(() => b.client.rpc('invite_family_person_account', { p_family_id: A.family, p_invited_by: A.user, p_person_id: randomUUID(), p_email: `qa-probe-${cfg.runId}@example.invalid` }))],

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

  // ── Nobody joins a personal vault (046): A, its owner and admin, invites
  // B to it through add-member, as the app's Add would. The database refuses,
  // and add-member says why (409 personal_vault). No invitation may be left.
  {
    const title = 'Account A cannot invite anyone to its personal vault';
    if (!personalA) {
      results.add('access', 'personal-vault-invite', title, 'skipped', {
        why: personalMissing ? 'migration 046 is not applied to DEV yet' : "no personal vault of A's (see its control)",
      });
    } else {
      const r = await invokeFunction(cfg, a, 'add-member', { family_id: personalA, email: b.user.email }, { timeoutMs: 30_000 });
      const { data: asked } = await a.client.from('family_invites').select('id').eq('family_id', personalA);
      const { data: inIt } = await a.client.from('family_members').select('user_id').eq('family_id', personalA);
      for (const invite of asked ?? []) await a.client.rpc('cancel_family_invite', { p_invite_id: invite.id });
      const alone = (inIt ?? []).every((m) => m.user_id === a.user.id);
      const [state, why] = asked?.length || !alone
        ? ['fail', `B was ${asked?.length ? 'INVITED' : 'ADDED'} (an invitation is withdrawn again)`]
        : r.status === 409 && r.data?.status === 'personal_vault'
          ? ['pass', 'refused: a personal vault is for its owner alone']
          : r.status >= 400
            ? ['pass', `refused (HTTP ${r.status}: the add-member on DEV is older than 046 and says so less clearly)`]
            : ['fail', `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 160)}`];
      results.add('access', 'personal-vault-invite', title, state, { why });
    }
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

  if (shareA) {
    const { error: offErr } = await a.client.rpc('revoke_document_share', { p_share_id: shareA.id });
    const after = await invokeFunction(cfg, anon, 'share', { token: shareA.token }, { timeoutMs: 30_000 });
    const [state, why] = shareFnJudge((status, data) => (!offErr && status === 404 && data?.status === 'gone'
      ? ['pass', 'HTTP 404 once turned off']
      : ['fail', offErr ? `could not turn it off: ${offErr.message}` : `HTTP ${status}: the link STILL opens`]))({ status: after.status, data: after.data });
    results.add('access', 'control:share-off', 'Control — a link stops opening the moment it is turned off', state, { why });
  }

  if (deviceA) {
    const { data: deviceStill } = await a.client.from('push_subscriptions').select('id').eq('endpoint', deviceEndpoint);
    results.add('access', 'control:push-intact', "Control — account A's notification device survived every probe", deviceStill?.length === 1 ? 'pass' : 'fail',
      deviceStill?.length === 1 ? {} : { why: 'it is GONE' });
    await a.client.from('push_subscriptions').delete().eq('endpoint', deviceEndpoint);
  }

  if (cardA) {
    const { data: cardStill } = await a.client.from('family_emergency_cards').select('blood_group, allergies').eq('person_id', personA);
    const intact = cardStill?.length === 1 && cardStill[0].blood_group === cardBody.blood_group && cardStill[0].allergies === cardBody.allergies;
    results.add('access', 'control:emergency-intact', "Control — the emergency card in account A's tree survived every probe", intact ? 'pass' : 'fail',
      intact ? {} : { why: cardStill?.length ? 'it was CHANGED' : 'it is GONE' });
  }

  if (personA) {   // taking the person out takes their card with it
    const { data: personStill } = await a.client.from('family_people').select(nicknameSet ? 'display_name, nickname' : 'display_name').eq('id', personA);
    const intact = personStill?.length === 1 && personStill[0].display_name === personName
      && (!nicknameSet || personStill[0].nickname === nicknameA);
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
