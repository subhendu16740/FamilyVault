// Counts which screens are opened (analytics.ts): the route only, like
// "/document/[id]", never what is on it. Mounted once in the root layout.

import { useEffect } from 'react';
import { useSegments } from 'expo-router';
import { useAuth } from '../lib/auth';
import { useOnPlus } from '../lib/family-plan';
import { screenName, setAnalyticsPlan, track } from '../lib/analytics';

export function AnalyticsTracker() {
  const segments = useSegments();
  const { user } = useAuth();
  const onPlus = useOnPlus();
  const screen = screenName(segments);

  useEffect(() => {
    setAnalyticsPlan(user ? (onPlus ? 'plus' : 'free') : null);
  }, [user, onPlus]);

  useEffect(() => {
    track('screen_viewed', { screen });
  }, [screen]);

  return null;
}
