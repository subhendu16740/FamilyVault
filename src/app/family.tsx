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
import { addFamilyMember, leaveFamily, removeFamilyMember, updateMemberRole } from '../lib/api';
import { BackButton } from '../components/back-button';

const relations = ['Father', 'Mother', 'Spouse', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'];

// Membership has no invitations and no requests (migration 025): an admin
// adds a person who already has an account, and they are in straight away —
// and notified. Anyone can leave any family they are in.
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
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void;
  } | null>(null);

  const isAdmin = membership?.role === 'admin';
  const adminCount = members.filter((m) => m.role === 'admin').length;
  // The last admin cannot leave: nobody would be left to manage the family.
  const canLeave = !!currentFamily && !(isAdmin && adminCount <= 1);

  // Someone may have added this person to a family since the app opened.
  useFocusEffect(
    useCallback(() => {
      refreshFamilies().catch(() => {});
      refreshMembers().catch(() => {});
    }, [refreshFamilies, refreshMembers])
  );

  const showConfirm = (title: string, message: string, onConfirm: () => void, destructive = true, confirmLabel = destructive ? 'Remove' : 'Confirm') => {
    setConfirmDialog({ title, message, onConfirm, destructive, confirmLabel });
  };

  const familyName = currentFamily?.name || 'Family';

  const handleRemoveMember = (memberId: string, name: string) => {
    showConfirm('Remove Member', `Remove ${name} from ${familyName} Vault?`, async () => {
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

  const handleLeave = () => {
    if (!currentFamily || !user) return;
    showConfirm('Leave Family', `Leave ${familyName} Vault? You will no longer see its documents. An admin can add you again.`, async () => {
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
        case 'added':
          setNotice(`${outcome.displayName} was added to ${familyName} and can now see its documents.`);
          setShowAddMember(false);
          setEmail('');
          setSelectedRelation('');
          setAlias('');
          refreshMembers().catch(() => {});
          break;
        case 'already_member':
          setAddError(`${outcome.displayName} is already in this family.`);
          break;
        case 'no_account':
          setAddError(`No FamilyVault account uses ${address} yet. Ask them to sign up with this email, then add them again.`);
          break;
        case 'invalid_email':
          setAddError("That doesn't look like an email address.");
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

  if (!currentFamily) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <BackButton />
          <Text style={styles.title}>Manage Family</Text>
        </View>
        <View style={styles.noFamilyWrap}>
          <Feather name="users" size={48} color="#D1D5DB" />
          <Text style={styles.noFamilyTitle}>No Family Yet</Text>
          <Text style={styles.noFamilySub}>
            Create a family to share and manage documents together — or ask your family's admin to add you, using the email you sign in with.
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
              <Text style={styles.addBtnText}>Create Family</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <View style={styles.headerRow}>
          <View style={styles.headerTitles}>
            <Text style={styles.title}>{currentFamily.name}</Text>
            <Text style={styles.subtitle}>{members.length} member{members.length !== 1 ? 's' : ''}</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity
              onPress={() => setShowAddMember(true)}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#2A3D66', '#4A6491']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.addBtn}
              >
                <Text style={styles.addBtnText}>+ Add Member</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {notice && (
          <TouchableOpacity style={styles.notice} onPress={() => setNotice(null)} activeOpacity={0.8}>
            <Feather name="info" size={16} color="#2A3D66" />
            <Text style={styles.noticeText}>{notice}</Text>
            <Feather name="x" size={16} color="#6B7280" />
          </TouchableOpacity>
        )}

        {/* Every family this person is in — more than one once an admin adds them elsewhere */}
        {families.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Your Families</Text>
            <View style={styles.memberList}>
              {families.map((f) => {
                const isCurrent = f.family_id === currentFamily.id;
                return (
                  <TouchableOpacity
                    key={f.family_id}
                    onPress={() => switchFamily(f.family_id)}
                    style={[styles.familyRow, isCurrent && styles.familyRowCurrent]}
                    activeOpacity={0.8}
                  >
                    <Feather name="home" size={18} color={isCurrent ? '#FFFFFF' : '#2A3D66'} />
                    <View style={styles.memberInfo}>
                      <Text style={[styles.familyRowName, isCurrent && styles.familyRowNameCurrent]}>{f.families.name}</Text>
                      <Text style={[styles.familyRowRole, isCurrent && styles.familyRowRoleCurrent]}>{f.role}</Text>
                    </View>
                    {isCurrent && <Feather name="check" size={18} color="#FFFFFF" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

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
                          >
                            <Feather name="shield" size={14} color="#2A3D66" />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => handleRemoveMember(m.id, name)}
                          style={styles.actionBtnDanger}
                        >
                          <Feather name="user-minus" size={14} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
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
            <Feather name="users" size={40} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No members yet</Text>
            <Text style={styles.emptySubtitle}>Add your family members to get started</Text>
          </View>
        )}

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
              >
                <Feather name="x" size={20} color="#4B5563" />
              </TouchableOpacity>
            </View>

            <Text style={styles.sheetIntro}>
              They need a FamilyVault account. Enter the email they sign in with: they're added straight away as a viewer, and get a notification.
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
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.addMemberBtnText}>Add Member</Text>
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
  safe: { flex: 1, backgroundColor: '#F8F9FC' },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    gap: 8,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  headerTitles: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700', color: '#2A3D66' },
  subtitle: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  addBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
  scroll: { flex: 1 },
  section: { paddingHorizontal: 24, paddingTop: 24 },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: '#6B7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#6B7280' },
  emptySubtitle: { fontSize: 13, color: '#9CA3AF' },
  memberList: { gap: 12 },
  memberCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 80,
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)',
    elevation: 3,
  },
  memberAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitial: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberName: { fontSize: 15, fontWeight: '600', color: '#1F2937' },
  youBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  youBadgeText: { fontSize: 10, fontWeight: '600', color: '#2A3D66' },
  memberRelation: { fontSize: 13, color: '#9CA3AF', marginTop: 2, textTransform: 'capitalize' },
  adminBadge: {
    backgroundColor: '#EDE9FE',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  adminBadgeText: { fontSize: 10, fontWeight: '600', color: '#7C3AED' },
  actionRow: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnDanger: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Notice banner: the result of an add, remove or leave
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 24,
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
  },
  noticeText: { flex: 1, fontSize: 13, color: '#2A3D66', lineHeight: 18 },
  // Family switcher
  familyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 56,
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)',
    elevation: 2,
  },
  familyRowCurrent: { backgroundColor: '#2A3D66' },
  familyRowName: { fontSize: 15, fontWeight: '600', color: '#1F2937' },
  familyRowNameCurrent: { color: '#FFFFFF' },
  familyRowRole: { fontSize: 12, color: '#9CA3AF', marginTop: 2, textTransform: 'capitalize' },
  familyRowRoleCurrent: { color: 'rgba(255,255,255,0.75)' },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
    minHeight: 48,
  },
  leaveBtnText: { fontSize: 14, fontWeight: '600', color: '#EF4444' },
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
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%',
    boxShadow: '0px -4px 16px rgba(0, 0, 0, 0.15)',
    elevation: 20,
  },
  sheetHandle: {
    width: 48,
    height: 4,
    backgroundColor: '#D1D5DB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  sheetTitle: { fontSize: 19, fontWeight: '700', color: '#2A3D66' },
  sheetIntro: { fontSize: 13, color: '#6B7280', lineHeight: 19, marginTop: -12, marginBottom: 20 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  fieldLabelOptional: { fontWeight: '400', color: '#9CA3AF' },
  fieldInput: {
    backgroundColor: '#F8F9FC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1F2937',
    minHeight: 56,
    outlineStyle: 'none',
  } as any,
  fieldHint: { fontSize: 11, color: '#9CA3AF', marginTop: 6 },
  addError: { fontSize: 13, color: '#DC2626', lineHeight: 18, marginBottom: 8 },
  relationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  relationChip: {
    width: '47%',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#F8F9FC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  relationChipSelected: { backgroundColor: '#2A3D66', borderColor: '#2A3D66' },
  relationChipText: { fontSize: 14, fontWeight: '500', color: '#374151' },
  relationChipTextSelected: { color: '#FFFFFF' },
  addMemberBtn: {
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    marginTop: 8,
    marginBottom: 24,
  },
  addMemberBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  noFamilyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  noFamilyTitle: { fontSize: 20, fontWeight: '700', color: '#374151' },
  noFamilySub: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  createFamilyBtn: {
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 8,
  },
  // Confirmation dialog
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  dialogBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.15)',
    elevation: 10,
  },
  dialogTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937', marginBottom: 8 },
  dialogMessage: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 24 },
  dialogActions: { flexDirection: 'row', gap: 12 },
  dialogCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  dialogCancelText: { fontSize: 15, fontWeight: '600', color: '#4B5563' },
  dialogConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#2A3D66',
    alignItems: 'center',
  },
  dialogConfirmBtnDestructive: {
    backgroundColor: '#EF4444',
  },
  dialogConfirmText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  dialogConfirmTextDestructive: { color: '#FFFFFF' },
});
