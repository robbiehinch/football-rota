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
