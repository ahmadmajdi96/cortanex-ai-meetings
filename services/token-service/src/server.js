import crypto from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_TOKEN_EXP_SECONDS = 60 * 60 * 2;

function getEnv(name, fallback = '') {
    const value = process.env[name];

    return value === undefined || value === '' ? fallback : value;
}

function base64url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
}

function decodeBase64url(input) {
    const normalized = input.replaceAll('-', '+').replaceAll('_', '/');
    const padding = '='.repeat((4 - normalized.length % 4) % 4);

    return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

export function signJwt(payload, secret, header = {}) {
    if (!secret) {
        throw new Error('JWT secret is required');
    }

    const encodedHeader = base64url(JSON.stringify({
        alg: 'HS256',
        typ: 'JWT',
        ...header
    }));
    const encodedPayload = base64url(JSON.stringify(payload));
    const input = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto
        .createHmac('sha256', secret)
        .update(input)
        .digest('base64url');

    return `${input}.${signature}`;
}

export function verifyJwt(token, secret) {
    const parts = String(token || '').split('.');

    if (parts.length !== 3 || !secret) {
        throw unauthorized('Invalid bearer token');
    }

    const [ encodedHeader, encodedPayload, signature ] = parts;
    const header = JSON.parse(decodeBase64url(encodedHeader));

    if (header.alg !== 'HS256') {
        throw unauthorized('Only HS256 app tokens are supported by this broker');
    }

    const expected = crypto
        .createHmac('sha256', secret)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest('base64url');
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);

    if (
        expectedBuffer.length !== signatureBuffer.length
        || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
        throw unauthorized('Invalid bearer token signature');
    }

    const payload = JSON.parse(decodeBase64url(encodedPayload));
    const now = Math.floor(Date.now() / 1000);

    if (payload.nbf && Number(payload.nbf) > now) {
        throw unauthorized('Bearer token is not valid yet');
    }

    if (payload.exp && Number(payload.exp) <= now) {
        throw unauthorized('Bearer token has expired');
    }

    return payload;
}

function unauthorized(message) {
    const error = new Error(message);

    error.statusCode = 401;

    return error;
}

function badRequest(message) {
    const error = new Error(message);

    error.statusCode = 400;

    return error;
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return '';
}

function parseRoles(payload) {
    const roles = [
        payload.role,
        ...(Array.isArray(payload.roles) ? payload.roles : []),
        ...(Array.isArray(payload.scopes) ? payload.scopes : [])
    ];

    return roles.map(role => String(role).toLowerCase());
}

function normalizeSignedUser(payload) {
    const id = firstString(payload.sub, payload.id, payload.user_id, payload.uid);

    if (!id) {
        throw unauthorized('Signed user token must include sub, id, user_id, or uid');
    }

    const email = firstString(payload.email);
    const name = firstString(
        payload.name,
        payload.display_name,
        payload.displayName,
        payload.fullName,
        email,
        'Cortanex User'
    );
    const avatar = firstString(payload.picture, payload.avatar, payload.avatarUrl);
    const orgId = firstString(
        payload.org_id,
        payload.organization_id,
        payload.tenant_id,
        payload.company_id,
        'global'
    );
    const roles = parseRoles(payload);

    return {
        avatar,
        email,
        id,
        isHost: roles.some(role => [ 'admin', 'owner', 'manager', 'host', 'moderator' ].includes(role)),
        name,
        orgId
    };
}

function normalizeDemoUser(headers) {
    return normalizeSignedUser({
        avatar: headers['x-demo-user-avatar'],
        email: headers['x-demo-user-email'],
        name: headers['x-demo-user-name'],
        org_id: headers['x-demo-user-org'] || 'demo',
        role: headers['x-demo-user-role'] || 'host',
        sub: headers['x-demo-user-id']
    });
}

function authenticate(request) {
    const authHeader = request.headers.authorization || '';
    const appSecret = getEnv('APP_AUTH_JWT_SECRET');

    if (authHeader.startsWith('Bearer ')) {
        return normalizeSignedUser(verifyJwt(authHeader.slice(7), appSecret));
    }

    if (getEnv('ALLOW_DEMO_AUTH') === '1' && request.headers['x-demo-user-id']) {
        return normalizeDemoUser(request.headers);
    }

    throw unauthorized('Missing authenticated Cortanex user');
}

function slugify(value, fallback = 'meeting') {
    const slug = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

    return slug || fallback;
}

function getPublicUrl() {
    const publicUrl = getEnv('PUBLIC_URL');

    if (!publicUrl) {
        throw new Error('PUBLIC_URL must be configured');
    }

    return publicUrl.replace(/\/+$/g, '');
}

