// ─── One compact scale for type, size and spacing ───────────────
//
// Screens that use this look like one app instead of several. The numbers
// follow the platforms' own guidance, sized down to match the rest of
// AskLocker (content text is 13–15px everywhere else):
//
//   • Top bar 56 tall, a 24px back arrow in a 44px touch area at the left,
//     the title beside it — Material 3's top app bar on a phone, and Apple's
//     navigation bar, whose inline title is 17pt semibold.
//   • 44px is the smallest thing a finger should have to hit (Apple's
//     minimum); the drawn icon can be smaller than its touch area.
//   • Text: 17 for the screen title, 16 for headings, 15 for body and
//     labels, 13 for secondary lines, 12 for badges and section labels —
//     between Material's Body Large (16) and Body Medium (14), with one size
//     per job. Nothing smaller than 12.
//
// Unrelated to src/constants/theme.ts, which is the unused create-expo-app
// scaffold.
// ────────────────────────────────────────────────────────────────

import type { TextStyle } from 'react-native';

export const color = {
  primary: '#2A3D66',
  secondary: '#4A6491',
  accent: '#D4807B',
  background: '#F8F9FC',
  surface: '#FFFFFF',
  text: '#1F2937',
  textBody: '#374151',
  textMuted: '#6B7280',
  border: '#E5E7EB',
  divider: '#F3F4F6',
  inputBorder: '#D1D5DB',
  tint: '#EFF6FF',
  danger: '#DC2626',
} as const;

export const type = {
  /** The screen's title, in the top bar. */
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: color.primary },
  /** Card and section headings. */
  heading: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: color.text },
  /** Paragraphs and what people type. */
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400', color: color.textBody },
  /** A row's or a field's name. */
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500', color: color.text },
  button: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  /** The second line of a row, hints, small print. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400', color: color.textMuted },
  /** Badges, tags, timestamps: the smallest text there is. */
  meta: { fontSize: 12, lineHeight: 16, fontWeight: '400', color: '#9CA3AF' },
  /** Group names above a card: SETTINGS › ACCOUNT. */
  overline: {
    fontSize: 12, lineHeight: 16, fontWeight: '600', color: color.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
} satisfies Record<string, TextStyle>;

export const size = {
  bar: 56,
  /** Buttons, text fields, and the touch area of an icon button. */
  control: 44,
  row: 56,
  icon: 24,
  iconBox: 32,
  /** The bottom tab bar (Home, Ask, Upload). */
  tabBar: 64,
  /**
   * The round Ask button in the middle of the tab bar: taller than the bar,
   * so it rises above it by the difference. A tab with something at its
   * foot (Ask's question box) leaves that much room.
   */
  ask: 76,
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radius = { control: 12, card: 16, pill: 999 } as const;

export const shadow = {
  card: { boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.06)', elevation: 2 },
} as const;
