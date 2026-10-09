/* Test chặn SSRF: ipBlocked phải chặn mọi dải IP nội bộ / đặc biệt.
   Chạy: npm test (node --test, không cần MongoDB) */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ipBlocked } = require('../server/safefetch');

const BLOCKED = [
  '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.1',
  '127.0.0.1', '127.1.2.3', '0.0.0.0', '169.254.10.20',
  '100.64.0.1', '100.127.255.255',                       // CGNAT
  '192.0.2.1', '198.51.100.5', '203.0.113.9',             // TEST-NET-1/2/3
  '192.0.0.1', '192.88.99.1', '198.18.0.1', '198.19.5.5', // IETF / 6to4 / benchmark
  '::1', '::', 'fe80::1', 'fe90::1', 'fc00::1', 'fd12:3456::1',
  '2001:db8::1', '64:ff9b::808:808',                     // documentation / NAT64
  '::ffff:10.0.0.1', '::ffff:192.168.1.1',                // IPv4-mapped private
  'not-an-ip', '999.999.999.999', '',
];
const ALLOWED = [
  '8.8.8.8', '1.1.1.1', '203.0.114.1', '100.63.0.1', '100.128.0.1',
  '172.15.255.255', '172.32.0.1', '192.167.255.255', '192.169.0.1',
  '2001:4860:4860::8888', '2606:4700:4700::1111',
  '::ffff:8.8.8.8',                                      // IPv4-mapped public
];

test('ipBlocked chặn IP nội bộ / đặc biệt', () => {
  for (const ip of BLOCKED) assert.equal(ipBlocked(ip), true, `phải chặn ${ip}`);
});
test('ipBlocked cho qua IP công cộng', () => {
  for (const ip of ALLOWED) assert.equal(ipBlocked(ip), false, `phải cho qua ${ip}`);
});
test('ipBlocked phân biệt biên dải 172.16/12 và 100.64/10', () => {
  assert.equal(ipBlocked('172.15.0.1'), false);
  assert.equal(ipBlocked('172.16.0.1'), true);
  assert.equal(ipBlocked('172.31.255.255'), true);
  assert.equal(ipBlocked('172.32.0.1'), false);
  assert.equal(ipBlocked('100.63.255.255'), false);
  assert.equal(ipBlocked('100.64.0.0'), true);
  assert.equal(ipBlocked('100.127.255.255'), true);
  assert.equal(ipBlocked('100.128.0.0'), false);
});
