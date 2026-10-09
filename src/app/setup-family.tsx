import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import { createNewFamily } from '../lib/api';
import { BackButton } from '../components/back-button';
import { color, radius, size, space, type } from '../constants/design';

export default function SetupFamilyScreen() {
  const { user } = useAuth();
  // First sign-in has nowhere to go back to — the app sends people here
  // until they have a vault. Someone who already has one came from Manage
  // Family to make another, and needs a way out.
  const { families, refreshFamilies, switchFamily } = useFamily();
  const [familyName, setFamilyName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  // Said on the screen, not in an alert: an alert shows nothing in a browser.
  // `plus`: refused because on Free a person creates one family (050).
  const [problem, setProblem] = useState<{ message: string; plus: boolean } | null>(null);

  const handleCreate = async () => {
    setProblem(null);
    if (!familyName.trim()) {
      setProblem({ message: 'Please enter a family name.', plus: false });
      return;
    }
    if (!user) return;

    setLoading(true);
    try {
      const familyId = await createNewFamily(user.id, familyName.trim(), description.trim() || undefined);
      await refreshFamilies();
      // Their own new family, so it opens: making it is their own choice.
      switchFamily(familyId);
      router.replace('/home' as any);
    } catch (err: any) {
      setProblem({ message: err?.message || 'Failed to create family.', plus: err?.hint === 'family_limit' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {families.length > 0 && (
        <View style={styles.backRow}>
          <BackButton fallback="/family" />
        </View>
      )}
      <View style={[styles.container, families.length > 0 && styles.containerBelowBack]}>

        {/* Header */}
        <View style={styles.header}>
          <LinearGradient
            colors={['#2A3D66', '#4A6491']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconBox}
          >
            <Text style={styles.iconEmoji}>🏛️</Text>
          </LinearGradient>
          <Text style={styles.title}>Create Your Family Vault</Text>
          <Text style={styles.subtitle}>
            A vault you share: everyone you invite sees its documents. Your personal vault stays yours alone.
          </Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Family Name</Text>
            <View style={styles.inputWrapper}>
              <Feather name="users" size={18} color="#9CA3AF" style={styles.inputIcon} />
              <TextInput
                placeholder="e.g. The Sharma Family"
                placeholderTextColor="#9CA3AF"
                value={familyName}
                onChangeText={setFamilyName}
                style={styles.input}
                autoFocus
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Description <Text style={styles.fieldOptional}>(optional)</Text>
            </Text>
            <View style={styles.inputWrapper}>
              <Feather name="file-text" size={18} color="#9CA3AF" style={styles.inputIcon} />
              <TextInput
                placeholder="A short description"
                placeholderTextColor="#9CA3AF"
                value={description}
                onChangeText={setDescription}
                style={styles.input}
              />
            </View>
          </View>
        </View>

        {problem && (
          <View style={styles.problem} accessibilityRole="alert">
            <Feather name="alert-circle" size={16} color={color.danger} style={styles.problemIcon} />
            <View style={styles.problemTextWrap}>
              <Text style={styles.problemText}>{problem.message}</Text>
              {problem.plus && (
                <Text style={styles.problemLink} accessibilityRole="link" onPress={() => router.push('/plus' as any)}>
                  See Family Plus ›
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Create Button */}
        <TouchableOpacity
          onPress={handleCreate}
          activeOpacity={0.85}
          disabled={loading}
        >
          <LinearGradient
            colors={['#2A3D66', '#4A6491']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.createBtn, loading && styles.btnDisabled]}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.createBtnText}>Create Family Vault</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Feather name="lock" size={16} color={color.primary} style={styles.infoIcon} />
          <View style={styles.infoTextWrap}>
            <Text style={styles.infoTitle}>Just for your family</Text>
            <Text style={styles.infoSub}>
              Your family gets its own space. In AskLocker, only the people in your family can open its documents.
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  // The arrow sits where every other screen has it: the top-left of a 56px bar.
  backRow: { height: size.bar, justifyContent: 'center', paddingLeft: space.xs },
  container: {
    flex: 1,
    paddingHorizontal: space.lg,
    paddingTop: 40,
    maxWidth: 390,
    alignSelf: 'center',
    width: '100%',
  },
  containerBelowBack: { paddingTop: space.sm },
  header: {
    alignItems: 'center',
    marginBottom: space.xl + 8,
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  iconEmoji: { fontSize: 28 },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: color.primary,
    textAlign: 'center',
    marginBottom: space.sm,
  },
  subtitle: {
    ...type.body,
    color: color.textMuted,
    textAlign: 'center',
    maxWidth: 300,
  },
  form: { gap: space.lg, marginBottom: space.xl },
  field: {},
  fieldLabel: {
    ...type.caption,
    fontWeight: '500',
    color: color.textBody,
    marginBottom: 6,
  },
  fieldOptional: { fontWeight: '400', color: '#9CA3AF' },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.inputBorder,
    minHeight: size.control,
    paddingHorizontal: space.md,
  },
  inputIcon: { marginRight: space.sm },
  input: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: color.text,
    paddingVertical: space.xs,
    outlineStyle: 'none',
  } as any,
  createBtn: {
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
    marginBottom: space.xl,
  },
  btnDisabled: { opacity: 0.7 },
  problem: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: '#FEF2F2',
    borderRadius: radius.control,
    padding: space.md,
    marginBottom: space.lg,
  },
  problemIcon: { marginTop: 2 },
  problemTextWrap: { flex: 1, gap: space.xs },
  problemText: { ...type.caption, color: '#991B1B' },
  problemLink: { ...type.caption, fontWeight: '600', color: color.primary },
  createBtnText: { ...type.button, color: '#FFFFFF' },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: color.tint,
    borderRadius: radius.control,
    padding: space.md,
    gap: space.md,
    alignItems: 'flex-start',
  },
  infoIcon: { marginTop: 2 },
  infoTextWrap: { flex: 1 },
  infoTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: color.primary, marginBottom: 2 },
  infoSub: type.caption,
});
