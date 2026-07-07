import { createRoot } from 'react-dom/client';
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MonitorUp,
  Play,
  RefreshCw,
  ShieldCheck,
  User,
  Users,
  Video
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import './styles.css';

type MeetingTokenResponse = {
  domain: string;
  expiresAt: string;
  inviteUrl: string;
  jwt: string;
  meetingUrl: string;
  owner: boolean;
  publicUrl: string;
  roomName: string;
  userInfo: {
    displayName: string;
    email?: string;
  };
};

type ApprovalPendingResponse = {
  approvalRequired: true;
  message: string;
  ownerName: string;
  requestId: string;
  roomName: string;
};

type ApprovalRequest = {
  createdAt: string;
  id: string;
  roomName: string;
  status: 'pending' | 'approved';
  user: {
    email?: string;
    id: string;
    name: string;
  };
};

type DemoUser = {
  id: string;
  name: string;
  email: string;
  org: string;
  role: 'host' | 'member';
};

const tokenEndpoint = import.meta.env.VITE_TOKEN_ENDPOINT || '/api/jitsi/meetings/token';

function userIdFromEmail(email: string) {
  return email
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'demo-user';
}

function initialRoom() {
  const params = new URLSearchParams(window.location.search);
  const pathRoom = window.location.pathname.match(/^\/meetings\/([^/]+)/);

  return (
    (pathRoom ? decodeURIComponent(pathRoom[1]) : '')
    || params.get('room')
    || import.meta.env.VITE_DEFAULT_MEETING_ID
    || 'cortanex-demo-room'
  );
}

