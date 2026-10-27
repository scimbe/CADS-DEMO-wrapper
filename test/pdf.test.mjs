import test from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, withoutPdf } from '../lib/pdf.mjs';

test('findChrome: none installed -> null (PDF is skipped, no traceback)', () => {
  assert.equal(findChrome({ PATH: '/usr/bin:/bin' }, () => false), null);
});
test('findChrome: PATH chromium and CHROME_BIN are found', () => {
  assert.equal(findChrome({ PATH: '/a:/b' }, (p) => p === '/b/chromium'), '/b/chromium');
  assert.equal(findChrome({ PATH: '/a', CHROME_BIN: '/x/c' }, (p) => p === '/x/c'), '/x/c');
});
test('withoutPdf drops --pdf from the bundle command only', () => {
  assert.equal(withoutPdf('python3 -m src.generate_report --out report-output --pdf --config config/report.yaml'), 'python3 -m src.generate_report --out report-output --config config/report.yaml');
});
