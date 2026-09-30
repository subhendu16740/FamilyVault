// ─── Members: only an admin adds, anyone can leave (migration 025) ─
//
// There are no invitations and no requests to join: a family admin adds a
// person who already has an account, through the add-member Edge Function,
// and they are in at once. This walks that path with the two QA accounts:
//
//   B, a stranger, cannot add itself through add-member
//   A adds B as a viewer          → B sees the vault, and was notified
//   adding B again                → "already a member", nothing duplicated
//   an email with no account      → "no account", nothing created
//   B — now an insider, but a viewer — cannot make itself admin, give itself
//   delete rights, delete A's document, add a member, remove A or rename the
//   vault. Each is checked by reading the row back: RLS answers a refused
//   UPDATE or DELETE with "0 rows", not with an error.
//   B leaves                      → "Leave family" works
//   the family tree (031): B became a person in it when added, reads it,
//   cannot change it but may edit its own details, and stays in it — without
//   the account — after leaving; the check then takes that person out, so
//   runs do not pile up.
//
// Skipped, with the reason, until add-member is deployed to DEV and 025 is
// applied there. B is removed again however the checks end.
// ────────────────────────────────────────────────────────────────

import { invokeFunction } from '../supabase.mjs';
import { refusedByAuth, short } from './access.mjs';

const RECENT_MS = 10 * 60 * 1000;

