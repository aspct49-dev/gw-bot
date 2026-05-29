// app.jsx — root: flow, theme vars, loading, tweaks.

const { useState: useS, useRef: useR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "direction": "cobalt",
  "accent": "#2454d6",
  "radius": 13,
  "ambient": true,
  "glass": true
}/*EDITMODE-END*/;

function looksValid(url) {
  const u = (url || '').trim();
  return u.length > 3;
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [screen, setScreen] = useS('twitter');   // twitter | twitterResults | youtube | youtubeResults
  const [loading, setLoading] = useS(false);
  const [error, setError] = useS('');
  const [twData, setTwData] = useS(null);
  const [ytData, setYtData] = useS(null);
  const abortRef = useR(null);

  const tab = screen.startsWith('youtube') ? 'youtube' : 'twitter';

  const goTab = (key) => {
    if (abortRef.current) abortRef.current.abort();
    setLoading(false);
    setError('');
    setScreen(key);
  };

  // ── Twitter pick ──
  const pickTwitter = async (form) => {
    if (!looksValid(form.url)) { setError('Enter a valid post URL to continue.'); return; }
    setError('');
    setLoading({ label: 'Fetching reposts…' });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.url, num: form.num, retweet: form.retweet, follow: form.follow }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setTwData({
        url: form.url, winners: data.winners, remaining: data.remaining || [],
        retweeters: data.retweeters, eligible: data.eligible,
        retweet: form.retweet, follow: form.follow, author: data.author,
      });
      setScreen('twitterResults');
    } catch (e) {
      if (e.name === 'AbortError') return;
      setError('Failed to connect to server.');
    } finally {
      setLoading(false);
    }
  };

  // ── Twitter reroll ──
  const rerollTwitter = async (ids) => {
    if (!twData || !ids.length) return;
    setLoading({ label: 'Rerolling…' });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/twitter/reroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winners: twData.winners, remaining: twData.remaining, reroll_ids: ids }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setTwData({ ...twData, winners: data.winners, remaining: data.remaining });
    } catch (e) {
      if (e.name === 'AbortError') return;
      setError('Failed to reroll. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── YouTube pick ──
  const pickYoutube = async (form) => {
    if (!looksValid(form.url)) { setError('Enter a valid YouTube video URL to continue.'); return; }
    setError('');
    setLoading({ label: 'Scanning comments…' });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/youtube/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.url, num: form.num, keyword: form.keyword, max_comments: form.maxC }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setYtData({ url: form.url, winners: data.winners, remaining: data.remaining || [], commenters: data.commenters, keyword: form.keyword });
      setScreen('youtubeResults');
    } catch (e) {
      if (e.name === 'AbortError') return;
      setError('Failed to connect to server.');
    } finally {
      setLoading(false);
    }
  };

  // ── YouTube reroll ──
  const rerollYoutube = async (ids) => {
    if (!ytData || !ids.length) return;
    setLoading({ label: 'Rerolling…' });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/youtube/reroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winners: ytData.winners, remaining: ytData.remaining, reroll_ids: ids }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setYtData({ ...ytData, winners: data.winners, remaining: data.remaining });
    } catch (e) {
      if (e.name === 'AbortError') return;
      setError('Failed to reroll. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Theme vars ──
  const vars = buildVars(t.direction, t.accent, t.radius);
  const themeAmbient = (THEMES[t.direction] || {}).vars['--ambient'];
  vars['--ambient'] = t.ambient ? themeAmbient : '0';

  const wide = screen.endsWith('Results');

  let body;
  if (loading) {
    body = (
      <div className="screen loading">
        <div className="spinner" />
        <div className="lbl">{loading.label}</div>
      </div>
    );
  } else if (screen === 'twitter') {
    body = <TwitterForm error={error} onSubmit={pickTwitter} />;
  } else if (screen === 'twitterResults') {
    body = <TwitterResults data={twData} onBack={() => goTab('twitter')} onReroll={rerollTwitter} />;
  } else if (screen === 'youtube') {
    body = <YoutubeForm error={error} onSubmit={pickYoutube} />;
  } else if (screen === 'youtubeResults') {
    body = <YoutubeResults data={ytData} onBack={() => goTab('youtube')} onReroll={rerollYoutube} />;
  }

  return (
    <div className="stage" style={vars} data-glass={t.glass ? '1' : '0'}>
      <div className={'card' + (wide ? ' wide' : '')}>
        <Brand />
        <Tabs active={tab} onSelect={goTab} />
        {body}
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Direction" />
        <TweakRadio value={t.direction}
          options={[{ value: 'airy', label: 'Airy' },
                    { value: 'cobalt', label: 'Cobalt' },
                    { value: 'crisp', label: 'Crisp' }]}
          onChange={(v) => setTweak('direction', v)} />

        <TweakSection label="Accent" />
        <TweakColor label="Blue" value={t.accent}
          options={[ACCENTS.classic, ACCENTS.cobalt, ACCENTS.sky]}
          onChange={(v) => setTweak('accent', v)} />

        <TweakSection label="Shape" />
        <TweakSlider label="Corner radius" value={t.radius} min={6} max={22} unit="px"
          onChange={(v) => setTweak('radius', v)} />

        <TweakSection label="Motion" />
        <TweakToggle label="Ambient glow" value={t.ambient}
          onChange={(v) => setTweak('ambient', v)} />
        <TweakToggle label="Liquid glass" value={t.glass}
          onChange={(v) => setTweak('glass', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
