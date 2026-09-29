// Settings › Help & FAQ — short answers, a way to send feedback, and how to
// reach the team. Keep the answers true of the app as it is.

import { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SUPPORT_EMAIL, SUPPORT_PHONE } from '../../lib/app-info';
import { ScreenHeader } from '../../components/screen-header';
import { Card, CardTitle, Body, PrimaryButton, screenStyles } from '../../components/settings-ui';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'How do I add a document?',
    a: 'Open Upload at the bottom of the screen. Take a photo with Scan, pick a file with Browse Files, or choose a picture from your Gallery. FamilyVault reads the text, so you can find it later. On a computer you can also bring documents in From Gmail.',
  },
  {
    q: 'How do I find a document or an answer?',
    a: 'Open Search and ask in your own words, for example "When does Mom\'s passport expire?". FamilyVault answers and shows which document the answer came from.',
  },
  {
    q: 'Can I ask by speaking?',
    a: 'Yes. Turn on the Voice assistant in Settings, under Accessibility. Then tap the microphone on Search and say your question. The answer is read out loud.',
  },
  {
    q: 'Who can see my documents?',
    a: 'Only the people in your family. An admin adds each person by the email they sign in with; nobody can join by themselves. Settings › Privacy has more.',
  },
  {
    q: 'How do I add someone to my family?',
    a: 'If you are an admin, open Manage Family and choose Add Member, then type the email they use for FamilyVault. They need to have signed up first.',
  },
  {
    q: 'What does ★ Family Plus mean?',
    a: 'Family Plus is the paid plan, coming soon. Things marked with ★, like reminders before a document runs out, will be part of it.',
  },
  {
    q: 'Why can\'t FamilyVault find something that is in a document?',
    a: 'A blurred or dark photo is hard to read. Try again in good light, holding the phone steady. If your documents are in another language, choose it in Settings, under Documents.',
  },
];

export default function HelpScreen() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Help & FAQ" fallback="/settings" />
      <ScrollView contentContainerStyle={screenStyles.body}>
        <Text style={styles.sectionTitle}>Questions people ask</Text>
        <View style={styles.faqCard}>
          {FAQ.map((item, i) => {
            const expanded = open === i;
            return (
              <View key={item.q} style={[styles.faqItem, i > 0 && styles.faqBorder]}>
                <TouchableOpacity
                  style={styles.faqQuestion}
                  onPress={() => setOpen(expanded ? null : i)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                >
                  <Text style={styles.faqQ}>{item.q}</Text>
                  <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color="#4A6491" />
                </TouchableOpacity>
                {expanded && <Text style={styles.faqA}>{item.a}</Text>}
              </View>
            );
          })}
        </View>

        <Card>
          <CardTitle icon="send">Send us feedback</CardTitle>
          <Body>Something not working, an idea, or a question? Write to us here — it goes straight to the FamilyVault team.</Body>
          <PrimaryButton label="Send feedback" icon="edit-3" onPress={() => router.push('/settings/feedback' as any)} />
        </Card>

        <Card>
          <CardTitle icon="phone">Contact us</CardTitle>
          {!!SUPPORT_EMAIL && (
            <TouchableOpacity
              style={styles.contactRow}
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
              accessibilityRole="link"
            >
              <Feather name="mail" size={20} color="#2A3D66" />
              <Text style={styles.contactText}>{SUPPORT_EMAIL}</Text>
            </TouchableOpacity>
          )}
          {!!SUPPORT_PHONE && (
            <TouchableOpacity
              style={styles.contactRow}
              onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE.replace(/[^\d+]/g, '')}`)}
              accessibilityRole="link"
            >
              <Feather name="phone" size={20} color="#2A3D66" />
              <Text style={styles.contactText}>{SUPPORT_PHONE}</Text>
            </TouchableOpacity>
          )}
          {!SUPPORT_EMAIL && !SUPPORT_PHONE && (
            <Body>Send feedback, above, reaches the FamilyVault team directly.</Body>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937' },
  faqCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)',
    elevation: 3,
  },
  faqItem: { paddingHorizontal: 16 },
  faqBorder: { borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  faqQuestion: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 12 },
  faqQ: { flex: 1, fontSize: 17, fontWeight: '600', color: '#1F2937' },
  faqA: { fontSize: 16, lineHeight: 24, color: '#374151', paddingBottom: 16 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  contactText: { fontSize: 17, fontWeight: '600', color: '#2A3D66' },
});
