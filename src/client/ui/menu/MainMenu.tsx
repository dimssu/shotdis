import { useEffect, useState } from 'react';
import { useStore } from '@client/app/store';
import { fetchServerInfo, SERVER_URL } from '@client/app/serverStatus';
import { audio } from '@client/game/audio/AudioManager';
import { Button } from '../common/Controls';
import { NamePrompt } from './NamePrompt';

export function MainMenu({ onJoinRoom }: { onJoinRoom: (code: string) => void }) {
  const firstLaunch = useStore((s) => s.firstLaunch);
  const name = useStore((s) => s.settings.name);
  const setScreen = useStore((s) => s.setScreen);
  const setOverlay = useStore((s) => s.setOverlay);
  const serverInfo = useStore((s) => s.serverInfo);
  const inviteCode = useStore((s) => s.inviteCode);
  const clearInvite = useStore((s) => s.clearInvite);
  const [askName, setAskName] = useState(firstLaunch);
  const [joinAfterName, setJoinAfterName] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const info = await fetchServerInfo();
      if (alive) useStore.setState({ serverInfo: info });
    };
    void poll();
    const t = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    // Music can only start after a user gesture; retry on first interaction.
    const tryStart = () => {
      if (audio.init()) {
        const s = useStore.getState().settings;
        audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume, s.muted);
        audio.startMusic('menu');
      }
    };
    tryStart();
    window.addEventListener('pointerdown', tryStart, { once: true });
    window.addEventListener('keydown', tryStart, { once: true });
    return () => {
      window.removeEventListener('pointerdown', tryStart);
      window.removeEventListener('keydown', tryStart);
    };
  }, []);

  const joinInvite = () => {
    if (!inviteCode) return;
    if (!name) {
      setJoinAfterName(true);
      setAskName(true);
      return;
    }
    onJoinRoom(inviteCode);
  };

  const play = () => {
    if (!name) {
      setAskName(true);
      return;
    }
    setScreen('play');
  };

  return (
    <>
      <div className="menu">
        <div className="menu-panel">
          <h1 className="logo">
            <span className="dot" />
            SHOTDIS
          </h1>
          <p className="tagline">Fast browser arena FPS</p>
          <div className="name-row">
            <div className="field">
              <label>Playing as</label>
              <button className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setAskName(true)} title="Change name">
                {name || 'Set your name'}
              </button>
            </div>
          </div>
          {inviteCode && (
            <div className="invite-card" role="region" aria-label="Room invite">
              <span className="label">You are invited</span>
              <b>ROOM {inviteCode}</b>
              <div className="row">
                <Button className="primary" onClick={joinInvite} disabled={!SERVER_URL} autoFocus>
                  Join room
                </Button>
                <Button className="ghost small" onClick={clearInvite}>
                  Not now
                </Button>
              </div>
            </div>
          )}
          <div className="menu-nav">
            <Button className={inviteCode ? '' : 'primary'} onClick={play} autoFocus={!inviteCode}>
              Play
            </Button>
            <Button onClick={() => setOverlay('settings')}>Settings</Button>
            <Button onClick={() => setOverlay('controls')}>Controls</Button>
            <Button onClick={() => setOverlay('credits')}>Credits</Button>
          </div>
          <div className="menu-footer">
            <span className={`status-pill ${serverInfo ? (serverInfo.ok ? 'ok' : 'bad') : ''}`}>
              <i />
              {!SERVER_URL ? 'Offline build · practice only' : serverInfo === null ? 'Checking server…' : serverInfo.ok ? `Online · ${serverInfo.players} in ${serverInfo.rooms} room${serverInfo.rooms === 1 ? '' : 's'}` : 'Server unreachable'}
            </span>
            <span>v{__APP_VERSION__}</span>
          </div>
        </div>
      </div>
      {askName && (
        <NamePrompt
          onDone={() => {
            setAskName(false);
            if (joinAfterName && inviteCode) onJoinRoom(inviteCode);
            setJoinAfterName(false);
          }}
        />
      )}
    </>
  );
}
