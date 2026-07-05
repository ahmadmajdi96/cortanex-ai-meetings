# Branding

The branded web image overlays the official Jitsi `web` image.

## Files

- `web/Dockerfile` injects the Cortanex CSS and favicon into Jitsi's `index.html`.
- `web/branding/custom-config.js` appends runtime `config.js` overrides.
- `web/branding/custom-interface_config.js` appends runtime `interface_config.js` overrides.
- `web/rootfs/usr/share/jitsi-meet/images/cortanex-logo.png` is generated from the supplied logo.
- `web/rootfs/usr/share/jitsi-meet/images/watermark.svg` is a Cortanex fallback if a future Jitsi view asks for the default watermark asset.
- `web/rootfs/usr/share/jitsi-meet/css/cortanex.css` hides Jitsi watermark elements and applies Cortanex colors.

## Current Defaults

The config disables:

- Jitsi watermark.
- Brand watermark.
- Powered-by label.
- Jitsi mobile app promotion.
- Welcome footer.
- Deep-linking logo.

It sets:

- App name: `Cortanex AI Meetings`.
- Provider name: `Cortanex AI`.
- Logo URL: `images/cortanex-logo.png`.
- Support/brand link: `https://cortanexai.com`.
