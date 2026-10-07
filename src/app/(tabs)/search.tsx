import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFamily } from '../../lib/family-context';
import { useAuth } from '../../lib/auth';
import { accountKey, storageGet, storageSet } from '../../lib/storage';
import { isPersonalVault, vaultName } from '../../lib/vaults';
import {
  fetchCategories, ragSearch, indexStatus, saveChat, getSavedChat, isMissingMigration, claimVoiceAnswer,
  fetchVoiceStatus, ChatStorageFullError,
  type RagSearchResult, type RagHistoryTurn, type IndexStatus, type SavedChatMessage,
} from '../../lib/api';
import { plusPage } from '../../lib/family-plan';
import type { Database } from '../../lib/database.types';
import { usePreferences } from '../../lib/preferences';
import { phrase } from '../../lib/voice-languages';
import {
  recognitionSupported, listen, stopListening, cancelListening, speak, stopSpeaking, type SpeechErrorCode,
} from '../../lib/speech';
import { toSpeech } from '../../lib/speech-text';
import { ScreenHeader, HeaderIconButton, HeaderActions } from '../../components/screen-header';
import { VaultPill, VaultSheet, type VaultChoice } from '../../components/vault-sheet';
import { color, size, space, type } from '../../constants/design';

type DocumentCategory = Database['public']['Tables']['document_categories']['Row'];

interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  sources?: RagSearchResult['sources'];
  debug?: RagSearchResult['debug'];
  loading?: boolean;
}

/** "openai/gpt-oss-120b" → "gpt-oss-120b": enough to recognise, short enough for one line. */
function shortModel(id: string): string {
  return id.split('/').pop() ?? id;
}

// Voice mode. One control, one state at a time, and the screen always says
// which — the four states the mic button can be in.
type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

