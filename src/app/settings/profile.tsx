// Settings › Profile — your name and phone number. The name is what your
// family sees on documents and in member lists.

import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useFamily } from '../../lib/family-context';
import { fetchProfile, updateProfile } from '../../lib/api';
import { ScreenHeader } from '../../components/screen-header';
import { Card, CardTitle, Field, PrimaryButton, Status, screenStyles } from '../../components/settings-ui';

export default function ProfileScreen() {
  const { user } = useAuth();
  const { refreshMembers } = useFamily();
  const metaName: string = user?.user_metadata?.display_name || user?.user_metadata?.full_name || '';
  const metaPhone: string = user?.user_metadata?.phone || '';

  const [name, setName] = useState(metaName);
  const [phone, setPhone] = useState(metaPhone);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchProfile(user.id, { displayName: metaName, phone: metaPhone })
      .then((p) => { if (!cancelled) { setName(p.displayName); setPhone(p.phone); } })
      .catch(() => { /* the account's own copy is already showing */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  const save = async () => {
    if (!user) return;
    const trimmed = name.trim();
    const number = phone.trim();
    if (!trimmed) { setStatus({ kind: 'error', text: 'Please type your name.' }); return; }
    if (trimmed.length > 60) { setStatus({ kind: 'error', text: 'Please use a shorter name — 60 letters at most.' }); return; }
    if (number && !/^\+?[\d\s()-]{6,20}$/.test(number)) {
      setStatus({ kind: 'error', text: 'That does not look like a phone number. Use digits, and + for the country code.' });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const { familySees } = await updateProfile(user.id, { displayName: trimmed, phone: number });
      refreshMembers().catch(() => {});
      setStatus({
        kind: 'ok',
        text: familySees ? 'Saved.' : 'Saved. Your family will see the new name after the next AskLocker update.',
      });
    } catch (err: any) {
      setStatus({ kind: 'error', text: err?.message || 'Could not save. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Profile" fallback="/settings" />
      <ScrollView contentContainerStyle={screenStyles.body} keyboardShouldPersistTaps="handled">
        <Card>
          <CardTitle icon="user">About you</CardTitle>
          <Field
            label="Your name"
            value={name}
            onChangeText={(t) => { setName(t); setStatus(null); }}
            autoComplete="name"
            maxLength={60}
            hint="Your family sees this name on documents and in the member list."
          />
          <Field
            label="Phone number (optional)"
            value={phone}
            onChangeText={(t) => { setPhone(t); setStatus(null); }}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+91 98765 43210"
            maxLength={20}
          />
          <Field
            label="Email"
            value={user?.email ?? ''}
            editable={false}
            hint="This is the address you sign in with. It cannot be changed here."
          />
          {status && <Status kind={status.kind}>{status.text}</Status>}
          <PrimaryButton label="Save" onPress={save} busy={saving} icon="check" />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
