// Cortanex AI defaults appended to the generated Jitsi config.js at container boot.
config.defaultLogoUrl = 'images/cortanex-logo.png';
config.disableDeepLinking = true;
config.disableInviteFunctions = false;
config.disableModeratorIndicator = false;
config.enableWelcomePage = false;
config.p2p = config.p2p || {};
config.p2p.enabled = true;
config.prejoinConfig = {
    ...(config.prejoinConfig || {}),
    enabled: true,
    hideDisplayName: false
};
config.requireDisplayName = true;
config.bosh = `${window.location.origin}/${subdir || ''}http-bind`;
config.websocket = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/${subdir || ''}xmpp-websocket`;
config.deploymentInfo = {
    ...(config.deploymentInfo || {}),
    environment: 'cortanex-ai',
    environmentType: 'self-hosted'
};
config.toolbarButtons = config.toolbarButtons && config.toolbarButtons.length
    ? config.toolbarButtons
    : [
        'microphone',
        'camera',
        'closedcaptions',
        'desktop',
        'fullscreen',
        'fodeviceselection',
        'hangup',
        'profile',
        'chat',
        'recording',
        'livestreaming',
        'etherpad',
        'sharedvideo',
        'settings',
        'raisehand',
        'videoquality',
        'filmstrip',
        'invite',
        'stats',
        'shortcuts',
        'tileview',
        'videobackgroundblur',
        'download',
        'mute-everyone',
        'mute-video-everyone',
        'security',
        'participants-pane',
        'select-background',
        'toggle-camera',
        'whiteboard',
        'shareaudio',
        'noisesuppression'
    ];
