import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius } from './theme';

export function Badge({ label, tone = 'neutral', testID }: { label: string; tone?: 'neutral' | 'accent' | 'warning'; testID?: string }) {
  return <View testID={testID} style={[styles.badge, tone === 'accent' && styles.accent, tone === 'warning' && styles.warning]}>
    <Text style={[styles.text, tone === 'accent' && styles.accentText, tone === 'warning' && styles.warningText]}>
      {label}
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 26, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.badge, backgroundColor: colors.raised, justifyContent: 'center' },
  text: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  accent: { backgroundColor: colors.accentSurface },
  accentText: { color: colors.accentText },
  warning: { backgroundColor: '#302615' },
  warningText: { color: colors.warning },
});
