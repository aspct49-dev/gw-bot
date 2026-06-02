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

function KickNavIcon() {
  return <img src="icon-kick.webp" alt="Kick" style={{width:17,height:17,objectFit:'contain',flexShrink:0}} />;
}

function WheelNavIcon() {
  // Mini pie-wheel: 6 coloured segments + white hub
  const cx = 8, cy = 8, r = 6.5;
  const colors = ['#2454d6','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2'];
  const n = colors.length;
  const segs = colors.map((color, i) => {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    return <path key={i} d={`M${cx},${cy} L${x0},${y0} A${r},${r} 0 0,1 ${x1},${y1} Z`} fill={color} />;
  });
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{flexShrink:0}}>
      {segs}
      <circle cx={cx} cy={cy} r="2.6" fill="white" />
    </svg>
  );
}

function Nav({ active, onSelect }) {
  return (
    <header className="nav">
      <div className="nav-inner">
        <div className="nav-brand">
          <img className="nav-logo" src="drawr-logo.png" alt="drawr" />
        </div>
        <nav className="nav-links">
          <button className="nav-link" data-active={active === 'twitter' ? '1' : '0'}
                  onClick={() => onSelect('twitter')}>
            <img className="nav-link-ico" src="icon-x.png" alt="" />
            X Picker
          </button>
          <button className="nav-link" data-active={active === 'youtube' ? '1' : '0'}
                  onClick={() => onSelect('youtube')}>
            <img className="nav-link-ico" src="icon-youtube.png" alt="" />
            YouTube Picker
          </button>
          <button className="nav-link" data-active={active === 'kick' ? '1' : '0'}
                  onClick={() => onSelect('kick')}>
            <KickNavIcon />
            Kick Giveaway
          </button>
          <button className="nav-link" data-active={active === 'wheel' ? '1' : '0'}
                  onClick={() => onSelect('wheel')}>
            <WheelNavIcon />
            Wheel
          </button>
        </nav>
        <div className="nav-right" />
      </div>
    </header>
  );
}

function Footer({ onSelect }) {
  const go = (tab) => (e) => { e.preventDefault(); onSelect && onSelect(tab); window.scrollTo(0, 0); };
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <img className="footer-logo" src="drawr-logo.png" alt="drawr" />
          <p className="footer-tagline">
            A fair, transparent way to pick giveaway winners from X posts, YouTube videos, Kick chat, and custom wheels.
          </p>
        </div>
        <div className="footer-col">
          <div className="footer-col-head">Tools</div>
          <a className="footer-link" href="/" onClick={go('twitter')}>X Picker</a>
          <a className="footer-link" href="/" onClick={go('youtube')}>YouTube Picker</a>
          <a className="footer-link" href="/" onClick={go('kick')}>Kick Giveaway</a>
          <a className="footer-link" href="/" onClick={go('wheel')}>Wheel</a>
        </div>
        <div className="footer-col">
          <div className="footer-col-head">Company</div>
          <a className="footer-link" href="/about">About</a>
          <a className="footer-link" href="/features">Features</a>
        </div>
        <div className="footer-col">
          <div className="footer-col-head">Legal</div>
          <a className="footer-link" href="/privacy">Privacy Policy</a>
          <a className="footer-link" href="/terms">Terms of Service</a>
        </div>
      </div>
      <div className="footer-copy">© 2026 drawr. All rights reserved.</div>
    </footer>
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

Object.assign(window, { Arrow, Nav, Footer, Field, TextInput, NumberInput, Checkbox, WheelNavIcon });
