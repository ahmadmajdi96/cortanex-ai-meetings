ARG JITSI_IMAGE_VERSION=stable-11031
FROM jitsi/web:${JITSI_IMAGE_VERSION}

COPY rootfs/ /

RUN set -eux; \
    sed -i 's|<meta name="theme-color" content="#2A3A4B">|<meta name="theme-color" content="#071826">|' /usr/share/jitsi-meet/index.html; \
    sed -i '/<meta name="theme-color" content="#071826">/a\    <link rel="icon" type="image/png" href="images/favicon.png">' /usr/share/jitsi-meet/index.html; \
    sed -i '/<link rel="stylesheet" href="css\/all.css?v=9268">/a\    <link rel="stylesheet" href="css/cortanex.css?v=1">' /usr/share/jitsi-meet/index.html