export async function runMemberChecks(cfg, { a, b, vaultA }, results) {
  const add = (actor, email, extra = {}) =>
    invokeFunction(cfg, actor, 'add-member', { family_id: vaultA.id, email, ...extra }, { timeoutMs: 30_000 });
  const http = (r) => `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 140)}`;
  const roster = async () => {
    const { data, error } = await a.client.from('family_members').select('id, user_id, role, can_delete').eq('family_id', vaultA.id);
    if (error) throw new Error(`could not read QA Vault A's members: ${error.message}`);
    return data ?? [];
  };
  const memberRow = async (userId) => (await roster()).find((m) => m.user_id === userId) ?? null;
  const check = (id, title, ok, why) => results.add('members', id, title, ok ? 'pass' : 'fail', { why });

  // B starts outside vault A; the access checks leave it that way.
  if (await memberRow(b.user.id)) {
    await b.client.from('family_members').delete().eq('family_id', vaultA.id).eq('user_id', b.user.id);
    if (await memberRow(b.user.id)) {
      results.add('members', 'setup', 'Membership checks', 'fail', { why: 'account B is already in QA Vault A and could not be removed' });
      return;
    }
  }

  // ── A stranger cannot use the endpoint to get in.
  const self = await add(b, cfg.b.email);
  if (self.status === 404 && !self.data?.status) {
    results.add('members', 'deployed', 'add-member is deployed to DEV', 'skipped', { why: 'not deployed yet — merging to dev deploys it' });
    return;
  }
  check('stranger-cannot-add', 'Account B cannot add itself to QA Vault A through add-member', self.status === 403, http(self));

  // ── A adds B.
  const added = await add(a, cfg.b.email, { relationship: 'Other', alias: 'QA insider' });
  if (added.status === 503 && added.data?.status === 'needs_migration') {
    results.add('members', 'add', 'An admin adds an existing account by email', 'skipped', { why: 'migration 025 is not applied to DEV yet' });
    return;
  }
  const isAdded = added.status === 200 && added.data?.status === 'added';
  check('add', 'An admin adds an existing account by email (add-member)', isAdded,
    isAdded ? `added ${added.data.display_name} as ${added.data.role}` : http(added));
  if (!isAdded) return;

  let sacrificialId = null;
  let treePerson = null;              // B's person in A's tree, removed at the end
  try {
    const mine = await memberRow(b.user.id);
    check('added-as-viewer', 'The new member is a viewer who cannot delete', mine?.role === 'viewer' && mine?.can_delete === false,
      mine ? `role ${mine.role}, can_delete ${mine.can_delete}` : 'no membership row');
    if (!mine) return;

    const again = await add(a, cfg.b.email);
    check('already-member', 'Adding the same person again says so and creates nothing', again.status === 409 && again.data?.status === 'already_member', http(again));

    const nobody = await add(a, `qa-nobody-${cfg.runId}@example.invalid`);
    check('no-account', 'An email with no account is reported, and nothing is created', nobody.status === 404 && nobody.data?.status === 'no_account', http(nobody));

    const { data: docs, error: docsErr } = await b.client.rpc('get_family_documents', { p_family_id: vaultA.id, p_limit: 5, p_offset: 0 });
    check('member-sees-vault', 'The new member sees the family\'s documents', !docsErr && (docs?.length ?? 0) > 0,
      docsErr ? docsErr.message : `${docs?.length ?? 0} document(s)`);

    const { data: inbox, error: inboxErr } = await b.client.rpc('get_user_notifications', { p_user_id: b.user.id, p_limit: 20, p_offset: 0 });
    const told = (inbox ?? []).find((n) => n.type === 'member' && n.family_id === vaultA.id && Date.now() - Date.parse(n.created_at) < RECENT_MS);
    check('member-notified', 'The new member was told, by a notification', !inboxErr && !!told,
      inboxErr ? inboxErr.message : told ? `"${told.title}"` : 'no "member" notification in the last 10 minutes');
    if (told) await b.client.rpc('mark_notification_read', { p_notification_id: told.id, p_user_id: b.user.id });

    // ── The insider probes. B is a member now, so RLS lets it SEE these rows;
    // only the admin checks stand between it and changing them.
    await b.client.from('family_members').update({ role: 'admin' }).eq('id', mine.id);
    const afterPromote = await memberRow(b.user.id);
    check('viewer-cannot-promote', 'A viewer cannot make itself admin', afterPromote?.role === 'viewer', `role is ${afterPromote?.role ?? 'gone'}`);

    await b.client.from('family_members').update({ can_delete: true }).eq('id', mine.id);
    const afterGrant = await memberRow(b.user.id);
    check('viewer-cannot-grant', 'A viewer cannot give itself delete rights', afterGrant?.can_delete === false, `can_delete is ${afterGrant?.can_delete}`);

    const { data: docId, error: sacErr } = await a.client.rpc('insert_family_document', {
      p_family_id: vaultA.id, p_uploaded_by: a.user.id, p_file_name: `qa_sacrificial_${cfg.runId}_m.pdf`,
      p_file_type: 'pdf', p_file_size_bytes: 1, p_storage_path: `${vaultA.namespace}/qa_sacrificial_${cfg.runId}_m.pdf`,
    });
    if (sacErr) {
      results.add('members', 'viewer-cannot-delete', "A viewer cannot delete another member's document", 'skipped', { why: `could not create the target: ${sacErr.message}` });
    } else {
      sacrificialId = docId;
      const { error: delErr } = await b.client.rpc('delete_family_document', { p_family_id: vaultA.id, p_document_id: docId, p_user_id: b.user.id });
      const { data: still } = await a.client.rpc('get_document_detail', { p_family_id: vaultA.id, p_document_id: docId });
      check('viewer-cannot-delete', "A viewer cannot delete another member's document", refusedByAuth(delErr) && !!still?.length,
        delErr ? short(delErr) : still?.length ? 'no error, but the document survived' : 'the document is GONE');
    }

    const viaEndpoint = await add(b, `qa-nobody-${cfg.runId}@example.invalid`);
    check('viewer-cannot-add', 'A viewer cannot add members', viaEndpoint.status === 403, http(viaEndpoint));

    const { error: insErr } = await b.client.from('family_members').insert({ family_id: vaultA.id, user_id: a.user.id, role: 'admin' });
    check('no-direct-insert', 'Nobody writes a membership row directly — adding is the server\'s job', refusedByAuth(insErr),
      insErr ? short(insErr) : 'the insert was ALLOWED');

    await b.client.from('family_members').delete().eq('family_id', vaultA.id).eq('user_id', a.user.id);
    check('viewer-cannot-remove', 'A viewer cannot remove the admin', !!(await memberRow(a.user.id)), 'checked by reading the roster back');

    await b.client.from('families').update({ name: 'QA intrusion' }).eq('id', vaultA.id);
    const { data: fam } = await a.client.from('families').select('name').eq('id', vaultA.id).single();
    check('viewer-cannot-rename', 'A viewer cannot rename the family', fam?.name === vaultA.name, `name is "${fam?.name}"`);
    if (fam && fam.name !== vaultA.name) await a.client.from('families').update({ name: vaultA.name }).eq('id', vaultA.id);

    // ── The family tree (031): B is a person in it now.
    const { data: person, error: personErr } = await a.client.from('family_people')
      .select('id, user_id, display_name').eq('id', mine.id).maybeSingle();
    if (personErr && /PGRST205|42P01|could not find the table|does not exist/i.test(`${personErr.code} ${personErr.message}`)) {
      results.add('members', 'tree', 'Family tree checks', 'skipped', { why: 'migration 031 is not applied to DEV yet' });
    } else {
      treePerson = person?.id ?? null;
      check('member-is-a-person', 'A new member becomes a person in the family tree, under their member id',
        !personErr && person?.user_id === b.user.id, personErr ? personErr.message : person ? `"${person.display_name}"` : 'no person');

      const { data: seen, error: seenErr } = await b.client.from('family_people').select('id').eq('family_id', vaultA.id);
      check('member-sees-tree', 'The new member sees the family tree', !seenErr && (seen?.length ?? 0) >= 2,
        seenErr ? seenErr.message : `${seen?.length ?? 0} people`);

      const { data: sneaked, error: addErr } = await b.client.rpc('add_family_person', { p_family_id: vaultA.id, p_display_name: `QA intrusion ${cfg.runId}` });
      if (sneaked) await a.client.rpc('remove_family_person', { p_person_id: sneaked });
      check('viewer-cannot-change-tree', 'A viewer cannot add people to the family tree', refusedByAuth(addErr),
        addErr ? short(addErr) : 'the person was ADDED (and removed again)');

      const { error: selfErr } = await b.client.rpc('update_family_person', { p_person_id: mine.id, p_display_name: person?.display_name ?? 'QA insider', p_gender: null, p_birth_date: null });
      check('member-edits-self', 'A member may edit their own details in the tree', !selfErr, selfErr ? short(selfErr) : 'saved');
    }

    // ── And anyone can leave.
    const { data: left, error: leaveErr } = await b.client.from('family_members').delete()
      .eq('family_id', vaultA.id).eq('user_id', b.user.id).select('id');
    const gone = !(await memberRow(b.user.id));
    check('member-can-leave', 'A member can leave the family', !leaveErr && (left?.length ?? 0) === 1 && gone,
      leaveErr ? leaveErr.message : gone ? 'left' : 'still a member');

    if (treePerson && gone) {
      const { data: after } = await a.client.from('family_people').select('user_id').eq('id', treePerson).maybeSingle();
      check('leaver-stays-in-tree', 'Someone who leaves stays in the family tree, without their account',
        !!after && after.user_id === null, after ? `user_id is ${after.user_id ?? 'cleared'}` : 'the person is GONE');
    }
  } finally {
    if (await memberRow(b.user.id)) await a.client.from('family_members').delete().eq('family_id', vaultA.id).eq('user_id', b.user.id);
    if (sacrificialId) await a.client.rpc('delete_family_document', { p_family_id: vaultA.id, p_document_id: sacrificialId, p_user_id: a.user.id });
    // B's person stays in the tree after leaving, by design; a QA run should not.
    if (treePerson && !(await memberRow(b.user.id))) {
      const { error: rmErr } = await a.client.rpc('remove_family_person', { p_person_id: treePerson });
      if (rmErr) results.note('members', `could not take B's person out of the tree: ${rmErr.message}`);
    }
    if (await memberRow(b.user.id)) {
      results.add('members', 'cleanup', 'Account B is out of QA Vault A again', 'fail', { why: 'B is STILL a member — the next run would start from an insider' });
    }
  }
}
