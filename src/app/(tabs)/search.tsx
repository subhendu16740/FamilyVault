import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFamily } from '../../lib/family-context';
import { fetchCategories, ragSearch, type RagSearchResult, type RagHistoryTurn } from '../../lib/api';
import type { Database } from '../../lib/database.types';

type DocumentCategory = Database['public']['Tables']['document_categories']['Row'];

interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  sources?: RagSearchResult['sources'];
  loading?: boolean;
}

export default function SearchScreen() {
  const { currentFamily, members } = useFamily();
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Build dynamic suggestions from family member names
  const suggestions = members.slice(0, 4).map((m) => {
    const name = m.alias || m.users.display_name;
    const docs = ['passport', 'health insurance', 'tax returns', 'birth certificate'];
    return `${name}'s ${docs[Math.floor(Math.random() * docs.length)]}`;
  });

  useEffect(() => {
    fetchCategories().then(setCategories).catch(console.error);
  }, []);

  const handleAsk = async (q: string) => {
    if (!q.trim() || !currentFamily || isAsking) return;
    const question = q.trim();
    setQuery('');
    setIsAsking(true);

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
      const result = await ragSearch(currentFamily.id, question, history);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiPlaceholder.id
            ? { ...m, text: result.answer, sources: result.sources, loading: false }
            : m
        )
      );
    } catch (err) {
      console.error('RAG error:', err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiPlaceholder.id
            ? { ...m, text: 'Sorry, I couldn\'t process your question. Please try again.', loading: false }
            : m
        )
      );
    } finally {
      setIsAsking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

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
                onPress={() => setMessages([])}
                style={styles.backBtn}
              >
                <Feather name="arrow-left" size={24} color="#4B5563" />
              </TouchableOpacity>
            )}
            <Text style={styles.title}>Ask FamilyVault</Text>
            {hasMessages && (
              <TouchableOpacity onPress={() => setMessages([])} style={styles.newChatBtn}>
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
                  <Feather name="cpu" size={32} color="#FFFFFF" />
                </LinearGradient>
                <Text style={styles.emptyTitle}>Ask anything about your documents</Text>
                <Text style={styles.emptySub}>
                  I can find information across all your family's uploaded documents.
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
                        <Text style={styles.typingText}>Searching documents...</Text>
                      </View>
                    ) : (
                      <>
                        <Text style={[
                          styles.messageText,
                          msg.role === 'user' && styles.userText,
                        ]}>
                          {msg.text}
                        </Text>
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

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <View style={styles.inputBox}>
            <Feather name="message-circle" size={18} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => handleAsk(query)}
              placeholder="Ask about your documents..."
              placeholderTextColor="#9CA3AF"
              returnKeyType="send"
              style={styles.input}
              editable={!isAsking}
            />
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
  sendBtn: {},
  sendBtnDisabled: { opacity: 0.5 },
  sendGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
