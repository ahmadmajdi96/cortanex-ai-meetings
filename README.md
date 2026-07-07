# Cortanex AI Meetings

Self-hosted Jitsi Meet for Cortanex AI, packaged as a Docker Compose service with:

- Cortanex AI branding and logo assets.
- No visible Jitsi logo, powered-by label, or Jitsi watermark.
- JWT authentication for signed Cortanex users.
- A small token broker service for room-scoped Jitsi JWTs.
- A React integration component using `@jitsi/react-sdk`.

The stack is pinned to `jitsi/docker-jitsi-meet` `stable-11031`.

## Services

- `web`: branded Jitsi Meet web UI.
- `prosody`: XMPP and JWT room authentication.
- `jicofo`: conference focus component.
- `jvb`: Jitsi Videobridge media router.
- `token-service`: app-facing JWT broker for signed Cortanex users.

## Production Deploy

Point a DNS record such as `meet.cortanexai.com` to your server, then open:

- `80/tcp`
- `443/tcp`
- `10000/udp`

Bootstrap the environment:

```bash
./scripts/bootstrap-env.sh
```

Edit `.env` before starting:

```bash
PUBLIC_URL=https://meet.cortanexai.com
LETSENCRYPT_DOMAIN=meet.cortanexai.com
LETSENCRYPT_EMAIL=admin@cortanexai.com
CORTANEX_APP_URL=https://cortanexai.com
CORS_ALLOWED_ORIGINS=https://cortanexai.com
```

If the server is behind NAT, also set:

```bash
JVB_ADVERTISE_IPS=your.public.server.ip
```

Start the service:

```bash
docker compose build
docker compose up -d
```

View logs:

```bash
docker compose logs -f web prosody jicofo jvb token-service
```

## React Integration

Copy or import `integration/react/CortanexJitsiMeeting.tsx` into the Cortanex AI React app and install:

```bash
npm install @jitsi/react-sdk
```

Use it from an authenticated page:

```tsx
<CortanexJitsiMeeting
  appAccessToken={session.accessToken}
  meetingId={caseId}
  subject={`Case ${caseNumber}`}
  onInviteReady={(inviteUrl) => setInviteLink(inviteUrl)}
/>
```

The token request should flow through your authenticated backend or reverse proxy:

```text
React app -> Cortanex backend -> token-service -> Jitsi iframe
```

Do not expose `JWT_APP_SECRET` to React.

When a room already exists, users other than the creator receive `202 Accepted`
with `approvalRequired: true` instead of a Jitsi JWT. The creator can poll and
approve join requests through:

```http
GET /v1/meetings/:roomName/requests
POST /v1/meetings/:roomName/requests/:requestId/approve
```

## Local Test Frontend

Run the full local test stack:

```bash
docker compose --env-file compose.local.env up -d --build web prosody jicofo jvb token-service test-frontend
```

Open:

```text
http://localhost:5174
```

The test page is separate from the Jitsi iframe. It sends demo signed-user headers to `token-service`, receives a room JWT, and loads the meeting from `http://localhost:8010`.

Stop the local test stack:

```bash
docker compose --env-file compose.local.env down
```

## IP Address Test Access

For the current test server at `70.30.221.109`, copy the IP example and replace every `replace-this-*` value with generated secrets:

```bash
cp compose.ip.env.example compose.ip.env
openssl rand -hex 32
```

Start the stack:

```bash
docker compose --env-file compose.ip.env up -d --build web prosody jicofo jvb token-service test-frontend
```

Open the test UI:

```text
http://70.30.221.109:5174
```

Open Jitsi directly:

```text
https://70.30.221.109:8443
```

Because this is IP-only HTTPS, the browser will show a certificate warning. Accept it once before using the embedded meeting page. For real users, point a domain such as `meet.cortanexai.com` to `70.30.221.109` and use the production `.env` with Let's Encrypt.

Open these firewall ports on the server:

```text
5174/tcp for the test frontend
8080/tcp for local HTTP fallback
8443/tcp for Jitsi HTTPS
10000/udp for Jitsi media
```

## Signed User Data

`token-service` reads the signed app user token from:

```http
Authorization: Bearer <appAccessToken>
```

It maps common claims into the Jitsi JWT:

- `sub`, `id`, `user_id`, or `uid` -> Jitsi user id.
- `name`, `display_name`, `displayName`, `fullName`, or `email` -> display name.
- `email` -> participant email.
- `picture`, `avatar`, or `avatarUrl` -> avatar URL.
- `org_id`, `organization_id`, `tenant_id`, or `company_id` -> tenant/group.
- `role`, `roles`, or `scopes` -> host/moderator hint.

Rooms are scoped as:

```text
cortanex-<tenant>-<meeting-id>
```

Users with the same `meetingId` join the same room.

## Branding

Branding files live in:

- `web/branding/custom-config.js`
- `web/branding/custom-interface_config.js`
- `web/rootfs/usr/share/jitsi-meet/images/cortanex-logo.png`
- `web/rootfs/usr/share/jitsi-meet/css/cortanex.css`

The Docker image also overrides the app title, manifest, touch icon, and fallback watermark asset.

## Security Notes

- Keep `ENABLE_GUESTS=0` if every participant must be a signed Cortanex user.
- Keep `ALLOW_DEMO_AUTH=0` in production.
- Keep `token-service` bound to `127.0.0.1` unless protected by your backend or private network.
- Rotate `JWT_APP_SECRET` and `APP_AUTH_JWT_SECRET` if they are ever exposed.
- Jitsi rooms are ephemeral; store meeting records and invitations in the Cortanex app database.
