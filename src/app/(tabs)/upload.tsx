import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, ActivityIndicator, Image, Modal, Pressable, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFamily } from '../../lib/family-context';
import { useDocumentOwners } from '../../lib/family-people';
import { useAuth } from '../../lib/auth';
import { StorageFullError, fetchCategories, uploadDocument } from '../../lib/api';
import {
  extractTextFromImage, isImageFile, ocrLanguageGapOnThisDevice, type OcrProgress,
} from '../../lib/ocr';
import { usePreferences } from '../../lib/preferences';
import { describeOcrLanguages } from '../../lib/ocr-languages';
import {
  detectFileType, isSaveable, mimeTypeFor, nameWithType, unsupportedFileMessage, type SaveableType,
} from '../../lib/file-types';
import type { Database } from '../../lib/database.types';
import { ScreenHeader, PlusTag } from '../../components/screen-header';
import { color, radius, shadow, size, space, type } from '../../constants/design';

type DocumentCategory = Database['public']['Tables']['document_categories']['Row'];

interface PickedFile {
  uri: string;
  name: string;
  type: SaveableType;
  mimeType: string;
  size: number;
}

export default function UploadScreen() {
  const { user } = useAuth();
  const { currentFamily } = useFamily();
  // Everyone in the family tree (you first); the members, before migration 031.
  const owners = useDocumentOwners();
  // From a person's page: "Add a document for Nani".
  const { person } = useLocalSearchParams<{ person?: string }>();
  const { documentLanguages } = usePreferences();
  // Shown while scanning, so it is obvious which languages are being read —
  // and obvious what to change in Settings if a page comes back as nonsense.
  const languageLabel = describeOcrLanguages(documentLanguages);
  // Non-empty only on a phone app whose bundled recogniser cannot read a
  // script the person selected.
  const languageGap = ocrLanguageGapOnThisDevice(documentLanguages);
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [selectedPerson, setSelectedPerson] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ docId: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Says which wall was hit: the family's storage limit (038), or anything else.
  const [storageFull, setStorageFull] = useState(false);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(console.error);
  }, []);

  useEffect(() => {
    if (person && owners.some((o) => o.id === person)) setSelectedPerson(person);
    else if (owners.length > 0 && !owners.some((o) => o.id === selectedPerson)) setSelectedPerson(owners[0].id);
  }, [owners, person]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (categories.length > 0 && !selectedCategory) {
      setSelectedCategory(categories[0].id);
    }
  }, [categories]);

  // ─── File Pickers ─────────────────────────────────────────────

  // Every picker's result goes through here, so they cannot disagree about
  // what a file is. The type comes from its MIME type or name, never from a
  // web blob: uri (see file-types.ts), and a file the vault cannot keep is
  // turned away now rather than failing at Save.
  const takeFile = (
    picked: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null },
    fallbackStem: string,
  ) => {
    const kind = detectFileType(picked);
    if (!isSaveable(kind)) {
      setStorageFull(false);
      setErrorMsg(unsupportedFileMessage(kind));
      return;
    }
    const file: PickedFile = {
      uri: picked.uri,
      name: nameWithType(picked.name, kind, fallbackStem),
      type: kind,
      mimeType: mimeTypeFor(kind),
      size: picked.size ?? 0,
    };
    setPickedFile(file);
    setOcrText(null);
    runOcr(file);
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      takeFile(
        { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size },
        `document_${Date.now()}`,
      );
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
    takeFile(
      { uri: asset.uri, name: null, mimeType: asset.mimeType, size: asset.fileSize },
      `scan_${Date.now()}`,
    );
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
    takeFile(
      { uri: asset.uri, name: asset.fileName, mimeType: asset.mimeType, size: asset.fileSize },
      `photo_${Date.now()}`,
    );
  };

  // ─── OCR Processing ────────────────────────────────────────────

  const runOcr = async (file: PickedFile) => {
    if (!isImageFile(file.type)) return;
    setOcrRunning(true);
    setOcrProgress({ stage: 'loading', progress: 0 });
    try {
      const text = await extractTextFromImage(file.uri, setOcrProgress, documentLanguages);
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
      setStorageFull(false);
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
      setStorageFull(err instanceof StorageFullError);
      setErrorMsg(err.message ?? 'Something went wrong.');
    } finally {
      setUploading(false);
    }
  };

  // ─── Helpers ──────────────────────────────────────────────────

  const isImage = pickedFile && ['jpg', 'jpeg', 'png', 'heic'].includes(pickedFile.type);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Upload Document" />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {!pickedFile ? (
          /* ─── Step 1: Choose Source ──────────────────────────── */
          <View style={styles.body}>
            <Text style={styles.sectionTitle}>Choose source</Text>

            <View style={styles.primaryActions}>
              <TouchableOpacity onPress={pickFromCamera} activeOpacity={0.85} style={styles.scanTouch}>
                <LinearGradient
                  colors={['#2A3D66', '#4A6491']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.primaryBtn}
                >
                  <Feather name="camera" size={28} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Scan</Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={pickDocument}
                style={styles.primaryBtnOutline}
                activeOpacity={0.85}
              >
                <Feather name="folder" size={28} color={color.primary} />
                <Text style={styles.primaryBtnOutlineText}>Browse Files</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.secondaryActions}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={pickFromGallery}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <Feather name="image" size={22} color={color.primary} />
                <Text style={styles.secondaryBtnText}>Gallery</Text>
              </TouchableOpacity>
              {/* Web only: connecting Gmail from the phone app needs a native
                  auth session, not built yet (see gmail-import.tsx).
                  ★: part of Family Plus, the paid plan. It works for everyone
                  until the plan exists; the tag sits under the label. */}
              {Platform.OS === 'web' && (
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => router.push('/gmail-import' as any)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="From Gmail, part of Family Plus"
                >
                  <Feather name="mail" size={22} color={color.primary} />
                  <Text style={styles.secondaryBtnText}>From Gmail</Text>
                  <PlusTag />
                </TouchableOpacity>
              )}
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

            {/* This build cannot read a script the person chose */}
            {languageGap.length > 0 && (
              <View style={styles.ocrGapCard}>
                <Feather name="alert-triangle" size={16} color="#9A6200" />
                <Text style={styles.ocrGapText}>
                  This app can't read {languageGap.map(l => l.english).join(', ')} yet.
                  Scanning still works, but only the English on the page will be found.
                </Text>
              </View>
            )}

            {/* OCR Progress */}
            {ocrRunning && ocrProgress && (
              <View style={styles.ocrCard}>
                <View style={styles.ocrHeader}>
                  <ActivityIndicator size="small" color="#2A3D66" />
                  <Text style={styles.ocrLabel}>
                    {ocrProgress.downloading ? `Getting ${languageLabel} language data...` :
                     ocrProgress.stage === 'loading' ? 'Loading OCR engine...' :
                     ocrProgress.stage === 'recognizing' ? `Reading ${languageLabel} text from image...` : 'Done'}
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
              <Feather name="refresh-cw" size={16} color={color.primary} />
              <Text style={styles.changeFileBtnText}>Choose different file</Text>
            </TouchableOpacity>

            {/* Owner */}
            <Text style={styles.sectionTitle}>Who does this belong to?</Text>
            <View style={styles.chipsWrap}>
              {owners.map((o) => {
                const sub = o.label ? ` (${o.label})` : '';
                return (
                  <TouchableOpacity
                    key={o.id}
                    onPress={() => setSelectedPerson(o.id)}
                    style={[
                      styles.chip,
                      selectedPerson === o.id && styles.chipSelected,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: selectedPerson === o.id }}
                  >
                    {selectedPerson === o.id && (
                      <Feather name="check" size={14} color="#FFFFFF" style={styles.chipCheck} />
                    )}
                    <Text style={[
                      styles.chipText,
                      selectedPerson === o.id && styles.chipTextSelected,
                    ]}>
                      {o.name}{sub}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Category */}
            <Text style={[styles.sectionTitle, styles.sectionTitleLater]}>Category</Text>
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
              style={styles.saveBtnWrap}
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
              <Feather name="check-circle" size={32} color="#22C55E" />
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
              <Feather name="alert-circle" size={32} color="#EF4444" />
            </View>
            <Text style={styles.dialogTitle}>{storageFull ? 'Storage full' : 'Upload Failed'}</Text>
            <Text style={styles.dialogMsg}>{errorMsg}</Text>
            <TouchableOpacity
              style={styles.dialogBtnWide}
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
  safe: { flex: 1, backgroundColor: color.background },
  scroll: { flex: 1 },
  body: { padding: space.lg },
  sectionTitle: { ...type.heading, marginBottom: space.md },
  sectionTitleLater: { marginTop: space.xl },
  primaryActions: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  // Scan narrow, Browse Files wide, 2 to 5. The first version looked like this
  // by accident — Scan's wrapper had no flex, so it shrank to its label — and
  // people liked it; the ratio makes it hold on every screen width.
  scanTouch: { flex: 2 },
  primaryBtn: {
    flex: 1,
    borderRadius: radius.card,
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 112,
    boxShadow: '0px 2px 8px rgba(42, 61, 102, 0.2)',
    elevation: 3,
  },
  primaryBtnText: { ...type.button, color: '#FFFFFF' },
  primaryBtnOutline: {
    flex: 5,
    borderRadius: radius.card,
    padding: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 112,
    borderWidth: 1,
    borderColor: color.primary,
    backgroundColor: color.surface,
  },
  primaryBtnOutlineText: { ...type.button, color: color.primary },
  secondaryActions: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  secondaryBtn: {
    flex: 1,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 80,
    ...shadow.card,
  },
  secondaryBtnText: type.label,
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.divider,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: space.md,
  },
  hintText: type.caption,
  docPreview: {
    backgroundColor: color.divider,
    borderRadius: radius.card,
    height: 200,
    overflow: 'hidden',
    marginBottom: space.md,
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
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  previewLabel: type.caption,
  fileInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.surface,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: color.border,
    marginBottom: space.sm,
  },
  fileInfoName: { ...type.label, flex: 1 },
  fileInfoSize: type.meta,
  ocrCard: {
    backgroundColor: color.tint,
    borderRadius: 10,
    padding: space.md,
    marginBottom: space.sm,
    gap: 10,
  },
  ocrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  ocrLabel: { ...type.caption, fontWeight: '500', color: color.primary },
  ocrGapCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: '#FFF7E6',
    borderWidth: 1,
    borderColor: '#F5D9A0',
    borderRadius: 10,
    padding: space.md,
    marginTop: space.md,
  },
  ocrGapText: { ...type.caption, flex: 1, color: '#7A5200' },
  ocrBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(42, 61, 102, 0.15)',
    overflow: 'hidden',
  },
  ocrBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: color.primary,
  },
  ocrDoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    marginBottom: space.sm,
  },
  ocrDoneText: { ...type.caption, fontWeight: '500', color: '#16A34A' },
  changeFileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    minHeight: size.control,
    marginBottom: space.md,
  },
  changeFileBtnText: { ...type.label, color: color.primary },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.inputBorder,
    minHeight: 40,
  },
  chipSelected: { backgroundColor: color.primary, borderColor: color.primary },
  chipCheck: { marginRight: space.xs },
  chipText: { fontSize: 14, lineHeight: 20, fontWeight: '500', color: color.textBody },
  chipTextSelected: { color: '#FFFFFF' },
  saveBtnWrap: { marginTop: space.xl },
  saveBtn: {
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { ...type.button, color: '#FFFFFF' },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xl,
  },
  dialog: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.xl,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  dialogIconWrap: { marginBottom: space.md },
  dialogTitle: { ...type.title, color: color.text, marginBottom: space.xs },
  dialogMsg: { ...type.body, color: color.textMuted, textAlign: 'center', marginBottom: space.xl },
  dialogBtns: { flexDirection: 'row', gap: space.md, width: '100%' },
  dialogBtnOutline: {
    flex: 1,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
  },
  dialogBtnOutlineText: { ...type.button, color: color.primary },
  dialogBtnFilled: {
    flex: 1,
    borderRadius: radius.control,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
  },
  dialogBtnWide: {
    alignSelf: 'stretch',
    borderRadius: radius.control,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
  },
  dialogBtnFilledText: { ...type.button, color: '#FFFFFF' },
});
