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
  User,
  Users,
  Video
} from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import './styles.css';

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

type DemoUser = {
  id: string;
  name: string;
  email: string;
  org: string;
  role: 'host' | 'member';
};

const tokenEndpoint = import.meta.env.VITE_TOKEN_ENDPOINT || '/api/jitsi/meetings/token';

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
    id: 'demo-ahmad',
    name: 'Ahmad Salameh',
    org: 'cortanex',
    role: 'host'
  });
  const [ meetingId, setMeetingId ] = useState(initialRoom);
  const [ subject, setSubject ] = useState('Cortanex AI test meeting');
  const [ meeting, setMeeting ] = useState<MeetingTokenResponse | null>(null);
  const [ isLoading, setIsLoading ] = useState(false);
  const [ error, setError ] = useState('');
  const [ copied, setCopied ] = useState('');

  const appInviteUrl = useMemo(() => {
    const url = new URL(window.location.href);
    const shareRoom = meeting?.roomName || meetingId || 'cortanex-demo-room';

    url.pathname = `/meetings/${encodeURIComponent(shareRoom)}`;
    url.search = '';

    return url.toString();
  }, [ meeting?.roomName, meetingId ]);

  async function startMeeting(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
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
          'x-demo-user-email': demoUser.email,
          'x-demo-user-id': demoUser.id,
          'x-demo-user-name': demoUser.name,
          'x-demo-user-org': demoUser.org,
          'x-demo-user-role': demoUser.role
        },
        method: 'POST'
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || `Request failed with ${response.status}`);
      }

      const nextMeeting = body as MeetingTokenResponse;

      setMeeting(nextMeeting);
      window.history.replaceState(null, '', `/meetings/${encodeURIComponent(nextMeeting.roomName)}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to create the meeting');
    } finally {
      setIsLoading(false);
    }
  }

  async function copyValue(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
  }

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
              onChange={event => setDemoUser(user => ({ ...user, email: event.target.value }))}
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
              <Video size={48} />
              <h2>No Active Meeting</h2>
              <p>Room token not issued.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
