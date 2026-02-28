import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';

export default function LoginScreen() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter email and password.');
      return;
    }
    if (isSignUp && !displayName.trim()) {
      Alert.alert('Missing fields', 'Please enter your name.');
      return;
    }

    setLoading(true);
    const { error } = isSignUp
      ? await signUp(email.trim(), password, displayName.trim())
      : await signIn(email.trim(), password);
    setLoading(false);

    if (error) {
      Alert.alert(isSignUp ? 'Sign Up Failed' : 'Sign In Failed', error);
      return;
    }

    if (isSignUp) {
      Alert.alert('Account Created', 'Please check your email to verify your account, then sign in.', [
        { text: 'OK', onPress: () => setIsSignUp(false) },
      ]);
    } else {
      router.replace('/home' as any);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View style={styles.logoSection}>
            <LinearGradient
              colors={['#2A3D66', '#4A6491']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoBox}
            >
              <Text style={styles.logoEmoji}>🏛️</Text>
            </LinearGradient>
            <Text style={styles.logoTitle}>FamilyVault</Text>
          </View>

          {/* Display Name (sign up only) */}
          {isSignUp && (
            <View style={styles.inputWrapper}>
              <Feather name="user" size={20} color="#9CA3AF" style={styles.inputIcon} />
              <TextInput
                placeholder="Full Name"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="words"
                value={displayName}
                onChangeText={setDisplayName}
                style={styles.input}
              />
            </View>
          )}

          {/* Email */}
          <View style={styles.inputWrapper}>
            <Feather name="mail" size={20} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              placeholder="Email"
              placeholderTextColor="#9CA3AF"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
            />
          </View>

          {/* Password */}
          <View style={styles.inputWrapper}>
            <Feather name="lock" size={20} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              placeholder="Password"
              placeholderTextColor="#9CA3AF"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              style={[styles.input, styles.inputWithTrailing]}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.inputTrailing}
            >
              <Feather name={showPassword ? 'eye-off' : 'eye'} size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmit}
            activeOpacity={0.85}
            disabled={loading}
          >
            <LinearGradient
              colors={['#2A3D66', '#4A6491']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.signInBtn, loading && styles.btnDisabled]}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.signInText}>
                  {isSignUp ? 'Create Account' : 'Sign In'}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Divider + Social + Biometric (sign in only) */}
          {!isSignUp && (
            <>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or continue with</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Google Sign In */}
              <TouchableOpacity
                style={styles.socialBtn}
                onPress={async () => {
                  setGoogleLoading(true);
                  const { error } = await signInWithGoogle();
                  setGoogleLoading(false);
                  if (error) {
                    Alert.alert('Google Sign In Failed', error);
                  } else {
                    router.replace('/home' as any);
                  }
                }}
                disabled={googleLoading}
                activeOpacity={0.85}
              >
                {googleLoading ? (
                  <ActivityIndicator color="#2A3D66" />
                ) : (
                  <Text style={styles.socialBtnText}>Google</Text>
                )}
              </TouchableOpacity>

              {/* Biometric */}
              <View style={styles.biometricCard}>
                <LinearGradient
                  colors={['#D4807B', '#2A3D66']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.biometricIcon}
                >
                  <Feather name="aperture" size={24} color="#FFFFFF" />
                </LinearGradient>
                <View style={styles.biometricInfo}>
                  <Text style={styles.biometricTitle}>Biometric Login</Text>
                  <Text style={styles.biometricSubtitle}>Use Face ID or Fingerprint</Text>
                </View>
                <TouchableOpacity>
                  <Text style={styles.biometricEnable}>Enable</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <View style={styles.spacer} />

          {/* Toggle Sign In / Sign Up */}
          <TouchableOpacity
            style={styles.createAccountBtn}
            onPress={() => setIsSignUp(!isSignUp)}
          >
            <Text style={styles.createAccountText}>
              {isSignUp ? 'Already have an account? Sign In' : 'Create account'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F9FC' },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 24,
    maxWidth: 390,
    alignSelf: 'center',
    width: '100%',
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoBox: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  logoEmoji: { fontSize: 36 },
  logoTitle: { fontSize: 22, fontWeight: '700', color: '#2A3D66' },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
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
  inputWithTrailing: { paddingRight: 8 },
  inputTrailing: {
    padding: 8,
    marginRight: -8,
  },
  signInBtn: {
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    marginBottom: 24,
  },
  btnDisabled: { opacity: 0.7 },
  signInText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#D1D5DB' },
  dividerText: { fontSize: 13, color: '#6B7280' },
  socialBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    marginBottom: 16,
  },
  socialBtnText: { fontSize: 15, fontWeight: '500', color: '#374151' },
  biometricCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  biometricIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  biometricInfo: { flex: 1 },
  biometricTitle: { fontSize: 15, fontWeight: '600', color: '#1F2937' },
  biometricSubtitle: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  biometricEnable: { fontSize: 15, fontWeight: '500', color: '#2A3D66' },
  spacer: { flex: 1 },
  createAccountBtn: { alignItems: 'center', paddingVertical: 16 },
  createAccountText: { fontSize: 15, fontWeight: '500', color: '#2A3D66' },
});
