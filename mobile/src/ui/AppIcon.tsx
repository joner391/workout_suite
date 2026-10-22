import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { colors, radius } from './theme';

export type IconName = 'home' | 'workout' | 'profile' | 'settings' | 'close' | 'plus' | 'back' | 'chevron' | 'up' | 'down' | 'edit' | 'trash' | 'chart' | 'warning' | 'bolt' | 'link' | 'unlink' | 'swap' | 'clipboard' | 'scale' | 'target';

/** A single 24-unit grid and stroke weight keeps every navigation icon aligned. */
export function AppIcon({ name, size = 24, color = colors.muted }: { name: IconName; size?: number; color?: string }) {
  return <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    accessible={false}
  >
    {name === 'home' && <Path d="M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />}

    {name === 'workout' && <><Path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" /><Path d="M3 12h3m12 0h3" /></>}

    {name === 'profile' && <><Circle cx={12} cy={8} r={4} /><Path d="M4 21v-2a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v2" /></>}

    {name === 'settings' && <><Path d="M10 3h4l.6 2.1 2 .9 2-.6 2 3.4L19.5 10v4l1.1 1.2-2 3.4-2-.6-2 .9L14 21h-4l-.6-2.1-2-.9-2 .6-2-3.4L4.5 14v-4L3.4 8.8l2-3.4 2 .6 2-.9Z" /><Circle cx={12} cy={12} r={3} /></>}

    {name === 'close' && <Path d="m6 6 12 12M18 6 6 18" />}

    {name === 'plus' && <Path d="M12 5v14M5 12h14" />}

    {name === 'back' && <Path d="m10 5-7 7 7 7M3 12h18" />}

    {name === 'chevron' && <Path d="m9 5 7 7-7 7" />}

    {name === 'up' && <Path d="m5 15 7-7 7 7" />}

    {name === 'down' && <Path d="m5 9 7 7 7-7" />}

    {name === 'edit' && <><Path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15Z" /></>}

    {name === 'trash' && <Path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />}
    {name === 'chart' && <Path d="M4 3v18h17M8 16v-4M13 16V8M18 16V5" />}
    {name === 'warning' && <><Path d="m12 3 10 18H2ZM12 9v5" /><Circle cx={12} cy={17} r={0.5} /></>}
    {name === 'bolt' && <Path d="m13 2-9 12h7l-1 8 10-13h-7Z" />}
    {(name === 'link' || name === 'unlink') && <><Path d="m10 13 4-4M8 16l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0M16 8l2-2a3 3 0 0 1 4 4l-5 5a3 3 0 0 1-4 0" />{name === 'unlink' && <Path d="m3 3 18 18" />}</>}
    {name === 'swap' && <Path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />}
    {name === 'clipboard' && <><Path d="M9 4H5v17h14V4h-4M8 10h8M8 15h5" /><Path d="M9 2h6v4H9Z" /></>}
    {name === 'scale' && <><Path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 8a5 5 0 0 1 8 0M12 10l2-3" /></>}
    {name === 'target' && <><Circle cx={12} cy={12} r={9} /><Circle cx={12} cy={12} r={5} /><Circle cx={12} cy={12} r={1} /></>}
  </Svg>;
}

export function IconButton({ name, label, onPress, testID, disabled = false }: { name: IconName; label: string; onPress: () => void; testID?: string; disabled?: boolean }) {
  return <TouchableOpacity
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled }}
    onPress={onPress}
    disabled={disabled}
    style={[styles.button, disabled && styles.disabled]}
  >
    <AppIcon name={name} size={20} color={colors.accentText} />
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control, backgroundColor: colors.raised },
  disabled: { opacity: 0.4 },
});
