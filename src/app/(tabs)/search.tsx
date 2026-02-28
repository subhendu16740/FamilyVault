import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFamily } from '../../lib/family-context';
import { fetchCategories, searchDocuments } from '../../lib/api';
import type { FamilySearchResultRow, Database } from '../../lib/database.types';

type DocumentCategory = Database['public']['Tables']['document_categories']['Row'];
type SearchState = 'empty' | 'results';

export default function SearchScreen() {
  const { currentFamily, members } = useFamily();
  const [searchState, setSearchState] = useState<SearchState>('empty');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FamilySearchResultRow[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [searching, setSearching] = useState(false);

  // Build dynamic suggestions from family member names
  const suggestions = members.slice(0, 4).map((m) => {
    const name = m.alias || m.users.display_name;
    const docs = ['passport', 'health insurance', 'tax returns', 'birth certificate'];
    return `${name}'s ${docs[Math.floor(Math.random() * docs.length)]}`;
  });

  useEffect(() => {
    fetchCategories().then(setCategories).catch(console.error);
  }, []);

  const handleSearch = async (q: string) => {
    if (!q.trim() || !currentFamily) return;
    setQuery(q);
    setSearching(true);
    setSearchState('results');
    try {
      const data = await searchDocuments(currentFamily.id, q.trim());
      setResults(data);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const resultBorderColor = (relevance: string) => {
    if (relevance === 'filename') return '#BBF7D0';
    if (relevance === 'content') return '#FDE68A';
    return '#E5E7EB';
  };

  const confidenceStyle = (relevance: string) => {
    if (relevance === 'filename') return { bg: '#DCFCE7', text: '#15803D', label: 'Name' };
    if (relevance === 'content') return { bg: '#FEF3C7', text: '#B45309', label: 'Content' };
    return { bg: '#F3F4F6', text: '#6B7280', label: 'Partial' };
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {searchState !== 'empty' && (
            <TouchableOpacity
              onPress={() => { setSearchState('empty'); setQuery(''); }}
              style={styles.backBtn}
            >
              <Feather name="arrow-left" size={24} color="#4B5563" />
            </TouchableOpacity>
          )}
          <Text style={styles.title}>Search</Text>
        </View>

        {/* Search Input */}
        <View style={styles.searchBox}>
          <Feather name="search" size={20} color="#9CA3AF" style={styles.searchIcon} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => query.trim() && handleSearch(query)}
            placeholder="Try: Dad's passport"
            placeholderTextColor="#9CA3AF"
            returnKeyType="search"
            style={styles.searchInput}
          />
          <TouchableOpacity style={styles.micBtn}>
            <Feather name="mic" size={20} color="#9CA3AF" />
          </TouchableOpacity>
        </View>

        {/* Quick toggle */}
        {searchState === 'results' && (
          <View style={styles.toggleRow}>
            <TouchableOpacity
              onPress={() => { setSearchState('empty'); setQuery(''); setResults([]); }}
              style={styles.toggleBtnBlue}
            >
              <Text style={styles.toggleTextBlue}>Clear Search</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Empty State */}
        {searchState === 'empty' && (
          <View style={styles.body}>
            <Text style={styles.sectionTitle}>Try asking</Text>
            <View style={styles.suggestionsGrid}>
              {suggestions.map((s, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.suggestionCard}
                  onPress={() => handleSearch(s)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.suggestionText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Categories</Text>
            <View style={styles.categoriesWrap}>
              {categories.slice(0, 8).map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={styles.categoryChip}
                  onPress={() => handleSearch(cat.name)}
                >
                  <Text style={styles.categoryChipText}>{cat.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Results State */}
        {searchState === 'results' && (
          <View style={styles.body}>
            <Text style={styles.sectionTitle}>
              {searching ? 'Searching...' : `${results.length} Result${results.length !== 1 ? 's' : ''}`}
            </Text>

            {searching ? (
              <ActivityIndicator size="small" color="#2A3D66" style={{ marginTop: 20 }} />
            ) : results.length === 0 ? (
              <View style={styles.emptyResults}>
                <Feather name="search" size={40} color="#D1D5DB" />
                <Text style={styles.emptyResultsTitle}>No results found</Text>
                <Text style={styles.emptyResultsSub}>Try a different search term</Text>
              </View>
            ) : (
              <View style={styles.resultsList}>
                {results.map((result) => {
                  const conf = confidenceStyle(result.relevance);
                  return (
                    <TouchableOpacity
                      key={result.id}
                      style={[styles.resultCard, { borderColor: resultBorderColor(result.relevance) }]}
                      onPress={() => router.push(`/document/${result.id}` as any)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.resultInner}>
                        <LinearGradient
                          colors={['#2A3D66', '#4A6491']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.resultIcon}
                        >
                          <Feather name="file-text" size={22} color="#FFFFFF" />
                        </LinearGradient>
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultTitle} numberOfLines={1}>{result.file_name}</Text>
                          <Text style={styles.resultMatch}>
                            {[result.category_name, result.member_name].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        <View style={[styles.confidenceBadge, { backgroundColor: conf.bg }]}>
                          <Text style={[styles.confidenceText, { color: conf.text }]}>
                            {conf.label}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 22, fontWeight: '700', color: '#2A3D66' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FC',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    minHeight: 56,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: '#1F2937', paddingVertical: 4, outlineStyle: 'none' } as any,
  micBtn: { padding: 8, marginRight: -8 },
  toggleRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  toggleBtnBlue: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  toggleTextBlue: { fontSize: 13, fontWeight: '500', color: '#2A3D66' },
  toggleBtnAmber: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  toggleTextAmber: { fontSize: 13, fontWeight: '500', color: '#B45309' },
  scroll: { flex: 1 },
  body: { padding: 24 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#1F2937', marginBottom: 16 },
  suggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  suggestionCard: {
    width: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    minHeight: 80,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  suggestionText: { fontSize: 13, color: '#374151' },
  categoriesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 999,
    minHeight: 44,
    justifyContent: 'center',
  },
  categoryChipText: { fontSize: 13, color: '#374151' },
  aiCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  aiCardTitle: { fontSize: 12, fontWeight: '700', color: '#14532D', marginBottom: 12 },
  aiTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  aiTag: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  aiTagMuted: { fontSize: 13, color: '#6B7280' },
  aiTagBold: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  resultsList: { gap: 12 },
  resultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 2,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  resultInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultInfo: { flex: 1 },
  resultTitle: { fontSize: 15, fontWeight: '600', color: '#1F2937', marginBottom: 4 },
  resultMatch: { fontSize: 11, color: '#9CA3AF' },
  confidenceBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  confidenceText: { fontSize: 12, fontWeight: '700' },
  emptyResults: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyResultsTitle: { fontSize: 16, fontWeight: '600', color: '#6B7280' },
  emptyResultsSub: { fontSize: 13, color: '#9CA3AF' },
});
