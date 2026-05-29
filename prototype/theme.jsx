// theme.jsx — direction definitions + CSS-variable builder.
// Three blue/white directions. Accent + radius are independent tweaks layered
// on top, so changing accent recolors every direction consistently.

const THEMES = {
  airy: {
    label: 'Airy Light',
    vars: {
      '--app-bg': 'linear-gradient(176deg,#e9f1ff 0%,#f4f8ff 52%,#ffffff 100%)',
      '--ambient': '1',
      '--card-bg': '#ffffff',
      '--card-border': '1px solid #e7eefb',
      '--card-shadow': '0 1px 2px rgba(20,45,85,.05), 0 26px 60px -30px rgba(20,45,85,.24)',
      '--text': '#15233c',
      '--muted': '#5d6c87',
      '--subtle': '#94a1b9',
      '--field-bg': '#fafcff',
      '--field-border': '#e4ebf7',
      '--field-border-hover': '#ccd9ee',
      '--divider': '#eef2fa',
      '--track': '#eef3fb',
    },
  },
  cobalt: {
    label: 'Calm Cobalt',
    vars: {
      '--app-bg': 'radial-gradient(135% 120% at 50% -12%, #1c4080 0%, #122f5e 48%, #0b2143 100%)',
      '--ambient': '1',
      '--card-bg': '#ffffff',
      '--card-border': '1px solid rgba(255,255,255,.55)',
      '--card-shadow': '0 32px 90px -34px rgba(3,14,34,.7)',
      '--text': '#13233e',
      '--muted': '#586786',
      '--subtle': '#8a98b4',
      '--field-bg': '#f9fbff',
      '--field-border': '#e3eaf6',
      '--field-border-hover': '#cad7ee',
      '--divider': '#eef2f9',
      '--track': '#eef3fb',
      // frosted card when liquid glass is enabled on this vivid backdrop
      '--glass-card-bg': 'rgba(255,255,255,.8)',
      '--glass-card-filter': 'blur(22px) saturate(180%)',
      '--glass-card-border': '1px solid rgba(255,255,255,.6)',
    },
  },
  crisp: {
    label: 'Crisp Minimal',
    vars: {
      '--app-bg': '#fbfcfe',
      '--ambient': '0',
      '--card-bg': '#ffffff',
      '--card-border': '1px solid #ebeff6',
      '--card-shadow': '0 1px 2px rgba(20,40,80,.04)',
      '--text': '#1a2436',
      '--muted': '#69748a',
      '--subtle': '#a0aabd',
      '--field-bg': '#ffffff',
      '--field-border': '#e8ecf4',
      '--field-border-hover': '#d4dbe8',
      '--divider': '#eef1f7',
      '--track': '#f1f4f9',
    },
  },
};

const ACCENTS = {
  classic: '#2f6df0',
  cobalt: '#2454d6',
  sky: '#1f8fe6',
};

// Build the inline style object of CSS variables for the stage root.
function buildVars(direction, accent, radius) {
  const theme = THEMES[direction] || THEMES.airy;
  const a = accent || ACCENTS.classic;
  return {
    ...theme.vars,
    '--accent': a,
    '--accent-strong': `color-mix(in srgb, ${a} 82%, #07193c)`,
    '--accent-soft': `color-mix(in srgb, ${a} 9%, #ffffff)`,
    '--accent-ring': `color-mix(in srgb, ${a} 24%, transparent)`,
    '--on-accent': '#ffffff',
    '--radius': `${radius}px`,
  };
}

window.THEMES = THEMES;
window.ACCENTS = ACCENTS;
window.buildVars = buildVars;
