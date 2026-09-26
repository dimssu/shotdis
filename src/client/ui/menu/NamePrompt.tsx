import { useState } from 'react';
import { sanitizeName } from '@shared/util/sanitize';
import { NET } from '@shared/config';
import { useStore } from '@client/app/store';
import { Button, uiConfirm, uiError } from '../common/Controls';

export function NamePrompt({ onDone }: { onDone: () => void }) {
  const current = useStore((s) => s.settings.name);
  const update = useStore((s) => s.updateSettings);
  const [value, setValue] = useState(current);
  const clean = sanitizeName(value);
  const invalid = value.trim().length > 0 && clean.length === 0;

  const submit = () => {
    if (!clean) {
      uiError();
      return;
    }
    update({ name: clean });
    uiConfirm();
    onDone();
  };

  return (
    <div className="overlay">
      <form
        className="modal narrow"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="modal-head">
          <h2>Enter your name</h2>
        </div>
        <div className="field">
          <label htmlFor="name">Callsign</label>
          <input
            id="name"
            className={`input ${invalid ? 'invalid' : ''}`}
            autoFocus
            maxLength={NET.MAX_NAME_LENGTH}
            placeholder="e.g. NeonFox"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <span className={`hint ${invalid ? 'error' : ''}`}>
            {invalid ? 'Letters, numbers, spaces, - _ . only.' : `Up to ${NET.MAX_NAME_LENGTH} characters. Shown to other players.`}
          </span>
        </div>
        <Button className="primary" onClick={submit} disabled={clean.length === 0}>
          Continue
        </Button>
      </form>
    </div>
  );
}
