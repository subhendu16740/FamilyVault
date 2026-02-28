import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../lib/auth';

export default function Index() {
  const { session, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#2A3D66" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/home" />;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F9FC',
  },
});
