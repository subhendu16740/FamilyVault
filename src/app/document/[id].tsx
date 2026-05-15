import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
  Image, Platform, Alert, Modal, Pressable, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useFamily } from '../../lib/family-context';
import {
  fetchDocumentById, getDocumentSignedUrl, deleteDocument,
  updateDocument, fetchCategories, fetchFamilyMembers,
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import type { FamilyDocumentDetailRow } from '../../lib/database.types';

const actions = [
  { icon: 'share-2', label: 'Share', bg: '#EFF6FF', color: '#2563EB' },
  { icon: 'download', label: 'Download', bg: '#F0FDF4', color: '#16A34A' },
  { icon: 'edit-3', label: 'Edit', bg: '#FFFBEB', color: '#D97706' },
  { icon: 'trash-2', label: 'Delete', bg: '#FEF2F2', color: '#DC2626' },
] as const;

const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'heic', 'webp'];
function isImageType(fileType: string): boolean {
  return IMAGE_TYPES.includes(fileType.toLowerCase());
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentFamily } = useFamily();
  const [doc, setDoc] = useState<FamilyDocumentDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editMemberId, setEditMemberId] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!currentFamily || !id) return;
    setLoading(true);
    fetchDocumentById(currentFamily.id, id)
      .then(setDoc)
      .catch((err) => console.error('Doc fetch error:', err))
      .finally(() => setLoading(false));
  }, [currentFamily?.id, id]);

  useEffect(() => {
    if (!doc?.storage_path) return;
    setPreviewLoading(true);
    setPreviewError(false);
    getDocumentSignedUrl(doc.storage_path)
      .then(setPreviewUrl)
      .catch(() => setPreviewError(true))
      .finally(() => setPreviewLoading(false));
  }, [doc?.storage_path]);

  // ─── Action Handlers ───────────────────────────────────────────

  const handleShare = useCallback(async () => {
    if (!previewUrl || !doc) return;
    if (Platform.OS === 'web') {
      if (navigator.share) {
        try {
          await navigator.share({ title: doc.file_name, url: previewUrl });
        } catch { /* user cancelled */ }
      } else {
        await navigator.clipboard.writeText(previewUrl);
        Alert.alert('Link copied', 'Document link copied to clipboard.');
      }
    } else {
      // On native, open share sheet via expo-sharing (falls back to web browser)
      try {
        const Sharing = await import('expo-sharing');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(previewUrl);
        } else {
          Alert.alert('Sharing unavailable', 'Sharing is not supported on this device.');
        }
      } catch {
        Alert.alert('Error', 'Could not share this document.');
      }
    }
  }, [previewUrl, doc]);

  const handleDownload = useCallback(async () => {
    if (!previewUrl || !doc) return;
    if (Platform.OS === 'web') {
      const a = document.createElement('a');
      a.href = previewUrl;
      a.download = doc.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      // On native, open in browser to trigger download
      await WebBrowser.openBrowserAsync(previewUrl);
    }
  }, [previewUrl, doc]);

  const handleDelete = useCallback(() => {
    if (!doc || !currentFamily) return;
    const doDelete = async () => {
      setActionLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');
        await deleteDocument(currentFamily.id, doc.id, user.id, doc.storage_path);
        router.back();
      } catch (err: any) {
        Alert.alert('Delete failed', err.message || 'Could not delete document.');
      } finally {
        setActionLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      if (confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) doDelete();
    } else {
      Alert.alert(
        'Delete Document',
        `Delete "${doc.file_name}"? This cannot be undone.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: doDelete }],
      );
    }
  }, [doc, currentFamily]);

  const openEditModal = useCallback(async () => {
    if (!doc || !currentFamily) return;
    setEditName(doc.file_name);
    setEditCategoryId(doc.category_id);
    setEditMemberId(doc.belongs_to_member);

    // Load categories and members for the pickers
    try {
      const [cats, mems] = await Promise.all([
        fetchCategories(),
        fetchFamilyMembers(currentFamily.id),
      ]);
      setCategories(cats.map((c) => ({ id: c.id, name: c.name })));
      setMembers(mems.map((m) => ({
        id: m.id,
        name: m.alias || (m.users as any)?.display_name || (m.users as any)?.email || 'Member',
      })));
    } catch { /* use empty lists */ }

    setEditVisible(true);
  }, [doc, currentFamily]);

  const handleEditSave = useCallback(async () => {
    if (!doc || !currentFamily) return;
    setActionLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const updates: { fileName?: string; categoryId?: string; belongsToMember?: string } = {};
      if (editName && editName !== doc.file_name) updates.fileName = editName;
      if (editCategoryId && editCategoryId !== doc.category_id) updates.categoryId = editCategoryId;
      if (editMemberId && editMemberId !== doc.belongs_to_member) updates.belongsToMember = editMemberId;

      if (Object.keys(updates).length > 0) {
        await updateDocument(currentFamily.id, doc.id, user.id, updates);
        // Refresh document
        const updated = await fetchDocumentById(currentFamily.id, doc.id);
        if (updated) setDoc(updated);
      }
      setEditVisible(false);
    } catch (err: any) {
      Alert.alert('Update failed', err.message || 'Could not update document.');
    } finally {
      setActionLoading(false);
    }
  }, [doc, currentFamily, editName, editCategoryId, editMemberId]);

  const actionHandlers: Record<string, () => void> = {
    Share: handleShare,
    Download: handleDownload,
    Edit: openEditModal,
    Delete: handleDelete,
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#2A3D66" />
        </View>
      </SafeAreaView>
    );
  }

  if (!doc) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Feather name="arrow-left" size={24} color="#4B5563" />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Document</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.loaderWrap}>
          <Feather name="file-minus" size={48} color="#D1D5DB" />
          <Text style={styles.notFoundText}>Document not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const infoRows = [
    { label: 'Uploaded', value: formatDate(doc.created_at) },
    { label: 'File size', value: formatBytes(doc.file_size_bytes) },
    { label: 'Type', value: doc.file_type.toUpperCase() },
    ...(doc.category_name ? [{ label: 'Category', value: doc.category_name }] : []),
    ...(doc.uploader_name ? [{ label: 'Uploaded by', value: doc.uploader_name }] : []),
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={24} color="#4B5563" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>{doc.file_name}</Text>
        <TouchableOpacity style={styles.iconBtn}>
          <Feather name="more-vertical" size={24} color="#4B5563" />
        </TouchableOpacity>
      </View>

      {/* Tags */}
      <View style={styles.tagsRow}>
        {doc.category_name && (
          <View style={[styles.tag, styles.tagBlue]}>
            <Text style={[styles.tagText, styles.tagTextBlue]}>{doc.category_name}</Text>
          </View>
        )}
        {doc.member_name && (
          <View style={[styles.tag, styles.tagPurple]}>
            <Text style={[styles.tagText, styles.tagTextPurple]}>
              {doc.member_relationship || doc.member_name}
            </Text>
          </View>
        )}
        <View style={[styles.tag, styles.tagGray]}>
          <Text style={[styles.tagText, styles.tagTextGray]}>
            {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Document Preview */}
        <View style={styles.previewCard}>
          {previewLoading ? (
            <View style={styles.previewBody}>
              <ActivityIndicator size="large" color="#2A3D66" />
              <Text style={styles.previewSub}>Loading preview…</Text>
            </View>
          ) : previewError || !previewUrl ? (
            <View style={styles.previewBody}>
              <View style={styles.previewIconWrap}>
                <Feather name="file-text" size={48} color="#9CA3AF" />
              </View>
              <Text style={styles.previewTitle}>Preview unavailable</Text>
              <Text style={styles.previewSub}>{doc.file_name}</Text>
            </View>
          ) : isImageType(doc.file_type) ? (
            <Image
              source={{ uri: previewUrl }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          ) : doc.file_type === 'pdf' ? (
            <View style={styles.previewBody}>
              <View style={styles.previewIconWrap}>
                <Feather name="file-text" size={48} color="#DC2626" />
              </View>
              <Text style={styles.previewTitle}>PDF Document</Text>
              <Text style={styles.previewSub}>{doc.file_name}</Text>
              <TouchableOpacity
                style={styles.viewPdfBtn}
                onPress={() => {
                  if (!previewUrl) return;
                  if (Platform.OS === 'web') {
                    window.open(previewUrl, '_blank');
                  } else {
                    WebBrowser.openBrowserAsync(previewUrl);
                  }
                }}
              >
                <Feather name="external-link" size={16} color="#FFFFFF" />
                <Text style={styles.viewPdfBtnText}>Open PDF</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.previewBody}>
              <View style={styles.previewIconWrap}>
                <Feather name="file" size={48} color="#9CA3AF" />
              </View>
              <Text style={styles.previewTitle}>Document Preview</Text>
              <Text style={styles.previewSub}>{doc.file_name}</Text>
            </View>
          )}
        </View>

        {/* Document Info */}
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>Document Information</Text>
          {infoRows.map((row, idx) => (
            <View key={idx} style={[styles.infoRow, idx > 0 && styles.infoRowBorder]}>
              <Text style={styles.infoLabel}>{row.label}</Text>
              <Text style={styles.infoValue}>{row.value}</Text>
            </View>
          ))}
          {doc.member_name && (
            <View style={[styles.infoRow, styles.infoRowBorder]}>
              <Text style={styles.infoLabel}>Belongs to</Text>
              <View style={styles.ownerWrap}>
                <LinearGradient
                  colors={['#2A3D66', '#4A6491']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.ownerAvatar}
                >
                  <Text style={styles.ownerInitial}>{doc.member_name.charAt(0)}</Text>
                </LinearGradient>
                <Text style={styles.infoValue}>{doc.member_name}</Text>
              </View>
            </View>
          )}
          {/* Extracted metadata */}
          {doc.metadata && doc.metadata.length > 0 && (
            <>
              <Text style={[styles.cardTitle, { marginTop: 16 }]}>Extracted Data</Text>
              {doc.metadata.map((m, idx) => (
                <View key={idx} style={[styles.infoRow, idx > 0 && styles.infoRowBorder]}>
                  <Text style={styles.infoLabel}>{m.key.replace(/_/g, ' ')}</Text>
                  <Text style={styles.infoValue}>{m.value}</Text>
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>

      {/* Sticky Action Bar */}
      <View style={styles.actionBar}>
        {actions.map((action, idx) => (
          <TouchableOpacity
            key={idx}
            style={styles.actionItem}
            onPress={actionHandlers[action.label]}
            disabled={actionLoading}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: action.bg }]}>
              <Feather name={action.icon} size={20} color={action.color} />
            </View>
            <Text style={styles.actionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Loading overlay */}
      {actionLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}

      {/* Edit Modal */}
      <Modal visible={editVisible} animationType="slide" transparent>
        <Pressable style={styles.modalOverlay} onPress={() => setEditVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Edit Document</Text>

            {/* File name */}
            <Text style={styles.fieldLabel}>File Name</Text>
            <TextInput
              style={styles.textInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Document name"
              placeholderTextColor="#9CA3AF"
            />

            {/* Category picker */}
            {categories.length > 0 && (
              <>
                <Text style={styles.fieldLabel}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {categories.map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.chip, editCategoryId === cat.id && styles.chipActive]}
                      onPress={() => setEditCategoryId(cat.id)}
                    >
                      <Text style={[styles.chipText, editCategoryId === cat.id && styles.chipTextActive]}>
                        {cat.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            {/* Member picker */}
            {members.length > 0 && (
              <>
                <Text style={styles.fieldLabel}>Belongs To</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {members.map((mem) => (
                    <TouchableOpacity
                      key={mem.id}
                      style={[styles.chip, editMemberId === mem.id && styles.chipActive]}
                      onPress={() => setEditMemberId(mem.id)}
                    >
                      <Text style={[styles.chipText, editMemberId === mem.id && styles.chipTextActive]}>
                        {mem.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            {/* Save / Cancel */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleEditSave}
                disabled={actionLoading}
              >
                <Text style={styles.saveBtnText}>
                  {actionLoading ? 'Saving…' : 'Save Changes'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F9FC' },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  notFoundText: { fontSize: 16, fontWeight: '600', color: '#6B7280' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#2A3D66' },
  tagsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  tag: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  tagText: { fontSize: 13 },
  tagBlue: { backgroundColor: '#DBEAFE' },
  tagTextBlue: { color: '#1D4ED8' },
  tagPurple: { backgroundColor: '#EDE9FE' },
  tagTextPurple: { color: '#7C3AED' },
  tagGray: { backgroundColor: '#F3F4F6' },
  tagTextGray: { color: '#374151' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, gap: 16 },
  previewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
    boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.08)',
    elevation: 4,
  },
  previewBody: {
    aspectRatio: 3 / 4,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.08)',
    elevation: 3,
  },
  previewImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
  },
  viewPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2A3D66',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 16,
  },
  viewPdfBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  previewTitle: { fontSize: 17, fontWeight: '600', color: '#374151', marginBottom: 4 },
  previewSub: { fontSize: 13, color: '#9CA3AF' },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)',
    elevation: 3,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1F2937', marginBottom: 16 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  infoRowBorder: { borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  infoLabel: { fontSize: 13, color: '#6B7280', textTransform: 'capitalize' },
  infoValue: { fontSize: 13, fontWeight: '500', color: '#1F2937' },
  ownerWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ownerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerInitial: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  actionBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionItem: { flex: 1, alignItems: 'center', gap: 6 },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 11, color: '#374151' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
    marginTop: 16,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
  },
  chipScroll: { flexGrow: 0, marginBottom: 4 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  chipActive: { backgroundColor: '#2A3D66' },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#6B7280' },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2A3D66',
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
