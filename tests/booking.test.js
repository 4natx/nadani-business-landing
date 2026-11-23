import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBooking, localDate, validateBooking } from '../js/booking.js';
import { bookingSettings } from '../js/config.js';

const now = new Date(2026, 10, 23, 23, 55);
const options = { species: ['dog', 'cat'], service: ['banho', 'cuidados'], period: ['morning', 'afternoon'] };
const booking = { guardian: 'Marina Demo ', pet: 'Bento', species: 'dog', service: 'banho', date: '2026-11-23', period: 'morning', notes: '' };
const validate = input => validateBooking(input, options, now);

test('builds dates in local time across month, year and leap-year boundaries', () => {
  assert.equal(localDate(0, now), '2026-11-23');
  assert.equal(localDate(1, new Date(2026, 11, 31)), '2027-01-01');
  assert.equal(localDate(1, new Date(2028, 1, 28)), '2028-02-29');
});

test('accepts a valid demo request with optional notes empty', () => {
  assert.deepEqual(validate(booking), {});
});

test('requires all six mandatory values', () => {
  assert.deepEqual(Object.keys(validate({})), ['guardian', 'pet', 'species', 'service', 'period', 'date']);
});

test('rejects whitespace-only names, long values and unknown choices', () => {
  const values = { ...booking, guardian: '    ', pet: 'a'.repeat(61), species: 'other', service: 'invalid', period: 'evening', notes: 'a'.repeat(301) };
  assert.deepEqual(Object.keys(validate(values)), ['guardian', 'pet', 'species', 'service', 'period', 'notes']);
});

test('rejects impossible, malformed, past and out-of-window dates', () => {
  for (const date of ['2026-02-30', '2026-13-01', '26-11-23', '2026-11-22', localDate(bookingSettings.windowDays + 1, now)]) {
    assert.ok(validate({ ...booking, date }).date, date);
  }
  assert.deepEqual(validate({ ...booking, date: localDate(bookingSettings.windowDays, now) }), {});
});

test('produces a formatted summary with readable service and period labels', () => {
  assert.deepEqual(formatBooking(booking, { species: { dog: 'Cão' }, service: { banho: 'Banho completo' }, period: { morning: 'Manhã' } }), [
    ['Tutor', 'Marina Demo'], ['Animal', 'Bento'], ['Tipo de animal', 'Cão'], ['Serviço', 'Banho completo'],
    ['Data preferida', '23/11/2026'], ['Período', 'Manhã'], ['Observações', '—'],
  ]);
});