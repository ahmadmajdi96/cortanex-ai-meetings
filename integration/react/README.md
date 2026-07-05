# React Integration

Install the SDK in the Cortanex AI React app:

```bash
npm install @jitsi/react-sdk
```

Use `CortanexJitsiMeeting.tsx` inside the authenticated area of the app. Pass the signed app access token for the current user and a stable `meetingId`; users with the same `meetingId` join the same Jitsi room.

```tsx
<CortanexJitsiMeeting
  appAccessToken={session.accessToken}
  meetingId={caseId}
  subject={`Case ${caseNumber}`}
  onInviteReady={(inviteUrl) => setInviteLink(inviteUrl)}
/>
```

Recommended production routing:

```text
React app -> your authenticated backend route -> token-service -> Jitsi iframe
```

Do not put `JWT_APP_SECRET` in React. The token service only trusts a signed app user token or demo headers when `ALLOW_DEMO_AUTH=1`.
