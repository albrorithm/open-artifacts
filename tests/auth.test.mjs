import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authenticateTailscale,
  isAllowedOrigin,
  readTailscaleConfig,
} from '../lib/auth/tailscale.ts';

const OWNER_LOGIN = 'owner@example.invalid';
const ORIGIN = 'https://artifacts.example.invalid';
const CONFIG_ENV = {
  OPEN_ARTIFACTS_OWNER_LOGIN: OWNER_LOGIN,
  OPEN_ARTIFACTS_ORIGIN: ORIGIN,
};
const CONFIG = { ownerLogin: OWNER_LOGIN, origin: ORIGIN };

function headers(entries = {}) {
  return new Headers(entries);
}

test('accepts one exact owner login and a canonical HTTPS origin', () => {
  assert.deepEqual(readTailscaleConfig(CONFIG_ENV), CONFIG);

  assert.deepEqual(
    authenticateTailscale(
      headers({ 'tailscale-user-login': OWNER_LOGIN }),
      CONFIG,
    ),
    { id: `tailscale:${OWNER_LOGIN}`, provider: 'tailscale', role: 'owner' },
  );
});

test('requires an exact, non-empty owner login in configuration', () => {
  const invalidLogins = [
    undefined,
    '',
    'owner@example.invalid other@example.invalid',
    'owner@example.invalid,other@example.invalid',
    `owner@${'a'.repeat(1018)}.invalid`,
  ];

  for (const ownerLogin of invalidLogins) {
    assert.throws(
      () =>
        readTailscaleConfig({
          ...CONFIG_ENV,
          OPEN_ARTIFACTS_OWNER_LOGIN: ownerLogin,
        }),
      /OPEN_ARTIFACTS_OWNER_LOGIN/,
    );
  }
});

test('rejects absent or wrong Tailscale identities', () => {
  const cases = [
    headers(),
    headers({ 'tailscale-user-login': 'other@example.invalid' }),
    headers({ 'tailscale-user-login': OWNER_LOGIN.toUpperCase() }),
  ];

  for (const requestHeaders of cases) {
    assert.equal(authenticateTailscale(requestHeaders, CONFIG), null);
  }
});

test('does not treat Sites, bearer, profile, or app-capability headers as identity', () => {
  const cases = [
    {
      name: 'Sites identity headers',
      entries: {
        'oai-authenticated-user-id': 'sites-user@example.invalid',
        'oai-authenticated-user-email': OWNER_LOGIN,
      },
    },
    {
      name: 'bearer credentials',
      entries: { authorization: 'Bearer token.example.invalid' },
    },
    {
      name: 'Tailscale profile fields',
      entries: {
        'tailscale-user-name': OWNER_LOGIN,
        'tailscale-user-profile-pic': 'https://profile.example.invalid/avatar',
      },
    },
    {
      name: 'app capability',
      entries: {
        'tailscale-app-capabilities': '{"example.invalid/artifacts":["owner"]}',
      },
    },
  ];

  for (const { name, entries } of cases) {
    assert.equal(
      authenticateTailscale(headers(entries), CONFIG),
      null,
      `${name} must not authenticate an owner`,
    );
  }
});

test('rejects tagged sources without a user login', () => {
  assert.equal(
    authenticateTailscale(
      headers({
        'tailscale-user-name': 'tag:automation.example.invalid',
        'tailscale-user-tailnet': 'tailnet.example.invalid',
      }),
      CONFIG,
    ),
    null,
  );
});

test('rejects duplicate and comma-separated user-login headers', () => {
  const duplicate = new Headers();
  duplicate.append('tailscale-user-login', OWNER_LOGIN);
  duplicate.append('tailscale-user-login', OWNER_LOGIN);

  const cases = [
    duplicate,
    headers({ 'tailscale-user-login': `${OWNER_LOGIN},other@example.invalid` }),
    headers({ 'tailscale-user-login': `other@example.invalid,${OWNER_LOGIN}` }),
  ];

  for (const requestHeaders of cases) {
    assert.equal(authenticateTailscale(requestHeaders, CONFIG), null);
  }
});

test('requires a canonical HTTPS origin with no credentials, path, query, or hash', () => {
  const invalidOrigins = [
    'http://artifacts.example.invalid',
    'https://user:pass@artifacts.example.invalid',
    'https://artifacts.example.invalid/path',
    'https://artifacts.example.invalid?probe=1',
    'https://artifacts.example.invalid#fragment',
    'https://artifacts.example.invalid:443',
    undefined,
  ];

  for (const origin of invalidOrigins) {
    assert.throws(
      () =>
        readTailscaleConfig({ ...CONFIG_ENV, OPEN_ARTIFACTS_ORIGIN: origin }),
      /OPEN_ARTIFACTS_ORIGIN/,
    );
  }
});

test('allows absent and exact origins, but rejects null and unrelated origins', () => {
  const cases = [
    [headers(), true],
    [headers({ origin: ORIGIN }), true],
    [headers({ origin: 'null' }), false],
    [headers({ origin: 'https://other.example.invalid' }), false],
  ];

  for (const [requestHeaders, expected] of cases) {
    assert.equal(isAllowedOrigin(requestHeaders, ORIGIN), expected);
  }
});