export default function SearchScreen() {
  const { user } = useAuth();
  const { currentFamily, members, families } = useFamily();

  // Where Ask searches (046): every vault this person is in — their personal
  // vault and each family — unless they pick one, which answers sooner.
  // Remembered on this device. A vault they have left since is no choice: all
  // of them, then.
  const [searchIn, setSearchIn] = useState('all');
  const [searchInOpen, setSearchInOpen] = useState(false);
  useEffect(() => {
    if (!user) return;
    storageGet(accountKey.askIn(user.id)).then((v) => { if (v) setSearchIn(v); }).catch(() => {});
  }, [user?.id]);
  const chooseSearchIn = (key: string) => {
    setSearchIn(key);
    if (user) storageSet(accountKey.askIn(user.id), key).catch(() => {});
  };
  const severalVaults = families.length > 1;
  const pickedVault = searchIn !== 'all' ? families.find((f) => f.family_id === searchIn) ?? null : null;
  const askAll = severalVaults && !pickedVault;
  const askFamily = pickedVault?.families ?? currentFamily;
  const searchInChoices: VaultChoice[] = [
    { key: 'all', name: 'All my vaults', subtitle: 'Every document you can see', icon: 'layers' },
    ...families.map((f): VaultChoice => ({
      key: f.family_id,
      name: vaultName(f.families),
      subtitle: isPersonalVault(f.families) ? 'Only you' : 'Family',
      icon: isPersonalVault(f.families) ? 'lock' : 'users',
    })),
  ];
  /** A source's vault, by the name every screen uses for it. */
  const vaultOf = (familyId?: string, sent?: string) => {
    const f = familyId ? families.find((x) => x.family_id === familyId) : undefined;
    return f ? vaultName(f.families) : sent;
  };
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // ─── Saved chats (028) ──────────────────────────────────
  // Nothing is kept unless Save chat is tapped. From then on the saved chat
  // follows the conversation: each finished answer brings it up to date,
  // until New question starts another. The clock at the top right lists them.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  // Saved chats take the family's storage (042). When there is no room, why,
  // and what to do; a saved chat that ran out of room stops following along.
  const [chatFull, setChatFull] = useState<{ text: string; plusLink: boolean } | null>(null);
  const [saveStopped, setSaveStopped] = useState(false);
  const lastSaved = useRef<ChatMessage[] | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { chat: chatToOpen } = useLocalSearchParams<{ chat?: string }>();

  const toSaved = (list: ChatMessage[]): SavedChatMessage[] =>
    list.filter((m) => !m.loading && m.text).map((m) => ({ role: m.role, text: m.text, sources: m.sources }));

  const showSaveNotice = (tone: 'ok' | 'error', text: string, forMs = 5000) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setSaveNotice({ tone, text });
    noticeTimer.current = setTimeout(() => setSaveNotice(null), forMs);
  };
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const saveFailed = (err: unknown) => {
    if (err instanceof ChatStorageFullError) {
      setSaveNotice(null);
      setChatFull({ text: err.message, plusLink: err.room?.plan !== 'plus' });
      return;
    }
    showSaveNotice('error', isMissingMigration(err)
      ? 'Saving chats is not switched on yet.'
      : 'Could not save this chat. Please try again.', 7000);
  };

  const startNewChat = () => {
    setMessages([]);
    setSavedId(null);
    setSaveNotice(null);
    setChatFull(null);
    setSaveStopped(false);
    lastSaved.current = null;
  };

  // A chat belongs to one family: switching family starts afresh rather than
  // carrying a conversation (and its saved copy) across.
  const familyId = currentFamily?.id;
  const shownFamily = useRef(familyId);
  useEffect(() => {
    // From one family to another only: the family arriving after a refresh
    // must not wipe a chat that was just opened.
    if (shownFamily.current && familyId && shownFamily.current !== familyId) startNewChat();
    shownFamily.current = familyId;
  }, [familyId]);

  // Opened from Saved chats: /search?chat=<id>.
  useEffect(() => {
    if (!chatToOpen) return;
    let cancelled = false;
    getSavedChat(chatToOpen)
      .then((saved) => {
        if (cancelled || !saved) return;
        const restored: ChatMessage[] = saved.messages.map((m, i) => ({
          id: `s-${saved.id}-${i}`, role: m.role, text: m.text, sources: m.sources,
        }));
        lastSaved.current = restored;
        setMessages(restored);
        setSavedId(saved.id);
        setSaveNotice(null);
        setChatFull(null);
        setSaveStopped(false);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
      })
      .catch(saveFailed)
      .finally(() => { if (!cancelled) router.setParams({ chat: undefined } as any); });
    return () => { cancelled = true; };
  }, [chatToOpen]);

  // Keep a saved chat up to date once each answer has arrived, until the
  // family's storage has no room for it.
  useEffect(() => {
    if (!savedId || !familyId || saveStopped || messages === lastSaved.current) return;
    if (messages.some((m) => m.loading)) return;
    lastSaved.current = messages;
    saveChat(familyId, toSaved(messages), savedId).then(setSavedId).catch((err) => {
      if (err instanceof ChatStorageFullError) setSaveStopped(true);
      saveFailed(err);
    });
  }, [messages, savedId, familyId, saveStopped]);

  const handleSave = async () => {
    if (!familyId || saving || savedId) return;
    setSaving(true);
    try {
      const id = await saveChat(familyId, toSaved(messages));
      lastSaved.current = messages;
      setSavedId(id);
      setChatFull(null);
      showSaveNotice('ok', 'Saved. Find it again with the clock at the top.');
    } catch (err) {
      saveFailed(err);
    } finally {
      setSaving(false);
    }
  };

  // ─── Search index self-repair ───────────────────────────
  // A vault whose chunks are not embedded on the current model searches by
  // keywords alone, which is much worse and, for a question asked in another
  // script, useless. The fix is a one-off rebuild — and asking someone to go
  // and find a Settings row to make search work is not a fix at all. So when
  // an answer reports the index is stale, start the rebuild here, once, and
  // show it happening. A member who is not an admin gets a 403; that is
  // expected and stays quiet.
  const [indexFix, setIndexFix] = useState<IndexStatus | null>(null);
  const indexFixStarted = useRef(false);

  const repairIndex = useCallback(async (familyId: string) => {
    if (indexFixStarted.current) return;
    indexFixStarted.current = true;
    try {
      for (let pass = 0; pass < 200; pass++) {
        const result = await indexStatus(familyId, false);
        setIndexFix(result);
        if (result.error || result.done || result.processed === 0) break;
      }
    } catch (err) {
      // A non-admin gets a 403 and should see nothing; anything else is worth
      // showing, because a silent failure here is what kept the index stale.
      const message = (err as { message?: string })?.message ?? String(err);
      setIndexFix(/403|admin/i.test(message) ? null : {
        up_to_date: false, done: false, processed: 0,
        done_count: 0, total_count: 0, model: '', error: message.slice(0, 120),
      });
    }
  }, []);

  // ─── Voice assistant ────────────────────────────────────
  const { voiceMode, voiceLanguage } = usePreferences();
  const voiceSupported = useMemo(() => recognitionSupported(), []);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const voiceStateRef = useRef<VoiceState>('idle');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const t = (key: Parameters<typeof phrase>[1]) => phrase(voiceLanguage, key);

  const setVoice = (next: VoiceState) => {
    voiceStateRef.current = next;
    setVoiceState(next);
  };

  // Read an answer aloud. Also the Read-again button's action.
  const speakMessage = useCallback((id: string, text: string, lang?: string) => {
    setSpeakingId(id);
    setVoice('speaking');
    speak(toSpeech(text), lang || voiceLanguage, {
      onDone: () => {
        setSpeakingId(current => (current === id ? null : current));
        if (voiceStateRef.current === 'speaking') setVoice('idle');
      },
      onError: () => {
        setSpeakingId(null);
        if (voiceStateRef.current === 'speaking') setVoice('idle');
      },
    });
  }, [voiceLanguage]);

  // Voice chats (041–043): on the free plan each person has 10 of their own —
  // a question asked by voice or an answer read aloud, one per question —
  // then they type and read, and Family Plus brings voice back. How many are
  // left is always on show in voice mode. Each new answer is claimed before
  // it is read; one heard already is read again without counting. When the
  // server cannot be asked, the answer is read.
  const heardIds = useRef(new Set<string>());
  const [voiceQuota, setVoiceQuotaState] = useState<{ left: number; limit: number } | null>(null);
  const voiceQuotaRef = useRef<{ left: number; limit: number } | null>(null);
  const setVoiceQuota = (q: { left: number; limit: number } | null) => {
    voiceQuotaRef.current = q;
    setVoiceQuotaState(q);
  };
  const noVoiceLeft = voiceQuota?.left === 0;
  // "None left" is said aloud once, so nobody waits for a voice that is not coming.
  const limitSaid = useRef(false);
  const sayNoVoiceLeft = useCallback(() => {
    setVoice('idle');
    if (limitSaid.current) return;
    limitSaid.current = true;
    const notice = phrase(voiceLanguage, 'voice_limit');
    setVoiceNotice(notice);
    speak(notice, voiceLanguage);
  }, [voiceLanguage]);

  useFocusEffect(useCallback(() => {
    if (!familyId) return;
    let cancelled = false;
    fetchVoiceStatus(familyId).then((status) => {
      if (cancelled || !status) return;   // unknown (before 042, offline): keep what a claim said
      setVoiceQuota(status.limit == null ? null : { left: status.left ?? 0, limit: status.limit });
    });
    return () => { cancelled = true; };
  }, [familyId]));
  useEffect(() => { setVoiceQuota(null); limitSaid.current = false; }, [familyId]);

  const readAnswer = useCallback(async (id: string, text: string, lang?: string) => {
    if (!heardIds.current.has(id) && currentFamily) {
      // None left, as far as this screen knows: no need to ask again.
      let allowed = voiceQuotaRef.current?.left !== 0;
      if (allowed) {
        const allowance = await claimVoiceAnswer(currentFamily.id);
        if (allowance?.limit != null) {
          setVoiceQuota({
            left: Math.max(0, allowance.limit - (allowance.used ?? allowance.limit)),
            limit: allowance.limit,
          });
        }
        allowed = !allowance || allowance.allowed;
      }
      if (!allowed) {
        sayNoVoiceLeft();
        return;
      }
      heardIds.current.add(id);
      // They tapped the mic while we asked: their new question comes first.
      if (voiceStateRef.current === 'listening') return;
    }
    speakMessage(id, text, lang);
  }, [currentFamily, speakMessage, sayNoVoiceLeft]);

  const stopVoice = useCallback(() => {
    stopListening();
    stopSpeaking();
    setSpeakingId(null);
    setVoice('idle');
  }, []);

  // Leaving the screen must never leave a voice talking or a mic open.
  useEffect(() => () => { stopListening(); stopSpeaking(); }, []);
  useEffect(() => { if (!voiceMode) stopVoice(); }, [voiceMode, stopVoice]);

  // Build dynamic suggestions from family member names
  const suggestions = members.slice(0, 4).map((m) => {
    const name = m.alias || m.users.display_name;
    const docs = ['passport', 'health insurance', 'tax returns', 'birth certificate'];
    return `${name}'s ${docs[Math.floor(Math.random() * docs.length)]}`;
  });

  useEffect(() => {
    fetchCategories().then(setCategories).catch(console.error);
  }, []);

  const handleAsk = async (q: string, opts: { spoken?: boolean } = {}) => {
    if (!q.trim() || !askFamily || isAsking) return;
    const question = q.trim();
    setQuery('');
    setIsAsking(true);
    setVoiceNotice(null);
    // A spoken question gets a spoken answer. A typed one in voice mode too:
    // the setting is about hearing answers, not only about the mic — so this
    // holds even on a browser with no recogniser. Not once this person's free
    // voice chats are used: then the answer is written for the screen.
    const voiceWanted = voiceMode || !!opts.spoken;
    const wantVoice = voiceWanted && voiceQuotaRef.current?.left !== 0;
    if (wantVoice) setVoice('thinking');

    // Everything said so far, in the shape the server expects. Captured
    // before the new turn is appended so it never includes this question.
    const history: RagHistoryTurn[] = messages
      .filter((m) => !m.loading && m.text)
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text,
        sources: m.sources,
        source_ids: m.sources?.map((s) => s.id),
      }));

    // Add user message
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: question };
    const aiPlaceholder: ChatMessage = { id: `a-${Date.now()}`, role: 'ai', text: '', loading: true };
    setMessages((prev) => [...prev, userMsg, aiPlaceholder]);

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const result = await ragSearch(askFamily.id, question, history, {
        language: voiceMode ? voiceLanguage : undefined,
        voice: wantVoice,
        ...(askAll ? { vaults: 'all' as const } : {}),
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiPlaceholder.id
            ? { ...m, text: result.answer, sources: result.sources, debug: result.debug, loading: false }
            : m
        )
      );
      if (wantVoice) readAnswer(aiPlaceholder.id, result.answer, result.answer_language);
      else if (voiceWanted) sayNoVoiceLeft();
      if (result.debug?.index_rebuilding) repairIndex(result.debug.rebuilding_family_ids?.[0] ?? askFamily.id);
    } catch (err) {
      console.error('RAG error:', err);
      const failed = t('failed');
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiPlaceholder.id
            ? { ...m, text: failed, loading: false }
            : m
        )
      );
      if (voiceWanted) {
        // An apology, not an answer: said even with no voice chats left, never counted.
        heardIds.current.add(aiPlaceholder.id);
        speakMessage(aiPlaceholder.id, failed);
      }
    } finally {
      setIsAsking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  // Tap to talk. The recogniser stops itself when the person pauses and the
  // transcript goes straight to search — no send step. While it listens, the
  // same button is Cancel, for words the person did not mean to say.
  const startListening = () => {
    stopSpeaking();
    setSpeakingId(null);
    setVoiceNotice(null);
    setQuery('');
    setVoice('listening');
    listen(voiceLanguage, {
      onInterim: (text) => setQuery(text),
      onFinal: (text) => {
        setQuery('');
        handleAsk(text, { spoken: true });
      },
      onError: (code: SpeechErrorCode) => {
        setQuery('');
        setVoice('idle');
        const notice =
          code === 'not-allowed' ? t('mic_denied')
          : code === 'unsupported' ? t('no_voice_support')
          : t('not_heard');
        setVoiceNotice(notice);
        speak(notice, voiceLanguage);
      },
      onEnd: () => {
        // Ended with silence, no transcript: back to ready.
        if (voiceStateRef.current === 'listening') {
          setQuery('');
          setVoice('idle');
        }
      },
    });
  };

  const onMicPress = () => {
    // No voice chats left: say why, and listen to nothing.
    if (voiceQuotaRef.current?.left === 0 && voiceStateRef.current !== 'listening') {
      stopSpeaking();
      setSpeakingId(null);
      setVoice('idle');
      const notice = t('voice_limit_mic');
      setVoiceNotice(notice);
      speak(notice, voiceLanguage);
      return;
    }
    switch (voiceStateRef.current) {
      case 'idle': startListening(); break;
      case 'listening': cancelVoiceQuestion(); break; // throw away what was heard: nothing asked
      case 'thinking': break;                      // wait for the answer
      case 'speaking': startListening(); break;    // cut the voice off and ask again
    }
  };

  // Cancel: what was heard so far is thrown away — nothing is asked, and no
  // voice chat is used. Back to ready, and the screen says so.
  const cancelVoiceQuestion = () => {
    cancelListening();
    setQuery('');
    setVoice('idle');
    setVoiceNotice(t('cancelled'));
  };

  const voicePlaceholder = () => {
    if (!voiceSupported) return t('no_voice_support');
    if (voiceNotice) return voiceNotice;
    if (noVoiceLeft) return t('type_to_ask');
    switch (voiceState) {
      case 'listening': return t('listening');
      case 'thinking': return t('thinking');
      case 'speaking': return t('ask_another');
      default: return t('tap_to_ask');
    }
  };

  // Voice mode shows the mic in the right-hand slot, unless the person has
  // typed something — then it's a question to send, as before.
  const showMic = voiceMode && voiceSupported && (voiceState === 'listening' || !query.trim());

  const hasMessages = messages.length > 0;
  const answered = messages.some((m) => m.role === 'ai' && !m.loading && !!m.text);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Back leaves Ask, as on every screen but Home. At the right: + starts
            a new question (what the old arrow here used to do), and the clock
            opens Saved chats. The clock never moves; + appears beside it. */}
        <ScreenHeader
          title="Ask"
          right={(
            <HeaderActions>
              {hasMessages && (
                <HeaderIconButton icon="plus" label="New question" onPress={() => { stopVoice(); startNewChat(); }} />
              )}
              <HeaderIconButton icon="clock" label="Saved chats" onPress={() => router.push('/saved-chats' as any)} />
            </HeaderActions>
          )}
        />

        {/* Where to search (046): all vaults, or one, which answers sooner */}
        {severalVaults && (
          <View style={styles.searchInBar}>
            <VaultPill
              label="Search in"
              value={pickedVault ? vaultName(pickedVault.families) : 'All my vaults'}
              icon={pickedVault ? (isPersonalVault(pickedVault.families) ? 'lock' : 'users') : 'layers'}
              onPress={() => setSearchInOpen(true)}
            />
          </View>
        )}

        {/* Chat Area */}
        <ScrollView
          ref={scrollRef}
          style={styles.chatArea}
          contentContainerStyle={!hasMessages ? styles.emptyContainer : styles.chatContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => hasMessages && scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {!hasMessages ? (
            /* Empty State */
            <View style={styles.emptyWrapper}>
              {/* Centered hero section */}
              <View style={styles.emptyState}>
                <LinearGradient
                  colors={['#2A3D66', '#4A6491']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.emptyIcon}
                >
                  <Feather name={voiceMode && !noVoiceLeft ? 'mic' : 'cpu'} size={32} color="#FFFFFF" />
                </LinearGradient>
                <Text style={styles.emptyTitle}>
                  {voiceMode ? t(noVoiceLeft ? 'empty_title_typed' : 'empty_title') : 'Ask anything about your documents'}
                </Text>
                <Text style={styles.emptySub}>
                  {voiceMode
                    ? t('empty_sub')
                    : askAll
                      ? 'I can find information across all your vaults: your personal vault and your families.'
                      : pickedVault
                        ? `I can find information in ${vaultName(pickedVault.families)}.`
                        : "I can find information across all your family's uploaded documents."}
                </Text>
              </View>

              {/* Categories at bottom */}
              <View style={styles.categoriesSection}>
                <View style={styles.categoriesWrap}>
                  {categories.slice(0, 8).map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={styles.categoryChip}
                      onPress={() => handleAsk(`Show me all ${cat.name} documents`)}
                    >
                      <Text style={styles.categoryChipText}>{cat.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          ) : (
            /* Chat Messages */
            <>
              {messages.map((msg) => (
                <View
                  key={msg.id}
                  style={[
                    styles.messageBubble,
                    msg.role === 'user' ? styles.userBubble : styles.aiBubble,
                  ]}
                >
                  {msg.role === 'ai' && (
                    <View style={styles.aiAvatar}>
                      <Feather name="cpu" size={14} color="#2A3D66" />
                    </View>
                  )}
                  <View style={[
                    styles.bubbleContent,
                    msg.role === 'user' ? styles.userContent : styles.aiContent,
                  ]}>
                    {msg.loading ? (
                      <View style={styles.typingRow}>
                        <ActivityIndicator size="small" color="#2A3D66" />
                        <Text style={styles.typingText}>{voiceMode ? t('thinking') : 'Searching documents...'}</Text>
                      </View>
                    ) : (
                      <>
                        <Text style={[
                          styles.messageText,
                          msg.role === 'user' && styles.userText,
                        ]}>
                          {msg.text}
                        </Text>
                        {/* Read again: an answer already heard always; a new one only while voice chats are left. */}
                        {msg.role === 'ai' && voiceMode && (!noVoiceLeft || heardIds.current.has(msg.id)) && (
                          <View style={styles.voiceTools}>
                            {speakingId === msg.id ? (
                              <TouchableOpacity style={styles.voiceToolBtn} onPress={stopVoice}>
                                <Feather name="square" size={14} color="#2A3D66" />
                                <Text style={styles.voiceToolText}>{t('stop')}</Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                style={styles.voiceToolBtn}
                                onPress={() => readAnswer(msg.id, msg.text)}
                                disabled={voiceState === 'listening' || voiceState === 'thinking'}
                              >
                                <Feather name="volume-2" size={14} color="#2A3D66" />
                                <Text style={styles.voiceToolText}>{t('read_again')}</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                        {msg.debug && (voiceMode
                          ? !!(msg.debug.translate_error || msg.debug.condense_error || msg.debug.rerank_error
                               || msg.debug.pin_error || msg.debug.index_rebuilding || msg.debug.embedded === false)
                          : msg.debug.history_turns > 0 || !!msg.debug.translated
                               || msg.debug.index_rebuilding || msg.debug.embedded === false) && (
                          <Text style={styles.searchedFor} numberOfLines={3}>
                            Searched for: {msg.debug.searched_for}
                            {msg.debug.condensed ? '' : ' (not rewritten)'}
                            {'\n'}
                            {msg.debug.kept_count ?? msg.debug.kept_docs.length} of {msg.debug.candidate_count} passages kept ({msg.debug.kept_docs.length} {msg.debug.kept_docs.length === 1 ? 'doc' : 'docs'}) · {msg.debug.pinned_docs.length} pinned
                            {msg.debug.models?.answer ? ` · ${shortModel(msg.debug.models.answer)}` : ''}
                            {msg.debug.history_turns > 0 && !msg.debug.client_sent_sources ? ' · old client' : ''}
                            {msg.debug.index_rebuilding ? ' · index rebuilding — run Settings › Search' : ''}
                            {msg.debug.embedded === false && !msg.debug.index_rebuilding
                              ? ` · no query vector${msg.debug.embed_error ? `: ${msg.debug.embed_error}` : ', keywords only'}`
                              : ''}
                            {msg.debug.pin_error ? ` · pin: ${msg.debug.pin_error}` : ''}
                            {msg.debug.rerank_error ? ` · rerank: ${msg.debug.rerank_error}` : ''}
                            {msg.debug.condense_error ? ` · condense: ${msg.debug.condense_error}` : ''}
                            {msg.debug.translate_error ? ` · translate: ${msg.debug.translate_error}` : ''}
                          </Text>
                        )}
                        {msg.sources && msg.sources.length > 0 && (
                          <View style={styles.sourcesWrap}>
                            {msg.sources.map((s) => (
                              <TouchableOpacity
                                key={s.id}
                                style={styles.sourceChip}
                                // Opened in the vault it is in, which may not be the open one.
                                onPress={() => router.push({
                                  pathname: '/document/[id]',
                                  params: { id: s.id, ...(s.family_id ? { family: s.family_id } : {}) },
                                } as any)}
                                accessibilityLabel={[s.file_name, severalVaults ? vaultOf(s.family_id, s.family_name) : null].filter(Boolean).join(', in ')}
                              >
                                <Feather name="file-text" size={12} color="#2A3D66" />
                                <Text style={styles.sourceText} numberOfLines={1}>{s.file_name}</Text>
                                {severalVaults && !!vaultOf(s.family_id, s.family_name) && (
                                  <Text style={styles.sourceVault} numberOfLines={1}>· {vaultOf(s.family_id, s.family_name)}</Text>
                                )}
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </>
                    )}
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>

        {/* Index repair, while it runs */}
        {indexFix && !indexFix.up_to_date && !indexFix.error && (
          <View style={styles.indexStrip}>
            <ActivityIndicator size="small" color="#2A3D66" />
            <Text style={styles.indexStripText} numberOfLines={1}>
              {indexFix.reextracting
                ? 'Improving search… reading your PDFs again, tables and all'
                : indexFix.rechunking
                  ? 'Improving search across languages… re-reading your documents'
                  : `Improving search across languages… ${indexFix.done_count}` +
                    `${indexFix.total_count > 0 ? ` of ${indexFix.total_count}` : ''} passages`}
            </Text>
          </View>
        )}
        {indexFix?.up_to_date && (
          <View style={styles.indexStrip}>
            <Feather name="check-circle" size={14} color="#2F7D5C" />
            <Text style={styles.indexStripText}>
              Search is ready. Ask again for a better answer.
            </Text>
          </View>
        )}
        {!!indexFix?.unindexed?.length && (
          <View style={[styles.indexStrip, styles.indexStripError]}>
            <Feather name="alert-triangle" size={14} color="#9A6200" />
            <Text style={[styles.indexStripText, styles.indexStripErrorText]} numberOfLines={2}>
              Not searchable, nothing could be read from {indexFix.unindexed.length === 1 ? 'it' : 'them'}:{' '}
              {indexFix.unindexed.join(', ')}. Try uploading again.
            </Text>
          </View>
        )}
        {indexFix?.error && (
          <View style={[styles.indexStrip, styles.indexStripError]}>
            <Feather name="alert-triangle" size={14} color="#9A6200" />
            <Text style={[styles.indexStripText, styles.indexStripErrorText]} numberOfLines={2}>
              Couldn't finish improving search: {indexFix.error}
            </Text>
          </View>
        )}

        {/* Voice chats: how many this person has left on the free plan, always, in voice mode. */}
        {voiceMode && voiceQuota && (
          <View style={[styles.indexStrip, styles.voiceStrip]}>
            <Feather name={noVoiceLeft ? 'mic-off' : 'mic'} size={14} color={color.primary} />
            <Text style={styles.indexStripText}>
              {noVoiceLeft
                ? `You have used your ${voiceQuota.limit} free voice chats. Type to ask; answers stay on the screen.`
                : `You have ${voiceQuota.left} of ${voiceQuota.limit} free voice chats left.`}
            </Text>
            <TouchableOpacity onPress={() => router.push(plusPage('voice') as any)} accessibilityRole="link" hitSlop={8}>
              <Text style={styles.voiceStripLink}>Family Plus ›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* A chat with no room to be saved: why, and what to do (042). */}
        {chatFull && (
          <View style={[styles.indexStrip, styles.indexStripError]} accessibilityLiveRegion="polite">
            <Feather name="hard-drive" size={14} color="#9A6200" />
            <Text style={[styles.indexStripText, styles.indexStripErrorText]}>{chatFull.text}</Text>
            {chatFull.plusLink && (
              <TouchableOpacity onPress={() => router.push(plusPage('storage') as any)} accessibilityRole="link" hitSlop={8}>
                <Text style={styles.voiceStripLink}>Family Plus ›</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Save chat: explicit, on the conversation itself. */}
        {hasMessages && (
          <View style={styles.saveBar}>
            {savedId && saveStopped ? (
              <View style={[styles.saveBtn, styles.saveBtnStopped]} accessibilityLabel="New answers in this chat are not being saved">
                <Feather name="alert-circle" size={16} color="#9A6200" />
                <Text style={[styles.saveBtnText, styles.saveBtnTextStopped]}>Not saving new answers</Text>
              </View>
            ) : savedId ? (
              <View style={[styles.saveBtn, styles.saveBtnDone]} accessibilityLabel="This chat is saved">
                <Feather name="check-circle" size={16} color="#2F7D5C" />
                <Text style={[styles.saveBtnText, styles.saveBtnTextDone]}>Saved</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.saveBtn, (!answered || isAsking || saving) && styles.saveBtnOff]}
                onPress={handleSave}
                disabled={!answered || isAsking || saving}
                activeOpacity={0.7}
                hitSlop={{ top: 4, bottom: 4 }}
                accessibilityRole="button"
                accessibilityLabel="Save chat"
              >
                {saving
                  ? <ActivityIndicator size="small" color={color.primary} />
                  : <Feather name="bookmark" size={16} color={color.primary} />}
                <Text style={styles.saveBtnText}>Save chat</Text>
              </TouchableOpacity>
            )}
            {!!saveNotice && (
              <Text
                style={[styles.saveNotice, saveNotice.tone === 'error' && styles.saveNoticeError]}
                numberOfLines={2}
                accessibilityLiveRegion="polite"
              >
                {saveNotice.text}
              </Text>
            )}
          </View>
        )}

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <View style={styles.inputBox}>
            <Feather
              name={voiceMode && !noVoiceLeft ? 'mic' : 'message-circle'}
              size={18}
              color={voiceState === 'listening' ? '#D4807B' : '#9CA3AF'}
              style={styles.inputIcon}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => handleAsk(query)}
              placeholder={voiceMode ? voicePlaceholder() : 'Ask about your documents...'}
              placeholderTextColor={voiceNotice ? '#B45309' : '#9CA3AF'}
              returnKeyType="send"
              style={[styles.input, voiceMode && styles.inputLarge]}
              editable={!isAsking && voiceState !== 'listening'}
            />
            {showMic ? (
              <TouchableOpacity
                onPress={onMicPress}
                disabled={voiceState === 'thinking'}
                accessibilityRole="button"
                accessibilityLabel={voiceState === 'listening' ? t('cancel') : voicePlaceholder()}
                style={styles.micBtn}
              >
                {voiceState === 'thinking' ? (
                  <View style={[styles.micCircle, styles.micThinking]}>
                    <ActivityIndicator size="small" color="#6B7280" />
                  </View>
                ) : voiceState === 'listening' ? (
                  // Listening: the same button cancels, and says so.
                  <View style={[styles.micCircle, styles.micListening, styles.micCancel]}>
                    <Feather name="x" size={22} color="#FFFFFF" />
                    <Text style={styles.micCancelText}>{t('cancel')}</Text>
                  </View>
                ) : voiceState === 'speaking' ? (
                  <View style={[styles.micCircle, styles.micSpeaking]}>
                    <Feather name="volume-2" size={26} color="#FFFFFF" />
                  </View>
                ) : noVoiceLeft ? (
                  // No voice chats left: a tap says why, so it stays, quieter.
                  <View style={[styles.micCircle, styles.micOff]}>
                    <Feather name="mic-off" size={24} color="#6B7280" />
                  </View>
                ) : (
                  <LinearGradient
                    colors={['#2A3D66', '#4A6491']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.micCircle}
                  >
                    <Feather name="mic" size={26} color="#FFFFFF" />
                  </LinearGradient>
                )}
              </TouchableOpacity>
            ) : (
            <TouchableOpacity
              onPress={() => handleAsk(query)}
              disabled={!query.trim() || isAsking}
              style={[styles.sendBtn, (!query.trim() || isAsking) && styles.sendBtnDisabled]}
            >
              <LinearGradient
                colors={(!query.trim() || isAsking) ? ['#D1D5DB', '#D1D5DB'] : ['#2A3D66', '#4A6491']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sendGradient}
              >
                <Feather name="send" size={18} color="#FFFFFF" />
              </LinearGradient>
            </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      <VaultSheet
        visible={searchInOpen}
        title="Search in"
        intro="All my vaults searches every document you can see. Pick one vault and the answer comes sooner."
        choices={searchInChoices}
        selected={pickedVault ? pickedVault.family_id : 'all'}
        onSelect={chooseSearchIn}
        onClose={() => setSearchInOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  flex: { flex: 1 },
  chatArea: { flex: 1 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  chatContent: { padding: space.lg, paddingBottom: space.sm },
  // ─── Empty State ──────────────────────────────────────
  emptyWrapper: { flexGrow: 1, justifyContent: 'space-between' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  categoriesSection: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  emptyTitle: { ...type.title, color: color.text, textAlign: 'center', marginBottom: space.xs },
  emptySub: { ...type.caption, textAlign: 'center', maxWidth: 300 },
  categoriesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
  categoryChip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 999,
  },
  categoryChipText: { fontSize: 13, lineHeight: 18, color: color.textBody },
  // ─── Chat Messages ────────────────────────────────────
  messageBubble: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  userBubble: { justifyContent: 'flex-end' },
  aiBubble: { justifyContent: 'flex-start' },
  aiAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  bubbleContent: {
    maxWidth: '80%',
    borderRadius: 18,
    padding: 14,
  },
  userContent: {
    backgroundColor: '#2A3D66',
    borderBottomRightRadius: 4,
  },
  aiContent: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  messageText: { ...type.body, color: color.text },
  userText: { color: '#FFFFFF' },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingText: type.caption,
  sourcesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    // Never wider than the answer: the file name gives way first, then the vault.
    maxWidth: '100%',
  },
  sourceText: { fontSize: 12, lineHeight: 16, color: color.primary, fontWeight: '500', maxWidth: 160, flexShrink: 1 },
  sourceVault: { fontSize: 12, lineHeight: 16, color: color.textMuted, maxWidth: 120, flexShrink: 0 },
  searchInBar: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  searchedFor: { fontSize: 12, lineHeight: 16, color: '#9CA3AF', marginTop: space.sm, fontStyle: 'italic' },
  indexStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#EFF6FF',
    borderTopWidth: 1,
    borderTopColor: '#DBE7FB',
  },
  indexStripText: { flex: 1, fontSize: 13, lineHeight: 18, color: color.primary },
  indexStripError: { backgroundColor: '#FFF7E6', borderTopColor: '#F5D9A0' },
  indexStripErrorText: { color: '#7A5200' },
  voiceStrip: { backgroundColor: '#FBEDEB', borderTopColor: '#F3D3CF' },
  voiceStripLink: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: color.primary },
  // ─── Save chat ────────────────────────────────────────
  saveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: color.background,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.primary,
    backgroundColor: color.surface,
  },
  saveBtnOff: { opacity: 0.45 },
  saveBtnDone: { borderColor: 'transparent', backgroundColor: '#EAF5EF' },
  saveBtnText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: color.primary },
  saveBtnTextDone: { color: '#2F7D5C' },
  saveBtnStopped: { borderColor: 'transparent', backgroundColor: '#FFF7E6' },
  saveBtnTextStopped: { color: '#9A6200' },
  saveNotice: { ...type.caption, flex: 1, color: color.textBody },
  saveNoticeError: { color: '#B45309' },
  // ─── Input Bar ────────────────────────────────────────
  inputBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: space.lg,
    paddingTop: 10,
    // The tab bar's round Ask button rises into this space; the box stays clear of it.
    paddingBottom: 10 + size.ask - size.tabBar,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.background,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: color.border,
    paddingLeft: 14,
    paddingRight: 4,
    gap: space.sm,
    minHeight: 44,
  },
  inputIcon: { marginLeft: 2 },
  input: {
    flex: 1,
    // Without it a web text field keeps its own width and pushes the mic (or
    // the wider Cancel) off the screen on a narrow phone.
    minWidth: 0,
    fontSize: 15,
    color: '#1F2937',
    paddingVertical: 8,
    outlineStyle: 'none',
  } as any,
  inputLarge: { fontSize: 17 },
  sendBtn: {},
  sendBtnDisabled: { opacity: 0.5 },
  // ─── Voice ────────────────────────────────────────────
  micBtn: {},
  micCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micListening: {
    backgroundColor: '#D4807B',
    boxShadow: '0px 0px 0px 8px rgba(212, 128, 123, 0.25)',
  },
  micCancel: { width: 'auto', flexDirection: 'row', gap: 6, paddingHorizontal: 16 },
  micCancelText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  micThinking: { backgroundColor: '#E5E7EB' },
  micOff: { backgroundColor: '#E5E7EB' },
  micSpeaking: { backgroundColor: '#2F7D5C' },
  voiceTools: { flexDirection: 'row', gap: 8, marginTop: 10 },
  voiceToolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 40,
  },
  voiceToolText: { fontSize: 14, color: '#2A3D66', fontWeight: '600' },
  sendGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