function App() {
  const [ demoUser, setDemoUser ] = useState<DemoUser>({
    email: 'ahmad@cortanexai.com',
    id: userIdFromEmail('ahmad@cortanexai.com'),
    name: 'Ahmad Salameh',
    org: 'cortanex',
    role: 'host'
  });
  const [ meetingId, setMeetingId ] = useState(initialRoom);
  const [ subject, setSubject ] = useState('Cortanex AI test meeting');
  const [ meeting, setMeeting ] = useState<MeetingTokenResponse | null>(null);
  const [ isLoading, setIsLoading ] = useState(false);
  const [ pendingApproval, setPendingApproval ] = useState<ApprovalPendingResponse | null>(null);
  const [ approvalRequests, setApprovalRequests ] = useState<ApprovalRequest[]>([]);
  const [ approvingRequestId, setApprovingRequestId ] = useState('');
  const [ error, setError ] = useState('');
  const [ copied, setCopied ] = useState('');
  const meetingsEndpoint = useMemo(() => (
    tokenEndpoint.replace(/\/token\/?$/, '').replace(/\/+$/, '')
  ), []);

  const appInviteUrl = useMemo(() => {
    const url = new URL(window.location.href);
    const shareRoom = meeting?.roomName || meetingId || 'cortanex-demo-room';

    url.pathname = `/meetings/${encodeURIComponent(shareRoom)}`;
    url.search = '';

    return url.toString();
  }, [ meeting?.roomName, meetingId ]);

  function demoHeaders() {
    return {
      'x-demo-user-email': demoUser.email,
      'x-demo-user-id': demoUser.id,
      'x-demo-user-name': demoUser.name,
      'x-demo-user-org': demoUser.org,
      'x-demo-user-role': demoUser.role
    };
  }

  async function loadApprovalRequests(roomName = meeting?.roomName) {
    if (!roomName) {
      return;
    }

    const response = await fetch(`${meetingsEndpoint}/${encodeURIComponent(roomName)}/requests`, {
      headers: demoHeaders()
    });
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error || `Request failed with ${response.status}`);
    }

    setApprovalRequests(body.requests || []);
  }

  async function startMeeting(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault?.();
    setIsLoading(true);
    setError('');
    setCopied('');

    try {
      const response = await fetch(tokenEndpoint, {
        body: JSON.stringify({
          meetingId,
          subject
        }),
        headers: {
          'content-type': 'application/json',
          ...demoHeaders()
        },
        method: 'POST'
      });

      const body = await response.json();

      if (response.status === 202 && body.approvalRequired) {
        const nextPending = body as ApprovalPendingResponse;

        setPendingApproval(nextPending);
        setMeeting(null);
        setApprovalRequests([]);
        window.history.replaceState(null, '', `/meetings/${encodeURIComponent(nextPending.roomName)}`);
        return;
      }

      if (!response.ok) {
        throw new Error(body.error || `Request failed with ${response.status}`);
      }

      const nextMeeting = body as MeetingTokenResponse;

      setMeeting(nextMeeting);
      setPendingApproval(null);
      window.history.replaceState(null, '', `/meetings/${encodeURIComponent(nextMeeting.roomName)}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to create the meeting');
    } finally {
      setIsLoading(false);
    }
  }

  async function approveRequest(requestId: string) {
    const roomName = meeting?.roomName;

    if (!roomName) {
      return;
    }

    setApprovingRequestId(requestId);
    setError('');

    try {
      const response = await fetch(
        `${meetingsEndpoint}/${encodeURIComponent(roomName)}/requests/${encodeURIComponent(requestId)}/approve`,
        {
          headers: demoHeaders(),
          method: 'POST'
        }
      );
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || `Request failed with ${response.status}`);
      }

      await loadApprovalRequests(roomName);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to approve the request');
    } finally {
      setApprovingRequestId('');
    }
  }

  async function copyValue(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
  }

  useEffect(() => {
    if (!meeting?.roomName || !meeting.owner) {
      setApprovalRequests([]);
      return undefined;
    }

    let cancelled = false;

    async function pollRequests() {
      try {
        await loadApprovalRequests(meeting?.roomName);
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Unable to load join requests');
        }
      }
    }

    void pollRequests();
    const intervalId = window.setInterval(pollRequests, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [ demoUser.id, demoUser.role, meeting?.owner, meeting?.roomName ]);

  return (
    <main className="appShell">
      <aside className="controlPane">
        <header className="brandHeader">
          <img src="/cortanex-logo.png" alt="Cortanex AI" />
          <div>
            <p>Cortanex AI</p>
            <h1>Meeting Test</h1>
          </div>
        </header>

        <form className="setupForm" onSubmit={startMeeting}>
          <label>
            <span><CalendarClock size={16} /> Meeting ID</span>
            <input
              value={meetingId}
              onChange={event => setMeetingId(event.target.value)}
              required
            />
          </label>

          <label>
            <span><MonitorUp size={16} /> Subject</span>
            <input
              value={subject}
              onChange={event => setSubject(event.target.value)}
              required
            />
          </label>

          <label>
            <span><User size={16} /> Display Name</span>
            <input
              value={demoUser.name}
              onChange={event => setDemoUser(user => ({ ...user, name: event.target.value }))}
              required
            />
          </label>

          <label>
            <span><Mail size={16} /> Email</span>
            <input
              type="email"
              value={demoUser.email}
              onChange={event => setDemoUser(user => ({
                ...user,
                email: event.target.value,
                id: userIdFromEmail(event.target.value)
              }))}
              required
            />
          </label>

          <div className="splitFields">
            <label>
              <span><Users size={16} /> Org</span>
              <input
                value={demoUser.org}
                onChange={event => setDemoUser(user => ({ ...user, org: event.target.value }))}
                required
              />
            </label>

            <label>
              <span>Role</span>
              <select
                value={demoUser.role}
                onChange={event => setDemoUser(user => ({
                  ...user,
                  role: event.target.value as DemoUser['role']
                }))}
              >
                <option value="host">Host</option>
                <option value="member">Member</option>
              </select>
            </label>
          </div>

          <button className="primaryButton" disabled={isLoading} type="submit">
            {isLoading ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            Start Test Meeting
          </button>
        </form>

        {error ? <p className="errorMessage">{error}</p> : null}

        <section className="sharePanel">
          <div className="panelTitle">
            <Video size={18} />
            <h2>Invite</h2>
          </div>

          <button
            className="secondaryButton"
            onClick={() => copyValue('app', appInviteUrl)}
            type="button"
          >
            <Copy size={16} />
            Copy App Invite
          </button>

          <button
            className="secondaryButton"
            disabled={!meeting}
            onClick={() => meeting && copyValue('jitsi', meeting.meetingUrl)}
            type="button"
          >
            <Copy size={16} />
            Copy Jitsi URL
          </button>

          {meeting ? (
            <a className="secondaryLink" href={meeting.meetingUrl} rel="noreferrer" target="_blank">
              <ExternalLink size={16} />
              Open Meeting
            </a>
          ) : null}

          {copied ? (
            <p className="successMessage">
              <CheckCircle2 size={16} />
              Copied {copied === 'app' ? 'app invite' : 'Jitsi URL'}
            </p>
          ) : null}
        </section>

        {pendingApproval ? (
          <section className="approvalPanel">
            <div className="panelTitle">
              <ShieldCheck size={18} />
              <h2>Host Approval</h2>
            </div>
            <p className="approvalCopy">
              Request sent to {pendingApproval.ownerName}. You can join after approval.
            </p>
            <button className="secondaryButton" disabled={isLoading} onClick={() => startMeeting()} type="button">
              {isLoading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              Check Approval
            </button>
          </section>
        ) : null}

        {meeting?.owner ? (
          <section className="approvalPanel">
            <div className="panelTitle">
              <ShieldCheck size={18} />
              <h2>Join Requests</h2>
            </div>
            {approvalRequests.length ? (
              <div className="requestList">
                {approvalRequests.map(request => (
                  <div className="requestItem" key={request.id}>
                    <div>
                      <strong>{request.user.name}</strong>
                      <span>{request.user.email || request.user.id}</span>
                    </div>
                    <button
                      className="approveButton"
                      disabled={approvingRequestId === request.id}
                      onClick={() => approveRequest(request.id)}
                      type="button"
                    >
                      {approvingRequestId === request.id ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
                      Approve
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="approvalCopy">No pending requests.</p>
            )}
          </section>
        ) : null}
      </aside>

      <section className="meetingPane">
        <div className="meetingTopbar">
          <div>
            <p>Room</p>
            <h2>{meeting?.roomName || 'No active test room'}</h2>
          </div>

          <button className="iconButton" onClick={() => startMeeting()} type="button">
            <RefreshCw size={18} />
            Refresh Token
          </button>
        </div>

        <div className="meetingFrameWrap">
          {meeting ? (
            <iframe
              allow="camera; microphone; display-capture; autoplay; clipboard-write"
              src={meeting.meetingUrl}
              title="Cortanex AI Jitsi meeting"
            />
          ) : (
            <div className="emptyState">
              {pendingApproval ? <ShieldCheck size={48} /> : <Video size={48} />}
              <h2>{pendingApproval ? 'Waiting For Approval' : 'No Active Meeting'}</h2>
              <p>{pendingApproval ? pendingApproval.message : 'Room token not issued.'}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
