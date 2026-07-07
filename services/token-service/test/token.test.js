import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServer, resetMeetingApprovalsForTests, signJwt, verifyJwt } from '../src/server.js';

process.env.ALLOW_DEMO_AUTH = '1';
process.env.APP_AUTH_JWT_SECRET = 'app-secret';
process.env.CORTANEX_APP_URL = 'https://app.test';
process.env.CORS_ALLOWED_ORIGINS = '*';
process.env.JITSI_ROOM_PREFIX = 'cortanex';
process.env.JITSI_TOKEN_SUB = '*';
process.env.JWT_APP_ID = 'cortanex-ai-meet';
process.env.JWT_APP_SECRET = 'jitsi-secret';
process.env.PUBLIC_URL = 'https://meet.test';

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

function demoHeaders(user) {
    return {
        'content-type': 'application/json',
        'x-demo-user-email': user.email,
        'x-demo-user-id': user.id,
        'x-demo-user-name': user.name,
        'x-demo-user-org': 'demo',
        'x-demo-user-role': user.role
    };
}

async function readJson(response) {
    return response.json();
}

async function withTokenServer(callback) {
    resetMeetingApprovalsForTests();

    const server = createServer();

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    try {
        const address = server.address();

        await callback(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
        resetMeetingApprovalsForTests();
    }
}

test('meeting creator approves an invited user before a token is issued', async () => {
    const host = {
        email: 'host@cortanexai.com',
        id: 'host-user',
        name: 'Host User',
        role: 'host'
    };
    const invited = {
        email: 'guest@cortanexai.com',
        id: 'guest-user',
        name: 'Guest User',
        role: 'member'
    };

    await withTokenServer(async baseUrl => {
        const hostResponse = await fetch(`${baseUrl}/v1/meetings/token`, {
            body: JSON.stringify({ meetingId: 'case-approval' }),
            headers: demoHeaders(host),
            method: 'POST'
        });
        const hostBody = await readJson(hostResponse);

        assert.equal(hostResponse.status, 200);
        assert.equal(hostBody.owner, true);
        assert.match(hostBody.jwt, /^[^.]+\.[^.]+\.[^.]+$/);

        const requestResponse = await fetch(`${baseUrl}/v1/meetings/token`, {
            body: JSON.stringify({ meetingId: 'case-approval' }),
            headers: demoHeaders(invited),
            method: 'POST'
        });
        const requestBody = await readJson(requestResponse);

        assert.equal(requestResponse.status, 202);
        assert.equal(requestBody.approvalRequired, true);
        assert.equal(requestBody.roomName, hostBody.roomName);
        assert.equal(requestBody.jwt, undefined);

        const listResponse = await fetch(`${baseUrl}/v1/meetings/${encodeURIComponent(hostBody.roomName)}/requests`, {
            headers: demoHeaders(host)
        });
        const listBody = await readJson(listResponse);

        assert.equal(listResponse.status, 200);
        assert.equal(listBody.requests.length, 1);
        assert.equal(listBody.requests[0].user.id, invited.id);

        const approveResponse = await fetch(
            `${baseUrl}/v1/meetings/${encodeURIComponent(hostBody.roomName)}/requests/${encodeURIComponent(requestBody.requestId)}/approve`,
            {
                headers: demoHeaders(host),
                method: 'POST'
            }
        );
        const approveBody = await readJson(approveResponse);

        assert.equal(approveResponse.status, 200);
        assert.equal(approveBody.request.status, 'approved');

        const joinedResponse = await fetch(`${baseUrl}/v1/meetings/token`, {
            body: JSON.stringify({ meetingId: 'case-approval' }),
            headers: demoHeaders(invited),
            method: 'POST'
        });
        const joinedBody = await readJson(joinedResponse);

        assert.equal(joinedResponse.status, 200);
        assert.equal(joinedBody.owner, false);
        assert.match(joinedBody.jwt, /^[^.]+\.[^.]+\.[^.]+$/);
    });
});

test('a non-host cannot create a meeting before the creator starts it', async () => {
    const invited = {
        email: 'early@cortanexai.com',
        id: 'early-user',
        name: 'Early User',
        role: 'member'
    };

    await withTokenServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/v1/meetings/token`, {
            body: JSON.stringify({ meetingId: 'not-started' }),
            headers: demoHeaders(invited),
            method: 'POST'
        });
        const body = await readJson(response);

        assert.equal(response.status, 404);
        assert.match(body.error, /not been started/);
    });
});
