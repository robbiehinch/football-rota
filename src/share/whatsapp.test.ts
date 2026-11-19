import { expect, test } from 'vitest';
import { coachesSetup } from '../test/helpers';
import { whatsappText } from './whatsapp';

test('WhatsApp text matches the agreed format', () => {
  const { rota, settings } = coachesSetup();
  const text = whatsappText(rota!, settings);
  const lines = text.split('\n');
  expect(lines[0]).toBe('*Match rota* (40 min, subs at 5/10/20/30/35)');
  expect(lines[1]).toBe('*0-5* GK Jake · LD George · RD Joseph · LA Martha · RA Cass');
  expect(lines[2]).toBe('   OFF: Rufus, Albie, Milo, Alex');
  expect(lines[3]).toBe('*5-10* GK Jake · LD George · RD Albie · LA Martha · RA Cass');
  expect(lines[4]).toBe('   OFF: Joseph, Rufus, Milo, Alex');
  expect(lines[5]).toBe('*10-20* GK Joseph · LD Milo · RD Cass · LA Alex · RA Rufus');
  expect(lines.at(-1)).toBe(
    '*Minutes:* Joseph 25 · Rufus 25 · Albie 25 · Cass 25 · Jake 20 · Milo 20 · George 20 · Martha 20 · Alex 20',
  );
});

test('WhatsApp text can include the substitutions, flagging mid-quarter ones', () => {
  const { rota, settings } = coachesSetup();
  const lines = whatsappText(rota!, settings, 'Match rota', true).split('\n');
  expect(lines[3]).toBe('*5-10* GK Jake · LD George · RD Albie · LA Martha · RA Cass');
  expect(lines[4]).toBe('   SUBS (mid-quarter): Albie on for Joseph (RD)');
  expect(lines).toContain('   SUBS (mid-quarter): Rufus on for Cass (RD), Alex RD → LD');
});
