import assert from 'node:assert/strict';
import { test } from 'node:test';

import { signJwt, verifyJwt } from '../src/server.js';

test('signJwt creates an HS256 token verified by verifyJwt', () => {
    const secret = 'test-secret';
    const token = signJwt({
        exp: Math.floor(Date.now() / 1000) + 60,
        sub: 'user-1'
    }, secret);
    const payload = verifyJwt(token, secret);

    assert.equal(payload.sub, 'user-1');
});

test('verifyJwt rejects invalid signatures', () => {
    const token = signJwt({
        exp: Math.floor(Date.now() / 1000) + 60,
        sub: 'user-1'
    }, 'right-secret');

    assert.throws(() => verifyJwt(token, 'wrong-secret'), /signature/);
});
