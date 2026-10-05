// Help & FAQ › Send feedback. Saved to public.feedback (027), which only the
// team can read.

import { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sendFeedback, isMissingMigration, type FeedbackTopic } from '../../lib/api';
import { appVersion } from '../../lib/app-info';
import { ScreenHeader } from '../../components/screen-header';
import { Card, CardTitle, Body, Field, PrimaryButton, SecondaryButton, Status, screenStyles } from '../../components/settings-ui';
import { color, radius, space } from '../../constants/design';

const TOPICS: { id: FeedbackTopic; label: string }[] = [
  { id: 'problem', label: "Something isn't working" },
  { id: 'idea', label: 'An idea' },
  { id: 'question', label: 'A question' },
  { id: 'other', label: 'Something else' },
];

export default function FeedbackScreen() {
  const [topic, setTopic] = useState<FeedbackTopic | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!message.trim()) { setError('Please write your message first.'); return; }
    setSending(true);
    setError(null);
    try {
      await sendFeedback(message, topic, appVersion, Platform.OS);
      setSent(true);
      setMessage('');
      setTopic(null);
    } catch (err) {
      setError(isMissingMigration(err)
        ? 'Feedback is not switched on yet. Please try again later.'
        : (err as Error)?.message || 'Could not send your message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Send feedback" fallback="/settings/help" />
      <ScrollView contentContainerStyle={screenStyles.body} keyboardShouldPersistTaps="handled">
        {sent ? (
          <Card>
            <CardTitle icon="check-circle">Thank you</CardTitle>
            <Body>Your message has been sent to the FamilyVault team.</Body>
            <SecondaryButton label="Write another message" onPress={() => setSent(false)} />
          </Card>
        ) : (
          <Card>
            <CardTitle icon="edit-3">What is it about?</CardTitle>
            <View style={styles.topics} accessibilityRole="radiogroup">
              {TOPICS.map((t) => {
                const selected = topic === t.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.topic, selected && styles.topicSelected]}
                    onPress={() => setTopic(selected ? null : t.id)}
                    activeOpacity={0.8}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.topicText, selected && styles.topicTextSelected]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Field
              label="Your message"
              value={message}
              onChangeText={(t) => { setMessage(t); setError(null); }}
              multiline
              maxLength={4000}
              placeholder="Tell us what happened, or what you would like."
            />
            {error && <Status kind="error">{error}</Status>}
            <PrimaryButton label="Send" icon="send" onPress={send} busy={sending} disabled={!message.trim()} />
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  topic: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.inputBorder,
    backgroundColor: color.surface,
    justifyContent: 'center',
  },
  topicSelected: { borderColor: color.primary, backgroundColor: color.primary },
  topicText: { fontSize: 14, lineHeight: 20, fontWeight: '500', color: color.text },
  topicTextSelected: { color: '#FFFFFF' },
});
