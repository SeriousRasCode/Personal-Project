import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGNATURE_SKEW_SECONDS,
  isValidTimestamp,
  signCallback,
  verifyCallback,
} from './ussd-signature.js';

const SECRET = 'e2e-ussd-secret-0123456789abcdefghijkl';
const BODY = JSON.stringify({ sessionKey: 'abc', phone: '+251911000000' });
const NOW = new Date('2026-02-01T10:00:00.000Z');

describe('USSD callback signature', () => {
  it('accepts a signature over the timestamp and body', () => {
    const timestamp = NOW.toISOString();
    const signature = signCallback(SECRET, timestamp, BODY);

    expect(
      verifyCallback(SECRET, { timestamp, signature, body: BODY }, NOW),
    ).toBe(true);
  });

  it('accepts an upper case signature', () => {
    const timestamp = NOW.toISOString();
    const signature = signCallback(SECRET, timestamp, BODY).toUpperCase();

    expect(
      verifyCallback(SECRET, { timestamp, signature, body: BODY }, NOW),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const timestamp = NOW.toISOString();
    const signature = signCallback(SECRET, timestamp, BODY);

    expect(
      verifyCallback(SECRET, { timestamp, signature, body: `${BODY} ` }, NOW),
    ).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    const timestamp = NOW.toISOString();
    const signature = signCallback('another-secret', timestamp, BODY);

    expect(
      verifyCallback(SECRET, { timestamp, signature, body: BODY }, NOW),
    ).toBe(false);
  });

  it('rejects a replayed timestamp outside the skew window', () => {
    const stale = new Date(
      NOW.getTime() - (DEFAULT_SIGNATURE_SKEW_SECONDS + 60) * 1_000,
    ).toISOString();
    const signature = signCallback(SECRET, stale, BODY);

    expect(
      verifyCallback(SECRET, { timestamp: stale, signature, body: BODY }, NOW),
    ).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    const timestamp = NOW.toISOString();

    expect(
      verifyCallback(
        SECRET,
        { timestamp, signature: 'not-hex', body: BODY },
        NOW,
      ),
    ).toBe(false);
    expect(
      verifyCallback(SECRET, { timestamp, signature: '', body: BODY }, NOW),
    ).toBe(false);
  });

  it('rejects an unparsable timestamp', () => {
    const signature = signCallback(SECRET, 'not-a-date', BODY);

    expect(isValidTimestamp('not-a-date', NOW)).toBe(false);
    expect(
      verifyCallback(
        SECRET,
        { timestamp: 'not-a-date', signature, body: BODY },
        NOW,
      ),
    ).toBe(false);
  });
});
