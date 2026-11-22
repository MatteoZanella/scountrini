import { describe, expect, it, vi } from 'vitest';

// destination.js reads the app URL from auth.js; keep MSAL out of unit tests
vi.mock('../src/cloud/auth.js', () => ({ appBaseUrl: () => 'https://example.org/scountrini/' }));

const { buildInviteUrl, extractShareUrl, isValidShareUrl } = await import('../src/cloud/destination.js');
const { GraphError, describeError } = await import('../src/cloud/errors.js');

const SHARE = 'https://1drv.ms/f/c/abc123/EnXyZ?e=Q1w2E3';

describe('invite links', () => {
  it('round-trips a sharing link through an invite link', () => {
    const invite = buildInviteUrl(SHARE);
    expect(invite.startsWith('https://example.org/scountrini/?cartella=')).toBe(true);
    expect(extractShareUrl(invite)).toBe(SHARE);
  });

  it('leaves plain sharing links and non-URLs untouched', () => {
    expect(extractShareUrl(`  ${SHARE} `)).toBe(SHARE);
    expect(extractShareUrl('non è un link')).toBe('non è un link');
  });

  it('accepts only OneDrive / SharePoint hosts over https', () => {
    expect(isValidShareUrl(SHARE)).toBe(true);
    expect(isValidShareUrl('https://contoso.sharepoint.com/:f:/g/x')).toBe(true);
    expect(isValidShareUrl('http://1drv.ms/f/x')).toBe(false);
    expect(isValidShareUrl('https://1drv.ms.evil.com/f/x')).toBe(false);
  });
});

describe('describeError', () => {
  it('names the signed-in account on permission errors', () => {
    const msg = describeError(new GraphError(403, 'accessDenied'), { account: 'capo@outlook.it' });
    expect(msg).toContain('capo@outlook.it');
    expect(describeError(new GraphError(403))).toContain('permesso di modifica');
  });
});
