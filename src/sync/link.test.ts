import { describe, expect, it } from 'vitest';
import { diagnose } from './link';

const host = (a: string) => ({ type: 'host', address: a });
const pub = (a: string) => ({ type: 'srflx', address: a });

describe('why two devices could not connect', () => {
  it('different networks: different internet addresses', () => {
    const d = diagnose([host('x.local'), pub('1.1.1.1')], [host('y.local'), pub('2.2.2.2')], 'checking → failed', 'host');
    expect(d.hint).toMatch(/not on the same network/);
    expect(d.details).toMatch(/This device: local address \(hidden name\), internet address/);
  });
  it('the phone kept its Wi-Fi address private', () => {
    const d = diagnose([host('x.local'), pub('1.1.1.1')], [pub('1.1.1.1')], 'failed', 'host');
    expect(d.hint).toMatch(/other device didn't share its Wi-Fi address/);
    expect(d.noLocal).toBe(false);
    expect(diagnose([pub('1.1.1.1')], [host('x.local'), pub('1.1.1.1')], 'failed', 'guest').noLocal).toBe(true);
  });
  it('same network, both shared: the router keeps devices apart', () => {
    expect(diagnose([host('192.168.1.2'), pub('1.1.1.1')], [host('192.168.1.3'), pub('1.1.1.1')], 'failed', 'host').hint).toMatch(/isolation/);
  });
});
