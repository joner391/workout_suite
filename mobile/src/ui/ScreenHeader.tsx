import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IconButton } from './AppIcon';
import { colors, commonStyles, space } from './theme';

/** Actions have their own row, so titles never compete with controls for width. */
export function ScreenHeader({ title, subtitle, onClose, closeTestID, actions }: { title: string; subtitle?: string; onClose?: () => void; closeTestID?: string; actions?: React.ReactNode }) {
  return <View style={styles.header}>
    <View style={styles.heading}>
      <View style={commonStyles.titleColumn}>
        <Text style={commonStyles.title}>
          {title}
        </Text>
        {subtitle && <Text style={commonStyles.caption}>
          {subtitle}
        </Text>}
      </View>
      {onClose && <IconButton
        name="close"
        label={`Close ${title}`}
        testID={closeTestID}
        onPress={onClose}
      />}
    </View>
    {actions && <View style={commonStyles.wrapRow}>
      {actions}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  header: { padding: space.lg, gap: space.md, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
});
