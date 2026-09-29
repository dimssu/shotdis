import { useEffect, useRef, useState } from 'react';
import { WEAPONS, type WeaponId } from '@shared/weapons';
import { COMBAT, MATCH } from '@shared/config';
import { useStore } from '@client/app/store';
import { minimap } from '@client/game/hud/Minimap';
import { Crosshair } from './Crosshair';

function weaponLabel(w: WeaponId | 'fall' | 'void'): string {
  if (w === 'fall') return 'FALL';
  if (w === 'void') return 'VOID';
  return WEAPONS[w].short;
}

function useNow(hz: number): number {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 1000 / hz);
    return () => clearInterval(t);
  }, [hz]);
  return now;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function Top() {
  const hud = useStore((s) => s.hud);
  const now = useNow(4);
  const serverNow = now + hud.serverOffset;
  const remain = hud.phaseEndsAt - serverNow;
  const label = hud.phase === 'live' ? fmt(remain) : hud.phase === 'countdown' ? 'READY' : hud.phase === 'ended' ? 'END' : hud.phase === 'warmup' ? 'WARMUP' : '--:--';
  return (
    <div className="hud-top" aria-label="Match status">
      <div className="stat">
        <b>{hud.score}</b>SCORE
      </div>
      <div className={`timer ${hud.phase === 'live' && remain < 30000 ? 'low' : ''}`}>{label}</div>
      <div className="stat">
        <b>{hud.rank > 0 ? `#${hud.rank}` : '-'}</b>RANK
      </div>
    </div>
  );
}

function Bars() {
  const hp = useStore((s) => s.hud.hp);
  const armor = useStore((s) => s.hud.armor);
  const low = hp <= 30;
  return (
    <div className="hud-bl" aria-label="Health and armor">
      <div className="bar-row">
        <span className={`num ${low ? 'low' : ''}`} style={low ? { color: 'var(--danger)' } : undefined}>
          {hp}
        </span>
        <div className={`bar-track hp ${low ? 'low' : ''}`}>
          <i style={{ width: `${(hp / COMBAT.MAX_HP) * 100}%` }} />
        </div>
      </div>
      <div className="bar-row">
        <span className="num armor">{armor}</span>
        <div className="bar-track thin armor">
          <i style={{ width: `${(armor / COMBAT.MAX_ARMOR) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function Ammo() {
  const hud = useStore((s) => s.hud);
  const def = WEAPONS[hud.weapon];
  return (
    <div className="hud-br" aria-label="Weapon and ammo">
      {hud.reloading ? (
        <>
          <span className="reload-label">RELOADING</span>
          <div className="reload-bar">
            <i style={{ width: `${hud.reloadProgress * 100}%` }} />
          </div>
        </>
      ) : null}
      <div className="ammo">
        <span className={`mag ${hud.mag === 0 ? 'empty' : ''}`}>{hud.mag}</span>
        <span className="res">/ {hud.reserve}</span>
      </div>
      <div className="weapon-name">{def.name}</div>
      <div className="weapon-slots">
        <span className={hud.slot === 0 ? 'active' : ''}>1 {WEAPONS[hud.weapons[0]].short}</span>
        <span className={hud.slot === 1 ? 'active' : ''}>2 {WEAPONS[hud.weapons[1]].short}</span>
      </div>
    </div>
  );
}

function KillFeed() {
  const feed = useStore((s) => s.killFeed);
  return (
    <div className="killfeed" aria-live="polite">
      {feed.map((k) => (
        <div key={k.id} className={`kf ${k.mine ? 'mine' : ''} ${k.died ? 'died' : ''}`}>
          {k.killer ? <span style={{ color: `#${k.killerColor.toString(16).padStart(6, '0')}` }}>{k.killer}</span> : null}
          <span className="w">{weaponLabel(k.weapon)}</span>
          {k.headshot && <span className="hs">HS</span>}
          <span style={{ color: `#${k.victimColor.toString(16).padStart(6, '0')}` }}>{k.victim}</span>
        </div>
      ))}
    </div>
  );
}

function Feedback() {
  const hitMarkers = useStore((s) => s.hitMarkers);
  const indicators = useStore((s) => s.damageIndicators);
  const banners = useStore((s) => s.banners);
  const numbers = useStore((s) => s.damageNumbers);
  const flashAt = useStore((s) => s.damageFlashAt);
  const lowHealth = useStore((s) => s.hud.lowHealth);
  const reduced = useStore((s) => s.settings.reducedMotion);
  return (
    <>
      <div className="vignette" />
      {lowHealth && <div className="low-health" />}
      {flashAt > 0 && <div key={flashAt} className="damage-flash" />}
      {indicators.map((d) => (
        <div key={d.id} className="dmg-ind" style={{ transform: `rotate(${(d.angle * 180) / Math.PI}deg)` }}>
          <i />
        </div>
      ))}
      {hitMarkers.map((h) => (
        <div key={h.id} className={`hitmarker ${h.headshot ? 'hs' : ''} ${h.kill ? 'kill' : ''} ${h.blocked ? 'blocked' : ''}`} title={h.blocked ? 'Spawn protected' : undefined}>
          <i style={{ transform: 'translate(-11px,-9px) rotate(45deg)' }} />
          <i style={{ transform: 'translate(2px,-9px) rotate(-45deg)' }} />
          <i style={{ transform: 'translate(-11px,7px) rotate(-45deg)' }} />
          <i style={{ transform: 'translate(2px,7px) rotate(45deg)' }} />
        </div>
      ))}
      {numbers.map((n) => (
        <span key={n.id} className={`damage-number ${n.headshot ? 'hs' : ''}`} style={{ left: `${n.x}%`, top: `${n.y}%` }}>
          {n.value}
        </span>
      ))}
      {banners.map((b) => (
        <div key={b.id} className={`banner ${b.kind}`} style={reduced ? { animationDuration: '1.2s' } : undefined}>
          <b>{b.text}</b>
          {b.sub && <span>{b.sub}</span>}
        </div>
      ))}
    </>
  );
}

