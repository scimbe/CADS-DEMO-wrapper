// Short links for tests that are about something else (storage, pages, free cards, reports): limits per owner set out of the
// way and an explicit test owner, so those tests keep testing what they test. The owner rules themselves (security review M2)
// are tested with the real defaults in test/shortlink-limits.test.mjs.
import { createShortLinks } from '../lib/shortlink.mjs';

export const TEST_ENV = {
  SHORT_ACCOUNT_PER_HOUR: '100000', SHORT_ACCOUNT_PER_DAY: '100000', SHORT_DEVICE_PER_HOUR: '100000', SHORT_DEVICE_PER_DAY: '100000',
  SHORT_NEW_DEVICES_PER_HOUR: '100000', SHORT_PROOF_BITS: '0',
};
export const TEST_DEVICE = 'ab'.repeat(16);
export const TEST_OWNER = Object.freeze({ kind: 'a', key: 'test-account' });

/** createShortLinks with TEST_ENV under the given env, and create(input, who = null, owner = TEST_OWNER). */
export function testShortLinks(opts = {}) {
  const s = createShortLinks({ ...opts, env: { ...TEST_ENV, ...(opts.env || {}) } });
  const create = s.create;
  s.create = (input, who = null, owner = TEST_OWNER) => create(input, who, owner);
  return s;
}
/** A POST /api/s body from a test device (the HTTP route needs an account or a device). */
export const withDevice = (body) => (body && typeof body === 'object' && !Array.isArray(body) && body.device === undefined ? { ...body, device: TEST_DEVICE } : body);
