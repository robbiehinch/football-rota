import { minutesColors, textOn } from '../model/colors';
import { slotCount } from '../model/match';
import { playerStats } from '../model/stats';
import type { Rota, Settings } from '../model/types';

/**
 * Draw the rotation graph (players x time) onto a canvas sized for a phone
 * screen (1080 px wide = 360 css px at 3x).
 */
export function drawRotationGraph(rota: Rota, settings: Settings, title = 'Match rota'): HTMLCanvasElement {
  const m = settings.match;
  const n = slotCount(m);
  const stats = playerStats(rota, settings);
  const players = settings.squad.filter((p) => p.available || (stats[p.id]?.total ?? 0) > 0);
  const colors = minutesColors(Object.fromEntries(players.map((p) => [p.id, stats[p.id]?.total ?? 0])));
  const W = 1080;
  const pad = 36;
  const nameW = 230;
  const minsW = 110;
  const cellW = (W - pad * 2 - nameW - minsW) / n;
  const rowH = 84;
  const headH = 150;
  const H = headH + rowH * players.length + pad + 60;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#111827';
  g.font = 'bold 48px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(title, pad, 56);
  g.font = '28px system-ui, sans-serif';
  g.fillStyle = '#4b5563';
  for (let s = 0; s <= n; s++) {
    const xx = pad + nameW + s * cellW;
    g.textAlign = 'center';
    g.fillText(String(s * m.slot_length_min), xx, headH - 24);
  }
  g.textAlign = 'left';
  players.forEach((p, i) => {
    const y = headH + i * rowH;
    g.fillStyle = '#111827';
    g.font = 'bold 34px system-ui, sans-serif';
    g.fillText(p.name, pad, y + rowH / 2, nameW - 12);
    const line = stats[p.id]?.timeline ?? [];
    for (let s = 0; s < n; s++) {
      const x = pad + nameW + s * cellW;
      const code = line[s];
      const bg = code ? colors.byPlayer[p.id] : '#e5e7eb';
      g.fillStyle = bg;
      g.fillRect(x + 3, y + 6, cellW - 6, rowH - 12);
      g.fillStyle = code ? textOn(bg) : '#9ca3af';
      g.font = `${code ? 'bold ' : ''}28px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(code ?? 'off', x + cellW / 2, y + rowH / 2);
      g.textAlign = 'left';
    }
    g.fillStyle = '#111827';
    g.font = 'bold 32px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(`${stats[p.id]?.total ?? 0}m`, W - pad, y + rowH / 2);
    g.textAlign = 'left';
  });
  // Quarter lines
  g.strokeStyle = '#111827';
  g.lineWidth = 4;
  for (let q = 1; q < m.quarters; q++) {
    const x = pad + nameW + ((q * m.quarter_length_min) / m.slot_length_min) * cellW;
    g.beginPath();
    g.moveTo(x, headH - 6);
    g.lineTo(x, headH + rowH * players.length);
    g.stroke();
  }
  // Key: colour = minutes played
  let kx = pad;
  g.font = 'bold 28px system-ui, sans-serif';
  for (const k of colors.key) {
    g.fillStyle = k.color;
    g.fillRect(kx, H - 58, 28, 28);
    g.fillStyle = '#111827';
    const label = `${k.minutes} min`;
    g.fillText(label, kx + 38, H - 44);
    kx += 38 + g.measureText(label).width + 30;
  }
  g.fillStyle = '#6b7280';
  g.font = '26px system-ui, sans-serif';
  g.fillText('grey = bench · thick lines = quarters', kx, H - 44);
  return canvas;
}

export async function rotationGraphBlob(rota: Rota, settings: Settings, title?: string): Promise<Blob> {
  const canvas = drawRotationGraph(rota, settings, title);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'));
}
