import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Switch, Modal, Pressable,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import { usePreferences } from '../lib/preferences';
import { indexStatus, type IndexStatus } from '../lib/api';
import { VOICE_LANGUAGES, voiceLanguage } from '../lib/voice-languages';
import { OCR_LANGUAGES, describeOcrLanguages } from '../lib/ocr-languages';
import { hasVoiceFor } from '../lib/speech';

const settingsGroups = [
  {
    title: 'Account',
    items: [
      { icon: 'user', label: 'Profile', sub: 'Edit your name and photo' },
      { icon: 'shield', label: 'Security', sub: 'Password & biometrics' },
      { icon: 'bell', label: 'Notifications', sub: 'Expiry alerts and reminders' },
    ],
  },
  {
    title: 'Vault',
    items: [
      { icon: 'users', label: 'Manage Families', sub: 'View and switch families' },
      { icon: 'lock', label: 'Privacy', sub: 'Data isolation settings' },
      { icon: 'cloud', label: 'Storage', sub: 'Manage cloud backup' },
    ],
  },
  {
    title: 'Support',
    items: [
      { icon: 'help-circle', label: 'Help & FAQ', sub: 'How FamilyVault works' },
      { icon: 'info', label: 'About', sub: 'Version 1.0.0' },
    ],
  },
];

