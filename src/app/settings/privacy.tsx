// Settings › Privacy — who can see what, and where a document's text goes.
// Every sentence here has to stay true of the code, and of the people who run
// AskLocker: documents are not end-to-end encrypted, so nothing here may
// promise that nobody but the family can see them. Check it when changing
// sharing, search, OCR, embeddings, voice, notifications or Gmail import.

import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../components/screen-header';
import { Card, CardTitle, Body, SecondaryButton, screenStyles } from '../../components/settings-ui';

export default function PrivacyScreen() {
  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Privacy" fallback="/settings" />
      <ScrollView contentContainerStyle={screenStyles.body}>
        <Card>
          <CardTitle icon="users">Who can see your documents in AskLocker</CardTitle>
          <Body>
            A family's documents open only for the people in that family — apart from a single document someone in
            the family shares by link (below).
          </Body>
          <Body>
            Your personal vault is just for you: nobody else using AskLocker can open it, and nobody can be invited
            to it. Each time you upload, you choose where the document goes — your personal vault or one of your
            families.
          </Body>
          <Body>
            Nobody can join a family by themselves, and nobody is added without saying yes: an admin invites each
            person, by the email they sign in with, and they join only if they accept. Until then the family sees only
            that email, as Pending approval. Viewers can look at documents but cannot delete other people's.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="eye">What AskLocker itself can see</CardTitle>
          <Body>
            Your documents travel over encrypted (https) connections and are stored on encrypted disks by our storage
            provider, Supabase. They are not end-to-end encrypted: AskLocker's servers read their text so that you can
            search them and ask about them, and the people who run AskLocker can technically open stored documents
            and their text.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="link">Share links</CardTitle>
          <Body>
            A family admin, whoever added a document, or the person it belongs to can make a link to that one
            document for someone outside the family, like an accountant. Anyone with the link can open it, without
            an account, until it expires after 1, 7 or 30 days or someone turns it off. The family sees every working
            link and how often it was opened, and the person the document belongs to is told when someone else
            shares it.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="plus-square">Emergency cards</CardTitle>
          <Body>
            Everyone in your family can see each person's emergency card, so whoever is there in an emergency can
            help. Only a family admin, or the person themselves, can change one. When someone leaves the family or
            deletes their account, their card is deleted. Ask does not read emergency cards, so they are not sent to
            the AI service.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="file-text">Reading your documents</CardTitle>
          <Body>
            So that you can search them, AskLocker reads the text of each document when you add it, and keeps that
            text with the document.
          </Body>
          <Body>
            Photos you upload are read on your phone or in your browser. PDFs are read on AskLocker's server; a
            scanned PDF, and photos brought in from Gmail, may be read by an outside text-reading service, OCR.space.
          </Body>
          <Body>
            To make the text searchable, passages of it, and the questions you ask, are sent to HuggingFace, an
            outside service that turns text into search data.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="message-circle">When you ask a question</CardTitle>
          <Body>
            AskLocker finds the passages in your documents that best match your question — in all your vaults, or
            only the one you pick — and sends your question, the chat so far and those passages to an outside AI
            service, Groq, to write the answer. Only the matching passages are sent, not your whole vault, and only
            from vaults you are in.
          </Body>
          <Body>
            If you ask by voice, your browser or phone turns your speech into text with its own speech service (in
            Chrome, Google's).
          </Body>
        </Card>

        <Card>
          <CardTitle icon="bell">Notifications on your devices</CardTitle>
          <Body>
            If you turn them on, reminders reach your phone or computer through your browser's own notification
            service (Google's, Apple's, Mozilla's or Microsoft's). They are locked so that service cannot read them,
            and only the devices you turned on get them. Signing out on a device turns its notifications off.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="mail">Import from Gmail</CardTitle>
          <Body>
            What AskLocker finds in your email is shown to you, not your family. To list it, AskLocker keeps the
            sender, subject, date, file name and size of each attachment it finds, but not the emails themselves, and
            saves no file until you choose it. You can disconnect Gmail at any time, which forgets everything it
            found; documents you imported stay in your vault.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="user-x">Leaving or deleting</CardTitle>
          <Body>
            You can leave any family from Manage Family, or delete your account from Settings › Security. Deleting is
            immediate: it removes your account, your saved chats, your personal vault and any family nobody else looks
            after, and the screen shows exactly what goes before you confirm. Documents you added to a family that
            carries on stay with that family.
          </Body>
          <Body>
            Short-term copies in our providers' backups and logs expire on their own. What was already sent to the
            outside services above is kept under their own policies.
          </Body>
          <SecondaryButton label="Manage Family" icon="users" onPress={() => router.push('/family' as any)} />
          <SecondaryButton label="Delete account" icon="user-x" onPress={() => router.push('/settings/delete-account' as any)} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
