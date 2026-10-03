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
import { useDocumentOwners } from '../../lib/family-people';
import {
  fetchDocumentById, getDocumentSignedUrl, deleteDocument,
  updateDocument, fetchCategories,
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import type { FamilyDocumentDetailRow } from '../../lib/database.types';
import { ScreenHeader } from '../../components/screen-header';
import { ShareSheet } from '../../components/share-sheet';
import { color, radius, shadow, size, space, type } from '../../constants/design';

// Share makes a link that expires (036) for the web app's /s page, which
// only the web app knows the address of: not offered in the phone app yet.
const actions = [
  ...(Platform.OS === 'web' ? [{ icon: 'share-2', label: 'Share', bg: '#EFF6FF', color: '#2563EB' }] as const : []),
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
  const owners = useDocumentOwners();
  const [doc, setDoc] = useState<FamilyDocumentDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);

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

  // A link that expires, made and turned off in the sheet (036). Before it,
  // Share sent the file's raw storage address, which died after an hour
  // without saying so and could not be turned off.
  const handleShare = useCallback(() => setShareVisible(true), []);

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
        // Opened from a link there is no history, and staying on a document
        // that no longer exists is the worst place to be left.
        if (router.canGoBack()) router.back();
        else router.replace('/home' as any);
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

    // Everyone in the family tree can own a document; the members, before 031.
    setMembers(owners.map((o) => ({ id: o.id, name: o.isMe ? `${o.name} (me)` : o.name })));
    try {
      const cats = await fetchCategories();
      setCategories(cats.map((c) => ({ id: c.id, name: c.name })));
    } catch { /* use an empty list */ }

    setEditVisible(true);
  }, [doc, currentFamily, owners]);

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
    // Back even while loading: without a current family this never finishes,
    // and a spinner with no way out is a dead end.
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Document" />
        <View style={styles.loaderWrap}>
          <ActivityIndicator color={color.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!doc) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Document" />
        <View style={styles.loaderWrap}>
          <Feather name="file-minus" size={32} color="#D1D5DB" />
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
      <ScreenHeader title={doc.file_name} titleLines={2} />

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
              <ActivityIndicator color={color.primary} />
              <Text style={styles.previewSub}>Loading preview…</Text>
            </View>
          ) : previewError || !previewUrl ? (
            <View style={styles.previewBody}>
              <View style={styles.previewIconWrap}>
                <Feather name="file-text" size={32} color="#9CA3AF" />
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
                <Feather name="file-text" size={32} color="#DC2626" />
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
                <Feather name="file" size={32} color="#9CA3AF" />
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
              <Text style={[styles.cardTitle, styles.cardTitleLater]}>Extracted Data</Text>
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
              <Feather name={action.icon} size={18} color={action.color} />
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

      {currentFamily && (
        <ShareSheet
          visible={shareVisible}
          onClose={() => setShareVisible(false)}
          familyId={currentFamily.id}
          documentId={doc.id}
          fileName={doc.file_name}
        />
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
  safe: { flex: 1, backgroundColor: color.background },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  notFoundText: { ...type.heading, color: color.textMuted },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  tag: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  tagText: { fontSize: 13, lineHeight: 18 },
  tagBlue: { backgroundColor: '#DBEAFE' },
  tagTextBlue: { color: '#1D4ED8' },
  tagPurple: { backgroundColor: '#EDE9FE' },
  tagTextPurple: { color: '#7C3AED' },
  tagGray: { backgroundColor: color.divider },
  tagTextGray: { color: color.textBody },
  scroll: { flex: 1 },
  scrollContent: { padding: space.lg, gap: space.md },
  previewCard: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
    ...shadow.card,
  },
  // Sized to what it holds. The 3:4 frame is for a real preview; around a
  // spinner or a "Preview unavailable" icon it was half a screen of grey.
  previewBody: {
    minHeight: 200,
    backgroundColor: color.divider,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
  },
  previewIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
    ...shadow.card,
  },
  previewImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: color.divider,
  },
  viewPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.primary,
    paddingHorizontal: space.lg,
    minHeight: size.control,
    borderRadius: radius.control,
    marginTop: space.lg,
  },
  viewPdfBtnText: { ...type.button, color: '#FFFFFF' },
  previewTitle: { ...type.heading, color: color.textBody, marginBottom: 2 },
  previewSub: { ...type.caption, textAlign: 'center' },
  infoCard: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg,
    ...shadow.card,
  },
  cardTitle: { ...type.heading, marginBottom: space.xs },
  cardTitleLater: { marginTop: space.lg },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingVertical: 10,
  },
  infoRowBorder: { borderTopWidth: 1, borderTopColor: color.divider },
  infoLabel: { ...type.body, color: color.textMuted, textTransform: 'capitalize' },
  infoValue: { ...type.label, flexShrink: 1, textAlign: 'right' },
  ownerWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  ownerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerInitial: { fontSize: 12, fontWeight: '600', color: '#FFFFFF' },
  actionBar: {
    flexDirection: 'row',
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  actionItem: { flex: 1, alignItems: 'center', gap: space.xs, minHeight: size.control },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 12, lineHeight: 16, color: color.textBody },
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
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: space.lg,
    paddingBottom: space.xl,
    maxHeight: '80%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.inputBorder,
    alignSelf: 'center',
    marginBottom: space.md,
  },
  modalTitle: { ...type.title, color: color.text, marginBottom: space.xs },
  fieldLabel: {
    ...type.caption,
    fontWeight: '500',
    color: color.textBody,
    marginBottom: 6,
    marginTop: space.md,
  },
  textInput: {
    minHeight: size.control,
    borderWidth: 1,
    borderColor: color.inputBorder,
    borderRadius: 10,
    paddingHorizontal: space.md,
    fontSize: type.body.fontSize,
    color: color.text,
    backgroundColor: color.surface,
  },
  chipScroll: { flexGrow: 0, marginBottom: space.xs },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: color.divider,
    marginRight: space.sm,
  },
  chipActive: { backgroundColor: color.primary },
  chipText: { fontSize: 14, lineHeight: 20, color: color.textBody },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  modalActions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.xl,
  },
  cancelBtn: {
    flex: 1,
    minHeight: size.control,
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.inputBorder,
    alignItems: 'center',
  },
  cancelBtnText: { ...type.button, color: color.textBody },
  saveBtn: {
    flex: 1,
    minHeight: size.control,
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: color.primary,
    alignItems: 'center',
  },
  saveBtnText: { ...type.button, color: '#FFFFFF' },
});
