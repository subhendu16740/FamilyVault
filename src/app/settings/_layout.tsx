import { Stack } from 'expo-router';

// Settings and the screens it opens. With `index` as the first route, a
// sub-screen opened from a link or after a refresh still has Settings behind
// it, so Back goes where it looks like it should.
export const unstable_settings = { initialRouteName: 'index' };

export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
