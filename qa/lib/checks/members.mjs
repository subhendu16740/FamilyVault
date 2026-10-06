// ─── Members: only an admin invites, only a yes joins, anyone can leave ─
//
// Only a family admin asks someone in (025), through the add-member Edge
// Function, and since 037 they join only when they accept. This walks that
// path with the two QA accounts:
//
//   B, a stranger, cannot add itself through add-member
//   A invites B (037)             → B is not a member yet, sees nothing of the
//                                   vault, was told by an 'invite'
//                                   notification and sees the invitation;
//                                   A sees it as Pending approval; asking
//                                   again says so; A cannot accept for B
//   B declines                    → the invitation goes, and A is told
//   A invites B again, B accepts  → B is a viewer, sees the vault, A is told
//   (an add-member deployed before 037 adds at once: the invitation checks
//   skip, saying so, and the rest runs as before)
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
//   emergency cards (032): B writes its own card and reads the family's,
//   cannot change the admin's, and its card goes when it leaves.
//   linking (033): an entry A added by name is linked to B's account — B, a
//   viewer, cannot do it itself; while B is a member the two become one
//   person at once, and once B has left, linking B's old person invites B to
//   be it (037), and B's yes brings B back as it, under the same id.
//
// Skipped, with the reason, until add-member is deployed to DEV and its
// migration applied there. B is removed again, and any invitation to B
// withdrawn, however the checks end.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
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
  const link = (actor, personId) =>
    invokeFunction(cfg, actor, 'link-account', { family_id: vaultA.id, person_id: personId, email: cfg.b.email }, { timeoutMs: 30_000 });
  // The invitation to B waiting in vault A (037), as the family sees it: by the
  // address it asked. Nothing before 037.
  const inviteToB = async () => {
    const { data } = await a.client.from('family_invites').select('id, email, person_id').eq('family_id', vaultA.id);
    return (data ?? []).find((i) => i.email === cfg.b.email.trim().toLowerCase()) ?? null;
  };
  const inboxOf = async (actor) => {
    const { data } = await actor.client.rpc('get_user_notifications', { p_user_id: actor.user.id, p_limit: 50, p_offset: 0 });
    return data ?? [];
  };
  const recent = (n) => Date.now() - Date.parse(n.created_at) < RECENT_MS;

  // B starts outside vault A, with nothing waiting; the access checks leave it
  // that way, and so does a run that ended early.
  const stale = await inviteToB();
  if (stale) await a.client.rpc('cancel_family_invite', { p_invite_id: stale.id });
  if (await memberRow(b.user.id)) {
    await b.client.from('family_members').delete().eq('family_id', vaultA.id).eq('user_id', b.user.id);
    if (await memberRow(b.user.id)) {
      results.add('members', 'setup', 'Membership checks', 'fail', { why: 'account B is already in QA Vault A and could not be removed' });
      return;
    }
  }

  // ── The invitation (037): B is asked, says no, is asked again, says yes.
  // Returns whether B ended up a member, for the checks that follow.
  let seenByB = new Set();            // B's notices before it was asked
  const runInviteChecks = async () => {
    const invite = await inviteToB();
    check('invite-pending', 'The family sees the invitation as Pending approval', !!invite,
      invite ? `waiting for ${invite.email}` : 'no invitation in family_invites');
    if (!invite) return false;

    const { data: early, error: earlyErr } = await b.client.rpc('get_family_documents', { p_family_id: vaultA.id, p_limit: 5, p_offset: 0 });
    check('invitee-cannot-see', 'Someone invited sees none of the vault before saying yes', !!earlyErr || (early ?? []).length === 0,
      earlyErr ? short(earlyErr) : `${early?.length ?? 0} document(s)`);

    const { data: peek } = await b.client.from('family_invites').select('id').eq('family_id', vaultA.id);
    check('invitee-not-family', "Someone invited does not read the family's invitations, theirs included", (peek ?? []).length === 0,
      `${peek?.length ?? 0} row(s)`);

    const told = (await inboxOf(b)).find((n) => !seenByB.has(n.id) && n.type === 'invite' && n.family_id === vaultA.id);
    check('invite-notified', 'Someone invited is told, by an "invite" notification', !!told, told ? `"${told.title}"` : 'no "invite" notification in the last 10 minutes');

    const { data: mine, error: mineErr } = await b.client.rpc('get_my_invitations');
    const listed = (mine ?? []).find((i) => i.id === invite.id);
    check('invitee-sees-invitation', 'Someone invited sees which family asked, and who', !mineErr && listed?.family_name === vaultA.name,
      mineErr ? short(mineErr) : listed ? `"${listed.family_name}", from ${listed.invited_by_name ?? 'an admin'}` : 'not listed');

    const again = await add(a, cfg.b.email);
    check('invite-again', 'Inviting the same person again says so and sends nothing new', again.status === 409 && again.data?.status === 'already_invited', http(again));

    const { error: forErr } = await a.client.rpc('accept_family_invite', { p_invite_id: invite.id });
    check('admin-cannot-accept', 'An admin cannot say yes for the person invited', refusedByAuth(forErr) && !(await memberRow(b.user.id)),
      forErr ? short(forErr) : 'the admin ACCEPTED it');

    // No: the invitation goes, nobody joins, and A hears it — in a notice new
    // in this run, not one an earlier run left.
    const seenByA = new Set((await inboxOf(a)).map((n) => n.id));
    const newForA = async (pattern) => (await inboxOf(a))
      .find((n) => !seenByA.has(n.id) && n.type === 'member' && n.family_id === vaultA.id && pattern.test(n.title));
    const { error: noErr } = await b.client.rpc('decline_family_invite', { p_invite_id: invite.id });
    const afterNo = await inviteToB();
    const heardNo = await newForA(/said no/i);
    check('invitee-declines', 'Saying no removes the invitation, nobody joins, and the admin is told',
      !noErr && !afterNo && !(await memberRow(b.user.id)) && !!heardNo,
      noErr ? short(noErr) : afterNo ? 'the invitation is STILL there' : heardNo ? `"${heardNo.title}"` : 'the admin was not told');
    if (heardNo) await a.client.rpc('mark_notification_read', { p_notification_id: heardNo.id, p_user_id: a.user.id });

    // Asked again; yes this time.
    const asked = await add(a, cfg.b.email, { relationship: 'Other', alias: 'QA insider' });
    const second = asked.status === 200 && asked.data?.status === 'invited' ? await inviteToB() : null;
    if (!second) {
      check('invitee-accepts', 'Saying yes makes them a member, and the admin is told', false, `could not invite again: ${http(asked)}`);
      return false;
    }
    const { data: yes, error: yesErr } = await b.client.rpc('accept_family_invite', { p_invite_id: second.id });
    const heardYes = await newForA(/joined/i);
    const joinedRow = await memberRow(b.user.id);
    check('invitee-accepts', 'Saying yes makes them a member, the invitation goes, and the admin is told',
      !yesErr && yes?.status === 'joined' && !!joinedRow && !(await inviteToB()) && !!heardYes,
      yesErr ? short(yesErr) : !joinedRow ? 'NOT a member' : heardYes ? `"${heardYes.title}"` : 'the admin was not told');
    if (heardYes) await a.client.rpc('mark_notification_read', { p_notification_id: heardYes.id, p_user_id: a.user.id });
    return !!joinedRow;
  };

  // ── A stranger cannot use the endpoint to get in.
  const self = await add(b, cfg.b.email);
  if (self.status === 404 && !self.data?.status) {
    results.add('members', 'deployed', 'add-member is deployed to DEV', 'skipped', { why: 'not deployed yet — merging to dev deploys it' });
    return;
  }
  check('stranger-cannot-add', 'Account B cannot add itself to QA Vault A through add-member', self.status === 403, http(self));

  // ── A asks B in. Since 037 that is an invitation, and B joins on a yes.
  seenByB = new Set((await inboxOf(b)).map((n) => n.id));
  const added = await add(a, cfg.b.email, { relationship: 'Other', alias: 'QA insider' });
  if (added.status === 503 && added.data?.status === 'needs_migration') {
    results.add('members', 'add', 'An admin invites an existing account by email', 'skipped', { why: `add-member's migration is not applied to DEV yet: ${added.data?.error ?? ''}` });
    return;
  }
  const addedAtOnce = added.status === 200 && added.data?.status === 'added';
  if (addedAtOnce) {
    results.add('members', 'invite', 'An admin invites by email, and the person joins only on a yes', 'skipped',
      { why: 'add-member on DEV still adds at once — it invites once this is merged to dev and migration 037 is applied' });
  } else {
    const isInvited = added.status === 200 && added.data?.status === 'invited';
    check('invite', 'An admin invites an existing account by email (add-member), and nobody joins yet', isInvited && !(await memberRow(b.user.id)),
      isInvited ? `invited ${added.data.email}` : http(added));
    if (!isInvited) return;
    const ok = await runInviteChecks();
    if (!ok) return;
  }

  let sacrificialId = null;
  let treePerson = null;              // B's person in A's tree, removed at the end
  let cardChecked = false;            // B saved an emergency card (032)
  let linkEntry = null;               // the entry linked to B (033), removed at the end if still there
  let linkReady = false;              // link-account is deployed and 033 applied
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

    if (addedAtOnce) {
      const { data: inbox, error: inboxErr } = await b.client.rpc('get_user_notifications', { p_user_id: b.user.id, p_limit: 20, p_offset: 0 });
      const told = (inbox ?? []).find((n) => n.type === 'member' && n.family_id === vaultA.id && recent(n));
      check('member-notified', 'The new member was told, by a notification', !inboxErr && !!told,
        inboxErr ? inboxErr.message : told ? `"${told.title}"` : 'no "member" notification in the last 10 minutes');
      if (told) await b.client.rpc('mark_notification_read', { p_notification_id: told.id, p_user_id: b.user.id });
    }

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

    // Share links (036): a viewer may share only what they added or what is
    // theirs, never an admin's document.
    if (docs?.length) {
      const { data: made, error: shareErr } = await b.client.rpc('create_document_share', { p_family_id: vaultA.id, p_document_id: docs[0].id, p_days: 1 });
      if (shareErr && String(shareErr.code) === 'PGRST202') {
        results.add('members', 'viewer-cannot-share', "A viewer cannot share someone else's document by link", 'skipped', { why: 'migration 036 is not applied to DEV yet' });
      } else {
        check('viewer-cannot-share', "A viewer cannot share someone else's document by link", refusedByAuth(shareErr),
          shareErr ? short(shareErr) : 'a link was MADE');
        // A link that should never have been made does not stay open.
        if (!shareErr && made?.id) await a.client.rpc('revoke_document_share', { p_share_id: made.id });
      }
    }

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

      // ── Nicknames (045): the family's own name for someone. B gives itself
      // one, which the family sees, and cannot change the admin's.
      const myNickname = `QA ${cfg.runId}`.slice(0, 40);
      const { error: nickErr } = await b.client.rpc('set_family_person_nickname', { p_person_id: mine.id, p_nickname: myNickname });
      if (String(nickErr?.code) === 'PGRST202') {
        results.add('members', 'nicknames', 'Nickname checks', 'skipped', { why: 'migration 045 is not applied to DEV yet' });
      } else {
        const { data: seenNick } = await a.client.from('family_people').select('nickname').eq('id', mine.id).maybeSingle();
        check('member-sets-own-nickname', 'A member may give themselves a nickname, and the family sees it',
          !nickErr && seenNick?.nickname === myNickname, nickErr ? short(nickErr) : `"${seenNick?.nickname}"`);

        const { data: adminNick } = await a.client.from('family_people').select('id, nickname')
          .eq('family_id', vaultA.id).eq('user_id', a.user.id).maybeSingle();
        const { error: otherNickErr } = await b.client.rpc('set_family_person_nickname', { p_person_id: adminNick?.id ?? randomUUID(), p_nickname: 'QA intrusion' });
        if (!otherNickErr && adminNick) await a.client.rpc('set_family_person_nickname', { p_person_id: adminNick.id, p_nickname: adminNick.nickname ?? '' });   // undo
        check('viewer-cannot-change-nickname', "A viewer cannot change someone else's nickname", refusedByAuth(otherNickErr),
          otherNickErr ? short(otherNickErr) : 'the nickname was CHANGED (and put back)');

        await b.client.rpc('set_family_person_nickname', { p_person_id: mine.id, p_nickname: '' });
      }

      // ── Emergency cards (032): B writes its own, reads the family's, and
      // cannot change the admin's.
      const { error: ownErr } = await b.client.rpc('save_emergency_card', { p_person_id: mine.id, p_card: { blood_group: 'O+', notes: `QA SPECIMEN ${cfg.runId}` } });
      if (ownErr && /^(PGRST202|PGRST205|42P01)$/.test(String(ownErr.code))) {
        results.add('members', 'emergency', 'Emergency card checks', 'skipped', { why: 'migration 032 is not applied to DEV yet' });
      } else {
        cardChecked = !ownErr;
        check('member-saves-own-card', 'A member may write their own emergency card', !ownErr, ownErr ? short(ownErr) : 'saved');

        const { data: cards, error: readErr } = await b.client.from('family_emergency_cards').select('person_id').eq('family_id', vaultA.id);
        check('member-reads-cards', "A member reads the family's emergency cards", !readErr && (cards ?? []).some((c) => c.person_id === mine.id),
          readErr ? readErr.message : `${cards?.length ?? 0} card(s)`);

        const { data: adminPerson } = await a.client.from('family_people').select('id')
          .eq('family_id', vaultA.id).eq('user_id', a.user.id).maybeSingle();
        const { error: otherErr } = await b.client.rpc('save_emergency_card', { p_person_id: adminPerson?.id ?? randomUUID(), p_card: { blood_group: 'AB-' } });
        if (!otherErr && adminPerson) await a.client.rpc('save_emergency_card', { p_person_id: adminPerson.id, p_card: {} });   // undo
        check('viewer-cannot-change-card', "A viewer cannot change someone else's emergency card", refusedByAuth(otherErr),
          otherErr ? short(otherErr) : 'the card was CHANGED (and cleared again)');
      }

      // ── Linking (033): A added B to the tree by name before B joined; that
      // entry and B's own person become one. A viewer cannot do it: merging an
      // entry into itself would take over that person's documents and card.
      const entryName = `QA entry ${cfg.runId}`;
      const { data: entry, error: entryErr } = await a.client.rpc('add_family_person', { p_family_id: vaultA.id, p_display_name: entryName });
      if (entryErr) {
        results.add('members', 'link', 'Linking someone in the tree to their account', 'fail', { why: `could not add the entry: ${short(entryErr)}` });
      } else {
        linkEntry = entry;
        const byViewer = await link(b, entry);
        if (byViewer.status === 404 && !byViewer.data?.status) {
          results.add('members', 'link', 'Linking someone in the tree to their account', 'skipped', { why: 'link-account is not deployed to DEV yet' });
        } else {
          check('viewer-cannot-link', 'A viewer cannot link someone in the tree to an account, its own included', byViewer.status === 403, http(byViewer));
          const merged = await link(a, entry);
          if (merged.status === 503 && merged.data?.status === 'needs_migration') {
            results.add('members', 'link', 'Linking someone in the tree to their account', 'skipped', { why: 'migration 033 is not applied to DEV yet' });
          } else {
            linkReady = true;
            const { data: entryLeft } = await a.client.from('family_people').select('id').eq('id', entry);
            const { data: one } = await a.client.from('family_people').select('display_name, user_id').eq('id', mine.id).maybeSingle();
            if (!entryLeft?.length) linkEntry = null;
            check('link-merges', 'Linking an entry to someone already in the family makes the two one person',
              merged.status === 200 && merged.data?.status === 'merged' && merged.data?.member_id === mine.id
                && !entryLeft?.length && one?.display_name === entryName && one?.user_id === b.user.id,
              merged.status !== 200 ? http(merged) : entryLeft?.length ? 'the entry is STILL there' : `one person, "${one?.display_name}"`);
          }
        }
      }
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
    if (treePerson && gone && cardChecked) {
      const { data: leftCard } = await a.client.from('family_emergency_cards').select('person_id').eq('person_id', treePerson);
      check('leaver-card-deleted', 'Someone who leaves takes their emergency card with them', (leftCard?.length ?? 0) === 0,
        leftCard?.length ? 'the card is STILL there' : 'deleted');
    }

    // ── Linking someone who is not a member (033): B's old person, left
    // behind in the tree, is linked to B's account again. B comes back as a
    // viewer under the same id, is told so, and then leaves again.
    if (treePerson && gone && linkReady) {
      const before = new Set((await inboxOf(b)).map((n) => n.id));
      const joined = await link(a, treePerson);
      let back = null;
      if (joined.status === 200 && joined.data?.status === 'invited') {
        // Since 037: an invitation to be that person, and B's yes.
        const waiting = await inviteToB();
        check('link-invites', 'Linking someone in the tree to an account that is not a member invites them to be that person, and nobody joins yet',
          waiting?.person_id === treePerson && !(await memberRow(b.user.id)),
          !waiting ? 'no invitation' : waiting.person_id === treePerson ? 'invited as that person' : 'invited as someone ELSE');
        const told = (await inboxOf(b)).find((n) => n.type === 'invite' && n.family_id === vaultA.id && !before.has(n.id));
        check('link-notified', 'Someone invited from the tree is told, by a notification', !!told, told ? `"${told.title}"` : 'no new "invite" notification');
        if (waiting) {
          const { data: accepted, error: acceptErr } = await b.client.rpc('accept_family_invite', { p_invite_id: waiting.id });
          back = await memberRow(b.user.id);
          check('link-joins', 'Accepting brings them in as that person, a viewer, under the same id',
            !acceptErr && accepted?.status === 'joined' && back?.id === treePerson && back?.role === 'viewer',
            acceptErr ? short(acceptErr) : !back ? 'not a member' : `${back.id === treePerson ? 'under the same id' : 'under a NEW id'}, ${back.role}`);
        }
      } else {
        // link-account as deployed before 037 brings them in at once.
        back = await memberRow(b.user.id);
        check('link-joins', 'Linking someone in the tree to an account that is not a member brings them in as that person, a viewer',
          joined.status === 200 && joined.data?.status === 'linked' && back?.id === treePerson && back?.role === 'viewer',
          joined.status !== 200 ? http(joined) : !back ? 'not a member' : `${back.id === treePerson ? 'under the same id' : 'under a NEW id'}, ${back.role}`);
        if (back) {
          const told = (await inboxOf(b)).find((n) => n.type === 'member' && n.family_id === vaultA.id && !before.has(n.id));
          check('link-notified', 'Someone linked into a family is told, by a notification', !!told, told ? `"${told.title}"` : 'no new "member" notification');
          if (told) await b.client.rpc('mark_notification_read', { p_notification_id: told.id, p_user_id: b.user.id });
        }
      }
      if (back) await b.client.from('family_members').delete().eq('family_id', vaultA.id).eq('user_id', b.user.id);
    }
  } finally {
    const waiting = await inviteToB();
    if (waiting) await a.client.rpc('cancel_family_invite', { p_invite_id: waiting.id });
    if (await memberRow(b.user.id)) await a.client.from('family_members').delete().eq('family_id', vaultA.id).eq('user_id', b.user.id);
    if (sacrificialId) await a.client.rpc('delete_family_document', { p_family_id: vaultA.id, p_document_id: sacrificialId, p_user_id: a.user.id });
    if (linkEntry) await a.client.rpc('remove_family_person', { p_person_id: linkEntry });
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
