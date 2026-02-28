import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Modal, TextInput, Pressable, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import { inviteMember, fetchFamilyInvitations, removeFamilyMember, updateMemberRole, revokeInvitation, type InvitationRow } from '../lib/api';

const relations = ['Father', 'Mother', 'Spouse', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'];

export default function FamilyScreen() {
  const { user } = useAuth();
  const { currentFamily, members, membership, refreshMembers } = useFamily();
  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedRelation, setSelectedRelation] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [aliases, setAliases] = useState('');
  const [inviting, setInviting] = useState(false);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void;
  } | null>(null);

  const isAdmin = membership?.role === 'admin';

  // Fetch invitations when family is available
  useEffect(() => {
    if (!currentFamily) return;
    fetchFamilyInvitations(currentFamily.id)
      .then(setInvitations)
      .catch(() => {});
  }, [currentFamily?.id]);

  // Filter: only show pending invitations for emails not already in members
  const memberEmails = new Set(members.map((m) => m.users?.email).filter(Boolean));
  const pendingInvites = invitations.filter(
    (inv) => inv.status === 'pending' && !memberEmails.has(inv.invitee_email)
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
      } catch {
        // silently handle
      }
    });
  };

  const handleMakeAdmin = (memberId: string, name: string) => {
    showConfirm('Make Admin', `Make ${name} an admin of ${familyName} Vault?\nThey will be able to add and remove members.`, async () => {
      try {
        await updateMemberRole(memberId, 'admin');
        refreshMembers().catch(() => {});
      } catch {
        // silently handle
      }
    }, false);
  };

  const handleRevokeInvite = (invitationId: string, email: string) => {
    showConfirm('Delete Invitation', `Delete pending invitation to ${email}?`, async () => {
      try {
        await revokeInvitation(invitationId);
        setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
      } catch {
        // silently handle
      }
    }, true, 'Delete');
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !currentFamily || !user) {
      Alert.alert('Required', 'Please enter an email address.');
      return;
    }
    const emailToInvite = inviteEmail.trim().toLowerCase();
    setInviting(true);
    try {
      await inviteMember(currentFamily.id, user.id, emailToInvite, 'viewer');

      // Optimistically add to local state so the UI updates immediately
      const optimistic: InvitationRow = {
        id: `temp-${Date.now()}`,
        family_id: currentFamily.id,
        invited_by: user.id,
        invitee_email: emailToInvite,
        role: 'viewer',
        status: 'pending',
        token: '',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      };
      setInvitations((prev) => [optimistic, ...prev]);

      Alert.alert('Invited', `Invitation sent to ${emailToInvite}`);
      setShowAddMember(false);
      setInviteEmail('');
      setMemberName('');
      setSelectedRelation('');
      setAliases('');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send invitation.');
    } finally {
      setInviting(false);
    }
  };

  if (!currentFamily) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={() => router.replace('/home' as any)} style={styles.backBtn}>
              <Feather name="arrow-left" size={24} color="#4B5563" />
            </TouchableOpacity>
            <Text style={styles.title}>Manage Family</Text>
          </View>
        </View>
        <View style={styles.noFamilyWrap}>
          <Feather name="users" size={48} color="#D1D5DB" />
          <Text style={styles.noFamilyTitle}>No Family Yet</Text>
          <Text style={styles.noFamilySub}>Create a family to share and manage documents together.</Text>
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
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.replace('/home' as any)} style={styles.backBtn}>
            <Feather name="arrow-left" size={24} color="#4B5563" />
          </TouchableOpacity>
          <View>
            <Text style={styles.title}>{currentFamily.name}</Text>
            <Text style={styles.subtitle}>{members.length} member{members.length !== 1 ? 's' : ''}</Text>
          </View>
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

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Active Members */}
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
                    <View style={styles.cardActions}>
                      <View style={styles.acceptedBadge}>
                        <Feather name="check-circle" size={14} color="#22C55E" />
                        <Text style={styles.acceptedText}>Joined</Text>
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
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Pending Invitations */}
        {pendingInvites.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Pending Invitations</Text>
            <View style={styles.memberList}>
              {pendingInvites.map((inv) => {
                const initial = inv.invitee_email.charAt(0).toUpperCase();
                const isExpired = new Date(inv.expires_at) < new Date();
                return (
                  <View key={inv.id} style={[styles.memberCard, styles.pendingCard]}>
                    <View style={styles.pendingAvatar}>
                      <Text style={styles.pendingInitial}>{initial}</Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName}>{inv.invitee_email}</Text>
                      <Text style={styles.memberRelation}>
                        Invited as {inv.role}
                      </Text>
                    </View>
                    <View style={styles.cardActions}>
                      <View style={isExpired ? styles.expiredBadge : styles.pendingBadge}>
                        <Feather
                          name={isExpired ? 'alert-circle' : 'clock'}
                          size={14}
                          color={isExpired ? '#EF4444' : '#F59E0B'}
                        />
                        <Text style={isExpired ? styles.expiredText : styles.pendingText}>
                          {isExpired ? 'Expired' : 'Invited'}
                        </Text>
                      </View>
                      {isAdmin && (
                        <TouchableOpacity
                          onPress={() => handleRevokeInvite(inv.id, inv.invitee_email)}
                          style={styles.actionBtnDanger}
                        >
                          <Feather name="trash-2" size={14} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Empty state */}
        {members.length === 0 && pendingInvites.length === 0 && (
          <View style={styles.emptyState}>
            <Feather name="users" size={40} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No members yet</Text>
            <Text style={styles.emptySubtitle}>Invite your family members to get started</Text>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Add Member Modal */}
      <Modal visible={showAddMember} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowAddMember(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.sheetHandle} />

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Invite Family Member</Text>
              <TouchableOpacity
                onPress={() => setShowAddMember(false)}
                style={styles.closeBtn}
              >
                <Feather name="x" size={20} color="#4B5563" />
              </TouchableOpacity>
            </View>

            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email Address</Text>
              <TextInput
                placeholder="Enter email address"
                placeholderTextColor="#9CA3AF"
                keyboardType="email-address"
                autoCapitalize="none"
                value={inviteEmail}
                onChangeText={setInviteEmail}
                style={styles.fieldInput}
              />
            </View>

            {/* Name */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Display Name <Text style={styles.fieldLabelOptional}>(optional)</Text>
              </Text>
              <TextInput
                placeholder="Enter full name"
                placeholderTextColor="#9CA3AF"
                value={memberName}
                onChangeText={setMemberName}
                style={styles.fieldInput}
              />
            </View>

            {/* Relationship */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Relationship</Text>
              <View style={styles.relationGrid}>
                {relations.map((r) => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setSelectedRelation(r)}
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

            {/* Aliases */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Also called <Text style={styles.fieldLabelOptional}>(optional)</Text>
              </Text>
              <TextInput
                placeholder="e.g. Papa, Daddy, Baba"
                placeholderTextColor="#9CA3AF"
                value={aliases}
                onChangeText={setAliases}
                style={styles.fieldInput}
              />
              <Text style={styles.fieldHint}>
                Powers the smart search — "Papa's passport"
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleInvite}
              activeOpacity={0.85}
              disabled={inviting}
            >
              <LinearGradient
                colors={['#2A3D66', '#4A6491']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.addMemberBtn, inviting && { opacity: 0.7 }]}
              >
                {inviting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.addMemberBtnText}>Send Invitation</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { padding: 4 },
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
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
  cardActions: { alignItems: 'flex-end', gap: 8 },
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
  acceptedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDF4',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  acceptedText: { fontSize: 11, fontWeight: '600', color: '#22C55E' },
  pendingCard: { opacity: 0.85 },
  pendingAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
  },
  pendingInitial: { fontSize: 22, fontWeight: '700', color: '#9CA3AF' },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFBEB',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pendingText: { fontSize: 11, fontWeight: '600', color: '#F59E0B' },
  expiredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  expiredText: { fontSize: 11, fontWeight: '600', color: '#EF4444' },
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
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
