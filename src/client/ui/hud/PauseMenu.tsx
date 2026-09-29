import { useEffect, useState } from 'react';
import { MAPS } from '@shared/maps';
import { useStore } from '@client/app/store';
import { Button, Segmented } from '../common/Controls';

export function inviteLink(code: string): string {
  return `${location.origin}/?room=${code}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Code, invite link and (for the host) the start button of a private room. */
function RoomPanel({ onStartMatch }: { onStartMatch: (mapId: string) => void }) {
  const room = useStore((s) => s.room)!;
  const myId = useStore((s) => s.myId);
  const phase = useStore((s) => s.hud.phase);
  const mapId = useStore((s) => s.hud.mapId);
  const rows = useStore((s) => s.scoreboard);
  const [map, setMap] = useState(mapId || MAPS[0].id);
  const [copied, setCopied] = useState<'link' | 'code' | 'failed' | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const isHost = room.host === myId;
  const humans = rows.filter((r) => !r.bot);
  const bots = rows.length - humans.length;
  const link = inviteLink(room.code);
  const hostName = rows.find((r) => r.id === room.host)?.name;

  return (
    <div className="room-panel" aria-label="Private room">
      <div className="room-panel-head">
        <span className="label">Private room</span>
        <span className="hint">
          {humans.length} {humans.length === 1 ? 'player' : 'players'}
          {bots > 0 ? ` + ${bots} ${bots === 1 ? 'bot' : 'bots'}` : ''}
        </span>
      </div>
      <button
        className="room-code"
        title="Copy the room code"
        onClick={async () => setCopied((await copyText(room.code)) ? 'code' : 'failed')}
      >
        {room.code}
      </button>
      <div className="invite-row">
        <input className="input" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <Button className="small" onClick={async () => setCopied((await copyText(link)) ? 'link' : 'failed')}>
          {copied === 'link' ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <span className="hint">
        {copied === 'code'
          ? 'Code copied.'
          : copied === 'failed'
            ? 'Copy blocked by the browser. Select the link and copy it by hand.'
            : 'Friends open the link, or enter the code under Play with friends.'}
      </span>
      {isHost ? (
        phase === 'warmup' ? (
          <div className="host-controls">
            <Segmented value={map} options={MAPS.map((m) => ({ value: m.id, label: m.name }))} onChange={setMap} />
            <Button className="primary" onClick={() => onStartMatch(map)}>
              Start match
            </Button>
          </div>
        ) : (
          <span className="hint">{phase === 'ended' ? 'Results are up. You can start the next match from warmup.' : 'Match in progress.'}</span>
        )
      ) : (
        <span className="hint">{hostName ? `${hostName} is the host and starts the match.` : 'Waiting for a host.'}</span>
      )}
    </div>
  );
}

export function PauseMenu({ onResume, onLeave, onStartMatch }: { onResume: () => void; onLeave: () => void; onStartMatch: (mapId: string) => void }) {
  const setOverlay = useStore((s) => s.setOverlay);
  const room = useStore((s) => s.room);
  return (
    <div className="overlay">
      <div className={`modal pause-menu ${room ? '' : 'narrow'}`} style={room ? { width: 'min(560px, 92vw)' } : undefined}>
        <div className="modal-head">
          <h2>Paused</h2>
          <span className="hint">The match keeps running</span>
        </div>
        {room && <RoomPanel onStartMatch={onStartMatch} />}
        <Button className={room ? '' : 'primary'} onClick={onResume} autoFocus>
          Resume
        </Button>
        <Button onClick={() => setOverlay('settings')}>Settings</Button>
        <Button onClick={() => setOverlay('controls')}>Controls</Button>
        <Button className="danger" onClick={onLeave}>
          {room ? 'Leave room' : 'Leave match'}
        </Button>
      </div>
    </div>
  );
}
