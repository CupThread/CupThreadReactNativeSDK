import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail } from '../src/utils/email';

test('isValidEmail: returns true for empty string as documented (#347)', () => {
  assert.equal(isValidEmail(''), true);
});

test('isValidEmail: returns false safely for non-string inputs (#347)', () => {
  assert.equal(isValidEmail(null as any), false);
  assert.equal(isValidEmail(undefined as any), false);
  assert.equal(isValidEmail(12345 as any), false);
  assert.equal(isValidEmail(true as any), false);
  assert.equal(isValidEmail({} as any), false);
  assert.equal(isValidEmail([] as any), false);
});

test('isValidEmail: returns true for well-formed email addresses', () => {
  assert.equal(isValidEmail('jane@example.com'), true);
  assert.equal(isValidEmail('user.name+tag@domain.co.uk'), true);
  assert.equal(isValidEmail('customer_support123@sub.service.org'), true);
  assert.equal(isValidEmail('"quoted.local"@example.com'), true);
});

test('isValidEmail: returns false for malformed email addresses', () => {
  assert.equal(isValidEmail('john@gmail'), false);
  assert.equal(isValidEmail('jane@example.com,'), false);
  assert.equal(isValidEmail('jane@example..com'), false);
  assert.equal(isValidEmail('@example.com'), false);
  assert.equal(isValidEmail('user@'), false);
  assert.equal(isValidEmail('   '), false);
  assert.equal(isValidEmail('plainaddress'), false);
  assert.equal(isValidEmail('.user@example.com'), false);
  assert.equal(isValidEmail('user.@example.com'), false);
});
