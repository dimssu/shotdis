import { useEffect, useState } from 'react';
import { WEAPONS } from '@shared/weapons';
import { useStore } from '@client/app/store';
import { Button } from '../common/Controls';

export function ResultsScreen({ onPlayAgain, onLeave }: { onPlayAgain: () => void; onLeave: () => void }) {
  const results = useStore((s) => s.results);
  const myId = useStore((s) => s.myId);
  const offset = useStore((s) => s.hud.serverOffset);
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!results) return null;
  const me = results.me;
  const winner = results.rows[0];
  const kd = me ? (me.deaths === 0 ? me.kills : me.kills / me.deaths) : 0;
  const next = Math.max(0, Math.ceil((results.nextAt - (now + offset)) / 1000));
  return (
    <div className="overlay">
      <div className="modal results">
        <div className="modal-head">
          <div className="winner">
            MATCH OVER · WINNER
            <b style={{ color: winner ? `#${winner.color.toString(16).padStart(6, '0')}` : undefined }}>{winner ? winner.name : '—'}</b>
          </div>
          <div className="hint" style={{ fontFamily: 'var(--mono)' }}>
            NEXT MATCH IN {next}s
          </div>
        </div>
        {me && (
          <div className="stat-tiles">
            <div className="tile">
              <b>{me.score}</b>
              <span>SCORE</span>
            </div>
            <div className="tile">
              <b>{me.kills}</b>
              <span>KILLS</span>
            </div>
            <div className="tile">
              <b>{me.deaths}</b>
              <span>DEATHS</span>
            </div>
            <div className="tile">
              <b>{kd.toFixed(2)}</b>
              <span>K/D</span>
            </div>
            <div className="tile">
              <b>{Math.round(results.accuracy * 100)}%</b>
              <span>ACCURACY</span>
            </div>
            <div className="tile">
              <b>{results.bestStreak}</b>
              <span>BEST STREAK</span>
            </div>
          </div>
        )}
        <table className="sb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Weapon</th>
              <th className="num">Kills</th>
              <th className="num">Deaths</th>
              <th className="num">Score</th>
            </tr>
          </thead>
          <tbody>
            {results.rows.map((r, i) => (
              <tr key={r.id} className={r.id === myId ? 'me' : ''}>
                <td>{i + 1}</td>
                <td className="name">
                  <i style={{ background: `#${r.color.toString(16).padStart(6, '0')}` }} />
                  {r.name}
                  {r.bot && <small>BOT</small>}
                </td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{WEAPONS[r.weapon].short}</td>
                <td className="num">{r.kills}</td>
                <td className="num">{r.deaths}</td>
                <td className="num">{r.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={onLeave}>Leave</Button>
          <Button className="primary" onClick={onPlayAgain} autoFocus>
            Play again
          </Button>
        </div>
      </div>
    </div>
  );
}
