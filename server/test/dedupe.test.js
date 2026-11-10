import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dedupeKey, normalize } from '../src/dedupe.js';

test('normalize lowercases and strips punctuation and work-mode noise', () => {
  assert.equal(normalize('  Python Intern (Remote)! '), 'python intern');
  assert.equal(normalize('Sr. Back-end Engineer'), 'sr back end engineer');
  assert.equal(normalize(null), '');
});

test('same job from different boards gets the same key', () => {
  const linkedin = { title: 'Python Intern (Remote)', company: 'Nimbus Labs Pvt. Ltd.', location: 'Islamabad, Pakistan' };
  const indeed = { title: 'python intern', company: 'Nimbus Labs', location: 'Islamabad' };
  assert.equal(dedupeKey(linkedin), dedupeKey(indeed));
});

test('different titles at the same company stay separate', () => {
  assert.notEqual(
    dedupeKey({ title: 'Python Intern', company: 'Nimbus Labs' }),
    dedupeKey({ title: 'Senior Python Engineer', company: 'Nimbus Labs' }),
  );
});

test('without a company, location is part of the key', () => {
  assert.notEqual(
    dedupeKey({ title: 'Intern', company: null, location: 'Lahore' }),
    dedupeKey({ title: 'Intern', company: null, location: 'Karachi' }),
  );
});