function buildRoomName(user, body) {
    const prefix = slugify(getEnv('JITSI_ROOM_PREFIX', 'cortanex'), 'cortanex');
    const requestedRoom = firstString(body.roomName, body.roomId, body.meetingId);
    const roomSlug = requestedRoom ? slugify(requestedRoom) : crypto.randomUUID();
    const orgSlug = slugify(user.orgId, 'global');

    if (roomSlug.startsWith(`${prefix}-`)) {
        return roomSlug;
    }

    return `${prefix}-${orgSlug}-${roomSlug}`.slice(0, 128);
}

function getDomainFromUrl(publicUrl) {
    return new URL(publicUrl).host;
}

function createMeetingToken(user, body = {}) {
    const publicUrl = getPublicUrl();
    const now = Math.floor(Date.now() / 1000);
    const requestedExpiry = Number(body.expiresInSeconds || getEnv('JWT_TOKEN_EXP_SECONDS', DEFAULT_TOKEN_EXP_SECONDS));
    const expiresInSeconds = Math.max(
        300,
        Math.min(
            Number.isFinite(requestedExpiry) ? requestedExpiry : DEFAULT_TOKEN_EXP_SECONDS,
            60 * 60 * 12
        )
    );
    const roomName = buildRoomName(user, body);
    const isModerator = body.moderator === undefined ? user.isHost : Boolean(body.moderator && user.isHost);
    const payload = {
        aud: 'jitsi',
        context: {
            features: {
                livestreaming: 'true',
                recording: 'true',
                transcription: 'true'
            },
            group: user.orgId,
            user: {
                avatar: user.avatar,
                email: user.email,
                id: user.id,
                moderator: String(isModerator),
                name: user.name
            }
        },
        exp: now + expiresInSeconds,
        iss: getEnv('JWT_APP_ID'),
        nbf: now - 5,
        room: roomName,
        sub: getEnv('JITSI_TOKEN_SUB', '*')
    };
    const jwt = signJwt(payload, getEnv('JWT_APP_SECRET'));
    const appUrl = getEnv('CORTANEX_APP_URL', 'https://cortanexai.com').replace(/\/+$/g, '');

    return {
        domain: getDomainFromUrl(publicUrl),
        expiresAt: new Date(payload.exp * 1000).toISOString(),
        inviteUrl: `${appUrl}/meetings/${encodeURIComponent(roomName)}`,
        jwt,
        meetingUrl: `${publicUrl}/${encodeURIComponent(roomName)}?jwt=${encodeURIComponent(jwt)}`,
        publicUrl,
        roomName,
        userInfo: {
            displayName: user.name,
            email: user.email
        }
    };
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let data = '';

        request.on('data', chunk => {
            data += chunk;

            if (data.length > 64 * 1024) {
                reject(badRequest('Request body is too large'));
                request.destroy();
            }
        });
        request.on('end', () => {
            if (!data) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(data));
            } catch {
                reject(badRequest('Request body must be valid JSON'));
            }
        });
        request.on('error', reject);
    });
}

function getAllowedOrigin(origin) {
    const allowed = getEnv('CORS_ALLOWED_ORIGINS', 'https://cortanexai.com')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

    if (allowed.includes('*')) {
        return '*';
    }

    return allowed.includes(origin) ? origin : '';
}

function sendJson(response, statusCode, body, request) {
    const origin = request.headers.origin;
    const allowedOrigin = origin ? getAllowedOrigin(origin) : '';
    const headers = {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'Vary': 'Origin'
    };

    if (allowedOrigin) {
        headers['Access-Control-Allow-Headers'] = 'authorization, content-type, x-demo-user-avatar, x-demo-user-email, x-demo-user-id, x-demo-user-name, x-demo-user-org, x-demo-user-role';
        headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
        headers['Access-Control-Allow-Origin'] = allowedOrigin;
    }

    response.writeHead(statusCode, headers);
    response.end(statusCode === 204 ? '' : JSON.stringify(body));
}

async function route(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (request.method === 'OPTIONS') {
        sendJson(response, 204, {}, request);
        return;
    }

    if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true, service: 'cortanex-jitsi-token-service' }, request);
        return;
    }

    if (request.method === 'POST' && [ '/v1/meetings', '/v1/meetings/token' ].includes(url.pathname)) {
        const user = authenticate(request);
        const body = await readBody(request);

        sendJson(response, 200, createMeetingToken(user, body), request);
        return;
    }

    sendJson(response, 404, { error: 'Not found' }, request);
}

export function createServer() {
    return http.createServer(async (request, response) => {
        try {
            await route(request, response);
        } catch (error) {
            const statusCode = error.statusCode || 500;

            sendJson(response, statusCode, {
                error: statusCode === 500 ? 'Internal server error' : error.message
            }, request);
        }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(getEnv('PORT', '3030'));

    createServer().listen(port, '0.0.0.0', () => {
        console.log(`Cortanex Jitsi token service listening on ${port}`);
    });
}
