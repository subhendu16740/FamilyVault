import { Tabs } from 'expo-router';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DrawerProvider } from '../../lib/drawer-context';
import ProfileDrawer from '../../components/ProfileDrawer';
import { size } from '../../constants/design';

// The bar spans the screen; its three tabs keep to the app's 390px column.
// Ask is the big round button in the middle: it sits on the bar's bottom
// edge and rises above its top, and the whole middle third answers a tap.
function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  // Above an iPhone's home indicator; nothing on Android or the web.
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={[styles.tabBarOuter, { paddingBottom: bottom }]}>
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
                accessibilityLabel="Ask"
              >
                <LinearGradient
                  colors={['#2A3D66', '#4A6491']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.searchBtn}
                >
                  <Feather name="search" size={30} color="#FFFFFF" />
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
  tabBarOuter: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  tabBar: {
    flexDirection: 'row',
    height: size.tabBar,
    alignItems: 'stretch',
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
    paddingBottom: 4,
    minHeight: 44,
    outlineStyle: 'none',
  } as any,
  tabLabel: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    fontWeight: '500',
  },
  // The full height of the bar, the button at its foot: taller than the bar,
  // it overflows upwards, never down.
  searchTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    outlineStyle: 'none',
  } as any,
  searchBtn: {
    width: size.ask,
    height: size.ask,
    borderRadius: size.ask / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    boxShadow: '0px 6px 16px rgba(42, 61, 102, 0.40)',
    elevation: 10,
  },
});
