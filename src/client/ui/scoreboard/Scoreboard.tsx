import { useStore } from '@client/app/store';
import { WEAPONS } from '@shared/weapons';

export function Scoreboard() {
  const rows = useStore((s) => s.scoreboard);
  const myId = useStore((s) => s.myId);
  const map = useStore((s) => s.hud.mapName);
  const mode = useStore((s) => s.mode);
  return (
    <div className="scoreboard" role="table" aria-label="Scoreboard">
      <h3>
        <span>{map || 'ARENA'}</span>
        <span>{mode === 'practice' ? 'PRACTICE' : 'DEATHMATCH'}</span>
      </h3>
      <table className="sb-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Weapon</th>
            <th className="num">Kills</th>
            <th className="num">Deaths</th>
            <th className="num">Streak</th>
            <th className="num">Score</th>
            <th className="num">Ping</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={`${r.id === myId ? 'me' : ''} ${r.alive ? '' : 'dead'}`}>
              <td>{i + 1}</td>
              <td className="name">
                <i style={{ background: `#${r.color.toString(16).padStart(6, '0')}` }} />
                {r.name}
                {r.bot && <small>BOT</small>}
              </td>
              <td style={{ fontSize: 11, color: 'var(--muted)' }}>{WEAPONS[r.weapon].short}</td>
              <td className="num">{r.kills}</td>
              <td className="num">{r.deaths}</td>
              <td className="num">{r.streak}</td>
              <td className="num">{r.score}</td>
              <td className="num">{r.bot ? '-' : r.ping}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
