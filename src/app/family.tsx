import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Modal, TextInput, Pressable, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import {
  addFamilyMember, cancelInvitation, fetchFamilyInvites, fetchPlanLimits, leaveFamily, removeFamilyMember, updateMemberRole,
  type PendingInvite,
} from '../lib/api';
import { useFamilyPlan } from '../lib/family-plan';
import { DEFAULT_PLAN_LIMITS, type PlanLimits } from '../lib/plans';
import { ScreenHeader, HeaderButton } from '../components/screen-header';
import { InvitationCards } from '../components/invitation-cards';
import { longDate } from '../lib/dates';
import { isPersonalVault, vaultName, vaultSubtitle } from '../lib/vaults';
import { color, radius, shadow, size, space, type } from '../constants/design';

const relations = ['Father', 'Mother', 'Spouse', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'];

// Nobody joins a family without saying yes (migration 037): an admin invites
// a person who already has an account, and they join when they accept — until
// then they show here as Pending approval, and any admin can withdraw it. The
// invitations waiting for YOU are at the top. Anyone can leave any family
// they are in.
//
// A family has at most its plan's number of members (041: 4), and an
// invitation waiting for its answer holds a place. The server keeps that
// limit; this screen shows it, and hides Add once the places are taken. The
// family tree has no limit: people without an account are not members.
//
// Results are shown on the screen, never with Alert.alert: react-native-web's
// Alert is an empty function, so on the web build it would show nothing.

export default function FamilyScreen() {
  const { user } = useAuth();
  const { currentFamily, families, members, membership, refreshMembers, refreshFamilies, switchFamily } = useFamily();
  const [showAddMember, setShowAddMember] = useState(false);
  const [email, setEmail] = useState('');
  const [selectedRelation, setSelectedRelation] = useState('');
  const [alias, setAlias] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [limits, setLimits] = useState<PlanLimits>(DEFAULT_PLAN_LIMITS);
  const { plan } = useFamilyPlan();
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void;
  } | null>(null);

  const isAdmin = membership?.role === 'admin';
  const adminCount = members.filter((m) => m.role === 'admin').length;
  // The last admin cannot leave: nobody would be left to manage the family.
  const canLeave = !!currentFamily && !(isAdmin && adminCount <= 1);

  const loadPending = useCallback(() => {
    if (!currentFamily) { setPending([]); return; }
    fetchFamilyInvites(currentFamily.id).then(setPending).catch(() => setPending([]));
  }, [currentFamily?.id]);

  // Someone may have joined, or answered, since the app opened.
  useFocusEffect(
    useCallback(() => {
      refreshFamilies().catch(() => {});
      refreshMembers().catch(() => {});
      loadPending();
      fetchPlanLimits().then(setLimits).catch(() => {});
    }, [refreshFamilies, refreshMembers, loadPending])
  );

  // Members and waiting invitations together, against the plan's number.
  const maxMembers = plan === 'plus' ? limits.members.plus : limits.members.free;
  const full = members.length + pending.length >= maxMembers;

  const showConfirm = (title: string, message: string, onConfirm: () => void, destructive = true, confirmLabel = destructive ? 'Remove' : 'Confirm') => {
    setConfirmDialog({ title, message, onConfirm, destructive, confirmLabel });
  };

  const familyName = currentFamily?.name || 'Family';

  const handleRemoveMember = (memberId: string, name: string) => {
    showConfirm('Remove Member', `Remove ${name} from ${familyName} Vault? The documents they added stay in the vault, and nobody else can delete them.`, async () => {
      try {
        await removeFamilyMember(memberId);
        refreshMembers().catch(() => {});
      } catch (err: any) {
        setNotice(err.message || `Could not remove ${name}.`);
      }
    });
  };

  const handleMakeAdmin = (memberId: string, name: string) => {
    showConfirm('Make Admin', `Make ${name} an admin of ${familyName} Vault?\nThey will be able to add and remove members.`, async () => {
      try {
        await updateMemberRole(memberId, 'admin');
        refreshMembers().catch(() => {});
      } catch (err: any) {
        setNotice(err.message || `Could not make ${name} an admin.`);
      }
    }, false);
  };

  const handleWithdraw = (invite: PendingInvite) => {
    const who = invite.personName ? `${invite.personName} (${invite.email})` : invite.email;
    showConfirm('Withdraw invitation', `Withdraw the invitation to ${who}? They will not be able to join ${familyName} with it.`, async () => {
      try {
        await cancelInvitation(invite.id);
        loadPending();
      } catch (err: any) {
        setNotice(err.message || 'Could not withdraw the invitation.');
      }
    }, true, 'Withdraw');
  };

  const handleLeave = () => {
    if (!currentFamily || !user) return;
    showConfirm('Leave Family', `Leave ${familyName} Vault? You will no longer see its documents. Documents you added stay, and nobody else can delete them, so delete any you want gone first. An admin can invite you again.`, async () => {
      try {
        await leaveFamily(currentFamily.id, user.id);
        await refreshFamilies();
        router.replace('/home' as any);
      } catch (err: any) {
        setNotice(err.message || 'Could not leave this family.');
      }
    }, true, 'Leave');
  };

  const closeAddMember = () => {
    setShowAddMember(false);
    setAddError(null);
  };

  const handleAdd = async () => {
    if (!currentFamily) return;
    const address = email.trim().toLowerCase();
    if (!address) {
      setAddError('Enter the email address they sign in with.');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const outcome = await addFamilyMember(currentFamily.id, address, {
        alias,
        relationship: selectedRelation || undefined,
      });
      switch (outcome.status) {
        case 'invited':
        case 'added':
          setNotice(outcome.status === 'invited'
            ? `Invitation sent to ${outcome.email}. They join ${familyName} once they accept — until then they show here as Pending approval.`
            : `${outcome.displayName} was added to ${familyName} and can now see its documents.`);
          setShowAddMember(false);
          setEmail('');
          setSelectedRelation('');
          setAlias('');
          refreshMembers().catch(() => {});
          loadPending();
          break;
        case 'already_member':
          setAddError(`${outcome.displayName} is already in this family.`);
          break;
        case 'already_invited':
          setAddError(`${address} has been invited already. They join once they accept.`);
          break;
        case 'no_account':
          setAddError(`No AskLocker account uses ${address} yet. Ask them to sign in to AskLocker once with Google, using this email, then add them again.`);
          break;
        case 'invalid_email':
          setAddError("That doesn't look like an email address.");
          break;
        case 'full':
          setAddError(outcome.message);
          refreshMembers().catch(() => {});
          loadPending();
          break;
        case 'unavailable':
          setAddError(outcome.message);
          break;
      }
    } catch (err: any) {
      setAddError(err.message || 'Could not add this member. Please try again.');
    } finally {
      setAdding(false);
    }
  };

  // Every vault this person is in (046): their personal vault and each
  // family. Tapping one opens it everywhere — Home, the family tree, Storage.
  const vaultList = families.length > 1 && currentFamily && (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Your vaults</Text>
      <View style={styles.memberList}>
        {families.map((f) => {
          const isCurrent = f.family_id === currentFamily.id;
          return (
            <TouchableOpacity
              key={f.family_id}
              onPress={() => switchFamily(f.family_id)}
              style={[styles.familyRow, isCurrent && styles.familyRowCurrent]}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: isCurrent }}
            >
              <Feather name={isPersonalVault(f.families) ? 'lock' : 'home'} size={16} color={isCurrent ? '#FFFFFF' : color.primary} />
              <View style={styles.memberInfo}>
                <Text style={[styles.familyRowName, isCurrent && styles.familyRowNameCurrent]}>{vaultName(f.families)}</Text>
                <Text style={[styles.familyRowRole, isCurrent && styles.familyRowRoleCurrent]}>{vaultSubtitle(f)}</Text>
              </View>
              {isCurrent && <Feather name="check" size={16} color="#FFFFFF" />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  // A family is how documents are shared; anyone can make one, at any time.
  const createFamily = (
    <TouchableOpacity
      onPress={() => router.push('/setup-family' as any)}
      style={styles.treeLink}
      activeOpacity={0.8}
      accessibilityRole="button"
    >
      <View style={styles.treeIcon}>
        <Feather name="plus" size={16} color={color.primary} />
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.treeTitle}>Create a family</Text>
        <Text style={styles.treeSub}>A vault to share documents with the people you invite</Text>
      </View>
      <Feather name="chevron-right" size={16} color="#9CA3AF" />
    </TouchableOpacity>
  );

  if (!currentFamily) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Manage Family" />
        <InvitationCards style={styles.invites} />
        <View style={styles.noFamilyWrap}>
          <Feather name="users" size={32} color="#D1D5DB" />
          <Text style={styles.noFamilyTitle}>No Family Yet</Text>
          <Text style={styles.noFamilySub}>
            Create a family to share and manage documents together — or ask your family's admin to invite you, using the email you sign in with. An invitation shows here, and on Home.
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/setup-family' as any)}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['#2A3D66', '#4A6491']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.createFamilyBtn}
            >
              <Text style={styles.createFamilyText}>Create Family</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // A personal vault (046) has nobody to manage: nobody else can be invited
  // to it. This is where its owner sees that, moves between their vaults,
  // and makes a family to share with.
  if (isPersonalVault(currentFamily)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Personal vault" subtitle="Just for you" />
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <InvitationCards style={styles.invites} />
          {notice && (
            <TouchableOpacity style={styles.notice} onPress={() => setNotice(null)} activeOpacity={0.8}>
              <Feather name="info" size={16} color="#2A3D66" />
              <Text style={styles.noticeText}>{notice}</Text>
              <Feather name="x" size={16} color="#6B7280" />
            </TouchableOpacity>
          )}
          <View style={styles.personalCard}>
            <View style={styles.treeIcon}>
              <Feather name="lock" size={16} color={color.primary} />
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.treeTitle}>Your documents, just for you</Text>
              <Text style={styles.personalText}>
                Nobody else using AskLocker can open your personal vault, and nobody can be invited to it. To keep documents with your
                family, create a family and invite them, or accept an invitation from one. Each time you upload, you
                choose where the document goes, and Ask searches all your vaults at once.
              </Text>
            </View>
          </View>
          {vaultList}
          {createFamily}
          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={currentFamily.name}
        subtitle={`${members.length} of ${maxMembers} members`}
        right={isAdmin && !full
          ? <HeaderButton icon="user-plus" label="Add" onPress={() => setShowAddMember(true)} />
          : undefined}
      />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Invitations waiting for you, to this family or another */}
        <InvitationCards style={styles.invites} />

        {notice && (
          <TouchableOpacity style={styles.notice} onPress={() => setNotice(null)} activeOpacity={0.8}>
            <Feather name="info" size={16} color="#2A3D66" />
            <Text style={styles.noticeText}>{notice}</Text>
            <Feather name="x" size={16} color="#6B7280" />
          </TouchableOpacity>
        )}

        {/* No room for another member: why, and what makes room. */}
        {isAdmin && full && (
          <View style={styles.fullNote}>
            <Feather name="users" size={16} color="#7A5200" />
            <Text style={styles.fullNoteText}>
              {familyName} is full: a family can have {maxMembers} members
              {pending.length > 0 ? ', and invitations waiting for an answer count too' : ''}. To invite someone else,{' '}
              {pending.length > 0 ? 'withdraw an invitation or remove a member' : 'remove a member'}. Anyone can still be
              added to the family tree, without an account.
            </Text>
          </View>
        )}

        {/* The tree holds everyone, accounts or not; this screen is who can sign in. */}
        <TouchableOpacity
          style={styles.treeLink}
          onPress={() => router.push('/family-tree' as any)}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <View style={styles.treeIcon}>
            <Feather name="git-branch" size={16} color={color.primary} />
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.treeTitle}>Family tree</Text>
            <Text style={styles.treeSub}>Everyone in the family, and whose documents are whose</Text>
          </View>
          <Feather name="chevron-right" size={16} color="#9CA3AF" />
        </TouchableOpacity>

        {/* Every vault this person is in, and a family of their own to start (046) */}
        {vaultList}

        {/* Members */}
        {members.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Members</Text>
            <View style={styles.memberList}>
              {members.map((m) => {
                const name = m.alias || m.users.display_name;
                const initial = name.charAt(0).toUpperCase();
                const isCurrentUser = m.user_id === user?.id;
                const isMemberAdmin = m.role === 'admin';
                return (
                  <View key={m.id} style={styles.memberCard}>
                    <LinearGradient
                      colors={isCurrentUser ? ['#D4807B', '#2A3D66'] : ['#2A3D66', '#4A6491']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.memberAvatar}
                    >
                      <Text style={styles.memberInitial}>{initial}</Text>
                    </LinearGradient>
                    <View style={styles.memberInfo}>
                      <View style={styles.memberNameRow}>
                        <Text style={styles.memberName}>{name}</Text>
                        {isCurrentUser && (
                          <View style={styles.youBadge}>
                            <Text style={styles.youBadgeText}>You</Text>
                          </View>
                        )}
                        {isMemberAdmin && (
                          <View style={styles.adminBadge}>
                            <Text style={styles.adminBadgeText}>Admin</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.memberRelation}>
                        {m.relationship || m.role}
                      </Text>
                    </View>
                    {isAdmin && !isCurrentUser && (
                      <View style={styles.actionRow}>
                        {!isMemberAdmin && (
                          <TouchableOpacity
                            onPress={() => handleMakeAdmin(m.id, name)}
                            style={styles.actionBtn}
                            hitSlop={4}
                            accessibilityRole="button"
                            accessibilityLabel={`Make ${name} an admin`}
                          >
                            <Feather name="shield" size={16} color={color.primary} />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => handleRemoveMember(m.id, name)}
                          style={styles.actionBtnDanger}
                          hitSlop={4}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${name}`}
                        >
                          <Feather name="user-minus" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Asked, not answered yet (037) */}
        {pending.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Pending approval</Text>
            <View style={styles.memberList}>
              {pending.map((invite) => {
                const asker = members.find((m) => m.user_id === invite.invitedBy);
                const askerName = invite.invitedBy === user?.id ? 'you' : asker ? (asker.alias || asker.users.display_name) : null;
                return (
                  <View key={invite.id} style={styles.memberCard}>
                    <View style={styles.pendingAvatar}>
                      <Feather name="clock" size={16} color="#B45309" />
                    </View>
                    <View style={styles.memberInfo}>
                      <View style={styles.memberNameRow}>
                        <Text style={styles.memberName} numberOfLines={1}>{invite.personName || invite.email}</Text>
                        <View style={styles.pendingBadge}>
                          <Text style={styles.pendingBadgeText}>Pending approval</Text>
                        </View>
                      </View>
                      <Text style={styles.pendingSub} numberOfLines={2}>
                        {invite.personName ? `${invite.email} · ` : ''}Invited {longDate(new Date(invite.createdAt))}
                        {askerName ? ` by ${askerName}` : ''}
                      </Text>
                    </View>
                    {isAdmin && (
                      <TouchableOpacity
                        onPress={() => handleWithdraw(invite)}
                        style={styles.actionBtnDanger}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel={`Withdraw the invitation to ${invite.personName || invite.email}`}
                      >
                        <Feather name="x" size={16} color="#EF4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Empty state */}
        {members.length === 0 && (
          <View style={styles.emptyState}>
            <Feather name="users" size={32} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No members yet</Text>
            <Text style={styles.emptySubtitle}>Add your family members to get started</Text>
          </View>
        )}

        {createFamily}

        {canLeave && (
          <TouchableOpacity onPress={handleLeave} style={styles.leaveBtn} activeOpacity={0.8}>
            <Feather name="log-out" size={16} color="#EF4444" />
            <Text style={styles.leaveBtnText}>Leave {familyName}</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Add Member Modal */}
      <Modal visible={showAddMember} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={closeAddMember} />
        <View style={styles.modalSheet}>
          <View style={styles.sheetHandle} />

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Add Family Member</Text>
              <TouchableOpacity
                onPress={closeAddMember}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Feather name="x" size={size.icon} color={color.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.sheetIntro}>
              They need a AskLocker account. Enter the email they sign in with: they get an invitation, and join as a viewer once they accept. Until then they show here as Pending approval.
            </Text>
            <Text style={styles.sheetIntro}>
              Already in the family tree? Open them there and choose Link to their AskLocker account instead, so they keep their place in the tree, their documents and their emergency card.
            </Text>

            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email Address</Text>
              <TextInput
                placeholder="The email they sign in with"
                placeholderTextColor="#9CA3AF"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={(v) => { setEmail(v); setAddError(null); }}
                style={styles.fieldInput}
              />
            </View>

            {/* Relationship */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Relationship <Text style={styles.fieldLabelOptional}>(optional)</Text>
              </Text>
              <View style={styles.relationGrid}>
                {relations.map((r) => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setSelectedRelation(selectedRelation === r ? '' : r)}
                    style={[
                      styles.relationChip,
                      selectedRelation === r && styles.relationChipSelected,
                    ]}
                  >
                    <Text style={[
                      styles.relationChipText,
                      selectedRelation === r && styles.relationChipTextSelected,
                    ]}>
                      {r}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* What the family calls them */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Called at home <Text style={styles.fieldLabelOptional}>(optional)</Text>
              </Text>
              <TextInput
                placeholder="e.g. Papa"
                placeholderTextColor="#9CA3AF"
                value={alias}
                onChangeText={setAlias}
                style={styles.fieldInput}
              />
              <Text style={styles.fieldHint}>
                Shown in this family instead of their account name
              </Text>
            </View>

            {addError && <Text style={styles.addError}>{addError}</Text>}

            <TouchableOpacity
              onPress={handleAdd}
              activeOpacity={0.85}
              disabled={adding}
            >
              <LinearGradient
                colors={['#2A3D66', '#4A6491']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.addMemberBtn, adding && { opacity: 0.7 }]}
              >
                {adding ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.addMemberBtnText}>Send invitation</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Confirmation Dialog */}
      <Modal visible={!!confirmDialog} transparent animationType="fade">
        <Pressable style={styles.dialogOverlay} onPress={() => setConfirmDialog(null)}>
          <View style={styles.dialogBox} onStartShouldSetResponder={() => true}>
            <Text style={styles.dialogTitle}>{confirmDialog?.title}</Text>
            <Text style={styles.dialogMessage}>{confirmDialog?.message}</Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setConfirmDialog(null)}
                style={styles.dialogCancelBtn}
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  confirmDialog?.onConfirm();
                  setConfirmDialog(null);
                }}
                style={[
                  styles.dialogConfirmBtn,
                  confirmDialog?.destructive !== false && styles.dialogConfirmBtnDestructive,
                ]}
              >
                <Text style={[
                  styles.dialogConfirmText,
                  confirmDialog?.destructive !== false && styles.dialogConfirmTextDestructive,
                ]}>
                  {confirmDialog?.confirmLabel}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  scroll: { flex: 1 },
  section: { paddingHorizontal: space.lg, paddingTop: space.lg },
  sectionLabel: { ...type.overline, marginBottom: space.sm, marginLeft: space.xs },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  emptyTitle: { ...type.heading, color: color.textMuted },
  emptySubtitle: { ...type.caption, textAlign: 'center' },
  memberList: { gap: space.sm },
  memberCard: {
    backgroundColor: color.surface,
    borderRadius: radius.control,
    paddingVertical: 10,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: size.row,
    ...shadow.card,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitial: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  memberInfo: { flex: 1, minWidth: 0 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  memberName: type.label,
  youBadge: {
    backgroundColor: color.tint,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  youBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: color.primary },
  memberRelation: { ...type.caption, textTransform: 'capitalize' },
  adminBadge: {
    backgroundColor: '#EDE9FE',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  adminBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#7C3AED' },
  actionRow: { flexDirection: 'row', gap: space.sm },
  invites: { paddingHorizontal: space.lg, paddingTop: space.lg },
  pendingAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  pendingBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#B45309' },
  pendingSub: type.caption,
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnDanger: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Notice banner: the result of an add, remove or leave
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.lg,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    borderRadius: 10,
    backgroundColor: color.tint,
  },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20, color: color.primary },
  fullNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.lg,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#FFF7E6',
    borderColor: '#F5D9A0',
  },
  fullNoteText: { flex: 1, fontSize: 14, lineHeight: 20, color: '#7A5200' },
  // Family switcher
  familyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.surface,
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    minHeight: size.row,
    ...shadow.card,
  },
  familyRowCurrent: { backgroundColor: color.primary },
  familyRowName: type.label,
  familyRowNameCurrent: { color: '#FFFFFF' },
  familyRowRole: type.caption,
  familyRowRoleCurrent: { color: 'rgba(255,255,255,0.8)' },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.xl,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    minHeight: size.control,
  },
  leaveBtnText: { ...type.button, color: color.danger },
  // Modal
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    maxHeight: '85%',
    boxShadow: '0px -4px 16px rgba(0, 0, 0, 0.15)',
    elevation: 20,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: color.inputBorder,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: space.xs,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginRight: -10,
  },
  sheetTitle: type.title,
  sheetIntro: { ...type.caption, marginBottom: space.lg },
  closeBtn: {
    width: size.control,
    height: size.control,
    borderRadius: size.control / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { marginBottom: space.lg },
  fieldLabel: { ...type.caption, fontWeight: '500', color: color.textBody, marginBottom: 6 },
  fieldLabelOptional: { fontWeight: '400', color: '#9CA3AF' },
  fieldInput: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.inputBorder,
    borderRadius: 10,
    paddingHorizontal: space.md,
    fontSize: type.body.fontSize,
    color: color.text,
    minHeight: size.control,
    outlineStyle: 'none',
  } as any,
  fieldHint: { ...type.caption, marginTop: 6 },
  addError: { fontSize: 14, lineHeight: 20, color: color.danger, marginBottom: space.sm },
  relationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  relationChip: {
    width: '47%',
    paddingHorizontal: space.md,
    borderRadius: 10,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.inputBorder,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  relationChipSelected: { backgroundColor: color.primary, borderColor: color.primary },
  relationChipText: { fontSize: 14, lineHeight: 20, fontWeight: '500', color: color.textBody },
  relationChipTextSelected: { color: '#FFFFFF' },
  addMemberBtn: {
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
    marginTop: space.xs,
    marginBottom: space.xl,
  },
  addMemberBtnText: { ...type.button, color: '#FFFFFF' },
  noFamilyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  noFamilyTitle: { ...type.heading, color: color.textBody },
  noFamilySub: { ...type.caption, textAlign: 'center', maxWidth: 300 },
  createFamilyBtn: {
    borderRadius: radius.control,
    paddingHorizontal: space.xl,
    minHeight: size.control,
    justifyContent: 'center',
    marginTop: space.sm,
  },
  createFamilyText: { ...type.button, color: '#FFFFFF' },
  // Confirmation dialog
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xl,
  },
  dialogBox: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg + 4,
    width: '100%',
    maxWidth: 360,
    boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.15)',
    elevation: 10,
  },
  dialogTitle: { ...type.title, color: color.text, marginBottom: space.sm },
  dialogMessage: { ...type.body, color: color.textMuted, marginBottom: space.xl },
  dialogActions: { flexDirection: 'row', gap: space.md },
  dialogCancelBtn: {
    flex: 1,
    minHeight: size.control,
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: color.divider,
    alignItems: 'center',
  },
  dialogCancelText: { ...type.button, color: '#4B5563' },
  dialogConfirmBtn: {
    flex: 1,
    minHeight: size.control,
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: color.primary,
    alignItems: 'center',
  },
  dialogConfirmBtnDestructive: {
    backgroundColor: '#EF4444',
  },
  dialogConfirmText: { ...type.button, color: '#FFFFFF' },
  dialogConfirmTextDestructive: { color: '#FFFFFF' },
  treeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginTop: space.lg,
    padding: space.md,
    minHeight: size.row,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    ...shadow.card,
  },
  treeIcon: { width: size.iconBox, height: size.iconBox, borderRadius: 8, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  treeTitle: type.label,
  treeSub: type.caption,
  personalCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    marginHorizontal: space.lg,
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    ...shadow.card,
  },
  personalText: { ...type.caption, marginTop: space.xs },
});
