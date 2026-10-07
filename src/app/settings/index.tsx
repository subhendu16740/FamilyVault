import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Switch, Modal, Pressable,
  ActivityIndicator, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { isProduction, environmentDescription } from '../../lib/environment';
import { useFamily } from '../../lib/family-context';
import { usePreferences } from '../../lib/preferences';
import { fetchPlanLimits, fetchVoiceStatus, indexStatus, type IndexStatus, type VoiceStatus } from '../../lib/api';
import { useFamilyPlan } from '../../lib/family-plan';
import { DEFAULT_PLAN_LIMITS, type PlanLimits } from '../../lib/plans';
import { VOICE_LANGUAGES, phrase, voiceLanguage } from '../../lib/voice-languages';
import { OCR_LANGUAGES, describeOcrLanguages } from '../../lib/ocr-languages';
import {
  chooseVoice, chosenVoice, hasVoiceFor, speak, stopSpeaking, voicesFor, type DeviceVoice,
} from '../../lib/speech';
import { ScreenHeader, PlusTag } from '../../components/screen-header';
import { appVersion } from '../../lib/app-info';
import { color, radius, shadow, size, space, type } from '../../constants/design';

// A row with an arrow opens a screen — every one of them. Rows that opened
// nothing used to sit here, which tells the person using the app that it is
// broken, or that they did something wrong. Import from Gmail lives on Upload.
type LinkItem = { icon: string; label: string; sub: string; route: string; value?: string };