function Countdown() {
  const n = useStore((s) => s.countdown);
  if (n === null) return null;
  return (
    <div className="countdown" aria-live="assertive">
      <b key={n}>{n === 0 ? 'GO' : n}</b>
      <span>{n === 0 ? 'FIGHT' : 'MATCH STARTING'}</span>
    </div>
  );
}

function Death() {
  const death = useStore((s) => s.death);
  const offset = useStore((s) => s.hud.serverOffset);
  const now = useNow(10);
  if (!death) return null;
  const remain = Math.max(0, death.respawnAt - (now + offset));
  return (
    <div className="death" aria-live="assertive">
      <h2>ELIMINATED</h2>
      {death.killer ? (
        <p>
          by <b style={{ color: `#${death.killerColor.toString(16).padStart(6, '0')}` }}>{death.killer}</b> · {weaponLabel(death.weapon)}
          {death.headshot ? ' · HEADSHOT' : ''}
        </p>
      ) : (
        <p>{death.weapon === 'void' ? 'You fell out of the arena.' : 'Fall damage.'}</p>
      )}
      <div className="respawn">RESPAWN IN {Math.ceil(remain / 1000)}</div>
    </div>
  );
}

function MinimapView() {
  const ref = useRef<HTMLCanvasElement>(null);
  const uiScale = useStore((s) => s.settings.uiScale);
  useEffect(() => {
    minimap.setCanvas(ref.current);
    return () => minimap.setCanvas(null);
  }, []);
  const size = Math.round(172 * uiScale);
  return <canvas ref={ref} className="minimap" style={{ width: size, height: size }} role="img" aria-label="Minimap" />;
}

/** Private room warmup: tell everyone what is happening and who starts the match. */
function RoomBanner() {
  const room = useStore((s) => s.room);
  const phase = useStore((s) => s.hud.phase);
  const myId = useStore((s) => s.myId);
  const humans = useStore((s) => s.scoreboard.filter((r) => !r.bot).length);
  if (!room || phase !== 'warmup') return null;
  const isHost = room.host === myId;
  return (
    <div className="room-banner" role="status">
      <b>WARMUP</b>
      <span>
        ROOM <em>{room.code}</em> · {humans} {humans === 1 ? 'PLAYER' : 'PLAYERS'}
      </span>
      <span className="hint-line">{isHost ? 'Press Esc to invite friends and start the match' : 'Kills do not count yet. Waiting for the host to start'}</span>
    </div>
  );
}

function Debug() {
  const show = useStore((s) => s.settings.showFps);
  const fps = useStore((s) => s.hud.fps);
  const ping = useStore((s) => s.hud.ping);
  const mode = useStore((s) => s.mode);
  if (!show) return null;
  return (
    <div className="hud-fps">
      {fps} FPS · {mode === 'practice' ? 'LOCAL' : `${ping} MS`}
    </div>
  );
}

export function HUD({ onClickToPlay }: { onClickToPlay: () => void }) {
  const alive = useStore((s) => s.hud.alive);
  const spread = useStore((s) => s.hud.spread);
  const scoped = useStore((s) => s.hud.scoped);
  const locked = useStore((s) => s.pointerLocked);
  const paused = useStore((s) => s.paused);
  const results = useStore((s) => s.results);
  const phase = useStore((s) => s.hud.phase);
  const hit = useStore((s) => s.hitMarkers.length > 0);
  const uiScale = useStore((s) => s.settings.uiScale);
  const reconnecting = useStore((s) => s.reconnecting);
  const connectStatus = useStore((s) => s.connectStatus);
  const minimapMode = useStore((s) => s.settings.minimap);
  return (
    <div className="hud" style={{ '--ui-scale': uiScale } as React.CSSProperties}>
      {scoped && <div className="scope" />}
      <Feedback />
      {alive && !scoped && <Crosshair spread={spread} hit={hit} />}
      {alive && scoped && <Crosshair spread={0} hit={hit} />}
      <Top />
      <RoomBanner />
      {minimapMode !== 'off' && <MinimapView />}
      <Bars />
      <Ammo />
      <KillFeed />
      <Countdown />
      <Death />
      <Debug />
      {reconnecting && (
        <div className="click-to-play" style={{ cursor: 'default' }} role="status" aria-live="assertive">
          <div className="spinner" />
          <b>RECONNECTING</b>
          <span>{connectStatus || 'CONNECTION LOST'}</span>
        </div>
      )}
      {!locked && !paused && !results && !reconnecting && phase !== 'ended' && (
        <div
          className="click-to-play"
          onClick={onClickToPlay}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClickToPlay();
            }
          }}
          role="button"
          tabIndex={0}
          style={{ pointerEvents: 'auto' }}
        >
          <b>CLICK TO PLAY</b>
          <span>MOUSE LOCKS TO THE ARENA · ESC TO PAUSE</span>
        </div>
      )}
      {phase === 'countdown' && <div style={{ position: 'absolute', top: 90, left: '50%', transform: 'translateX(-50%)', color: 'var(--muted)', letterSpacing: '0.3em', fontSize: 11 }}>ROUND STARTS SOON · {MATCH.DURATION_S / 60} MIN MATCH</div>}
    </div>
  );
}
