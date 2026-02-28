import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import { createNewFamily } from '../lib/api';

export default function SetupFamilyScreen() {
  const { user } = useAuth();
  const { refreshFamilies } = useFamily();
  const [familyName, setFamilyName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!familyName.trim()) {
      Alert.alert('Required', 'Please enter a family name.');
      return;
    }
    if (!user) return;

    setLoading(true);
    try {
      await createNewFamily(user.id, familyName.trim(), description.trim() || undefined);
      await refreshFamilies();
      router.replace('/home' as any);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create family.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
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
            Set up a secure space for your family's documents. You can invite members after creation.
          </Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Family Name</Text>
            <View style={styles.inputWrapper}>
              <Feather name="users" size={20} color="#9CA3AF" style={styles.inputIcon} />
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
              <Feather name="file-text" size={20} color="#9CA3AF" style={styles.inputIcon} />
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
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.createBtnText}>Create Family Vault</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Feather name="lock" size={18} color="#2A3D66" />
          <View style={styles.infoTextWrap}>
            <Text style={styles.infoTitle}>Private & Isolated</Text>
            <Text style={styles.infoSub}>
              Your family gets a completely isolated storage space. Documents are only visible to family members.
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F9FC' },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    maxWidth: 390,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconEmoji: { fontSize: 36 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2A3D66',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  form: { gap: 16, marginBottom: 24 },
  field: {},
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  fieldOptional: { fontWeight: '400', color: '#9CA3AF' },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 56,
    paddingHorizontal: 16,
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1F2937',
    paddingVertical: 4,
    outlineStyle: 'none',
  } as any,
  createBtn: {
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    marginBottom: 24,
  },
  btnDisabled: { opacity: 0.7 },
  createBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#EFF6FF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    alignItems: 'flex-start',
  },
  infoTextWrap: { flex: 1 },
  infoTitle: { fontSize: 14, fontWeight: '600', color: '#2A3D66', marginBottom: 4 },
  infoSub: { fontSize: 13, color: '#6B7280', lineHeight: 19 },
});
