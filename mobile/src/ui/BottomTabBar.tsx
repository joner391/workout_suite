import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AppIcon, IconName } from './AppIcon';
import { colors, radius, space } from './theme';

type Tab = 'home' | 'workout' | 'profile' | 'settings';
const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'workout', label: 'Workout', icon: 'workout' },
  { id: 'profile', label: 'Profile', icon: 'profile' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function BottomTabBar({ currentTab, hasActiveWorkout, onSelect }: { currentTab: Tab; hasActiveWorkout: boolean; onSelect: (tab: Tab) => void }) {
  return <View testID="root-bottom-tab-bar" accessibilityRole="tablist" style={styles.bar}>
    {tabs.map(tab => {
      const selected = currentTab === tab.id;
      return <TouchableOpacity
        key={tab.id}
        testID={`tab-btn-${tab.id}`}
        accessibilityRole="tab"
        accessibilityLabel={`${tab.label} Tab${tab.id === 'workout' && hasActiveWorkout ? ', workout in progress' : ''}`}
        accessibilityState={{ selected }}
        onPress={() => onSelect(tab.id)}
        style={styles.tab}
        activeOpacity={0.7}
      >
        <View style={[styles.icon, selected && styles.selectedIcon]}>
          <AppIcon name={tab.icon} color={selected ? colors.accentText : colors.muted} />
          {tab.id === 'workout' && hasActiveWorkout && <View testID="active-workout-tab-dot" style={styles.dot} />}
        </View>
        <Text style={[styles.label, selected && styles.selectedLabel]}>
          {tab.label}
        </Text>
      </TouchableOpacity>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.xs, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingVertical: space.xs },
  icon: { width: 48, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control },
  selectedIcon: { backgroundColor: colors.accentSurface },
  label: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: '600', textAlign: 'center' },
  selectedLabel: { color: colors.accentText },
  dot: { position: 'absolute', top: 3, right: 7, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.background },
});
