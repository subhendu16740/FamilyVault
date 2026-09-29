// Settings › Notifications — one switch. Off hides the bell's count and the
// list; alerts are still written (for every member, by
// check_expiry_notifications), so switching back on shows them again.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePreferences } from '../../lib/preferences';
import { ScreenHeader } from '../../components/screen-header';
import { Card, CardTitle, Body, OnOff, screenStyles } from '../../components/settings-ui';

export default function NotificationSettingsScreen() {
  const { notificationsEnabled, setNotificationsEnabled } = usePreferences();

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" fallback="/settings" />
      <ScrollView contentContainerStyle={screenStyles.body}>
        <Card>
          <CardTitle icon="bell">Show notifications</CardTitle>
          <OnOff value={notificationsEnabled} onChange={setNotificationsEnabled} label="Show notifications" />
          <Body>
            {notificationsEnabled
              ? 'New alerts appear under the bell on Home, with a count.'
              : 'The bell on Home stays quiet and the list is hidden. Nothing is deleted — switch back on to see them.'}
          </Body>
        </Card>

        <Card>
          <CardTitle icon="info">What you are told about</CardTitle>
          <Body>• A document of your family's runs out within 90 days — a passport, licence or policy.</Body>
          <Body>• Someone adds you to a family.</Body>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
