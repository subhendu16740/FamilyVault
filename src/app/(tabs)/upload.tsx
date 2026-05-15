import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, ActivityIndicator, Image, Modal, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFamily } from '../../lib/family-context';
import { useAuth } from '../../lib/auth';
import { fetchCategories, uploadDocument } from '../../lib/api';
import { extractTextFromImage, isImageFile, type OcrProgress } from '../../lib/ocr';
import type { Database } from '../../lib/database.types';

type DocumentCategory = Database['public']['Tables']['document_categories']['Row'];

interface PickedFile {
  uri: string;
  name: string;
  type: string;       // 'pdf' | 'jpg' | 'jpeg' | 'png'
  mimeType: string;
  size: number;
}

function getFileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? 'unknown';
}

export default function UploadScreen() {
  const { user } = useAuth();
  const { currentFamily, members } = useFamily();
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [selectedPerson, setSelectedPerson] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ docId: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(console.error);
  }, []);

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

  // ─── File Pickers ─────────────────────────────────────────────

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const ext = getFileExtension(asset.name);

      const file: PickedFile = {
        uri: asset.uri,
        name: asset.name,
        type: ext,
        mimeType: asset.mimeType ?? `application/${ext}`,
        size: asset.size ?? 0,
      };
      setPickedFile(file);
      setOcrText(null);
      runOcr(file);
    } catch (err) {
      Alert.alert('Error', 'Failed to pick document.');
    }
  };

  const pickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera permission is required to scan documents.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });

    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';

    const file: PickedFile = {
      uri: asset.uri,
      name: `scan_${Date.now()}.${ext}`,
      type: ext,
      mimeType: `image/${ext}`,
      size: asset.fileSize ?? 0,
    };
    setPickedFile(file);
    setOcrText(null);
    runOcr(file);
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Gallery permission is required.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';

    const file: PickedFile = {
      uri: asset.uri,
      name: asset.fileName ?? `photo_${Date.now()}.${ext}`,
      type: ext,
      mimeType: `image/${ext}`,
      size: asset.fileSize ?? 0,
    };
    setPickedFile(file);
    setOcrText(null);
    runOcr(file);
  };

  // ─── OCR Processing ────────────────────────────────────────────

  const runOcr = async (file: PickedFile) => {
    if (!isImageFile(file.type)) return;
    setOcrRunning(true);
    setOcrProgress({ stage: 'loading', progress: 0 });
    try {
      const text = await extractTextFromImage(file.uri, setOcrProgress);
      setOcrText(text);
      console.log(`[OCR] Extracted ${text.length} chars from ${file.name}`);
    } catch (err) {
      console.warn('[OCR] Failed:', err);
      // Non-blocking — upload proceeds without OCR text
      setOcrText(null);
    } finally {
      setOcrRunning(false);
      setOcrProgress(null);
    }
  };

  // ─── Upload Handler ───────────────────────────────────────────

  const handleUpload = async () => {
    if (!pickedFile || !currentFamily || !user) {
      setErrorMsg('Missing file, family, or user session. Please try again.');
      return;
    }

    setUploading(true);
    try {
      // Fetch the file as a blob
      const response = await fetch(pickedFile.uri);
      const blob = await response.blob();

      const docId = await uploadDocument({
        familyId: currentFamily.id,
        storageNamespace: currentFamily.storage_namespace,
        userId: user.id,
        fileName: pickedFile.name,
        fileType: pickedFile.type,
        fileBlob: blob,
        fileSizeBytes: pickedFile.size || blob.size,
        categoryId: selectedCategory || undefined,
        belongsToMemberId: selectedPerson || undefined,
        ocrText: ocrText || undefined,
      });

      setUploadResult({ docId });
    } catch (err: any) {
      console.error('Upload error:', err);
      setErrorMsg(err.message ?? 'Something went wrong.');
    } finally {
      setUploading(false);
    }
  };

  // ─── Helpers ──────────────────────────────────────────────────

  const isImage = pickedFile && ['jpg', 'jpeg', 'png', 'heic'].includes(pickedFile.type);

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
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {!pickedFile ? (
          /* ─── Step 1: Choose Source ──────────────────────────── */
          <View style={styles.body}>
            <Text style={styles.sectionTitle}>Choose source</Text>

            <View style={styles.primaryActions}>
              <TouchableOpacity onPress={pickFromCamera} activeOpacity={0.85}>
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
                onPress={pickDocument}
                style={styles.primaryBtnOutline}
                activeOpacity={0.85}
              >
                <Feather name="folder" size={44} color="#2A3D66" />
                <Text style={styles.primaryBtnOutlineText}>Browse Files</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.secondaryActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={pickFromGallery}>
                <Feather name="image" size={28} color="#4B5563" />
                <Text style={styles.secondaryBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>

            {/* Supported formats hint */}
            <View style={styles.hintCard}>
              <Feather name="info" size={16} color="#6B7280" />
              <Text style={styles.hintText}>Supports PDF, PNG, JPG, JPEG</Text>
            </View>
          </View>
        ) : (
          /* ─── Step 2: Tag & Upload ──────────────────────────── */
          <View style={styles.body}>
            {/* File Preview */}
            <View style={styles.docPreview}>
              {isImage ? (
                <Image source={{ uri: pickedFile.uri }} style={styles.previewImage} resizeMode="contain" />
              ) : (
                <View style={styles.previewPlaceholder}>
                  <View style={styles.previewIconWrap}>
                    <Feather name="file-text" size={32} color="#2A3D66" />
                  </View>
                  <Text style={styles.previewLabel}>PDF Document</Text>
                </View>
              )}
            </View>

            {/* File info */}
            <View style={styles.fileInfoRow}>
              <Feather name={isImage ? 'image' : 'file-text'} size={16} color="#6B7280" />
              <Text style={styles.fileInfoName} numberOfLines={1}>{pickedFile.name}</Text>
              <Text style={styles.fileInfoSize}>
                {pickedFile.size > 1024 * 1024
                  ? `${(pickedFile.size / (1024 * 1024)).toFixed(1)} MB`
                  : `${Math.round(pickedFile.size / 1024)} KB`}
              </Text>
            </View>

            {/* OCR Progress */}
            {ocrRunning && ocrProgress && (
              <View style={styles.ocrCard}>
                <View style={styles.ocrHeader}>
                  <ActivityIndicator size="small" color="#2A3D66" />
                  <Text style={styles.ocrLabel}>
                    {ocrProgress.stage === 'loading' ? 'Loading OCR engine...' :
                     ocrProgress.stage === 'recognizing' ? 'Reading text from image...' : 'Done'}
                  </Text>
                </View>
                <View style={styles.ocrBarBg}>
                  <View style={[styles.ocrBarFill, { width: `${Math.round(ocrProgress.progress * 100)}%` }]} />
                </View>
              </View>
            )}

            {/* OCR Complete */}
            {!ocrRunning && ocrText && ocrText.length > 0 && (
              <View style={styles.ocrDoneCard}>
                <Feather name="check-circle" size={16} color="#16A34A" />
                <Text style={styles.ocrDoneText}>
                  Text extracted ({ocrText.length} characters)
                </Text>
              </View>
            )}

            {/* Change file */}
            <TouchableOpacity
              style={styles.changeFileBtn}
              onPress={() => { setPickedFile(null); setOcrText(null); setOcrProgress(null); }}
            >
              <Feather name="refresh-cw" size={14} color="#2A3D66" />
              <Text style={styles.changeFileBtnText}>Choose different file</Text>
            </TouchableOpacity>

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
              {categories.slice(0, 12).map((cat) => (
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

            {/* Upload Button */}
            <TouchableOpacity
              activeOpacity={0.85}
              style={{ marginTop: 32 }}
              onPress={handleUpload}
              disabled={uploading || ocrRunning}
            >
              <LinearGradient
                colors={['#2A3D66', '#4A6491']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.saveBtn, uploading && styles.saveBtnDisabled]}
              >
                {uploading ? (
                  <View style={styles.uploadingRow}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text style={styles.saveBtnText}>Uploading...</Text>
                  </View>
                ) : (
                  <Text style={styles.saveBtnText}>Save to Vault</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Success Dialog */}
      <Modal visible={!!uploadResult} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => {}}>
          <View style={styles.dialog}>
            <View style={styles.dialogIconWrap}>
              <Feather name="check-circle" size={40} color="#22C55E" />
            </View>
            <Text style={styles.dialogTitle}>Uploaded!</Text>
            <Text style={styles.dialogMsg}>Document saved to your vault.</Text>
            <View style={styles.dialogBtns}>
              <TouchableOpacity
                style={styles.dialogBtnOutline}
                onPress={() => {
                  const docId = uploadResult?.docId;
                  setUploadResult(null);
                  setPickedFile(null);
                  if (docId) router.push(`/document/${docId}` as any);
                }}
              >
                <Text style={styles.dialogBtnOutlineText}>View</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dialogBtnFilled}
                onPress={() => { setUploadResult(null); setPickedFile(null); }}
              >
                <Text style={styles.dialogBtnFilledText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Error Dialog */}
      <Modal visible={!!errorMsg} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setErrorMsg(null)}>
          <View style={styles.dialog}>
            <View style={styles.dialogIconWrap}>
              <Feather name="alert-circle" size={40} color="#EF4444" />
            </View>
            <Text style={styles.dialogTitle}>Upload Failed</Text>
            <Text style={styles.dialogMsg}>{errorMsg}</Text>
            <TouchableOpacity
              style={styles.dialogBtnFilled}
              onPress={() => setErrorMsg(null)}
            >
              <Text style={styles.dialogBtnFilledText}>OK</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────

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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { padding: 4 },
  title: { fontSize: 22, fontWeight: '700', color: '#2A3D66' },
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
    boxShadow: '0px 4px 10px rgba(42, 61, 102, 0.25)',
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
  secondaryActions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    minHeight: 80,
    justifyContent: 'center',
    boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.05)',
    elevation: 2,
  },
  secondaryBtnText: { fontSize: 12, color: '#374151' },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 12,
  },
  hintText: { fontSize: 13, color: '#6B7280' },
  docPreview: {
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    height: 220,
    overflow: 'hidden',
    marginBottom: 12,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  fileInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 8,
  },
  fileInfoName: { flex: 1, fontSize: 14, fontWeight: '500', color: '#1F2937' },
  fileInfoSize: { fontSize: 12, color: '#9CA3AF' },
  ocrCard: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 10,
  },
  ocrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ocrLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#2A3D66',
  },
  ocrBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(42, 61, 102, 0.15)',
    overflow: 'hidden',
  },
  ocrBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#2A3D66',
  },
  ocrDoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  ocrDoneText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#16A34A',
  },
  changeFileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginBottom: 24,
  },
  changeFileBtnText: { fontSize: 13, color: '#2A3D66', fontWeight: '500' },
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
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  dialogIconWrap: { marginBottom: 16 },
  dialogTitle: { fontSize: 20, fontWeight: '700', color: '#1F2937', marginBottom: 8 },
  dialogMsg: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 24 },
  dialogBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  dialogBtnOutline: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#2A3D66',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  dialogBtnOutlineText: { fontSize: 15, fontWeight: '600', color: '#2A3D66' },
  dialogBtnFilled: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#2A3D66',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  dialogBtnFilledText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
