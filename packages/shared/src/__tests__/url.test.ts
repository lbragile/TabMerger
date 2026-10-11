import { describe, it, expect } from 'vitest';
import { isScriptUrl, toHttpUrl } from '../utils/url';

describe('toHttpUrl', () => {
  it('returns the normalised URL for http and https', () => {
    expect(toHttpUrl('https://example.com')).toBe('https://example.com/');
    expect(toHttpUrl('http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c');
    expect(toHttpUrl('HTTPS://Example.COM/Path')).toBe('https://example.com/Path');
  });

  it('accepts surrounding whitespace the way a browser does', () => {
    expect(toHttpUrl('  https://example.com/a ')).toBe('https://example.com/a');
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<p>x</p>',
    'vbscript:msgbox(1)',
    'blob:https://example.com/123',
    'file:///etc/hosts',
    'chrome://settings',
    'ftp://example.com/a',
  ])('returns undefined for the non-http(s) URL %j', (value) => {
    expect(toHttpUrl(value)).toBeUndefined();
  });

  it.each(['/relative/path', 'example.com', '//example.com/a', 'not a url', ''])(
    'returns undefined for the relative or unparseable string %j',
    (value) => {
      expect(toHttpUrl(value)).toBeUndefined();
    },
  );

  it.each([undefined, null, 0, 42, {}, [], true])('returns undefined for the non-string %j', (value) => {
    expect(toHttpUrl(value)).toBeUndefined();
  });
});

describe('isScriptUrl', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'data:',
    'vbscript:msgbox(1)',
    'blob:https://example.com/123',
  ])('is true for %j', (value) => {
    expect(isScriptUrl(value)).toBe(true);
  });

  it('ignores the case of the scheme', () => {
    expect(isScriptUrl('JAVASCRIPT:alert(1)')).toBe(true);
    expect(isScriptUrl('JaVaScRiPt:alert(1)')).toBe(true);
    expect(isScriptUrl('Data:text/plain,x')).toBe(true);
    expect(isScriptUrl('VBScript:msgbox(1)')).toBe(true);
  });

  it('ignores leading whitespace and control characters', () => {
    expect(isScriptUrl(' javascript:alert(1)')).toBe(true);
    expect(isScriptUrl('\n\t  javascript:alert(1)')).toBe(true);
    expect(isScriptUrl('\u0000\u0001javascript:alert(1)')).toBe(true);
  });

  it('ignores tab, CR and LF inside the scheme', () => {
    expect(isScriptUrl('java\tscript:alert(1)')).toBe(true);
    expect(isScriptUrl('java\nscript:alert(1)')).toBe(true);
    expect(isScriptUrl('java\r\nscript:alert(1)')).toBe(true);
    expect(isScriptUrl('d\ta\nt\ra:text/plain,x')).toBe(true);
  });

  it.each([
    'https://example.com',
    'http://example.com/?next=javascript:alert(1)',
    'mailto:someone@example.com',
    'chrome://settings',
    'file:///etc/hosts',
  ])('is false for the other absolute URL %j', (value) => {
    expect(isScriptUrl(value)).toBe(false);
  });

  it.each(['/relative/path', 'page.html', 'javascript', 'java script:alert(1)', '/javascript:alert(1)', '', '   '])(
    'is false for the relative or empty string %j',
    (value) => {
      expect(isScriptUrl(value)).toBe(false);
    },
  );

  it.each([undefined, null, 0, 42, {}, [], true])('is false for the non-string %j', (value) => {
    expect(isScriptUrl(value)).toBe(false);
  });
});
