import { Tabs } from 'expo-router';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { DrawerProvider } from '../../lib/drawer-context';
import ProfileDrawer from '../../components/ProfileDrawer';

function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.tabBar}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const isSearch = route.name === 'search';

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        if (isSearch) {
          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              style={styles.searchTabItem}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Ask FamilyVault"
            >
              <LinearGradient
                colors={['#2A3D66', '#4A6491']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.searchBtn}
              >
                <Feather name="search" size={24} color="#FFFFFF" />
              </LinearGradient>
            </TouchableOpacity>
          );
        }

        const iconName = route.name === 'home' ? 'home' : 'upload';
        const label = route.name === 'home' ? 'Home' : 'Upload';
        const color = isFocused ? '#2A3D66' : '#9CA3AF';

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            style={styles.tabItem}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: isFocused }}
          >
            <Feather name={iconName} size={22} color={color} />
            <Text style={[styles.tabLabel, { color }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <DrawerProvider>
      <ProfileDrawer />
      <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="search" />
        <Tabs.Screen name="upload" />
      </Tabs>
    </DrawerProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    height: 64,
    alignItems: 'center',
    paddingBottom: 4,
    paddingHorizontal: 8,
    maxWidth: 390,
    alignSelf: 'center',
    width: '100%',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    minHeight: 44,
    outlineStyle: 'none',
  } as any,
  tabLabel: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    fontWeight: '500',
  },
  searchTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    outlineStyle: 'none',
  } as any,
  searchBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 4px 8px rgba(42, 61, 102, 0.35)',
    elevation: 8,
  },
});
