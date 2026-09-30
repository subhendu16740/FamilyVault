// Settings › Privacy — who can see what, and where a document's text goes.
// Every sentence here has to stay true of the code: check it when changing
// sharing, search, OCR or Gmail import.

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
          <CardTitle icon="lock">Only your family sees your documents</CardTitle>
          <Body>
            Each family's documents are kept in their own private space. Only people who have been added to that
            family can open them.
          </Body>
          <Body>
            Nobody can join a family by themselves: an admin adds each person, by the email they sign in with. Viewers
            can look at documents but cannot delete other people's.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="message-circle">When you ask a question</CardTitle>
          <Body>
            FamilyVault finds the passages in your family's documents that best match your question, and sends the
            question with those passages to an AI service to write the answer. Only the matching passages are sent,
            not your whole vault.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="file-text">Reading your documents</CardTitle>
          <Body>
            So that you can search them, the text of your documents is read when you add them. Photos are read on
            your phone or in your browser. PDFs are read on FamilyVault's server, and a scanned PDF may be read by an
            outside text-reading (OCR) service.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="mail">Import from Gmail</CardTitle>
          <Body>
            Only you see what FamilyVault finds in your email, and nothing is saved until you choose it. You can
            disconnect Gmail at any time, which forgets everything it found.
          </Body>
        </Card>

        <Card>
          <CardTitle icon="user-x">Leaving or deleting</CardTitle>
          <Body>
            You can leave any family from Manage Family, or delete your account from Settings › Security. Deleting is
            immediate and nothing is kept.
          </Body>
          <SecondaryButton label="Manage Family" icon="users" onPress={() => router.push('/family' as any)} />
          <SecondaryButton label="Delete account" icon="user-x" onPress={() => router.push('/settings/delete-account' as any)} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
