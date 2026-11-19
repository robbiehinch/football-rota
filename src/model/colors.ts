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
