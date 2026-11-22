import { beforeEach, describe, expect, it, vi } from 'vitest';
import { muxWebp } from '../src/metadata/containers.js';

vi.mock('../src/cloud/auth.js', () => ({ getAccessToken: async () => 'token' }));
const { uploadFile } = await import('../src/cloud/graph.js');
const { NameTakenError } = await import('../src/cloud/errors.js');

// Minimal fake of the Graph endpoints uploadFile uses: item lookup, download URL, simple PUT
let files;
const json = (status, body) => new Response(body ? JSON.stringify(body) : null, { status });
beforeEach(() => {
  files = new Map();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  globalThis.fetch = vi.fn(async (url, { method = 'GET', body } = {}) => {
    if (url.startsWith('https://dl/')) return new Response(files.get(url.slice(11)).bytes);
    const name = decodeURIComponent(/items\/root:\/([^?:]+)/.exec(url)[1]);
    const meta = (f) => ({
      id: f.name,
      name: f.name,
      size: f.bytes.length,
      '@microsoft.graph.downloadUrl': `https://dl/${f.name}`,
    });
    if (method === 'GET') return files.has(name) ? json(200, meta(files.get(name))) : json(404, { error: {} });
    if (files.has(name)) return json(409, { error: { code: 'nameAlreadyExists' } });
    files.set(name, { name, bytes: new Uint8Array(await body.arrayBuffer()) });
    return json(201, meta(files.get(name)));
  });
});

// Tiny WebP files: `pixels` stands for the image data, `note` for the metadata
const webp = (pixels, note = '') => {
  const vp8l = [0x2f, 0, 0, 0, 0, ...pixels];
  const riff = new Uint8Array(
    [...'RIFF']
      .map((c) => c.charCodeAt(0))
      .concat(
        [0, 0, 0, 0],
        [...'WEBPVP8L'].map((c) => c.charCodeAt(0)),
        [vp8l.length, 0, 0, 0],
        vp8l,
        vp8l.length & 1 ? [0] : [],
      ),
  );
  return new Blob([muxWebp(riff, { width: 1, height: 1, xmp: `<x>${note}</x>` })], { type: 'image/webp' });
};
const dest = { driveId: 'd', itemId: 'root' };
const upload = (blob, opts) => uploadFile(dest, { folders: [], fileName: 'a.webp', blob, mime: 'image/webp' }, opts);

describe('uploadFile', () => {
  it('uses the name as is when free', async () => {
    expect((await upload(webp([1]))).name).toBe('a.webp');
  });

  it('takes a file with the same image data as its own earlier upload, even with other metadata', async () => {
    await upload(webp([1, 2], 'first try'));
    expect((await upload(webp([1, 2], 'second try'))).name).toBe('a.webp');
    expect(files.size).toBe(1);
  });

  it('stops on a different image under the same name and hands it over for comparison', async () => {
    await upload(webp([1]));
    const err = await upload(webp([9])).catch((e) => e);
    expect(err).toBeInstanceOf(NameTakenError);
    expect(err.existing.name).toBe('a.webp');
    expect(err.existing.blob.size).toBeGreaterThan(0);
    expect(files.size).toBe(1);
  });

  it('uploads a copy as -2 when allowed, never overwriting, and does not duplicate it on retry', async () => {
    await upload(webp([1]));
    expect((await upload(webp([9]), { allowCopy: true })).name).toBe('a-2.webp');
    expect((await upload(webp([9]), { allowCopy: true })).name).toBe('a-2.webp');
    expect((await upload(webp([7]), { allowCopy: true })).name).toBe('a-3.webp');
    expect(new Uint8Array(files.get('a.webp').bytes)).toEqual(new Uint8Array(await webp([1]).arrayBuffer()));
  });
});
