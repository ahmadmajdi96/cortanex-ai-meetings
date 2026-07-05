# React And Backend Integration

## Token Flow

The React app should not sign Jitsi JWTs. Use this flow:

```text
1. User signs in to Cortanex AI.
2. Cortanex backend issues or already has an app access token for that user.
3. React requests a meeting token from a protected backend route.
4. Backend forwards the signed user token to token-service.
5. token-service returns domain, roomName, jwt, inviteUrl, and userInfo.
6. React embeds the meeting with @jitsi/react-sdk.
```

## Backend Proxy Example

```ts
app.post('/api/jitsi/meetings/token', requireUser, async (req, res) => {
  const response = await fetch('http://127.0.0.1:3030/v1/meetings/token', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${req.user.appAccessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      meetingId: req.body.meetingId,
      subject: req.body.subject
    })
  });

  res.status(response.status).json(await response.json());
});
```

If your main app token is not HS256, replace `authenticate()` in `services/token-service/src/server.js` with your existing session verification logic.

## Invite Links

The broker returns:

```json
{
  "inviteUrl": "https://cortanexai.com/meetings/cortanex-global-case-123",
  "meetingUrl": "https://meet.cortanexai.com/cortanex-global-case-123?jwt=..."
}
```

Share `inviteUrl` inside Cortanex AI so invited users authenticate first. Use `meetingUrl` only for trusted server-side workflows because it contains a participant JWT.
