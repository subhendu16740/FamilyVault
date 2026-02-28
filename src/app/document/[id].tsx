import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamily } from '../../lib/family-context';
import { fetchDocumentById } from '../../lib/api';
import type { FamilyDocumentDetailRow } from '../../lib/database.types';

const actions = [
  { icon: 'share-2', label: 'Share', bg: '#EFF6FF', color: '#2563EB' },
  { icon: 'download', label: 'Download', bg: '#F0FDF4', color: '#16A34A' },
  { icon: 'edit-3', label: 'Edit', bg: '#FFFBEB', color: '#D97706' },
  { icon: 'trash-2', label: 'Delete', bg: '#FEF2F2', color: '#DC2626' },
] as const;

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

  useEffect(() => {
    if (!currentFamily || !id) return;
    setLoading(true);
    fetchDocumentById(currentFamily.id, id)
      .then(setDoc)
      .catch((err) => console.error('Doc fetch error:', err))
      .finally(() => setLoading(false));
  }, [currentFamily?.id, id]);

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
          <View style={styles.previewBody}>
            <View style={styles.previewIconWrap}>
              <Feather name="file-text" size={48} color="#9CA3AF" />
            </View>
            <Text style={styles.previewTitle}>Document Preview</Text>
            <Text style={styles.previewSub}>{doc.file_name}</Text>
          </View>
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
          <TouchableOpacity key={idx} style={styles.actionItem}>
            <View style={[styles.actionIconWrap, { backgroundColor: action.bg }]}>
              <Feather name={action.icon} size={20} color={action.color} />
            </View>
            <Text style={styles.actionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  previewTitle: { fontSize: 17, fontWeight: '600', color: '#374151', marginBottom: 4 },
  previewSub: { fontSize: 13, color: '#9CA3AF' },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
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
});
