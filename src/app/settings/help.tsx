// Settings › Help & FAQ — short answers, a way to send feedback, and how to
// reach the team. Keep the answers true of the app as it is.

import { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SUPPORT_EMAIL, SUPPORT_PHONE } from '../../lib/app-info';
import { DEFAULT_PLAN_LIMITS, FREE_STORAGE_LABEL, PLUS_FOR_SALE, formatBytes, plusPrice } from '../../lib/plans';
import { ScreenHeader } from '../../components/screen-header';
import { Card, CardTitle, Body, PrimaryButton, screenStyles } from '../../components/settings-ui';
import { color, radius, shadow, space, type } from '../../constants/design';

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
    a: 'Only the people in your family — and anyone you send a share link to, for that one document, until the link stops working. An admin invites each person by the email they sign in with, and they join only if they accept; nobody can join by themselves. Settings › Privacy has more.',
  },
  {
    q: 'How do I share a document with someone outside the family?',
    a: 'Open the document, choose Share, then Make a link, and send the link by message or email. Anyone with it can open that one document, without an account, for 1, 7 or 30 days. The same screen shows every working link and how often it was opened, and turns a link off at once. A family admin, whoever added the document, or the person it belongs to can share it. For now, Share is in FamilyVault on the web.',
  },
  {
    q: 'How do I add someone to my family?',
    a: 'If you are an admin, open Manage Family and choose Add, then type the email they use for FamilyVault. They need to have signed up first. They get an invitation and join once they accept — until then they show in Manage Family as Pending approval, and you can withdraw it.',
  },
  {
    q: 'Someone invited me to their family. What do I do?',
    a: 'The invitation is on Home and in Manage Family. Choose Accept to join and see the family\'s documents, or Decline to say no. Nobody is added to a family without saying yes, and you can leave a family at any time from Manage Family.',
  },
  {
    q: 'Who is in the family tree?',
    a: 'Everyone in your family, with or without an account — a grandmother who will never sign in included. Admins add people and say how they are related; everyone in the family sees the tree, with each person named from where you stand (Nani, Bua, Mama…). A green phone on someone\'s picture means they are on FamilyVault with their own account; nobody else needs one. You can change your own name and date of birth. Mark a document as someone\'s and you can ask about it by relation, like "Nani\'s pension papers".',
  },
  {
    q: 'Someone in our tree has just signed up. How do I connect them?',
    a: 'If you are an admin, open them in the family tree and choose Link to their FamilyVault account, then type the email they sign in with. They get an invitation, and once they accept they join the family as a viewer and keep their place in the tree, their documents and their emergency card. If you already added them in Manage Family and they now appear twice, linking makes the two one.',
  },
  {
    q: 'What is an emergency card?',
    a: 'Each person in your family tree can have one: blood group, allergies, health conditions, medicines, their doctor, health insurance and up to three people to call. Open Emergency cards from the menu, or the person\'s page, to show it to a doctor; every phone number on it is one tap from your phone. Everyone in the family can see it; an admin, or the person themselves, can change it.',
  },
  {
    q: 'How much space does my family get?',
    a: `Every family gets ${FREE_STORAGE_LABEL} free for its documents, in total. ★ Family Plus gives ${formatBytes(DEFAULT_PLAN_LIMITS.plus)}, for ${plusPrice('inr')} in India or ${plusPrice('usd')} elsewhere. Every plan has a limit: when a family's space is full, new documents can't be added until some are deleted${PLUS_FOR_SALE ? ', or the family moves to a bigger plan' : ''}. Nothing is ever deleted for you. Settings › Storage shows how much is used.`,
  },
  {
    q: 'How do reminders work?',
    a: 'When a document with an expiry date is added, FamilyVault reminds everyone in the family 90, 30 and 7 days before it expires, and on the day — under the bell on Home. To get them as notifications on your phone or computer, even when FamilyVault is closed, open Settings › Notifications and turn them on for that device. On iPhone, add FamilyVault to your Home Screen first. Birthdays in your family tree are reminded of on the morning of the day; switch them off in Settings › Notifications if you would rather not. It is free.',
  },
  {
    q: 'What does ★ Family Plus mean?',
    a: `Family Plus is the paid plan for the whole family, ${plusPrice('inr')} in India or ${plusPrice('usd')} elsewhere, coming soon. It gives ${formatBytes(DEFAULT_PLAN_LIMITS.plus)} of space, and things marked with ★, like the reminders page and bringing documents in from Gmail, are part of it; until it can be bought, those work for everyone.`,
  },
  {
    q: 'How do I delete my account?',
    a: 'Open Settings › Security and choose Delete account. It is immediate and nothing is kept. A family nobody else looks after is deleted with it, documents and all; the screen shows which ones before you confirm. To keep a family for the others, make one of them an admin first.',
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
                  <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={color.secondary} />
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
              <Feather name="mail" size={16} color={color.primary} />
              <Text style={styles.contactText}>{SUPPORT_EMAIL}</Text>
            </TouchableOpacity>
          )}
          {!!SUPPORT_PHONE && (
            <TouchableOpacity
              style={styles.contactRow}
              onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE.replace(/[^\d+]/g, '')}`)}
              accessibilityRole="link"
            >
              <Feather name="phone" size={16} color={color.primary} />
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
  sectionTitle: { ...type.overline, marginLeft: space.xs },
  faqCard: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    ...shadow.card,
  },
  faqItem: { paddingHorizontal: space.lg },
  faqBorder: { borderTopWidth: 1, borderTopColor: color.divider },
  faqQuestion: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingVertical: 10 },
  faqQ: { ...type.label, flex: 1 },
  faqA: { ...type.body, paddingBottom: space.lg },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  contactText: { ...type.label, color: color.primary },
});