function LinkGroup({ title, items }: { title: string; items: LinkItem[] }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.groupCard}>
        {items.map((item, i) => (
          <TouchableOpacity
            key={item.route}
            style={[styles.settingRow, i > 0 && styles.settingRowBorder]}
            activeOpacity={0.7}
            onPress={() => router.push(item.route as any)}
            accessibilityRole="button"
          >
            <View style={styles.settingIconWrap}>
              <Feather name={item.icon as any} size={16} color={color.primary} />
            </View>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>{item.label}</Text>
              <Text style={styles.settingSub}>{item.sub}</Text>
            </View>
            {!!item.value && <Text style={styles.settingValue}>{item.value}</Text>}
            <Feather name="chevron-right" size={16} color="#9CA3AF" />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

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
    voiceMode, voiceLanguage: voiceLang, documentLanguages, notificationsEnabled,
    setVoiceMode, setVoiceLanguage, setDocumentLanguages,
  } = usePreferences();
  // On the free plan each person has their own voice chats (041–043); say
  // how many are left where voice is switched on.
  const { isFree } = useFamilyPlan();
  const [limits, setLimits] = useState<PlanLimits>(DEFAULT_PLAN_LIMITS);
  const [voiceChats, setVoiceChats] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPlanLimits().then((l) => { if (!cancelled) setLimits(l); });
    return () => { cancelled = true; };
  }, []);
  useFocusEffect(useCallback(() => {
    if (!currentFamily) return;
    let cancelled = false;
    fetchVoiceStatus(currentFamily.id).then((v) => { if (!cancelled) setVoiceChats(v); });
    return () => { cancelled = true; };
  }, [currentFamily?.id]));
  const freeVoiceChats = limits.voiceAnswers.free;

  // Which voice reads the answers: this device's voices for the voice
  // language, chosen by ear and kept on this device.
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [deviceVoices, setDeviceVoices] = useState<DeviceVoice[]>([]);
  const [voiceChoice, setVoiceChoice] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([voicesFor(voiceLang), chosenVoice(voiceLang)]).then(([list, chosen]) => {
      if (cancelled) return;
      setDeviceVoices(list);
      setVoiceChoice(chosen && list.some((v) => v.id === chosen) ? chosen : null);
    });
    return () => { cancelled = true; };
  }, [voiceLang]);
  const pickVoice = (id: string | null) => {
    setVoiceChoice(id);
    chooseVoice(voiceLang, id);
    // Heard straight away, so a voice is chosen by ear.
    speak(phrase(voiceLang, 'voice_sample'), voiceLang, {}, id);
  };
  const closeVoicePicker = () => {
    stopSpeaking();
    setVoicePickerOpen(false);
  };
  const voiceLabel = deviceVoices.find((v) => v.id === voiceChoice)?.label ?? 'Automatic';

  const accountItems: LinkItem[] = [
    { icon: 'user', label: 'Profile', sub: 'Your name and phone number', route: '/settings/profile' },
    {
      icon: 'shield', label: 'Security', route: '/settings/security',
      sub: Platform.OS === 'web'
        ? 'How you sign in, fingerprint sign-in, signing out, deleting your account'
        : 'How you sign in, signing out, deleting your account',
    },
    {
      icon: 'bell', label: 'Notifications', sub: 'Expiry alerts and family news',
      route: '/settings/notifications', value: notificationsEnabled ? 'On' : 'Off',
    },
  ];
  const vaultItems: LinkItem[] = [
    { icon: 'users', label: 'Manage Families', sub: 'View and switch families', route: '/family' },
    { icon: 'hard-drive', label: 'Storage', sub: 'Your family\'s plan, and how much of its space is used', route: '/settings/storage' },
    { icon: 'star', label: 'Family Plus', sub: 'What Plus gives, side by side with Free', route: '/plus' },
    { icon: 'lock', label: 'Privacy', sub: 'Who can see your documents', route: '/settings/privacy' },
  ];
  const helpItems: LinkItem[] = [
    { icon: 'help-circle', label: 'Help & FAQ', sub: 'Answers, feedback and contact', route: '/settings/help' },
    // The badge says WHICH build this is at a glance; About says what that
    // means, in the one place someone goes to check.
    {
      icon: 'info', label: 'About AskLocker',
      sub: isProduction ? `Version ${appVersion}` : `Version ${appVersion} · ${environmentDescription}`,
      route: '/settings/about',
    },
  ];
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
      if (index.reextracting) return 'Updating… reading your PDFs again';
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
      <ScreenHeader title="Settings" />

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

        <LinkGroup title="Account" items={accountItems} />
        <LinkGroup title="Vault" items={vaultItems} />

        {/* Accessibility — the one group with live controls */}
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Accessibility</Text>
          <View style={styles.groupCard}>
            <View style={styles.settingRow}>
              <View style={styles.settingIconWrap}>
                <Feather name="mic" size={16} color={color.primary} />
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
            {(voiceChats ? voiceChats.limit != null : isFree && freeVoiceChats != null) && (
              <View style={[styles.settingRow, styles.settingRowBorder, styles.plusNote]}>
                <PlusTag link />
                <Text style={styles.plusNoteText}>
                  {voiceChats?.limit != null
                    ? voiceChats.left === 0
                      ? `You have used your ${voiceChats.limit} free voice chats. Family Plus brings voice back: every question by voice, every answer read aloud.`
                      : `You have ${voiceChats.left} of ${voiceChats.limit} free voice chats left: a question asked by voice or an answer read aloud, one per question. Everyone in the family has their own ${voiceChats.limit}. Family Plus has no limit.`
                    : `On the free plan, each person has ${freeVoiceChats} free voice chats: a question asked by voice or an answer read aloud, one per question. Family Plus has no limit.`}
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.settingRow, styles.settingRowBorder]}
              activeOpacity={0.7}
              onPress={() => setLangPickerOpen(true)}
            >
              <View style={styles.settingIconWrap}>
                <Feather name="globe" size={16} color={color.primary} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Voice language</Text>
                <Text style={styles.settingSub}>What you speak, and what it speaks back</Text>
              </View>
              <Text style={styles.settingValue}>{voiceLanguage(voiceLang).native}</Text>
              <Feather name="chevron-right" size={16} color="#9CA3AF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.settingRow, styles.settingRowBorder]}
              activeOpacity={0.7}
              onPress={() => setVoicePickerOpen(true)}
            >
              <View style={styles.settingIconWrap}>
                <Feather name="volume-2" size={16} color={color.primary} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Voice</Text>
                <Text style={styles.settingSub}>Who reads the answers on this device</Text>
              </View>
              <Text style={styles.settingValue} numberOfLines={1}>{voiceLabel}</Text>
              <Feather name="chevron-right" size={16} color="#9CA3AF" />
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
                <Feather name="file-text" size={16} color={color.primary} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Document languages</Text>
                <Text style={styles.settingSub}>What scanning should read on the page</Text>
              </View>
              <Text style={styles.settingValue} numberOfLines={1}>
                {describeOcrLanguages(documentLanguages)}
              </Text>
              <Feather name="chevron-right" size={16} color="#9CA3AF" />
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
                <Feather name="refresh-cw" size={16} color={color.primary} />
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

        <LinkGroup title="Help" items={helpItems} />

        {/* Sign Out */}
        <View style={styles.signOutSection}>
          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={handleSignOut}
            activeOpacity={0.8}
          >
            <Feather name="log-out" size={16} color={color.danger} />
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
                    {selected && <Feather name="check" size={18} color={color.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={voicePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={closeVoicePicker}
      >
        <Pressable style={styles.sheetBackdrop} onPress={closeVoicePicker}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Voice for {voiceLanguage(voiceLang).english}</Text>
            <Text style={styles.sheetNote}>
              {deviceVoices.length
                ? 'Tap a voice to hear it. The one you tap last reads your answers on this device.'
                : `This device has no ${voiceLanguage(voiceLang).english} voice of its own, so answers are read in its default voice. A phone's settings, or another browser, may offer more voices.`}
            </Text>
            <ScrollView style={styles.sheetList}>
              {[{ id: null as string | null, label: 'Automatic', note: 'The best voice for the language' }, ...deviceVoices].map((v, i) => {
                const selected = v.id === voiceChoice;
                return (
                  <TouchableOpacity
                    key={v.id ?? 'automatic'}
                    style={[styles.langRow, i > 0 && styles.settingRowBorder]}
                    activeOpacity={0.7}
                    onPress={() => pickVoice(v.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                  >
                    <View style={styles.settingText}>
                      <Text style={[styles.langNative, selected && styles.langSelected]} numberOfLines={2}>{v.label}</Text>
                      {!!v.note && <Text style={styles.settingSub}>{v.note}</Text>}
                    </View>
                    {selected
                      ? <Feather name="check" size={18} color={color.primary} />
                      : <Feather name="play-circle" size={18} color="#9CA3AF" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.sheetDone} onPress={closeVoicePicker} accessibilityRole="button">
              <Text style={styles.sheetDoneText}>Done</Text>
            </TouchableOpacity>
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
                      size={18}
                      color={selected ? color.primary : '#D1D5DB'}
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
  safe: { flex: 1, backgroundColor: color.background },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    margin: space.lg,
    padding: space.lg,
    borderRadius: radius.card,
    boxShadow: '0px 2px 8px rgba(42, 61, 102, 0.2)',
    elevation: 3,
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 20, fontWeight: '600', color: '#FFFFFF' },
  profileInfo: { flex: 1, minWidth: 0 },
  profileName: { ...type.heading, color: '#FFFFFF' },
  profileEmail: { ...type.caption, color: 'rgba(255,255,255,0.8)' },
  adminBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: space.xs,
  },
  adminBadgeText: { fontSize: 12, color: '#FFFFFF', fontWeight: '500', textTransform: 'capitalize' },
  group: { paddingHorizontal: space.lg, marginBottom: space.lg },
  groupTitle: { ...type.overline, marginBottom: space.sm, marginLeft: space.xs },
  groupCard: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    ...shadow.card,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    minHeight: size.row,
  },
  settingRowBorder: {
    borderTopWidth: 1,
    borderTopColor: color.divider,
  },
  settingIconWrap: {
    width: size.iconBox,
    height: size.iconBox,
    borderRadius: 8,
    backgroundColor: color.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingText: { flex: 1, minWidth: 0 },
  settingLabel: type.label,
  settingSub: type.caption,
  settingValue: { ...type.caption, maxWidth: 120 },
  settingAction: { ...type.button, color: color.primary },
  plusNote: { alignItems: 'flex-start', minHeight: 0 },
  plusNoteText: { ...type.caption, flex: 1, color: color.textBody, marginTop: 2 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(13, 17, 23, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingTop: space.lg,
    paddingBottom: space.xl,
    maxHeight: '75%',
  },
  sheetTitle: { ...type.title, paddingHorizontal: space.lg, marginBottom: space.sm },
  sheetNote: { ...type.caption, paddingHorizontal: space.lg, marginBottom: space.md },
  sheetList: { paddingHorizontal: 0 },
  sheetDone: {
    marginTop: space.md,
    marginHorizontal: space.lg,
    height: size.control,
    borderRadius: radius.control,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDoneText: { ...type.button, color: '#FFFFFF' },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    minHeight: size.row,
  },
  langNative: type.label,
  langSelected: { color: color.primary, fontWeight: '600' },
  signOutSection: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: '#FEF2F2',
    borderRadius: radius.control,
    minHeight: size.control,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  signOutText: { ...type.button, color: color.danger },
});
