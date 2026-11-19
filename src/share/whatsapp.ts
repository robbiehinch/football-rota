import { formatMinuteList, totalMinutes } from '../model/match';
import { lineupWindows, playerStats } from '../model/stats';
import type { Rota, Settings } from '../model/types';

/** WhatsApp-formatted text: *bold* headings, one block per substitution window. */
export function whatsappText(rota: Rota, settings: Settings, title = 'Match rota'): string {
  const name = (id: string | null) => (id ? (settings.squad.find((p) => p.id === id)?.name ?? '?') : '—');
  const subs = formatMinuteList(settings.match.sub_points);
  const lines = [`*${title}* (${totalMinutes(settings.match)} min${subs ? `, subs at ${subs}` : ''})`];
  for (const w of lineupWindows(rota, settings)) {
    lines.push(`*${w.start}-${w.end}* ` + settings.positions.map((q) => `${q.code} ${name(w.lineup[q.code] ?? null)}`).join(' · '));
    lines.push(`   OFF: ${w.bench.length ? w.bench.map(name).join(', ') : 'nobody'}`);
  }
  const stats = playerStats(rota, settings);
  const players = settings.squad.filter((p) => p.available || (stats[p.id]?.total ?? 0) > 0);
  const sorted = [...players].sort((a, b) => (stats[b.id]?.total ?? 0) - (stats[a.id]?.total ?? 0));
  lines.push(`*Minutes:* ` + sorted.map((p) => `${p.name} ${stats[p.id]?.total ?? 0}`).join(' · '));
  return lines.join('\n');
}
