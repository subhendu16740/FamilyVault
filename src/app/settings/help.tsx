// Settings › Help & FAQ — short answers, a way to send feedback, and how to
// reach the team. Keep the answers true of the app as it is: what Family Plus
// costs and how to pay follow the payments function's answer (044).

import { useMemo, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SUPPORT_EMAIL, SUPPORT_PHONE } from '../../lib/app-info';
import {
  DEFAULT_PLAN_LIMITS, FREE_PERSONAL_STORAGE_LABEL, FREE_STORAGE_LABEL, MAX_FILE_BYTES, PLUS_FOR_SALE, formatBytes, plusPrice, plusPrices,
  plusYearlyOffer, plusYearlySaving,
} from '../../lib/plans';
import { usePaymentsStatus } from '../../lib/family-plan';
import { lockAfterText } from '../../lib/app-lock';
import type { PaymentsStatus } from '../../lib/api';
import { ScreenHeader } from '../../components/screen-header';
import { Card, CardTitle, Body, PrimaryButton, screenStyles } from '../../components/settings-ui';
import { color, radius, shadow, space, type } from '../../constants/design';

function faq(payments: PaymentsStatus | null): { q: string; a: string }[] {
  const forSale = payments?.available ?? PLUS_FOR_SALE;
  return [
    {
      q: 'How do I add a document?',
      a: 'Tap Upload, then Scan, Browse Files or Gallery. If you\'re in a family, you choose which vault it goes to. With ★ Family Plus, you can also bring documents in From Gmail on a computer.',
    },
    {
      q: 'What is my personal vault?',
      a: 'Everyone gets a personal vault, and nobody else can join it. If you\'re not in a family, your uploads go there. To share documents, create or join a family in Manage Family.',
    },
    {
      q: 'How do I see or delete documents?',
      a: 'On Home, tap the document count or See all. Tap the bin to delete one, or Select to delete several. You can only delete documents you added, and deleting can\'t be undone.',
    },
    {
      q: 'How do I find something?',
      a: 'Tap the round Ask button and ask in your own words, like "When does Mom\'s passport expire?". AskLocker searches all your vaults and shows which document the answer came from. For a faster answer, pick one vault under Search in.',
    },
    {
      q: 'How many questions can I ask?',
      a: `On Free, you can ask ${DEFAULT_PLAN_LIMITS.questions.free} questions a month, and the count starts again on the 1st. Questions that get no answer don't count, but you can only try ${DEFAULT_PLAN_LIMITS.questionTriesPerDay.free} a day. ★ Family Plus has no monthly limit, just a fair-use cap of ${DEFAULT_PLAN_LIMITS.questionsFairUse} a month and ${DEFAULT_PLAN_LIMITS.questionTriesPerDay.plus} tries a day.`,
    },
    {
      q: 'Are there other limits?',
      a: `Files can be up to ${MAX_FILE_BYTES / (1024 * 1024)} MB. On Free, you can add ${DEFAULT_PLAN_LIMITS.uploadsPerDay.free} documents a day (${DEFAULT_PLAN_LIMITS.uploadsPerDay.plus} with ★ Family Plus) and create one family besides your personal vault. Saved chats, the family tree, share links and invitations have caps too, and AskLocker tells you if you reach one.`,
    },
    {
      q: 'Can I ask by speaking?',
      a: `Yes. Turn on Voice assistant in Settings › Accessibility, then tap the mic on Ask and speak. On Free, you get ${DEFAULT_PLAN_LIMITS.voiceAnswers.free} voice chats, and ★ Family Plus has no limit.`,
    },
    {
      q: 'How do I sign in?',
      a: 'Tap Continue with Google. The first time, this creates your account. There\'s no AskLocker password to remember.',
    },
    {
      q: 'Can I sign in with my fingerprint or face?',
      a: `Yes, on the web app. Sign in with Google once, then turn on Fingerprint sign-in in Settings › Security on each device. AskLocker then locks when it opens and after ${lockAfterText} away, and your fingerprint unlocks it.`,
    },
    {
      q: 'Who can see my documents?',
      a: 'Only the members of a document\'s vault can open it in AskLocker, plus anyone with a share link to it. Documents aren\'t end-to-end encrypted, so the people who run AskLocker can technically open them. Settings › Privacy has the details.',
    },
    {
      q: 'How do I share with someone outside the family?',
      a: 'Open the document, tap Share, then Make a link. Anyone with the link can open that document for 1 or 7 days, or 30 with ★ Family Plus, until you turn it off. Sharing works on the web app for now.',
    },
    {
      q: 'How do I add someone to my family?',
      a: `If you're an admin, open Manage Family, tap Add and type the Google email they sign in with. They must have signed in to AskLocker once, and they join when they accept. A family can have ${DEFAULT_PLAN_LIMITS.members.free} members on Free and ${DEFAULT_PLAN_LIMITS.members.plus} with ★ Family Plus, counting pending invitations.`,
    },
    {
      q: 'I\'ve been invited to a family. What now?',
      a: 'You\'ll find the invitation on Home and in Manage Family. Tap Accept to join, or Decline. You can leave a family any time from Manage Family.',
    },
    {
      q: 'Who is in the family tree?',
      a: 'Everyone in your family, even people without an account. A green phone on someone\'s picture means they use AskLocker. Mark a document as someone\'s, then ask by relation or nickname, like "Nani\'s pension papers".',
    },
    {
      q: 'Someone in our tree just joined. How do I link them?',
      a: 'If you\'re an admin, open them in the family tree, tap Link to their AskLocker account and type their Google email. Once they accept, they keep their place, documents and emergency card. If they show up twice, linking makes them one.',
    },
    {
      q: 'What is an emergency card?',
      a: 'It holds a person\'s blood group, allergies, medicines, doctor, insurance and people to call. Open Emergency cards from the menu to show a doctor, and tap any number to call it. Everyone in the family can see it, and an admin or the person can change it.',
    },
    {
      q: 'How much space do we get?',
      a: `On Free, a family gets ${FREE_STORAGE_LABEL} and your personal vault ${FREE_PERSONAL_STORAGE_LABEL}, saved chats included. ★ Family Plus gives a vault ${formatBytes(DEFAULT_PLAN_LIMITS.plus)}, for ${plusPrices('inr')} in India or ${plusPrices('usd')} elsewhere. If Plus ends while a vault is over its free space, you have ${DEFAULT_PLAN_LIMITS.graceDays} days to renew or delete documents, or the newest ones above it are removed.`,
    },
    {
      q: 'How do reminders work?',
      a: 'With ★ Family Plus, everyone in the family is reminded 90, 30 and 7 days before a document expires, and on the day. To get them on your phone or computer, turn them on in Settings › Notifications. Birthday reminders come on every plan.',
    },
    {
      q: 'What does ★ Family Plus mean?',
      a: `Family Plus is the paid plan for the whole family${forSale ? '' : ', coming soon'}. In India it's ${plusPrice('inr')}, or ${plusYearlyOffer('inr')} (${plusYearlySaving('inr')}). Elsewhere it's ${plusPrice('usd')}, or ${plusYearlyOffer('usd')}. It adds ${formatBytes(DEFAULT_PLAN_LIMITS.plus)} of space, no monthly question limit, unlimited voice chats, up to ${DEFAULT_PLAN_LIMITS.members.plus} members, 30-day share links, expiry reminders and Gmail import.`,
    },
    ...(forSale ? [{
      q: 'How do I pay for Family Plus?',
      a: `Open Settings › Family Plus and pick a month or a year. You pay through Razorpay by UPI, card or net banking, and AskLocker never sees your card or UPI details. Nothing renews by itself. For now, you can pay only on the web app${payments?.currencies.includes('USD') ? '' : ', in Indian rupees'}.`,
    }] : []),
    {
      q: 'How do I delete my account?',
      a: 'In Settings › Security, tap Delete account. It deletes your account, saved chats, personal vault and any family only you manage, right away. Documents you added to other families stay with them, and nobody can delete them, so remove any you want gone first.',
    },
    {
      q: 'Why can\'t AskLocker find something in my document?',
      a: 'Blurry or dark photos are hard to read. Retake the photo in good light. If your documents use another language, add it in Settings › Document languages.',
    },
  ];
}

export default function HelpScreen() {
  const [open, setOpen] = useState<number | null>(null);
  const payments = usePaymentsStatus();
  const items = useMemo(() => faq(payments), [payments]);

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Help & FAQ" fallback="/settings" />
      <ScrollView contentContainerStyle={screenStyles.body}>
        <Text style={styles.sectionTitle}>Questions people ask</Text>
        <View style={styles.faqCard}>
          {items.map((item, i) => {
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
          <Body>Something not working, or have an idea? Tell us here.</Body>
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
            <Body>Use Send feedback above to reach us.</Body>
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
