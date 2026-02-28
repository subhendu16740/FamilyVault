import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamily } from '../../lib/family-context';
import { fetchCategories } from '../../lib/api';
import type { Database } from '../../lib/database.types';

type UploadStep = 'source' | 'tag' | 'offline';
type DocumentCategory = Database['public']['Tables']['document_categories']['Row'];

export default function UploadScreen() {
  const { members } = useFamily();
  const [step, setStep] = useState<UploadStep>('source');
  const [selectedPerson, setSelectedPerson] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories] = useState<DocumentCategory[]>([]);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(console.error);
  }, []);

  // Set default selection when members load
  useEffect(() => {
    if (members.length > 0 && !selectedPerson) {
      setSelectedPerson(members[0].id);
    }
  }, [members]);

  useEffect(() => {
    if (categories.length > 0 && !selectedCategory) {
      setSelectedCategory(categories[0].id);
    }
  }, [categories]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={24} color="#4B5563" />
          </TouchableOpacity>
          <Text style={styles.title}>Upload Document</Text>
        </View>

        {/* Step tabs */}
        <View style={styles.stepTabs}>
          {(['source', 'tag', 'offline'] as UploadStep[]).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setStep(s)}
              style={[
                styles.stepTab,
                step === s && (s === 'offline' ? styles.stepTabAmber : styles.stepTabBlue),
              ]}
            >
              <Text style={[
                styles.stepTabText,
                step === s && (s === 'offline' ? styles.stepTabTextAmber : styles.stepTabTextBlue),
              ]}>
                {s === 'source' ? 'Step 1: Source' : s === 'tag' ? 'Step 2: Tag' : 'Offline'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Step 1: Source */}
        {step === 'source' && (
          <View style={styles.body}>
            <Text style={styles.sectionTitle}>Choose source</Text>

            <View style={styles.primaryActions}>
              <TouchableOpacity onPress={() => setStep('tag')} activeOpacity={0.85}>
                <LinearGradient
                  colors={['#2A3D66', '#4A6491']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.primaryBtn}
                >
                  <Feather name="camera" size={44} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Scan</Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setStep('tag')}
                style={styles.primaryBtnOutline}
                activeOpacity={0.85}
              >
                <Feather name="folder" size={44} color="#2A3D66" />
                <Text style={styles.primaryBtnOutlineText}>Browse Files</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.secondaryActions}>
              {[
                { icon: 'image', label: 'Gallery' },
                { icon: 'cloud', label: 'Cloud' },
                { icon: 'clock', label: 'Recent' },
              ].map((item, idx) => (
                <TouchableOpacity key={idx} style={styles.secondaryBtn}>
                  <Feather name={item.icon as any} size={28} color="#4B5563" />
                  <Text style={styles.secondaryBtnText}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Step 2: Tag */}
        {step === 'tag' && (
          <View style={styles.body}>
            {/* Preview */}
            <View style={styles.docPreview}>
              <View style={styles.previewIconWrap}>
                <Feather name="folder" size={32} color="#9CA3AF" />
              </View>
              <Text style={styles.previewLabel}>Document Preview</Text>
            </View>

            {/* AI Auto-detected */}
            <View style={styles.aiCard}>
              <View style={styles.aiCardHeader}>
                <Feather name="check-circle" size={18} color="#15803D" />
                <Text style={styles.aiCardTitle}>AI AUTO-DETECTED</Text>
              </View>
              <View style={styles.aiRows}>
                {[
                  { label: 'Type:', value: 'Passport' },
                  { label: 'Person:', value: 'Rahul' },
                  { label: 'Expiry:', value: '2034' },
                ].map((row, idx) => (
                  <View key={idx} style={styles.aiRow}>
                    <Text style={styles.aiRowLabel}>{row.label}</Text>
                    <Text style={styles.aiRowValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Owner */}
            <Text style={styles.sectionTitle}>Who does this belong to?</Text>
            <View style={styles.chipsWrap}>
              {members.map((m) => {
                const label = m.alias || m.users.display_name;
                const sub = m.relationship ? ` (${m.relationship})` : '';
                return (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => setSelectedPerson(m.id)}
                    style={[
                      styles.chip,
                      selectedPerson === m.id && styles.chipSelected,
                    ]}
                  >
                    {selectedPerson === m.id && (
                      <Feather name="check" size={14} color="#FFFFFF" style={styles.chipCheck} />
                    )}
                    <Text style={[
                      styles.chipText,
                      selectedPerson === m.id && styles.chipTextSelected,
                    ]}>
                      {label}{sub}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Category */}
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Category</Text>
            <View style={styles.chipsWrap}>
              {categories.slice(0, 10).map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => setSelectedCategory(cat.id)}
                  style={[
                    styles.chip,
                    selectedCategory === cat.id && styles.chipSelected,
                  ]}
                >
                  <Text style={[
                    styles.chipText,
                    selectedCategory === cat.id && styles.chipTextSelected,
                  ]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Save */}
            <TouchableOpacity activeOpacity={0.85} style={{ marginTop: 32 }}>
              <LinearGradient
                colors={['#2A3D66', '#4A6491']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.saveBtn}
              >
                <Text style={styles.saveBtnText}>Save to Vault</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* Offline State */}
        {step === 'offline' && (
          <View style={styles.body}>
            <View style={styles.offlineCard}>
              <Feather name="wifi-off" size={48} color="#D97706" style={{ alignSelf: 'center', marginBottom: 16 }} />
              <Text style={styles.offlineTitle}>Upload requires internet connection</Text>
              <Text style={styles.offlineSubtitle}>Connect to wifi to upload documents</Text>
            </View>

            <View style={styles.primaryActions}>
              <View style={[styles.primaryBtn, styles.disabledBtn]}>
                <Feather name="camera" size={44} color="#9CA3AF" />
                <Text style={styles.disabledBtnText}>Scan</Text>
              </View>
              <View style={[styles.primaryBtnOutline, styles.disabledBtnOutline]}>
                <Feather name="folder" size={44} color="#9CA3AF" />
                <Text style={styles.disabledBtnText}>Browse Files</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
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
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  backBtn: { padding: 4 },
  title: { fontSize: 22, fontWeight: '700', color: '#2A3D66' },
  stepTabs: { flexDirection: 'row', gap: 8 },
  stepTab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    minHeight: 44,
    justifyContent: 'center',
  },
  stepTabBlue: { backgroundColor: '#EFF6FF' },
  stepTabAmber: { backgroundColor: '#FFFBEB' },
  stepTabText: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  stepTabTextBlue: { color: '#2A3D66' },
  stepTabTextAmber: { color: '#B45309' },
  scroll: { flex: 1 },
  body: { padding: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1F2937', marginBottom: 16 },
  primaryActions: { flexDirection: 'row', gap: 16, marginBottom: 16 },
  primaryBtn: {
    flex: 1,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 160,
    shadowColor: '#2A3D66',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  primaryBtnOutline: {
    flex: 1,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 160,
    borderWidth: 2,
    borderColor: '#2A3D66',
    backgroundColor: '#FFFFFF',
  },
  primaryBtnOutlineText: { color: '#2A3D66', fontWeight: '600', fontSize: 16 },
  secondaryActions: { flexDirection: 'row', gap: 12 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    minHeight: 100,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  secondaryBtnText: { fontSize: 12, color: '#374151' },
  docPreview: {
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    height: 192,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  previewIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  previewLabel: { fontSize: 13, color: '#9CA3AF' },
  aiCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  aiCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  aiCardTitle: { fontSize: 12, fontWeight: '700', color: '#14532D' },
  aiRows: { gap: 8 },
  aiRow: { flexDirection: 'row', justifyContent: 'space-between' },
  aiRowLabel: { fontSize: 13, color: '#15803D' },
  aiRowValue: { fontSize: 13, fontWeight: '700', color: '#14532D' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 44,
  },
  chipSelected: { backgroundColor: '#2A3D66', borderColor: '#2A3D66' },
  chipCheck: { marginRight: 4 },
  chipText: { fontSize: 13, fontWeight: '500', color: '#374151' },
  chipTextSelected: { color: '#FFFFFF' },
  saveBtn: {
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  offlineCard: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 20,
    padding: 24,
    marginBottom: 24,
  },
  offlineTitle: { fontSize: 15, fontWeight: '600', color: '#92400E', textAlign: 'center', marginBottom: 8 },
  offlineSubtitle: { fontSize: 13, color: '#B45309', textAlign: 'center' },
  disabledBtn: {
    backgroundColor: '#E5E7EB',
    shadowOpacity: 0,
    elevation: 0,
  },
  disabledBtnOutline: {
    borderColor: '#D1D5DB',
    backgroundColor: '#E5E7EB',
  },
  disabledBtnText: { color: '#9CA3AF', fontWeight: '600', fontSize: 16 },
});
