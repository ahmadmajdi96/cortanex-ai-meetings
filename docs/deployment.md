# Deployment Notes

## Server Checklist

Use a Linux server with Docker Engine and Docker Compose v2. Create a DNS `A` record for the meeting domain before enabling Let's Encrypt.

Required public ports:

- `80/tcp` for HTTP challenge and redirect.
- `443/tcp` for the meeting web app and WebSockets.
- `10000/udp` for WebRTC media through Jitsi Videobridge.

If the server is behind a cloud firewall and a host firewall, open the ports in both places.

## Environment

Create `.env` from `.env.example`:

```bash
./scripts/bootstrap-env.sh
```

Required production values:

```bash
PUBLIC_URL=https://meet.cortanexai.com
LETSENCRYPT_DOMAIN=meet.cortanexai.com
LETSENCRYPT_EMAIL=admin@cortanexai.com
CORTANEX_APP_URL=https://cortanexai.com
CORS_ALLOWED_ORIGINS=https://cortanexai.com
```

For NAT or a private server IP:

```bash
JVB_ADVERTISE_IPS=your.public.ip.address
```

## Start And Update

```bash
docker compose build
docker compose up -d
docker compose ps
```

Update to a newer Jitsi release by changing `JITSI_IMAGE_VERSION`, rebuilding, and recreating containers:

```bash
docker compose build --pull
docker compose up -d
```

Read release notes before changing the pinned Jitsi version.

## Reverse Proxy

The bundled Jitsi `web` container can terminate TLS directly. If you put Nginx, Traefik, Caddy, or a cloud load balancer in front of it, make sure WebSocket proxying works for:

```text
/xmpp-websocket
/colibri-ws
```

Keep `10000/udp` routed directly to the Docker host running `jvb`.
