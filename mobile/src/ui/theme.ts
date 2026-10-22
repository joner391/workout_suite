import { StyleSheet } from 'react-native';

/** Shared visual language, based on the Home and Profile hubs. */
export const colors = {
  background: '#0A0A0A',
  surface: '#141417',
  raised: '#18181B',
  border: '#27272A',
  text: '#FAFAFA',
  secondaryText: '#D4D4D8',
  muted: '#A1A1AA',
  subtle: '#71717A',
  accent: '#00E676',
  accentText: '#86EFAC',
  accentSurface: '#14251D',
  accentBorder: '#315744',
  onAccent: '#052E16',
  danger: '#F87171',
  warning: '#FBBF24',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { badge: 6, control: 10, card: 14, large: 16 } as const;

export const commonStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.lg, paddingBottom: 40, gap: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  itemTitle: { color: colors.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.secondaryText, fontSize: 14, lineHeight: 21 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  button: { backgroundColor: colors.raised, borderRadius: radius.control, paddingHorizontal: space.md, paddingVertical: space.md, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.accentText, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radius.control, padding: 14, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: colors.onAccent, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  input: { backgroundColor: colors.raised, color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: space.md, paddingVertical: space.md, minHeight: 44, fontSize: 14 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  titleColumn: { flex: 1, minWidth: 0, gap: space.sm },
});
