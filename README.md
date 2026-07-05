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
