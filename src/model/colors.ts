/** Map free-form group labels to display colours. Known colour words get that colour. */
const NAMED: Record<string, string> = {
  blue: '#3b82f6',
  yellow: '#facc15',
  red: '#ef4444',
  green: '#22c55e',
  orange: '#f97316',
  purple: '#a855f7',
  pink: '#ec4899',
  white: '#f8fafc',
  black: '#1f2937',
  grey: '#9ca3af',
  gray: '#9ca3af',
  teal: '#14b8a6',
  brown: '#a16207',
};
const PALETTE = ['#60a5fa', '#fbbf24', '#f87171', '#4ade80', '#c084fc', '#fb923c', '#2dd4bf', '#f472b6'];

export function groupColor(group: string): string {
  const g = group.trim().toLowerCase();
  if (NAMED[g]) return NAMED[g];
  let h = 0;
  for (const ch of g) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Black or white text, whichever reads better on the given background. */
export function textOn(hex: string): string {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? '#111827' : '#ffffff';
}

/** Colours for "minutes played": most minutes first. */
const MINUTES_PALETTE = ['#3b82f6', '#facc15', '#22c55e', '#f97316', '#a855f7', '#ec4899', '#14b8a6', '#a16207'];
const MINUTES_NAMES = ['Blue', 'Yellow', 'Green', 'Orange', 'Purple', 'Pink', 'Teal', 'Brown'];
const NO_MINUTES = '#9ca3af';

export interface MinutesKey {
  minutes: number;
  color: string;
  colorName: string;
  players: string[];
}

/**
 * Colour each player by their total minutes in this rota, so players getting
 * the same time share a colour (e.g. blue = 25 min, yellow = 20 min).
 */
export function minutesColors(totals: Record<string, number>): { byPlayer: Record<string, string>; key: MinutesKey[] } {
  const distinct = [...new Set(Object.values(totals).filter((t) => t > 0))].sort((a, b) => b - a);
  const key: MinutesKey[] = distinct.map((minutes, i) => ({
    minutes,
    color: MINUTES_PALETTE[i % MINUTES_PALETTE.length],
    colorName: MINUTES_NAMES[i % MINUTES_NAMES.length],
    players: Object.keys(totals).filter((id) => totals[id] === minutes),
  }));
  const byPlayer: Record<string, string> = {};
  for (const [id, t] of Object.entries(totals)) byPlayer[id] = key.find((k) => k.minutes === t)?.color ?? NO_MINUTES;
  return { byPlayer, key };
}
