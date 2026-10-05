// Settings › Privacy — who can see what, and where a document's text goes.
// Every sentence here has to stay true of the code: check it when changing
// sharing, search, OCR, notifications or Gmail import.

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
            family can open them — apart from a single document someone in the family shares by link (below).
          </Body>
          <Body>
            Nobody can join a family by themselves, and nobody is added without saying yes: an admin invites each
            person, by the email they sign in with, and they join only if they accept. Until then the family sees only
            that email, as Pending approval. Viewers can look at documents but cannot delete other people's.
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
            deletes their account, their card is deleted.
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
