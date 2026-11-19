import { expect, test } from 'vitest';
import { lockKey } from '../model/locks';
import { coachesSetup } from '../test/helpers';
import { decodeSetup, encodeSetup, linkCodeFromHash, shareUrl } from './link';

test('a share link round-trips squad, settings, rules, rota and locks', async () => {
  const setup = coachesSetup();
  setup.settings.squad[3].available = false;
  setup.settings.squad[5].side = 'L';
  setup.locks = [lockKey(0, setup.settings.squad[0].id)];
  const code = await encodeSetup(setup);
  expect(code[0]).toBe('z');
  const back = await decodeSetup(code);
  expect(back.settings).toEqual(setup.settings);
  expect(back.constraints).toEqual(setup.constraints);
  expect(back.rota).toEqual(setup.rota);
  expect(back.locks).toEqual(setup.locks);
});

test('links are short enough to share in a message', async () => {
  const url = await shareUrl(coachesSetup(), 'https://robbiehinch.github.io/football-rota/');
  expect(url.length).toBeLessThan(2500);
  expect(linkCodeFromHash(new URL(url).hash)).toBe(url.split('#s=')[1]);
});

test('bad links are rejected, not half-loaded', async () => {
  await expect(decodeSetup('zAAAA')).rejects.toThrow();
  await expect(decodeSetup('xabc')).rejects.toThrow('Not a rota link');
  expect(linkCodeFromHash('#other')).toBeNull();
});
