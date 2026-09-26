import { useEffect } from 'react';
import { PRIMARY_WEAPONS, WEAPONS, type WeaponId } from '@shared/weapons';
import { MAPS } from '@shared/maps';
import { useStore } from '@client/app/store';
import { SERVER_URL } from '@client/app/serverStatus';
import { Button, Segmented, uiClick, uiHover } from '../common/Controls';

function statPct(w: WeaponId, key: 'damage' | 'rate' | 'range' | 'mobility'): number {
  const d = WEAPONS[w];
  switch (key) {
    case 'damage':
      return Math.min(1, (d.damage * d.pellets) / 95);
    case 'rate':
      return Math.min(1, d.rpm / 900);
    case 'range':
      return Math.min(1, d.falloff.start / 60 + (d.falloff.min > 0.9 ? 0.4 : 0));
    case 'mobility':
      return Math.min(1, (d.moveSpeedMult - 0.85) / 0.25);
  }
}

export function PlayScreen({ onStart }: { onStart: (mode: 'online' | 'practice') => void }) {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const setScreen = useStore((s) => s.setScreen);
  const serverInfo = useStore((s) => s.serverInfo);
  const online = !!SERVER_URL && serverInfo?.ok === true;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setScreen('menu');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setScreen]);

  return (
    <>
      <div className="overlay" style={{ background: 'rgba(5,6,10,0.6)' }}>
        <div className="modal">
          <div className="modal-head">
            <h2>Loadout</h2>
            <Button className="ghost small" onClick={() => setScreen('menu')}>
              ← Back
            </Button>
          </div>
          <div className="weapon-grid" role="radiogroup" aria-label="Primary weapon">
            {PRIMARY_WEAPONS.map((id) => {
              const w = WEAPONS[id];
              const active = settings.weapon === id;
              return (
                <button
                  key={id}
                  role="radio"
                  aria-checked={active}
                  className={`weapon-card ${active ? 'active' : ''}`}
                  onMouseEnter={uiHover}
                  onClick={() => {
                    uiClick();
                    update({ weapon: id });
                  }}
                >
                  <span className="name">{w.name}</span>
                  <span className="desc">{w.description}</span>
                  {(['damage', 'rate', 'range', 'mobility'] as const).map((k) => (
                    <span className="stat" key={k}>
                      {k}
                      <span className="bar">
                        <i style={{ width: `${statPct(id, k) * 100}%` }} />
                      </span>
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
          <div className="hint">Sidearm: {WEAPONS.pistol.name} is always carried. Switch with 1 / 2, Q or the mouse wheel.</div>
          <div className="mode-row">
            <div className="mode-card">
              <h3>Find match</h3>
              <p>
                {!SERVER_URL
                  ? 'This build has no game server configured.'
                  : online
                    ? `Join a live room with other players. ${serverInfo?.players ?? 0} online right now.`
                    : 'The game server is not reachable right now. Try practice mode.'}
              </p>
              <Button className="primary" disabled={!online} onClick={() => onStart('online')}>
                Find match
              </Button>
            </div>
            <div className="mode-card">
              <h3>Practice</h3>
              <p>Play offline against bots. Runs the full match locally, no connection needed.</p>
              <div className="row">
                <span className="hint">Bots</span>
                <Segmented value={String(settings.practiceBots)} options={[1, 2, 4, 7].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => update({ practiceBots: Number(v) })} />
              </div>
              <div className="row">
                <span className="hint">Skill</span>
                <Segmented
                  value={settings.practiceDifficulty}
                  options={[
                    { value: 'easy', label: 'Easy' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'hard', label: 'Hard' },
                    { value: 'mixed', label: 'Mixed' },
                  ]}
                  onChange={(v) => update({ practiceDifficulty: v })}
                />
              </div>
              <Button onClick={() => onStart('practice')}>Play offline</Button>
            </div>
          </div>
          <div className="hint">
            Maps in rotation: {MAPS.map((m) => m.name).join(' · ')}
          </div>
        </div>
      </div>
    </>
  );
}
