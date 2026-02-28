import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { Database } from './database.types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Conditionally require AsyncStorage only on native to avoid SSR "window is not defined" error
let nativeStorage: any = undefined;
if (Platform.OS !== 'web') {
  nativeStorage = require('@react-native-async-storage/async-storage').default;
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    ...(nativeStorage ? { storage: nativeStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
