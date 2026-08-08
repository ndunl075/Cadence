'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { comparison, comparisons, phrase, REFERENCES } = require('../src/comparisons');

const potter = REFERENCES.find((item) => item.title === 'the Harry Potter series');

test('phrases a plural multiple', () => {
  assert.equal(phrase(potter, 7), '~7 runs through the Harry Potter series');
  assert.equal(phrase(potter, 2063), '~2,063 runs through the Harry Potter series');
});

test('phrases a single work as "about"', () => {
  assert.equal(phrase(potter, 1), 'about a full run through the Harry Potter series');
});

test('phrases anything under a single work as a percentage', () => {
  assert.equal(phrase(potter, 0.25), '~25% of the Harry Potter series');
});

test('every reference reads correctly at all three tiers', () => {
  for (const reference of REFERENCES) {
    assert.match(phrase(reference, 12), /^~12 \S/, `plural phrasing for ${reference.title}`);
    assert.match(phrase(reference, 1), /^about \S/, `singular phrasing for ${reference.title}`);
    assert.match(phrase(reference, 0.3), /^~30% of \S/, `percentage phrasing for ${reference.title}`);
  }
});

test('leads with a graspable multiple rather than an absurd one', () => {
  for (const total of [1_000, 683_400, 25_888_287, 2_982_095_262]) {
    const first = comparison(total);
    const multiple = Number(first.replace(/[^\d.]/g, ''));
    assert.ok(multiple > 0 && multiple <= 100_000, `expected a graspable lead for ${total}, got "${first}"`);
  }
});

test('offers a deep but bounded list to cycle through', () => {
  const list = comparisons(25_888_287);
  assert.ok(list.length >= 12, `expected plenty of options, got ${list.length}`);
  assert.ok(list.length <= 24, `expected the list capped, got ${list.length}`);
  assert.equal(new Set(list).size, list.length, 'phrasings should be distinct');
});

test('spans orders of magnitude without running dry', () => {
  for (const total of [500, 50_000, 5_000_000, 500_000_000, 50_000_000_000]) {
    assert.ok(comparisons(total).length >= 5, `too few options at ${total}`);
  }
});

test('carries a reference big enough for very large totals', () => {
  const biggest = Math.max(...REFERENCES.map((item) => item.tokens));
  assert.ok(biggest > 1e9, 'need at least one internet-scale reference');
});

test('returns nothing for an empty or invalid count', () => {
  assert.deepEqual(comparisons(0), []);
  assert.deepEqual(comparisons(-5), []);
  assert.deepEqual(comparisons(NaN), []);
  assert.equal(comparison(0), null);
});
