// ─── The menu behind the name button on Home ────────────────────
//
// A drawer, not a screen: it slides in from the left over the page, the page
// stays visible behind it, and it closes with the ✕, a tap outside it, or the
// back button. Layout from the v4 design (who you are on top, then Home,
// Manage Family, Reminders and Settings, Sign Out at the bottom), in the
// app's own colours.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, Pressable, Animated, Easing, Platform, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import { useDrawer } from '../lib/drawer-context';
import { appVersion } from '../lib/app-info';
import { PlusTag } from './screen-header';
import { color, radius, size, space, type } from '../constants/design';

const menuItems: { icon: string; label: string; route: string; plus?: boolean }[] = [
  { icon: 'home', label: 'Home', route: '/home' },
  { icon: 'users', label: 'Manage Family', route: '/family' },
  // ★: part of Family Plus, the paid plan. The screen works for everyone.
  { icon: 'clock', label: 'Reminders', route: '/reminders', plus: true },
  { icon: 'settings', label: 'Settings', route: '/settings' },
];

// The native driver does not exist on the web; asking for it there warns.
const useNativeDriver = Platform.OS !== 'web';

export default function ProfileDrawer() {
  const { user, signOut } = useAuth();
  const { currentFamily, membership } = useFamily();
  const { isDrawerOpen, closeDrawer } = useDrawer();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(300, Math.round(width * 0.86));

  // Stay mounted while sliding out, so closing animates rather than vanishes.
  const [mounted, setMounted] = useState(isDrawerOpen);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isDrawerOpen) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver,
      }).start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [isDrawerOpen, progress]);

  const displayName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] || 'User';
  const email = user?.email || '';
  const initial = displayName.charAt(0).toUpperCase();
  const role = membership?.role ? membership.role.charAt(0).toUpperCase() + membership.role.slice(1) : '';
  const familyLine = [currentFamily?.name, role].filter(Boolean).join(' · ');

  const handleNavigate = (route: string) => {
    closeDrawer();
    setTimeout(() => router.navigate(route as any), 150);
  };

  const handleSignOut = async () => {
    closeDrawer();
    await signOut();
    router.replace('/login' as any);
  };

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth, 0] });

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={closeDrawer}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeDrawer}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          />
        </Animated.View>

        <Animated.View
          style={[styles.drawer, { width: drawerWidth, transform: [{ translateX }] }]}
          accessibilityViewIsModal
        >
          <LinearGradient
            colors={['#2A3D66', '#4A6491']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.profileHeader}
          >
            <View style={styles.headerTop}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
              <TouchableOpacity
                onPress={closeDrawer}
                style={styles.closeBtn}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel="Close menu"
              >
                <Feather name="x" size={size.icon} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <Text style={styles.profileName} numberOfLines={1}>{displayName}</Text>
            {!!email && <Text style={styles.profileSub} numberOfLines={1}>{email}</Text>}
            {!!familyLine && <Text style={styles.profileSub} numberOfLines={1}>{familyLine}</Text>}
          </LinearGradient>

          <View style={styles.menuList}>
            {menuItems.map((item) => (
              <TouchableOpacity
                key={item.route}
                style={styles.menuItem}
                onPress={() => handleNavigate(item.route)}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <View style={styles.menuIconWrap}>
                  <Feather name={item.icon as any} size={16} color={color.primary} />
                </View>
                <Text style={styles.menuLabel}>{item.label}</Text>
                {item.plus ? <PlusTag /> : <Feather name="chevron-right" size={16} color="#9CA3AF" />}
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              style={styles.signOutBtn}
              onPress={handleSignOut}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Feather name="log-out" size={16} color={color.danger} />
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
            <Text style={styles.version}>FamilyVault {appVersion}</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(13, 17, 23, 0.55)',
  },
  // A fixed width and no `flex`. On the web `flex: 1` makes the panel fill
  // the whole row (the old drawer covered the page like a screen), and
  // `flex: 0` shrinks it to nothing; the width alone is what native does.
  drawer: {
    backgroundColor: '#FFFFFF',
    height: '100%',
    boxShadow: '8px 0px 24px rgba(13, 17, 23, 0.25)',
    elevation: 16,
  },
  profileHeader: {
    paddingTop: space.sm,
    paddingBottom: space.lg,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    gap: 2,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  // The ✕ is drawn at 24px, like the back arrow, in a 44px touch area.
  closeBtn: {
    width: size.control,
    height: size.control,
    borderRadius: size.control / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  avatarText: { fontSize: 20, fontWeight: '600', color: '#FFFFFF' },
  profileName: { ...type.title, color: '#FFFFFF', paddingRight: space.md },
  profileSub: { ...type.caption, color: 'rgba(255,255,255,0.85)', paddingRight: space.md },
  menuList: {
    flex: 1,
    paddingTop: space.xs,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    minHeight: 52,
  },
  menuIconWrap: {
    width: size.iconBox,
    height: size.iconBox,
    borderRadius: 8,
    backgroundColor: color.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { ...type.label, flex: 1 },
  bottomSection: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    paddingTop: space.lg,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: '#FEF2F2',
    borderRadius: radius.control,
    minHeight: size.control,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  signOutText: { ...type.button, color: color.danger },
  version: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: space.md,
  },
});
