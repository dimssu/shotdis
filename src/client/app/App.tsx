import { useCallback, useEffect, useRef, useState } from 'react';
import { MAPS } from '@shared/maps';
import { Game } from '@client/game/Game';
import { LoopbackTransport, WsTransport, type Transport } from '@client/game/net/Transport';
import { audio } from '@client/game/audio/AudioManager';
import { HUD } from '@client/ui/hud/HUD';
import { PauseMenu } from '@client/ui/hud/PauseMenu';
import { ConnectingScreen, LoadingScreen } from '@client/ui/loading/LoadingScreen';
import { MainMenu } from '@client/ui/menu/MainMenu';
import { MenuBackground } from '@client/ui/menu/MenuBackground';
import { PlayScreen } from '@client/ui/menu/PlayScreen';
import { ResultsScreen } from '@client/ui/results/ResultsScreen';
import { Scoreboard } from '@client/ui/scoreboard/Scoreboard';
import { ControlsModal } from '@client/ui/settings/ControlsModal';
import { CreditsModal } from '@client/ui/settings/CreditsModal';
import { SettingsModal } from '@client/ui/settings/SettingsModal';
import { SERVER_URL } from './serverStatus';
import { useStore, type GameMode } from './store';

let pendingTransport: Transport | null = null;
let connectAttempt = 0;
let activeConnect: WsTransport | null = null;

/** `?map=neon` picks the practice map during development. */
function devMapIndex(): number | null {
  if (!import.meta.env.DEV) return null;
  const id = new URLSearchParams(location.search).get('map');
  if (!id) return null;
  const i = MAPS.findIndex((m) => m.id === id);
  return i >= 0 ? i : null;
}

function GameView({ onLeave }: { onLeave: (reason?: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const screen = useStore((s) => s.screen);
  const paused = useStore((s) => s.paused);
  const results = useStore((s) => s.results);
  const scoreboardOpen = useStore((s) => s.scoreboardOpen);
  const overlay = useStore((s) => s.overlay);
  const reconnecting = useStore((s) => s.reconnecting);
  const settings = useStore((s) => s.settings);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const transport = pendingTransport;
    pendingTransport = null;
    if (!canvas || !transport) {
      onLeave();
      return;
    }
    let game: Game;
    try {
      game = new Game({
        canvas,
        transport,
        name: settings.name,
        weapon: settings.weapon,
        serverUrl: transport.kind === 'online' ? SERVER_URL : undefined,
        onLeave: (reason) => onLeave(reason),
        onProgress: (label, value) => useStore.setState({ loadingLabel: label, loadingProgress: value }),
      });
    } catch (e) {
      transport.close();
      setFailed(e instanceof Error ? e.message : 'Could not start the renderer');
      return;
    }
    gameRef.current = game;
    let cancelled = false;
    game
      .start()
      .then(() => {
        if (cancelled) return;
        useStore.getState().setScreen('game');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFailed(e instanceof Error ? e.message : 'Failed to load the arena');
      });
    return () => {
      cancelled = true;
      game.stop();
      gameRef.current = null;
    };
    // The game is created once per mount; settings are read at creation time on purpose.
  }, []);

  const lock = useCallback(() => gameRef.current?.requestPointerLock(), []);

  return (
    <>
      <canvas ref={canvasRef} className="game-canvas" />
      {screen === 'loading' && !failed && <LoadingScreen />}
      {failed && (
        <div className="center-screen">
          <h1>Could not start</h1>
          <div className="sub" style={{ maxWidth: 420, textAlign: 'center' }}>
            {failed}
          </div>
          <button className="btn" onClick={() => onLeave()}>
            Back to menu
          </button>
        </div>
      )}
      {screen === 'game' && (
        <>
          <HUD onClickToPlay={lock} />
          {scoreboardOpen && <Scoreboard />}
          {results && (
            <ResultsScreen
              onPlayAgain={() => {
                useStore.getState().setResults(null);
                lock();
              }}
              onLeave={() => onLeave()}
            />
          )}
          {paused && !results && !reconnecting && overlay === 'none' && (
            <PauseMenu
              onResume={() => {
                useStore.setState({ paused: false });
                lock();
              }}
              onLeave={() => onLeave()}
            />
          )}
        </>
      )}
    </>
  );
}

export function App() {
  const screen = useStore((s) => s.screen);
  const overlay = useStore((s) => s.overlay);
  const setOverlay = useStore((s) => s.setOverlay);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.getState().setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    // Keep audio volumes in sync when settings change outside a match.
    audio.setVolumes(settings.masterVolume, settings.musicVolume, settings.sfxVolume, settings.muted);
  }, [settings.masterVolume, settings.musicVolume, settings.sfxVolume, settings.muted]);

  const leave = useCallback((reason?: string) => {
    const st = useStore.getState();
    st.reset();
    st.setScreen('menu');
    st.setOverlay('none');
    if (reason) st.setToast(reason);
    if (document.pointerLockElement) document.exitPointerLock();
    audio.stopAmbient();
    audio.startMusic('menu');
  }, []);

  const startMatch = useCallback(async (mode: GameMode) => {
    const st = useStore.getState();
    st.reset();
    st.setMode(mode);
    audio.init();
    audio.stopMusic(0.5);
    if (mode === 'online') {
      st.setScreen('connecting');
      useStore.setState({ connectStatus: 'Reaching the game server', connectError: null });
      const attempt = ++connectAttempt;
      activeConnect?.close();
      const ws = new WsTransport();
      activeConnect = ws;
      try {
        await ws.connect(SERVER_URL);
      } catch (e) {
        if (attempt === connectAttempt && useStore.getState().screen === 'connecting') {
          useStore.setState({ connectError: e instanceof Error ? e.message : 'Could not connect' });
        }
        return;
      }
      if (attempt !== connectAttempt || useStore.getState().screen !== 'connecting') {
        ws.close();
        return;
      }
      activeConnect = null;
      pendingTransport = ws;
    } else {
      const s = st.settings;
      pendingTransport = new LoopbackTransport({
        name: s.name,
        weapon: s.weapon,
        bots: s.practiceBots,
        difficulty: s.practiceDifficulty,
        mapIndex: devMapIndex() ?? Math.floor(Math.random() * MAPS.length),
      });
    }
    useStore.setState({ loadingProgress: 0, loadingLabel: 'Starting' });
    useStore.getState().setScreen('loading');
  }, []);

  return (
    <>
      {(screen === 'menu' || screen === 'play') && <MenuBackground />}
      {screen === 'menu' && <MainMenu />}
      {screen === 'play' && <PlayScreen onStart={(m) => void startMatch(m)} />}
      {screen === 'connecting' && (
        <ConnectingScreen
          onCancel={() => {
            connectAttempt++;
            activeConnect?.close();
            activeConnect = null;
            useStore.getState().setScreen('play');
          }}
          onOffline={() => void startMatch('practice')}
        />
      )}
      {(screen === 'loading' || screen === 'game') && <GameView onLeave={leave} />}
      {overlay === 'settings' && <SettingsModal onClose={() => setOverlay('none')} />}
      {overlay === 'controls' && <ControlsModal onClose={() => setOverlay('none')} />}
      {overlay === 'credits' && <CreditsModal onClose={() => setOverlay('none')} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
