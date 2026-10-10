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
          <CardTitle icon="users">Who can see your documents</CardTitle>
          <Body>
            Only a family's members can open its documents in AskLocker, unless someone shares one by link. Your
            personal vault is yours alone, and nobody else can join it.
          </Body>
          <Body>
            Nobody joins a family unless an admin invites them and they say yes. Only the person who added a document
            can delete it. Not even an admin can.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="eye">What AskLocker can see</CardTitle>
          <Body>
            Your documents travel over encrypted connections and are stored on Supabase's encrypted disks. They are not
            end-to-end encrypted. Our servers read the text so you can search it, and the people who run AskLocker can
            technically open your documents.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="link">Share links</CardTitle>
          <Body>
            Anyone with a share link can open that one document, without an account, until it expires or is turned
            off. Your family sees every working link, and you're told when someone shares a document that's yours.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="plus-square">Emergency cards</CardTitle>
          <Body>
            Everyone in your family can see each card, and a card is deleted when its person leaves. Ask doesn't read
            the cards, so they never go to the AI service.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="file-text">Reading your documents</CardTitle>
          <Body>
            Photos you upload are read on your device. Scanned PDFs and photos from Gmail may be read by OCR.space.
          </Body>
          <Body>
            To make search work, passages of your documents and your questions go to HuggingFace.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="message-circle">When you ask a question</CardTitle>
          <Body>
            Your question, the chat so far and the best-matching passages go to Groq, which writes the answer. Your
            whole vault is never sent.
          </Body>
          <Body>
            When you ask by voice, your browser or phone turns your speech into text with its own speech service. In
            Chrome, that's Google's.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="bell">Notifications on your devices</CardTitle>
          <Body>
            Notifications reach you through your browser's own push service, like Google's or Apple's. They're locked
            so that service can't read them.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="mail">Import from Gmail</CardTitle>
          <Body>
            Until you pick a file, AskLocker keeps only each attachment's sender, subject, date, name and size, never
            the email itself. Your family doesn't see this, and disconnecting Gmail forgets it.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="user-x">Leaving or deleting</CardTitle>
          <Body>
            Deleting your account is immediate. Documents you added to a family stay with it after you go, and nobody
            can delete them, so delete any you want gone first.
          </Body>
          <Body>
            Copies in our providers' backups and logs expire on their own. What the services above already got is kept
            under their own policies.
          </Body>
          <SecondaryButton label="Manage Family" icon="users" onPress={() => router.push('/family' as any)} />
          <SecondaryButton label="Delete account" icon="user-x" onPress={() => router.push('/settings/delete-account' as any)} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
