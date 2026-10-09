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
      a: 'Open Upload at the bottom of the screen. Take a photo with Scan, pick a file with Browse Files, or choose a picture from your Gallery. AskLocker reads the text, so you can find it later. If you are in a family, it asks where the document goes: your personal vault, which is just for you, or one of your families. On a computer you can also bring documents in From Gmail.',
    },
    {
      q: 'What is my personal vault?',
      a: 'Everyone has one: a vault just for you. Nobody else using AskLocker can open it, and nobody can be invited to it. If you are not in a family, everything you upload goes there. To share documents, create a family from Manage Family and invite the people you want, or accept an invitation from one. Home shows your newest documents from all your vaults together, each marked with the vault it is in.',
    },
    {
      q: 'How do I see all my documents, or delete some?',
      a: 'On Home, tap the number of documents (or See all, beside Recent Documents). All documents lists every document, newest first; choose a vault at the top to see only its documents. Tap the bin beside a document to delete it, or tap Select to tick several and delete them together. You can also delete a document from its own page. Only the person who added a document can delete it, so you see the bin only on the documents you added — in a family, even an admin cannot delete someone else\'s. Deleting removes the file too, frees its space, and cannot be undone.',
    },
    {
      q: 'How do I find a document or an answer?',
      a: 'Open Search and ask in your own words, for example "When does Mom\'s passport expire?". AskLocker searches all your vaults at once — your personal vault and every family — answers, and shows which document the answer came from. To get an answer sooner, tap Search in and pick one vault.',
    },
    {
      q: 'How many questions can I ask?',
      a: `On the free plan, each person can ask ${DEFAULT_PLAN_LIMITS.questions.free} questions a month, in all their vaults together; they start again on the 1st of the month. A question that finds nothing, or that AskLocker could not answer, is not counted. Search shows how many you have left once only a few remain. To keep AskLocker free for every family, each person can also try ${DEFAULT_PLAN_LIMITS.questionTriesPerDay.free} questions a day, answered or not. With ★ Family Plus there is no monthly limit for anyone in the family — only, to keep it fair, a ceiling of ${DEFAULT_PLAN_LIMITS.questionsFairUse} a month and ${DEFAULT_PLAN_LIMITS.questionTriesPerDay.plus} a day for one person, far more than anyone asks.`,
    },
    {
      q: 'Are there other limits?',
      a: `A few, the same for everyone, so that one person cannot use up what every family shares: files up to ${MAX_FILE_BYTES / (1024 * 1024)} MB; ${DEFAULT_PLAN_LIMITS.uploadsPerDay.free} documents added a day by each person on the free plan (${DEFAULT_PLAN_LIMITS.uploadsPerDay.plus} with ★ Family Plus); on the free plan, one family that you create, besides your personal vault; 50 saved chats for each person in a vault; 300 people in a family tree; 20 working share links for one document, each opening up to 100 times; and 20 invitations a day from a family, 3 of them to the same person. If you meet one, AskLocker says which, and what to do.`,
    },
    {
      q: 'Can I ask by speaking?',
      a: `Yes. Turn on the Voice assistant in Settings, under Accessibility. Then tap the microphone on Search and say your question, and the answer is read out loud. Said something by mistake? Tap Cancel while it is still listening, and nothing is asked. On the free plan, each person has ${DEFAULT_PLAN_LIMITS.voiceAnswers.free} free voice chats of their own — a question asked by voice or an answer read aloud, one per question — and Search shows how many you have left. After that you type, and the answer is on the screen; ★ Family Plus has no limit. Settings › Accessibility › Voice chooses who reads the answers, from the voices on your phone or computer.`,
    },
    {
      q: 'How do I sign in?',
      a: 'With your Google account: open AskLocker and choose Continue with Google. The first time, that makes your AskLocker account; after that it opens the same account on any phone or computer. There is no AskLocker password to remember.',
    },
    {
      q: 'Can I sign in with my fingerprint or face?',
      a: `Yes, on the web app, on each phone or computer you use: sign in with Google once, then turn on Fingerprint sign-in — Home offers it, and Settings › Security turns it on or off. After that, choose Sign in with fingerprint and your fingerprint or face (or the device's PIN) signs you in, with no Google and no password. AskLocker also locks itself when it opens and after ${lockAfterText} away, and your fingerprint opens it. Your fingerprint and face never leave your device. If it is not offered, Settings › Security says why — usually the phone has no screen lock, or AskLocker is open inside another app instead of in Chrome or Safari. Google sign-in always works too.`,
    },
    {
      q: 'Who can see my documents?',
      a: 'In AskLocker, only the people in your family — and anyone you send a share link to, for that one document, until the link stops working. An admin invites each person by the email they sign in with, and they join only if they accept; nobody can join by themselves. Your documents are not end-to-end encrypted: AskLocker reads their text to search them, and the people who run AskLocker can technically open them. Settings › Privacy says where your documents\' text goes.',
    },
    {
      q: 'How do I share a document with someone outside the family?',
      a: 'Open the document, choose Share, then Make a link, and send the link by message or email. Anyone with it can open that one document, without an account, for 1 or 7 days — or 30 days with ★ Family Plus. The same screen shows every working link and how often it was opened, and turns a link off at once. A family admin, whoever added the document, or the person it belongs to can share it. For now, Share is in AskLocker on the web.',
    },
    {
      q: 'How do I add someone to my family?',
      a: `If you are an admin, open Manage Family and choose Add, then type the email of the Google account they sign in with. They need to have signed in to AskLocker once first. They get an invitation and join once they accept — until then they show in Manage Family as Pending approval, and you can withdraw it. A family can have up to ${DEFAULT_PLAN_LIMITS.members.free} members on the free plan and ${DEFAULT_PLAN_LIMITS.members.plus} with ★ Family Plus, and invitations waiting for an answer count too. Anyone can be in the family tree without an account.`,
    },
    {
      q: 'Someone invited me to their family. What do I do?',
      a: 'The invitation is on Home and in Manage Family. Choose Accept to join and see the family\'s documents, or Decline to say no. Nobody is added to a family without saying yes, and you can leave a family at any time from Manage Family.',
    },
    {
      q: 'Who is in the family tree?',
      a: 'Everyone in your family, with or without an account — a grandmother who will never sign in included. Admins add people and say how they are related; everyone in the family sees the tree, with how each person is related to you (mother, aunt, cousin…) and any nickname the family gave them, like "Pinky". A green phone on someone\'s picture means they are on AskLocker with their own account; nobody else needs one. You can change your own name, nickname and date of birth. Mark a document as someone\'s and you can ask about it by relation or nickname, like "Nani\'s pension papers" or "Pinky\'s passport".',
    },
    {
      q: 'Someone in our tree has just joined AskLocker. How do I connect them?',
      a: 'If you are an admin, open them in the family tree and choose Link to their AskLocker account, then type the email of the Google account they sign in with. They get an invitation, and once they accept they join the family as a viewer and keep their place in the tree, their documents and their emergency card. If you already added them in Manage Family and they now appear twice, linking makes the two one.',
    },
    {
      q: 'What is an emergency card?',
      a: 'Each person in your family tree can have one: blood group, allergies, health conditions, medicines, their doctor, health insurance and up to three people to call. Open Emergency cards from the menu, or the person\'s page, to show it to a doctor; every phone number on it is one tap from your phone. Everyone in the family can see it; an admin, or the person themselves, can change it.',
    },
    {
      q: 'How much space do we get?',
      a: `On the free plan, each family has ${FREE_STORAGE_LABEL} for its documents, in total, and your personal vault ${FREE_PERSONAL_STORAGE_LABEL}. ★ Family Plus gives ${formatBytes(DEFAULT_PLAN_LIMITS.plus)} to either, for ${plusPrices('inr')} in India (${plusPrices('usd')} elsewhere). Saved chats count too. Every plan has a limit: when a family's space is full, new documents and saved chats can't be added until some are deleted${forSale ? ', or, on the free plan, the family moves to Family Plus' : ''}. If Family Plus ends while a vault holds more than its free space, it has ${DEFAULT_PLAN_LIMITS.graceDays} days to renew or delete documents; after that, the newest documents above the free space are removed. You are reminded when it ends, a week before and the day before. Settings › Storage shows how much is used.`,
    },
    {
      q: 'How do reminders work?',
      a: 'With ★ Family Plus, when a document with an expiry date is added, AskLocker reminds everyone in the family 90, 30 and 7 days before it expires, and on the day — under the bell on Home — and the Reminders page lists every expiry date. To get them as notifications on your phone or computer, even when AskLocker is closed, open Settings › Notifications and turn them on for that device. On iPhone, add AskLocker to your Home Screen first. Birthdays in your family tree are reminded of on the morning of the day, on every plan; switch them off in Settings › Notifications if you would rather not.',
    },
    {
      q: 'What does ★ Family Plus mean?',
      a: `Family Plus is the paid plan for the whole family${forSale ? '' : ', coming soon'}. In India it is ${plusPrice('inr')}, or ${plusYearlyOffer('inr')}: ${plusYearlySaving('inr')}. Elsewhere it is ${plusPrice('usd')}, or ${plusYearlyOffer('usd')}. It gives ${formatBytes(DEFAULT_PLAN_LIMITS.plus)} of space, and the things marked with ★ — questions with no monthly limit (on Free, each person has ${DEFAULT_PLAN_LIMITS.questions.free} a month), voice chats with no limit (on Free, each person has ${DEFAULT_PLAN_LIMITS.voiceAnswers.free}), up to ${DEFAULT_PLAN_LIMITS.members.plus} members who sign in (${DEFAULT_PLAN_LIMITS.members.free} on Free), share links that last 30 days, expiry reminders before a document runs out, with every expiry date in one list on the Reminders page, and bringing documents in from Gmail. Tap any ★, or open Settings › Family Plus, to see Free and Plus side by side. Birthday reminders reach every family, Free or Plus.`,
    },
    ...(forSale ? [{
      q: 'How do I pay for Family Plus?',
      a: `Open Settings › Family Plus, or tap any ★, and choose a year or a month. You pay through Razorpay, by UPI, card or net banking — AskLocker never sees your card or UPI details. Anyone in the family can pay, and Family Plus starts as soon as the payment goes through. Nothing renews by itself: paying again adds another month or year to the time left.${payments?.currencies.includes('USD') ? '' : ' For now, payments are in Indian rupees.'} Paying is in AskLocker on the web for now. If something goes wrong with a payment, send us feedback from this screen.`,
    }] : []),
    {
      q: 'How do I delete my account?',
      a: 'Open Settings › Security and choose Delete account. It is immediate: your account, saved chats and personal vault are deleted, and so is any family nobody else looks after, documents and all; the screen shows which ones before you confirm. Documents you added to a family that carries on stay with that family, and nobody else can delete them, so delete any you want gone first. To keep a family for the others, make one of them an admin first.',
    },
    {
      q: 'Why can\'t AskLocker find something that is in a document?',
      a: 'A blurred or dark photo is hard to read. Try again in good light, holding the phone steady. If your documents are in another language, choose it in Settings, under Documents.',
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
          <Body>Something not working, an idea, or a question? Write to us here — it goes straight to the AskLocker team.</Body>
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
            <Body>Send feedback, above, reaches the AskLocker team directly.</Body>
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
