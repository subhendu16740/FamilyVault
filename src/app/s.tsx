// A document someone was sent a link to (migration 036). Public: whoever has
// the link opens it here, with no account. The link's secret is after '#',
// which browsers never send to a server, so it reaches only this page and the
// share function. Web only, like the links themselves.
//
// No ScreenHeader: for the person reading this it is not a screen of the
// app, and a back arrow to Home would take them to a sign-in they have no
// use for. The AuthGate leaves this route alone either way.

import { useEffect, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, ActivityIndicator, Platform, Linking, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openSharedDocument, type SharedDocument } from '../lib/api';
import { longDate } from '../lib/dates';
import { color, radius, shadow, size, space, type } from '../constants/design';

type State = 'loading' | 'gone' | 'unavailable' | 'error' | SharedDocument;

const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'webp'];

function open(url: string) {
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
  else Linking.openURL(url);
}

export default function SharedDocumentScreen() {
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    const token = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
    let cancelled = false;
    openSharedDocument(token)
      .then((result) => { if (!cancelled) setState(result); })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.brand}>
          <LinearGradient colors={['#2A3D66', '#4A6491']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logo}>
            <Feather name="lock" size={16} color="#FFFFFF" />
          </LinearGradient>
          <Text style={styles.brandName}>FamilyVault</Text>
        </View>

        {state === 'loading' ? (
          <View style={styles.card}>
            <ActivityIndicator color={color.primary} />
            <Text style={styles.muted}>Opening the document…</Text>
          </View>
        ) : typeof state === 'string' ? (
          <View style={styles.card}>
            <View style={styles.goneIcon}>
              <Feather name={state === 'gone' ? 'link-2' : 'alert-circle'} size={24} color="#9CA3AF" />
            </View>
            <Text style={styles.heading}>
              {state === 'gone' ? 'This link has expired or was turned off'
                : state === 'unavailable' ? 'Share links are not switched on yet'
                : 'Could not open this link'}
            </Text>
            <Text style={styles.muted}>
              {state === 'gone' ? 'Ask whoever sent it for a new one.'
                : state === 'unavailable' ? 'Try again later, or ask whoever sent it.'
                : 'Check your connection and try again.'}
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.overline}>
              {state.sharedBy ? `${state.sharedBy} shared a document with you` : 'A document shared with you'}
            </Text>
            <Text style={styles.heading}>{state.fileName}</Text>
            <Text style={styles.muted}>You can open it until {longDate(new Date(state.expiresAt))}.</Text>

            {IMAGE_TYPES.includes(state.fileType.toLowerCase()) && (
              <Image source={{ uri: state.url }} style={styles.preview} resizeMode="contain" accessibilityLabel={state.fileName} />
            )}

            <TouchableOpacity style={styles.primary} onPress={() => open(state.url)} accessibilityRole="button">
              <Feather name="external-link" size={16} color="#FFFFFF" />
              <Text style={styles.primaryText}>Open</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => open(state.downloadUrl)} accessibilityRole="button">
              <Feather name="download" size={16} color={color.primary} />
              <Text style={styles.secondaryText}>Download</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.footer}>
          {typeof state === 'object' ? 'Only this one document is shared, and only until the date above. ' : ''}
          FamilyVault keeps a family's documents safe and easy to find.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  page: { padding: space.lg, gap: space.lg, alignItems: 'center', paddingTop: 40 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  logo: { width: size.iconBox, height: size.iconBox, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  brandName: { ...type.title, color: color.primary },
  card: {
    width: '100%', maxWidth: 480, backgroundColor: color.surface, borderRadius: radius.card, padding: space.lg,
    gap: space.md, alignItems: 'stretch', ...shadow.card,
  },
  overline: { ...type.overline, color: color.accent },
  heading: { ...type.heading, color: color.text },
  muted: type.caption,
  goneIcon: { alignSelf: 'flex-start' },
  preview: { width: '100%', height: 320, borderRadius: radius.control, backgroundColor: color.divider },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    minHeight: size.control, borderRadius: radius.control, backgroundColor: color.primary,
  },
  primaryText: { ...type.button, color: '#FFFFFF' },
  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    minHeight: size.control, borderRadius: radius.control, borderWidth: 1, borderColor: color.border,
  },
  secondaryText: { ...type.button, color: color.primary },
  footer: { ...type.caption, textAlign: 'center', maxWidth: 480 },
});
