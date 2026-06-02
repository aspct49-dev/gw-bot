// app.jsx — root: flow, theme vars, loading, tweaks.

const { useState: useS, useRef: useR } = React;

function WheelHeroIcon() {
  const colors = ['#2454d6','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2'];
  const n = colors.length, cx = 27, cy = 27, r = 24;
  return (
    <svg className="hero-icon" style={{borderRadius:'50%'}} width="54" height="54" viewBox="0 0 54 54">
      {colors.map((color, i) => {
        const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
        const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
        const x0 = (cx + r * Math.cos(a0)).toFixed(2), y0 = (cy + r * Math.sin(a0)).toFixed(2);
        const x1 = (cx + r * Math.cos(a1)).toFixed(2), y1 = (cy + r * Math.sin(a1)).toFixed(2);
        return <path key={i} d={`M${cx},${cy} L${x0},${y0} A${r},${r} 0 0,1 ${x1},${y1} Z`} fill={color} />;
      })}
      <circle cx={cx} cy={cy} r="8" fill="white" />
    </svg>
  );
}


function looksValid(url) {
  const u = (url || '').trim();
  return u.length > 3;
}

function App() {
  const [screen, setScreen] = useS('twitter');   // twitter | twitterResults | youtube | youtubeResults
  const [loading, setLoading] = useS(false);
  const [error, setError] = useS('');
  const [twData, setTwData] = useS(null);
  const [ytData, setYtData] = useS(null);
  const abortRef = useR(null);

  const tab = screen.startsWith('youtube') ? 'youtube' : screen.startsWith('kick') ? 'kick' : screen.startsWith('wheel') ? 'wheel' : 'twitter';

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
        body: JSON.stringify({
          url: form.url, num: form.num,
          retweet: form.retweet, follow: form.follow,
          min_followers: form.minFollowers || 0,
          min_account_age_days: form.minAccountAge || 0,
          require_profile_pic: form.requireProfilePic || false,
        }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setTwData({
        url: form.url, winners: data.winners, remaining: data.remaining || [],
        retweeters: data.retweeters, eligible: data.eligible,
        retweet: form.retweet, follow: form.follow, author: data.author,
        minFollowers: form.minFollowers || 0, minAccountAge: form.minAccountAge || 0,
        requireProfilePic: form.requireProfilePic || false,
        seed: data.seed, seedHash: data.seed_hash,
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
      setTwData({ ...twData, winners: data.winners, remaining: data.remaining, seed: data.seed, seedHash: data.seed_hash });
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
      setYtData({ url: form.url, winners: data.winners, remaining: data.remaining || [], commenters: data.commenters, keyword: form.keyword, seed: data.seed, seedHash: data.seed_hash });
      setScreen('youtubeResults');
    } catch (e) {
      if (e.name === 'AbortError') return;
      setError('Failed to connect to server.');
    } finally {
      setLoading(false);
    }
  };

  // ── Share draw ──
  const _saveAndShare = async (payload, setter, existing) => {
    try {
      const res = await fetch('/api/save-draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.draw_id) {
        const shareUrl = `${window.location.origin}/draw/${data.draw_id}`;
        setter({ ...existing, shareUrl });
        try { await navigator.clipboard.writeText(shareUrl); } catch {}
      } else {
        setError(data.error || 'Failed to save draw.');
      }
    } catch {
      setError('Failed to save draw.');
    }
  };

  const shareDraw = () => _saveAndShare({
    type: 'twitter',
    tweet_url: twData.url, author: twData.author,
    winners: twData.winners, eligible: twData.eligible,
    retweeters: twData.retweeters,
    retweet: twData.retweet, follow: twData.follow,
    min_followers: twData.minFollowers || 0,
    min_account_age_days: twData.minAccountAge || 0,
    require_profile_pic: twData.requireProfilePic || false,
    seed: twData.seed, seed_hash: twData.seedHash,
  }, setTwData, twData);

  const shareDrawYt = () => _saveAndShare({
    type: 'youtube',
    video_url: ytData.url, winners: ytData.winners,
    commenters: ytData.commenters, keyword: ytData.keyword,
    seed: ytData.seed, seed_hash: ytData.seedHash,
  }, setYtData, ytData);

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
      setYtData({ ...ytData, winners: data.winners, remaining: data.remaining, seed: data.seed, seedHash: data.seed_hash });
    } catch (e) {
      if (e.name === 'AbortError') return;
      setError('Failed to reroll. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isResults = screen.endsWith('Results');
  const showHero = !loading && !isResults;

  const heroIconSrc = { twitter: 'icon-x.png', youtube: 'icon-youtube.png', kick: 'icon-kick.webp' }[tab] || null;
  const heroSub = {
    twitter: 'Draw verifiable giveaway winners from X posts. Fair, fast, and transparent.',
    youtube: 'Draw winners from YouTube video comment sections.',
    kick: 'Connect to a Kick channel, collect live chat entries, and spin a winner.',
    wheel: 'Add any names, spin the wheel, and pick a winner instantly.',
  }[tab] || '';

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
    body = <TwitterResults data={twData} onBack={() => goTab('twitter')} onReroll={rerollTwitter} onShare={shareDraw} />;
  } else if (screen === 'youtube') {
    body = <YoutubeForm error={error} onSubmit={pickYoutube} />;
  } else if (screen === 'youtubeResults') {
    body = <YoutubeResults data={ytData} onBack={() => goTab('youtube')} onReroll={rerollYoutube} onShare={shareDrawYt} />;
  } else if (screen === 'kick') {
    body = <KickGiveaway />;
  } else if (screen === 'wheel') {
    body = <WheelGiveaway />;
  }

  return (
    <div className="page">
      <Nav active={tab} onSelect={goTab} />
      <main className="main">
        {showHero && (
          <div className="hero">
            {tab === 'wheel' ? <WheelHeroIcon /> : <img className="hero-icon" src={heroIconSrc} alt="" />}
            <h1 className="hero-title">PICK A WINNER</h1>
            <p className="hero-sub">{heroSub}</p>
          </div>
        )}
        <div className={'content-area' + (isResults ? ' wide' : '') + (tab === 'kick' ? ' kick' : '') + (tab === 'wheel' ? ' wheel' : '')}>
          {body}
        </div>
      </main>
      <Footer onSelect={goTab} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
