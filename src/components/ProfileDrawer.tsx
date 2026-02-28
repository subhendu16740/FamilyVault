import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, Pressable, Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import { useDrawer } from '../lib/drawer-context';

const DRAWER_WIDTH = Math.min(Dimensions.get('window').width * 0.8, 320);

const menuItems = [
  { icon: 'home', label: 'Home', route: '/home' },
  { icon: 'users', label: 'Manage Family', route: '/family' },
  { icon: 'settings', label: 'Settings', route: '/settings' },
];

export default function ProfileDrawer() {
  const { user, signOut } = useAuth();
  const { currentFamily, membership } = useFamily();
  const { isDrawerOpen, closeDrawer } = useDrawer();

  const displayName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] || 'User';
  const email = user?.email || '';
  const initial = displayName.charAt(0).toUpperCase();
  const role = membership?.role || 'member';

  const handleNavigate = (route: string) => {
    closeDrawer();
    setTimeout(() => router.push(route as any), 150);
  };

  const handleSignOut = async () => {
    closeDrawer();
    await signOut();
    router.replace('/login' as any);
  };

  return (
    <Modal
      visible={isDrawerOpen}
      transparent
      animationType="fade"
      onRequestClose={closeDrawer}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={closeDrawer} />

        <View style={styles.drawer}>
          {/* Profile Header */}
          <LinearGradient
            colors={['#2A3D66', '#4A6491']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.profileHeader}
          >
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileEmail}>{email}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{role}</Text>
            </View>
          </LinearGradient>

          {/* Family Name */}
          {currentFamily && (
            <View style={styles.familyRow}>
              <Feather name="shield" size={16} color="#2A3D66" />
              <Text style={styles.familyName}>{currentFamily.name}</Text>
            </View>
          )}

          {/* Menu Items */}
          <View style={styles.menuList}>
            {menuItems.map((item) => (
              <TouchableOpacity
                key={item.route}
                style={styles.menuItem}
                onPress={() => handleNavigate(item.route)}
                activeOpacity={0.7}
              >
                <View style={styles.menuIconWrap}>
                  <Feather name={item.icon as any} size={20} color="#2A3D66" />
                </View>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Feather name="chevron-right" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            ))}
          </View>

          {/* Bottom */}
          <View style={styles.bottomSection}>
            <TouchableOpacity
              style={styles.signOutBtn}
              onPress={handleSignOut}
              activeOpacity={0.8}
            >
              <Feather name="log-out" size={18} color="#DC2626" />
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
            <Text style={styles.version}>FamilyVault v1.0.0</Text>
          </View>
        </View>
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
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  drawer: {
    width: DRAWER_WIDTH,
    backgroundColor: '#FFFFFF',
    flex: 1,
    zIndex: 10,
  },
  profileHeader: {
    paddingTop: 60,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  profileEmail: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
    textAlign: 'center',
  },
  roleBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 8,
  },
  roleBadgeText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  familyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  familyName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2A3D66',
  },
  menuList: {
    flex: 1,
    paddingTop: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    minHeight: 56,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#1F2937',
  },
  bottomSection: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 16,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#DC2626',
  },
  version: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 16,
  },
});
