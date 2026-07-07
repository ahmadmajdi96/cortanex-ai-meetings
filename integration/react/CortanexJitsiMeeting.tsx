import { useEffect, useMemo, useState } from 'react';
import { JitsiMeeting } from '@jitsi/react-sdk';

type MeetingTokenResponse = {
  domain: string;
  expiresAt: string;
  inviteUrl: string;
  jwt: string;
  meetingUrl: string;
  publicUrl: string;
  roomName: string;
  userInfo: {
    displayName: string;
    email?: string;
  };
};

type ApprovalRequiredResponse = {
  approvalRequired: true;
  message: string;
  ownerName: string;
  requestId: string;
  roomName: string;
};

type JitsiApi = {
  addListener?: (eventName: string, listener: () => void) => void;
};

type CortanexJitsiMeetingProps = {
  appAccessToken: string;
  meetingId: string;
  subject?: string;
  tokenEndpoint?: string;
  onApiReady?: (api: JitsiApi, token: MeetingTokenResponse) => void;
  onApprovalRequired?: (approval: ApprovalRequiredResponse) => void;
  onInviteReady?: (inviteUrl: string, token: MeetingTokenResponse) => void;
  onMeetingEnded?: () => void;
};

const toolbarButtons = [
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

export function CortanexJitsiMeeting({
  appAccessToken,
  meetingId,
  onApiReady,
  onApprovalRequired,
  onInviteReady,
  onMeetingEnded,
  subject,
  tokenEndpoint = '/api/jitsi/meetings/token'
}: CortanexJitsiMeetingProps) {
  const [ token, setToken ] = useState<MeetingTokenResponse | null>(null);
  const [ approval, setApproval ] = useState<ApprovalRequiredResponse | null>(null);
  const [ error, setError ] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    setToken(null);
    setApproval(null);
    setError(null);

    async function loadToken() {
      const response = await fetch(tokenEndpoint, {
        body: JSON.stringify({
          meetingId,
          subject
        }),
        headers: {
          authorization: `Bearer ${appAccessToken}`,
          'content-type': 'application/json'
        },
        method: 'POST',
        signal: controller.signal
      });
      const body = await response.json();

      if (response.status === 202 && body.approvalRequired) {
        const nextApproval = body as ApprovalRequiredResponse;

        setApproval(nextApproval);
        onApprovalRequired?.(nextApproval);
        return;
      }

      if (!response.ok) {
        throw new Error(`Meeting token request failed: ${response.status}`);
      }

      const nextToken = body as MeetingTokenResponse;

      setToken(nextToken);
      onInviteReady?.(nextToken.inviteUrl, nextToken);
    }

    loadToken().catch(nextError => {
      if (!controller.signal.aborted) {
        setError(nextError instanceof Error ? nextError.message : 'Unable to start the meeting');
      }
    });

    return () => controller.abort();
  }, [ appAccessToken, meetingId, onApprovalRequired, onInviteReady, subject, tokenEndpoint ]);

  const configOverwrite = useMemo(() => ({
    defaultLogoUrl: 'images/cortanex-logo.png',
    disableDeepLinking: true,
    disableInviteFunctions: false,
    prejoinConfig: {
      enabled: true,
      hideDisplayName: false
    },
    requireDisplayName: true,
    subject,
    toolbarButtons
  }), [ subject ]);

  const interfaceConfigOverwrite = useMemo(() => ({
    APP_NAME: 'Cortanex AI Meetings',
    DEFAULT_LOGO_URL: 'images/cortanex-logo.png',
    DEFAULT_WELCOME_PAGE_LOGO_URL: 'images/cortanex-logo.png',
    DISPLAY_WELCOME_FOOTER: false,
    HIDE_DEEP_LINKING_LOGO: true,
    JITSI_WATERMARK_LINK: 'https://cortanexai.com',
    MOBILE_APP_PROMO: false,
    NATIVE_APP_NAME: 'Cortanex AI',
    PROVIDER_NAME: 'Cortanex AI',
    SHOW_BRAND_WATERMARK: false,
    SHOW_JITSI_WATERMARK: false,
    SHOW_POWERED_BY: false,
    SHOW_PROMOTIONAL_CLOSE_PAGE: false,
    SHOW_WATERMARK_FOR_GUESTS: false
  }), []);

  if (error) {
    return <div role="alert">{error}</div>;
  }

  if (!token) {
    return <div aria-busy={approval ? undefined : true}>{approval?.message}</div>;
  }

  return (
    <JitsiMeeting
      configOverwrite={configOverwrite}
      domain={token.domain}
      getIFrameRef={iframe => {
        iframe.allow = 'camera; microphone; display-capture; autoplay; clipboard-write';
        iframe.style.border = '0';
        iframe.style.height = '100%';
        iframe.style.minHeight = '640px';
        iframe.style.width = '100%';
      }}
      interfaceConfigOverwrite={interfaceConfigOverwrite}
      jwt={token.jwt}
      onApiReady={api => {
        const jitsiApi = api as JitsiApi;

        jitsiApi.addListener?.('readyToClose', () => onMeetingEnded?.());
        onApiReady?.(jitsiApi, token);
      }}
      roomName={token.roomName}
      userInfo={token.userInfo}
    />
  );
}
