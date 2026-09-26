import { audio } from '@client/game/audio/AudioManager';

export function uiHover(): void {
  audio.play('ui_hover', { volume: 0.25 });
}

export function uiClick(): void {
  audio.init();
  audio.play('ui_click', { volume: 0.5 });
}

export function uiConfirm(): void {
  audio.init();
  audio.play('ui_confirm', { volume: 0.5 });
}

export function uiError(): void {
  audio.init();
  audio.play('ui_error', { volume: 0.5 });
}

export function Button({
  children,
  className = '',
  onClick,
  disabled,
  autoFocus,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  title?: string;
}) {
  return (
    <button
      className={`btn ${className}`}
      disabled={disabled}
      autoFocus={autoFocus}
      title={title}
      onMouseEnter={() => !disabled && uiHover()}
      onClick={() => {
        if (disabled) return;
        uiClick();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={label}
      className={`toggle ${value ? 'on' : ''}`}
      onClick={() => {
        uiClick();
        onChange(!value);
      }}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          onMouseEnter={uiHover}
          onClick={() => {
            uiClick();
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  label: string;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="value">{format ? format(value) : value}</span>
    </span>
  );
}

export function Setting({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div>
        <span className="label">{label}</span>
        {sub && <span className="sub">{sub}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}
