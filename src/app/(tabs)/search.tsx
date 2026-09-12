import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFamily } from '../../lib/family-context';
import {
  fetchCategories, ragSearch, indexStatus,
  type RagSearchResult, type RagHistoryTurn, type IndexStatus,
} from '../../lib/api';
import type { Database } from '../../lib/database.types';
import { usePreferences } from '../../lib/preferences';
import { phrase } from '../../lib/voice-languages';
import {
  recognitionSupported, listen, stopListening, speak, stopSpeaking, type SpeechErrorCode,
} from '../../lib/speech';
import { toSpeech } from '../../lib/speech-text';

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
  const { currentFamily, members } = useFamily();
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

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
    if (!q.trim() || !currentFamily || isAsking) return;
    const question = q.trim();
    setQuery('');
    setIsAsking(true);
    setVoiceNotice(null);
    // A spoken question gets a spoken answer. A typed one in voice mode too:
    // the setting is about hearing answers, not only about the mic — so this
    // holds even on a browser with no recogniser.
    const wantVoice = voiceMode || !!opts.spoken;
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
      const result = await ragSearch(currentFamily.id, question, history, {
        language: voiceMode ? voiceLanguage : undefined,
        voice: wantVoice,
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiPlaceholder.id
            ? { ...m, text: result.answer, sources: result.sources, debug: result.debug, loading: false }
            : m
        )
      );
      if (wantVoice) speakMessage(aiPlaceholder.id, result.answer, result.answer_language);
      if (result.debug?.index_rebuilding && currentFamily) repairIndex(currentFamily.id);
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
      if (wantVoice) speakMessage(aiPlaceholder.id, failed);
    } finally {
      setIsAsking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  // Tap to talk. The recogniser stops itself when the person pauses and the
  // transcript goes straight to search — no send step.
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
    switch (voiceStateRef.current) {
      case 'idle': startListening(); break;
      case 'listening': stopListening(); break;   // onend delivers what was said so far
      case 'thinking': break;                      // wait for the answer
      case 'speaking': startListening(); break;    // cut the voice off and ask again
    }
  };

  const voicePlaceholder = () => {
    if (!voiceSupported) return t('no_voice_support');
    if (voiceNotice) return voiceNotice;
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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            {hasMessages && (
              <TouchableOpacity
                onPress={() => { stopVoice(); setMessages([]); }}
                style={styles.backBtn}
              >
                <Feather name="arrow-left" size={24} color="#4B5563" />
              </TouchableOpacity>
            )}
            <Text style={styles.title}>Ask FamilyVault</Text>
            {hasMessages && (
              <TouchableOpacity onPress={() => { stopVoice(); setMessages([]); }} style={styles.newChatBtn}>
                <Feather name="plus" size={18} color="#2A3D66" />
              </TouchableOpacity>
            )}
          </View>
        </View>

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
                  <Feather name={voiceMode ? 'mic' : 'cpu'} size={32} color="#FFFFFF" />
                </LinearGradient>
                <Text style={styles.emptyTitle}>
                  {voiceMode ? t('empty_title') : 'Ask anything about your documents'}
                </Text>
                <Text style={styles.emptySub}>
                  {voiceMode ? t('empty_sub') : "I can find information across all your family's uploaded documents."}
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
                        {msg.role === 'ai' && voiceMode && (
                          <View style={styles.voiceTools}>
                            {speakingId === msg.id ? (
                              <TouchableOpacity style={styles.voiceToolBtn} onPress={stopVoice}>
                                <Feather name="square" size={14} color="#2A3D66" />
                                <Text style={styles.voiceToolText}>{t('stop')}</Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                style={styles.voiceToolBtn}
                                onPress={() => speakMessage(msg.id, msg.text)}
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
                                onPress={() => router.push(`/document/${s.id}` as any)}
                              >
                                <Feather name="file-text" size={12} color="#2A3D66" />
                                <Text style={styles.sourceText} numberOfLines={1}>{s.file_name}</Text>
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
              Improving search across languages… {indexFix.done_count}
              {indexFix.total_count > 0 ? ` of ${indexFix.total_count}` : ''} passages
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
        {indexFix?.error && (
          <View style={[styles.indexStrip, styles.indexStripError]}>
            <Feather name="alert-triangle" size={14} color="#9A6200" />
            <Text style={[styles.indexStripText, styles.indexStripErrorText]} numberOfLines={2}>
              Couldn't finish improving search: {indexFix.error}
            </Text>
          </View>
        )}

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <View style={styles.inputBox}>
            <Feather
              name={voiceMode ? 'mic' : 'message-circle'}
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
                accessibilityLabel={voicePlaceholder()}
                style={styles.micBtn}
              >
                {voiceState === 'thinking' ? (
                  <View style={[styles.micCircle, styles.micThinking]}>
                    <ActivityIndicator size="small" color="#6B7280" />
                  </View>
                ) : voiceState === 'listening' ? (
                  <View style={[styles.micCircle, styles.micListening]}>
                    <Feather name="mic" size={26} color="#FFFFFF" />
                  </View>
                ) : voiceState === 'speaking' ? (
                  <View style={[styles.micCircle, styles.micSpeaking]}>
                    <Feather name="volume-2" size={26} color="#FFFFFF" />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F9FC' },
  flex: { flex: 1 },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backBtn: { padding: 4 },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: '#2A3D66' },
  newChatBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatArea: { flex: 1 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  chatContent: { padding: 16, paddingBottom: 8 },
  // ─── Empty State ──────────────────────────────────────
  emptyWrapper: { flexGrow: 1, justifyContent: 'space-between' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  categoriesSection: { paddingHorizontal: 20, paddingBottom: 16 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937', textAlign: 'center', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  categoriesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 999,
  },
  categoryChipText: { fontSize: 12, color: '#374151' },
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
  messageText: {
    fontSize: 15,
    color: '#1F2937',
    lineHeight: 22,
  },
  userText: { color: '#FFFFFF' },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingText: { fontSize: 13, color: '#6B7280' },
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
  },
  sourceText: { fontSize: 11, color: '#2A3D66', fontWeight: '500', maxWidth: 150 },
  searchedFor: { fontSize: 11, color: '#9CA3AF', marginTop: 8, fontStyle: 'italic', lineHeight: 15 },
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
  indexStripText: { flex: 1, fontSize: 12, color: '#2A3D66' },
  indexStripError: { backgroundColor: '#FFF7E6', borderTopColor: '#F5D9A0' },
  indexStripErrorText: { color: '#7A5200' },
  // ─── Input Bar ────────────────────────────────────────
  inputBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FC',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingLeft: 14,
    paddingRight: 6,
    gap: 8,
    minHeight: 48,
  },
  inputIcon: { marginLeft: 2 },
  input: {
    flex: 1,
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
  micThinking: { backgroundColor: '#E5E7EB' },
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