/** Supabase function errors arrive in several shapes; show something a person can read. */
function readableError(err: unknown): string {
  const message = (err as { message?: string })?.message ?? String(err);
  if (/not a member|admin/i.test(message)) return 'Only a family admin can update this';
  return message.slice(0, 80);
}

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { membership, currentFamily } = useFamily();
  const {
    voiceMode, voiceLanguage: voiceLang, documentLanguages,
    setVoiceMode, setVoiceLanguage, setDocumentLanguages,
  } = usePreferences();
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [docLangPickerOpen, setDocLangPickerOpen] = useState(false);

  // Multi-select: tapping toggles, and English is never removable because OCR
  // always reads it alongside whatever else is chosen.
  const toggleDocLanguage = (code: string) => {
    if (code === 'eng') return;
    const current = documentLanguages ?? [];
    setDocumentLanguages(
      current.includes(code) ? current.filter(c => c !== code) : [...current, code],
    );
  };
  // Which languages this phone can actually speak. Unknown until checked;
  // a missing entry means "not checked yet", never "unavailable".
  const [voiceAvailable, setVoiceAvailable] = useState<Record<string, boolean>>({});

  // ─── Search index ───────────────────────────────────────
  // One-time rebuild after the move to a multilingual embedding model.
  // Until it runs, Indian-language documents are found by exact words only.
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentFamily) return;
    let cancelled = false;
    indexStatus(currentFamily.id)
      .then(s => { if (!cancelled) setIndex(s); })
      .catch(err => { if (!cancelled) setIndexError(readableError(err)); });
    return () => { cancelled = true; };
  }, [currentFamily?.id]);

  // Each call embeds what it can inside its time budget, so keep calling
  // until it reports done. Progress updates between calls.
  const rebuildIndex = async () => {
    if (!currentFamily || rebuilding) return;
    setRebuilding(true);
    setIndexError(null);
    try {
      for (let pass = 0; pass < 200; pass++) {
        const result = await indexStatus(currentFamily.id, false);
        setIndex(result);
        if (result.error) { setIndexError(result.error); break; }
        if (result.done) break;
        // Not done but nothing embedded either: something is wrong at the far
        // end, and calling again would spin rather than finish.
        if (result.processed === 0) {
          setIndexError('Stalled — try again in a few minutes');
          break;
        }
      }
    } catch (err) {
      setIndexError(readableError(err));
    } finally {
      setRebuilding(false);
    }
  };

  const indexSubtitle = () => {
    if (indexError) return indexError;
    if (!index) return 'Checking…';
    if (rebuilding) {
      if (index.rechunking) return 'Updating… re-reading your documents';
      const of = index.total_count > 0 ? ` of ${index.total_count}` : '';
      return `Updating… ${index.done_count}${of} passages`;
    }
    if (index.up_to_date) {
      const stuck = index.unindexed?.length ?? 0;
      return stuck > 0
        ? `Up to date, but ${stuck} document${stuck === 1 ? '' : 's'} could not be read`
        : 'Up to date — all languages searchable';
    }
    return 'Update needed for Indian-language documents';
  };

  useEffect(() => {
    if (!langPickerOpen) return;
    let cancelled = false;
    Promise.all(VOICE_LANGUAGES.map(async l => [l.code, await hasVoiceFor(l.code)] as const))
      .then(pairs => { if (!cancelled) setVoiceAvailable(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [langPickerOpen]);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login' as any);
  };

  const displayName = user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const email = user?.email || '';
  const role = membership?.role || 'member';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <LinearGradient
          colors={['#2A3D66', '#4A6491']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileCard}
        >
          <View style={styles.avatarWrap}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileEmail}>{email}</Text>
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>{role}</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Settings Groups */}
        {settingsGroups.map((group, gIdx) => (
          <View key={gIdx} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.groupCard}>
              {group.items.map((item, iIdx) => (
                <TouchableOpacity
                  key={iIdx}
                  style={[styles.settingRow, iIdx > 0 && styles.settingRowBorder]}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingIconWrap}>
                    <Feather name={item.icon as any} size={18} color="#2A3D66" />
                  </View>
                  <View style={styles.settingText}>
                    <Text style={styles.settingLabel}>{item.label}</Text>
                    <Text style={styles.settingSub}>{item.sub}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color="#9CA3AF" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Accessibility — the one group with live controls */}
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Accessibility</Text>
          <View style={styles.groupCard}>
            <View style={styles.settingRow}>
              <View style={styles.settingIconWrap}>
                <Feather name="mic" size={18} color="#2A3D66" />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Voice assistant</Text>
                <Text style={styles.settingSub}>Talk to search and hear the answers</Text>
              </View>
              <Switch
                value={voiceMode}
                onValueChange={setVoiceMode}
                trackColor={{ false: '#D1D5DB', true: '#4A6491' }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Voice assistant"
              />
            </View>
            <TouchableOpacity
              style={[styles.settingRow, styles.settingRowBorder]}
              activeOpacity={0.7}
              onPress={() => setLangPickerOpen(true)}
            >
              <View style={styles.settingIconWrap}>
                <Feather name="globe" size={18} color="#2A3D66" />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Voice language</Text>
                <Text style={styles.settingSub}>What you speak, and what it speaks back</Text>
              </View>
              <Text style={styles.settingValue}>{voiceLanguage(voiceLang).native}</Text>
              <Feather name="chevron-right" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Documents — which languages scanning should read */}
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Documents</Text>
          <View style={styles.groupCard}>
            <TouchableOpacity
              style={styles.settingRow}
              activeOpacity={0.7}
              onPress={() => setDocLangPickerOpen(true)}
            >
              <View style={styles.settingIconWrap}>
                <Feather name="file-text" size={18} color="#2A3D66" />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Document languages</Text>
                <Text style={styles.settingSub}>What scanning should read on the page</Text>
              </View>
              <Text style={styles.settingValue} numberOfLines={1}>
                {describeOcrLanguages(documentLanguages)}
              </Text>
              <Feather name="chevron-right" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search index — live, and only actionable when a rebuild is due */}
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Search</Text>
          <View style={styles.groupCard}>
            <TouchableOpacity
              style={styles.settingRow}
              activeOpacity={index && !index.up_to_date && index.can_rebuild !== false ? 0.7 : 1}
              disabled={rebuilding || !index || index.up_to_date || index.can_rebuild === false}
              onPress={rebuildIndex}
            >
              <View style={styles.settingIconWrap}>
                <Feather name="refresh-cw" size={18} color="#2A3D66" />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Search index</Text>
                <Text style={styles.settingSub}>{indexSubtitle()}</Text>
              </View>
              {rebuilding
                ? <ActivityIndicator size="small" color="#2A3D66" />
                : index && !index.up_to_date && index.can_rebuild !== false
                  ? <Text style={styles.settingAction}>Update</Text>
                  : null}
            </TouchableOpacity>
          </View>
        </View>

        {/* Sign Out */}
        <View style={styles.signOutSection}>
          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={handleSignOut}
            activeOpacity={0.8}
          >
            <Feather name="log-out" size={18} color="#DC2626" />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={langPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLangPickerOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setLangPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Voice language</Text>
            <ScrollView style={styles.sheetList}>
              {VOICE_LANGUAGES.map((l, i) => {
                const selected = l.code === voiceLang;
                const unavailable = voiceAvailable[l.code] === false;
                return (
                  <TouchableOpacity
                    key={l.code}
                    style={[styles.langRow, i > 0 && styles.settingRowBorder]}
                    activeOpacity={0.7}
                    onPress={() => { setVoiceLanguage(l.code); setLangPickerOpen(false); }}
                  >
                    <View style={styles.settingText}>
                      <Text style={[styles.langNative, selected && styles.langSelected]}>{l.native}</Text>
                      <Text style={styles.settingSub}>
                        {l.english}{unavailable ? ' · No voice on this phone' : ''}
                      </Text>
                    </View>
                    {selected && <Feather name="check" size={20} color="#2A3D66" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={docLangPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDocLangPickerOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setDocLangPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Document languages</Text>
            <Text style={styles.sheetNote}>
              Pick every language your scanned documents use. English is always read.
              Each added language is downloaded once, the first time you scan.
            </Text>
            <ScrollView style={styles.sheetList}>
              {OCR_LANGUAGES.map((l, i) => {
                const selected = l.code === 'eng' || (documentLanguages ?? []).includes(l.code);
                return (
                  <TouchableOpacity
                    key={l.code}
                    style={[styles.langRow, i > 0 && styles.settingRowBorder]}
                    activeOpacity={l.code === 'eng' ? 1 : 0.7}
                    disabled={l.code === 'eng'}
                    onPress={() => toggleDocLanguage(l.code)}
                  >
                    <View style={styles.settingText}>
                      <Text style={[styles.langNative, selected && styles.langSelected]}>{l.native}</Text>
                      <Text style={styles.settingSub}>
                        {l.english}{l.code === 'eng' ? ' · always on' : ''}
                      </Text>
                    </View>
                    <Feather
                      name={selected ? 'check-square' : 'square'}
                      size={20}
                      color={selected ? '#2A3D66' : '#D1D5DB'}
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F9FC' },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    margin: 20,
    padding: 20,
    borderRadius: 24,
    boxShadow: '0px 4px 12px rgba(42, 61, 102, 0.3)',
    elevation: 6,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 26, fontWeight: '700', color: '#FFFFFF' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  profileEmail: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  adminBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  adminBadgeText: { fontSize: 11, color: '#FFFFFF', fontWeight: '500' },
  group: { paddingHorizontal: 20, marginBottom: 20 },
  groupTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  groupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)',
    elevation: 3,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 64,
  },
  settingRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  settingIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingText: { flex: 1 },
  settingLabel: { fontSize: 15, fontWeight: '500', color: '#1F2937' },
  settingSub: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  settingValue: { fontSize: 15, color: '#4B5563', maxWidth: 140 },
  settingAction: { fontSize: 15, fontWeight: '600', color: '#2A3D66' },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(13, 17, 23, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 32,
    maxHeight: '75%',
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#2A3D66', paddingHorizontal: 20, marginBottom: 8 },
  sheetNote: { fontSize: 12, color: '#6B7280', paddingHorizontal: 20, marginBottom: 12, lineHeight: 17 },
  sheetList: { paddingHorizontal: 4 },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 60,
  },
  langNative: { fontSize: 18, color: '#1F2937' },
  langSelected: { color: '#2A3D66', fontWeight: '700' },
  signOutSection: { paddingHorizontal: 20, paddingBottom: 32 },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  signOutText: { fontSize: 15, fontWeight: '600', color: '#DC2626' },
});
