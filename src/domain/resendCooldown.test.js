import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canResendVerification, remainingCooldownSeconds, RESEND_COOLDOWN_MS } from './resendCooldown.js';

test('sin envio previo, siempre se puede reenviar', () => {
  assert.equal(canResendVerification(null), true);
  assert.equal(canResendVerification(undefined), true);
});

test('justo despues de enviar, no se puede reenviar', () => {
  const now = 1_000_000;
  assert.equal(canResendVerification(now, now), false);
});

test('antes de que pase el cooldown completo, sigue bloqueado', () => {
  const sentAt = 1_000_000;
  assert.equal(canResendVerification(sentAt, sentAt + RESEND_COOLDOWN_MS - 1), false);
});

test('exactamente al cumplirse el cooldown, ya se puede reenviar', () => {
  const sentAt = 1_000_000;
  assert.equal(canResendVerification(sentAt, sentAt + RESEND_COOLDOWN_MS), true);
});

test('mucho despues del cooldown, se puede reenviar', () => {
  const sentAt = 1_000_000;
  assert.equal(canResendVerification(sentAt, sentAt + RESEND_COOLDOWN_MS * 10), true);
});

test('remainingCooldownSeconds es 0 sin envio previo', () => {
  assert.equal(remainingCooldownSeconds(null), 0);
});

test('remainingCooldownSeconds cuenta hacia abajo en segundos, redondeando hacia arriba', () => {
  const sentAt = 1_000_000;
  assert.equal(remainingCooldownSeconds(sentAt, sentAt + 500), 60); // 59.5s restantes -> 60
  assert.equal(remainingCooldownSeconds(sentAt, sentAt + 1000), 59);
});

test('remainingCooldownSeconds es 0 una vez cumplido el cooldown, nunca negativo', () => {
  const sentAt = 1_000_000;
  assert.equal(remainingCooldownSeconds(sentAt, sentAt + RESEND_COOLDOWN_MS), 0);
  assert.equal(remainingCooldownSeconds(sentAt, sentAt + RESEND_COOLDOWN_MS * 5), 0);
});
