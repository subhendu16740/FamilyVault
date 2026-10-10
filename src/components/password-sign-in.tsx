// Email and password, on test builds only — DEV and previews, where
// isProduction is false. QA's accounts sign in with passwords, and testing
// with several accounts is easier with them than with several Google
// accounts. Production signs in with Google only: login.tsx never shows
// this there.
//
// What goes wrong is said on the screen: Alert.alert does nothing on the web.

import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { color, radius, size, space, type } from '../constants/design';

export function PasswordSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { signInWithPassword, signUpWithPassword } = useAuth();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setNote({ kind: 'error', text: 'Enter your email and password.' });
      return;
    }
    if (creating && !name.trim()) {
      setNote({ kind: 'error', text: 'Enter a name.' });
      return;
    }
    setBusy(true);
    setNote(null);
    if (creating) {
      const { error, signedIn } = await signUpWithPassword(email.trim(), password, name.trim());
      setBusy(false);
      if (error) setNote({ kind: 'error', text: `Not created: ${error}` });
      else if (signedIn) onSignedIn();
      else {
        setCreating(false);
        setNote({ kind: 'ok', text: 'Created. Confirm your email, then sign in.' });
      }
      return;
    }
    const { error } = await signInWithPassword(email.trim(), password);
    setBusy(false);
    if (error) setNote({ kind: 'error', text: `Not signed in: ${error}` });
    else onSignedIn();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>Test builds only</Text>
        <View style={styles.dividerLine} />
      </View>
      <Text style={styles.intro}>For test accounts. The live app uses Google only.</Text>

      {creating && (
        <View style={styles.inputWrapper}>
          <Feather name="user" size={16} color="#9CA3AF" style={styles.inputIcon} />
          <TextInput
            placeholder="Name"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="words"
            value={name}
            onChangeText={setName}
            style={styles.input}
            accessibilityLabel="Name"
          />
        </View>
      )}
      <View style={styles.inputWrapper}>
        <Feather name="mail" size={16} color="#9CA3AF" style={styles.inputIcon} />
        <TextInput
          placeholder="Email"
          placeholderTextColor="#9CA3AF"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
          accessibilityLabel="Email"
        />
      </View>
      <View style={styles.inputWrapper}>
        <Feather name="lock" size={16} color="#9CA3AF" style={styles.inputIcon} />
        <TextInput
          placeholder="Password"
          placeholderTextColor="#9CA3AF"
          secureTextEntry={!showPassword}
          autoComplete={creating ? 'new-password' : 'current-password'}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
          style={styles.input}
          accessibilityLabel="Password"
        />
        <TouchableOpacity
          onPress={() => setShowPassword(!showPassword)}
          style={styles.eye}
          accessibilityRole="button"
          accessibilityLabel={showPassword ? 'Hide the password' : 'Show the password'}
        >
          <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      {!!note && (
        <Text style={[styles.note, note.kind === 'error' && styles.noteError]} accessibilityRole="alert">{note.text}</Text>
      )}

      <TouchableOpacity
        style={[styles.button, busy && styles.buttonBusy]}
        onPress={submit}
        disabled={busy}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : (
          <Text style={styles.buttonText}>{creating ? 'Create test account' : 'Sign in'}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.switch}
        onPress={() => { setCreating(!creating); setNote(null); }}
        accessibilityRole="button"
      >
        <Text style={styles.switchText}>{creating ? 'Have a test account? Sign in' : 'Create a test account'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.xl, gap: space.md },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: color.border },
  dividerText: type.overline,
  intro: { ...type.caption, textAlign: 'center' },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: radius.control,
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
  eye: { width: size.control, height: size.control, alignItems: 'center', justifyContent: 'center', marginRight: -space.md },
  note: { ...type.caption, color: '#166534', textAlign: 'center' },
  noteError: { color: color.danger },
  button: {
    backgroundColor: color.primary,
    borderRadius: radius.control,
    minHeight: size.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { ...type.button, color: '#FFFFFF' },
  switch: { minHeight: size.control, alignItems: 'center', justifyContent: 'center' },
  switchText: { ...type.button, fontWeight: '500', color: color.primary },
});
