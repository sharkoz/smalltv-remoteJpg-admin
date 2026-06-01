import { describe, it, expect } from 'vitest';
import { Signer } from '../src/auth/tokens.js';
import { FakeClock } from '../src/util/time.js';

describe('Signer', () => {
  it('round-trips a payload', () => {
    const s = new Signer('secret');
    const token = s.sign({ sub: 'alice' });
    expect(s.verify(token)).toMatchObject({ sub: 'alice' });
  });

  it('rejects a tampered token', () => {
    const s = new Signer('secret');
    const token = s.sign({ sub: 'alice' });
    expect(s.verify(token.slice(0, -2) + 'xx')).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = new Signer('secret-a').sign({ sub: 'alice' });
    expect(new Signer('secret-b').verify(token)).toBeNull();
  });

  it('honors expiry against the injected clock', () => {
    const clock = new FakeClock(0);
    const s = new Signer('secret', clock);
    const token = s.sign({ sub: 'alice' }, 1000);
    expect(s.verify(token)).toMatchObject({ sub: 'alice' });
    clock.advance(1500);
    expect(s.verify(token)).toBeNull();
  });

  it('handles undefined / malformed input', () => {
    const s = new Signer('secret');
    expect(s.verify(undefined)).toBeNull();
    expect(s.verify('nodot')).toBeNull();
    expect(s.verify('.sig')).toBeNull();
  });
});
