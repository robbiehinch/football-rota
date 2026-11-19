import { parseRotaFile, toRotaFile, type RotaFile, type Setup } from '../model/io';

/**
 * Share links: the whole setup (squad, match settings, rules, rota and locked
 * cells) packed into the URL fragment, so nothing is sent to a server.
 * Format: #s=<v><base64url>, where v is 'z' (deflate-compressed JSON) or 'j' (plain JSON).
 */

interface Payload {
  f: RotaFile;
  l?: string[];
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const canCompress = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** The part after "#s=" for this setup. */
export async function encodeSetup(setup: Setup): Promise<string> {
  const file = toRotaFile(setup);
  delete file.description;
  // Bench lists are derived from the line-ups; leave them out to keep links short.
  for (const row of file.rota ?? []) delete row.bench;
  const payload: Payload = { f: file, ...(setup.locks?.length ? { l: setup.locks } : {}) };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  if (canCompress()) return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
  return 'j' + toBase64Url(json);
}

/** Read a setup back from the part after "#s=". Throws if it isn't a valid link. */
export async function decodeSetup(code: string): Promise<Setup> {
  const kind = code[0];
  const bytes = fromBase64Url(code.slice(1));
  let json: Uint8Array;
  if (kind === 'z') {
    if (!canCompress()) throw new Error('This browser cannot open compressed links. Try a newer browser.');
    json = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind === 'j') json = bytes;
  else throw new Error('Not a rota link');
  const payload = JSON.parse(new TextDecoder().decode(json)) as Payload;
  if (!payload?.f?.squad?.length) throw new Error('The link has no squad in it');
  const setup = parseRotaFile(payload.f);
  return { ...setup, locks: Array.isArray(payload.l) ? payload.l : [] };
}

/** Full link to this app that opens the given setup. */
export async function shareUrl(setup: Setup, base = `${location.origin}${location.pathname}`): Promise<string> {
  return `${base}#s=${await encodeSetup(setup)}`;
}

/** The encoded setup in the current address, if any. */
export function linkCodeFromHash(hash = location.hash): string | null {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash);
  return m ? m[1] : null;
}
