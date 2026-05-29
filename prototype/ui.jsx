// ui.jsx — shared presentational pieces.

const { useState } = React;

function Arrow({ dir = 'right' }) {
  const d = dir === 'left'
    ? 'M11 4 L5 10 L11 16 M5 10 H17'
    : 'M9 4 L15 10 L9 16 M15 10 H3';
  return (
    <svg className="arrow" width="15" height="15" viewBox="0 0 20 20" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

// Two-tab segmented switch with a sliding thumb.
function Tabs({ active, onSelect }) {
  const tabs = [
    { key: 'twitter', label: 'X', icon: 'icon-x.png' },
    { key: 'youtube', label: 'YouTube', icon: 'icon-youtube.png' },
  ];
  const idx = tabs.findIndex((t) => t.key === active);
  return (
    <div className="tabs" role="tablist">
      <div className="tab-thumb" style={{ transform: `translateX(${idx * 100}%)` }} />
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" className="tab"
                data-active={t.key === active ? '1' : '0'}
                onClick={() => onSelect(t.key)} aria-label={t.label}>
          <img className="tab-ico" src={t.icon} alt={t.label} />
        </button>
      ))}
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <img className="brand-logo" src="logo.png" alt="Doug's Giveaway Bot" />
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <p className="help">{hint}</p>}
    </div>
  );
}

function TextInput(props) {
  return <input className="input" type="text" {...props} />;
}

function NumberInput(props) {
  return <input className="input" type="number" {...props} />;
}

function Checkbox({ checked, onChange, children }) {
  return (
    <div className="check" data-on={checked ? '1' : '0'}
         onClick={() => onChange(!checked)} role="checkbox" aria-checked={checked}>
      <span className="box" />
      <span>{children}</span>
    </div>
  );
}

Object.assign(window, { Arrow, Tabs, Brand, Field, TextInput, NumberInput, Checkbox });
