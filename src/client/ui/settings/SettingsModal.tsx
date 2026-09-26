import { useState } from 'react';
import { useStore } from '@client/app/store';
import { DEFAULT_SETTINGS } from '@client/app/settings';
import { Button, Segmented, Setting, Slider, Toggle, uiClick } from '../common/Controls';
import { Crosshair } from '../hud/Crosshair';
import { NamePrompt } from '../menu/NamePrompt';

type Tab = 'gameplay' | 'graphics' | 'audio' | 'access';
const COLORS = ['#4df2c9', '#ffffff', '#ff4fa3', '#ffb347', '#8ae9ff', '#c3ff5a', '#ff4d4d'];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.updateSettings);
  const updateCh = useStore((st) => st.updateCrosshair);
  const [tab, setTab] = useState<Tab>('gameplay');
  const [askName, setAskName] = useState(false);
  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal" role="dialog" aria-label="Settings">
        <div className="modal-head">
          <h2>Settings</h2>
          <Button className="ghost small" onClick={onClose} autoFocus>
            Close ✕
          </Button>
        </div>
        <div className="tabs" role="tablist">
          {(
            [
              ['gameplay', 'Gameplay'],
              ['graphics', 'Graphics'],
              ['audio', 'Audio'],
              ['access', 'Accessibility'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => { uiClick(); setTab(id); }}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'gameplay' && (
          <div className="settings-grid">
            <div>
              <Setting label="Player name">
                <Button className="small" onClick={() => setAskName(true)}>
                  {s.name || 'Set name'}
                </Button>
              </Setting>
              <Setting label="Mouse sensitivity" sub="Aim speed. Lower is more precise.">
                <Slider label="Sensitivity" value={s.sensitivity} min={0.5} max={10} step={0.1} onChange={(v) => update({ sensitivity: v })} format={(v) => v.toFixed(1)} />
              </Setting>
              <Setting label="Field of view" sub="Horizontal, in degrees.">
                <Slider label="Field of view" value={s.fov} min={70} max={120} step={1} onChange={(v) => update({ fov: v })} format={(v) => `${v}°`} />
              </Setting>
              <Setting label="Damage numbers" sub="Show damage dealt above enemies.">
                <Toggle label="Damage numbers" value={s.damageNumbers} onChange={(v) => update({ damageNumbers: v })} />
              </Setting>
              <Setting label="Show FPS and ping">
                <Toggle label="Show FPS" value={s.showFps} onChange={(v) => update({ showFps: v })} />
              </Setting>
            </div>
            <div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div className="crosshair-preview" aria-label="Crosshair preview">
                  <Crosshair spread={0.6} preview />
                </div>
                <div style={{ flex: 1 }}>
                  <Setting label="Size">
                    <Slider label="Crosshair size" value={s.crosshair.size} min={2} max={20} step={1} onChange={(v) => updateCh({ size: v })} />
                  </Setting>
                  <Setting label="Thickness">
                    <Slider label="Crosshair thickness" value={s.crosshair.thickness} min={1} max={5} step={1} onChange={(v) => updateCh({ thickness: v })} />
                  </Setting>
                  <Setting label="Gap">
                    <Slider label="Crosshair gap" value={s.crosshair.gap} min={0} max={16} step={1} onChange={(v) => updateCh({ gap: v })} />
                  </Setting>
                  <Setting label="Opacity">
                    <Slider label="Crosshair opacity" value={s.crosshair.opacity} min={0.2} max={1} step={0.05} onChange={(v) => updateCh({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
                  </Setting>
                </div>
              </div>
              <Setting label="Color">
                <div className="swatches">
                  {COLORS.map((c) => (
                    <button key={c} aria-label={`Crosshair color ${c}`} className={`swatch ${s.crosshair.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => { uiClick(); updateCh({ color: c }); }} />
                  ))}
                </div>
              </Setting>
              <Setting label="Dynamic" sub="Gap widens with spread while moving or firing.">
                <Toggle label="Dynamic crosshair" value={s.crosshair.dynamic} onChange={(v) => updateCh({ dynamic: v })} />
              </Setting>
              <Setting label="Center dot">
                <Toggle label="Center dot" value={s.crosshair.dot} onChange={(v) => updateCh({ dot: v })} />
              </Setting>
            </div>
          </div>
        )}
        {tab === 'graphics' && (
          <div className="settings-grid">
            <div>
              <Setting label="Quality" sub="Low disables shadows, particles and antialiasing.">
                <Segmented
                  value={s.quality}
                  options={[
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                  ]}
                  onChange={(v) => update({ quality: v })}
                />
              </Setting>
              <Setting label="Shadows">
                <Toggle label="Shadows" value={s.shadows} onChange={(v) => update({ shadows: v })} />
              </Setting>
              <Setting label="Effects" sub="Sparks, casings and ambient particles.">
                <Toggle label="Effects" value={s.effects} onChange={(v) => update({ effects: v })} />
              </Setting>
            </div>
            <div>
              <Setting label="Resolution scale" sub="Render below native resolution for more FPS.">
                <Slider label="Resolution scale" value={s.resolutionScale} min={0.5} max={1} step={0.05} onChange={(v) => update({ resolutionScale: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Setting>
              <Setting label="UI scale">
                <Slider label="UI scale" value={s.uiScale} min={0.8} max={1.4} step={0.05} onChange={(v) => update({ uiScale: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Setting>
            </div>
          </div>
        )}
        {tab === 'audio' && (
          <div className="settings-grid">
            <div>
              <Setting label="Master volume">
                <Slider label="Master volume" value={s.masterVolume} min={0} max={1} step={0.05} onChange={(v) => update({ masterVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Setting>
              <Setting label="Music volume">
                <Slider label="Music volume" value={s.musicVolume} min={0} max={1} step={0.05} onChange={(v) => update({ musicVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Setting>
              <Setting label="Effects volume">
                <Slider label="Effects volume" value={s.sfxVolume} min={0} max={1} step={0.05} onChange={(v) => update({ sfxVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Setting>
            </div>
            <div>
              <Setting label="Mute everything">
                <Toggle label="Mute" value={s.muted} onChange={(v) => update({ muted: v })} />
              </Setting>
              <p className="hint">All sounds and music are synthesized in your browser at startup. Nothing is downloaded.</p>
            </div>
          </div>
        )}
        {tab === 'access' && (
          <div className="settings-grid">
            <div>
              <Setting label="Reduced motion" sub="Disables head bob, view kick, camera shake and screen flashes' motion.">
                <Toggle label="Reduced motion" value={s.reducedMotion} onChange={(v) => update({ reducedMotion: v })} />
              </Setting>
              <Setting label="UI scale">
                <Slider label="UI scale" value={s.uiScale} min={0.8} max={1.4} step={0.05} onChange={(v) => update({ uiScale: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Setting>
            </div>
            <div>
              <p className="hint">Hit feedback is shown with shape and sound as well as color: hit markers, damage numbers and a distinct headshot tone. Menus are fully keyboard navigable (Tab / Enter / Esc).</p>
              <Button className="small" onClick={() => update({ ...DEFAULT_SETTINGS, name: s.name, crosshair: { ...DEFAULT_SETTINGS.crosshair } })}>
                Reset all settings
              </Button>
            </div>
          </div>
        )}
      </div>
      {askName && <NamePrompt onDone={() => setAskName(false)} />}
    </div>
  );
}
