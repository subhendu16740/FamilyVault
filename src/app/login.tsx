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
import { color, radius, size, space, type } from '../constants/design';

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
              <Feather name="user" size={18} color="#9CA3AF" style={styles.inputIcon} />
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
            <Feather name="mail" size={18} color="#9CA3AF" style={styles.inputIcon} />
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
            <Feather name="lock" size={18} color="#9CA3AF" style={styles.inputIcon} />
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
              <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color="#9CA3AF" />
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
                  <Feather name="aperture" size={20} color="#FFFFFF" />
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
  safe: { flex: 1, backgroundColor: color.background },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingTop: 40,
    paddingBottom: space.xl,
    maxWidth: 390,
    alignSelf: 'center',
    width: '100%',
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
    boxShadow: '0px 2px 8px rgba(42, 61, 102, 0.25)',
    elevation: 4,
  },
  logoEmoji: { fontSize: 28 },
  logoTitle: { fontSize: 20, lineHeight: 26, fontWeight: '600', color: color.primary },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.inputBorder,
    marginBottom: space.md,
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
  inputWithTrailing: { paddingRight: space.sm },
  inputTrailing: {
    padding: 10,
    marginRight: -10,
  },
  signInBtn: {
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
    marginTop: space.xs,
    marginBottom: space.xl,
  },
  btnDisabled: { opacity: 0.7 },
  signInText: { ...type.button, color: '#FFFFFF' },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.lg,
    gap: space.md,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: color.border },
  dividerText: type.caption,
  socialBtn: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.inputBorder,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
    marginBottom: space.lg,
  },
  socialBtnText: { ...type.button, fontWeight: '500', color: color.textBody },
  biometricCard: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg,
    borderWidth: 1,
    borderColor: color.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  biometricIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  biometricInfo: { flex: 1 },
  biometricTitle: type.label,
  biometricSubtitle: type.caption,
  biometricEnable: { ...type.button, color: color.primary },
  spacer: { flex: 1 },
  createAccountBtn: { alignItems: 'center', justifyContent: 'center', minHeight: size.control, marginVertical: space.sm },
  createAccountText: { ...type.button, fontWeight: '500', color: color.primary },
});
