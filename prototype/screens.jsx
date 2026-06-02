// screens.jsx — the four app screens. Presentational; App owns flow + data.

const { useState: useStateS } = React;

/* ─────────────── Twitter form ─────────────── */
function TwitterForm({ error, onSubmit }) {
  const [url, setUrl] = useStateS('');
  const [num, setNum] = useStateS(1);
  const [retweet, setRetweet] = useStateS(true);
  const [follow, setFollow] = useStateS(false);
  const [requireProfilePic, setRequireProfilePic] = useStateS(false);
  const [minFollowers, setMinFollowers] = useStateS(0);
  const [minAccountAge, setMinAccountAge] = useStateS(0);
  const [showFilters, setShowFilters] = useStateS(false);
  const noneSelected = !retweet && !follow;

  return (
    <div className="screen">
      {error && <div className="alert error">{error}</div>}
      <div className="form-card">
      <Field label="Post URL">
        <TextInput value={url} onChange={(e) => setUrl(e.target.value)}
                   placeholder="https://x.com/user/status/123456789" />
      </Field>

      <Field label="Number of winners">
        <NumberInput value={num} min={1} max={50}
                     onChange={(e) => setNum(e.target.value)} />
      </Field>

      <div className="checks">
        <div className="group-label">Entry requirements</div>
        <Checkbox checked={retweet} onChange={setRetweet}>Must have reposted the post</Checkbox>
        <Checkbox checked={follow} onChange={setFollow}>Must follow the post author</Checkbox>
        <p className="help">Follow checks run slower due to Twitter rate limits.</p>
      </div>

      <div className="filter-toggle" data-open={showFilters ? '1' : '0'}
           onClick={() => setShowFilters(v => !v)}>
        <span>Account filters <span style={{ fontSize: '11px', fontWeight: 400, opacity: .7 }}>(optional)</span></span>
        <svg className="filter-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 5l4 4 4-4" />
        </svg>
      </div>

      {showFilters && (
        <div className="filter-body">
          <div className="checks" style={{ marginTop: 10 }}>
            <Checkbox checked={requireProfilePic} onChange={setRequireProfilePic}>Must have a profile picture</Checkbox>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Min. followers" hint="0 = any">
              <NumberInput value={minFollowers} min={0}
                           onChange={(e) => setMinFollowers(Number(e.target.value) || 0)} />
            </Field>
            <Field label="Min. account age (days)" hint="0 = any">
              <NumberInput value={minAccountAge} min={0}
                           onChange={(e) => setMinAccountAge(Number(e.target.value) || 0)} />
            </Field>
          </div>
        </div>
      )}

      <button className="btn btn-primary" style={{ marginTop: 22 }}
              disabled={noneSelected}
              onClick={() => onSubmit({
                url, num: Number(num) || 1,
                retweet, follow,
                requireProfilePic,
                minFollowers: Number(minFollowers) || 0,
                minAccountAge: Number(minAccountAge) || 0,
              })}>
        Pick winners <Arrow />
      </button>
      </div>
    </div>
  );
}

/* ─────────────── Twitter results ─────────────── */
function SharePanel({ shareUrl }) {
  if (!shareUrl) return null;
  return (
    <div className="share-panel">
      <div className="share-panel-label">Results link — tap to copy</div>
      <input className="share-url-input" readOnly value={shareUrl}
             onClick={e => { e.target.select(); try { navigator.clipboard.writeText(shareUrl); } catch {} }} />
      <a className="btn btn-primary" href={shareUrl} target="_blank" rel="noreferrer"
         style={{ marginTop: 8, textDecoration: 'none' }}>
        Open results page ↗
      </a>
    </div>
  );
}

function TwitterResults({ data, onBack, onReroll, onShare }) {
  const { url, winners, retweeters, eligible, retweet, follow, author, seed, seedHash, shareUrl,
          minFollowers, minAccountAge, requireProfilePic } = data;
  const [marked, setMarked] = useStateS({});
  const anyMarked = Object.values(marked).some(Boolean);
  const canReroll = data.remaining && data.remaining.length > 0;

  const toggle = (id) => setMarked((m) => ({ ...m, [id]: !m[id] }));
  const doReroll = () => {
    const ids = winners.filter((w) => marked[w.id]).map((w) => w.id);
    onReroll(ids);
    setMarked({});
  };

  return (
    <div className="screen">
      <button className="back-link" onClick={onBack}><Arrow dir="left" /> New draw</button>
      <div className="head">
        <div className="eyebrow">Results</div>
        <h1 className="title">{winners.length} winner{winners.length !== 1 ? 's' : ''} drawn</h1>
        <p className="subtitle">From <a href={url} target="_blank" rel="noreferrer">{url}</a></p>
      </div>

      <div className="stats">
        {retweet && (
          <div className="stat"><div className="k">Reposters</div><div className="v">{retweeters.toLocaleString()}</div></div>
        )}
        <div className="stat"><div className="k">Eligible</div><div className="v">{eligible.toLocaleString()}</div></div>
      </div>

      <div className="criteria">
        {retweet && <span className="pill"><span className="tick" />Reposted</span>}
        {follow && <span className="pill"><span className="tick" />Follows @{author}</span>}
        {requireProfilePic && <span className="pill"><span className="tick" />Has profile pic</span>}
        {minFollowers > 0 && <span className="pill"><span className="tick" />{minFollowers.toLocaleString()}+ followers</span>}
        {minAccountAge > 0 && <span className="pill"><span className="tick" />Account {minAccountAge}+ days old</span>}
        {!retweet && !follow && <span className="pill"><span className="tick" />All participants</span>}
      </div>

      {winners.length ? (
        <>
          <div className="section-label"><h2>Winners</h2></div>
          {canReroll && <p className="reroll-hint">Check any winner you want to swap out, then reroll just those slots.</p>}
          <ul className="winners">
            {winners.map((w, i) => (
              <li className="winner" key={w.id} data-marked={canReroll && marked[w.id] ? '1' : '0'}>
                <span className="wnum">{i + 1}</span>
                {w.avatar && <img className="winner-avatar" src={w.avatar} alt={w.name} />}
                <div className="winner-body">
                  <div className="winner-name">{w.name}</div>
                  {w.username && w.username.trim() && (
                    <div className="winner-handle">
                      <a href={`https://twitter.com/${w.username.trim()}`} target="_blank" rel="noreferrer">@{w.username.trim()}</a>
                    </div>
                  )}
                  {w.bio && <div className="winner-bio">"{w.bio}"</div>}
                  {w.location && <div className="winner-location">📍 {w.location}</div>}
                </div>
                {canReroll && (
                  <span className="rr" data-on={marked[w.id] ? '1' : '0'}
                        onClick={() => toggle(w.id)} role="checkbox"
                        aria-checked={!!marked[w.id]} title="Reroll this winner" />
                )}
              </li>
            ))}
          </ul>
          <div className="btn-row">
            <button className="btn btn-outline" onClick={onBack}>New draw</button>
            {canReroll
              ? <button className="btn btn-primary" disabled={!anyMarked} onClick={doReroll}>Reroll selected</button>
              : null
            }
          </div>
          {shareUrl
            ? <SharePanel shareUrl={shareUrl} />
            : <button className="btn btn-outline" style={{ marginTop: 10 }} onClick={onShare}>Share draw ↗</button>
          }
          <FairProof seed={seed} seedHash={seedHash} />
        </>
      ) : (
        <>
          <div className="empty">
            <div className="emoji">[ no eligible entries ]</div>
            <p>Try relaxing the requirements or wait for more engagement.</p>
          </div>
          <button className="btn btn-primary" onClick={onBack}>Run another draw <Arrow /></button>
        </>
      )}
    </div>
  );
}

/* ─────────────── YouTube form ─────────────── */
function YoutubeForm({ error, onSubmit }) {
  const [url, setUrl] = useStateS('');
  const [num, setNum] = useStateS(1);
  const [keyword, setKeyword] = useStateS('');
  const [maxC, setMaxC] = useStateS(500);

  return (
    <div className="screen">
      {error && <div className="alert error">{error}</div>}
      <div className="form-card">
      <Field label="YouTube video URL">
        <TextInput value={url} onChange={(e) => setUrl(e.target.value)}
                   placeholder="https://www.youtube.com/watch?v=..." />
      </Field>

      <Field label="Number of winners">
        <NumberInput value={num} min={1} max={50}
                     onChange={(e) => setNum(e.target.value)} />
      </Field>

      <Field label="Keyword filter" hint="Optional — only draw from comments containing this word.">
        <TextInput value={keyword} onChange={(e) => setKeyword(e.target.value)}
                   placeholder="e.g. subscribe, enter, giveaway" />
      </Field>

      <Field label="Max comments to scan" hint="Higher values cover more comments but take longer.">
        <NumberInput value={maxC} min={10} max={10000}
                     onChange={(e) => setMaxC(e.target.value)} />
      </Field>

      <button className="btn btn-primary" style={{ marginTop: 4 }}
              onClick={() => onSubmit({ url, num: Number(num) || 1, keyword: keyword.trim(), maxC })}>
        Pick winners <Arrow />
      </button>
      </div>
    </div>
  );
}

/* ─────────────── YouTube results ─────────────── */
function YoutubeResults({ data, onBack, onReroll, onShare }) {
  const { url, winners, commenters, keyword, seed, seedHash, shareUrl } = data;
  const [marked, setMarked] = useStateS({});
  const anyMarked = Object.values(marked).some(Boolean);
  const canReroll = data.remaining && data.remaining.length > 0;

  const toggle = (id) => setMarked((m) => ({ ...m, [id]: !m[id] }));

  const doReroll = () => {
    const ids = winners.filter((w) => marked[w.id]).map((w) => w.id);
    onReroll(ids);
    setMarked({});
  };

  return (
    <div className="screen">
      <button className="back-link" onClick={onBack}><Arrow dir="left" /> New draw</button>
      <div className="head">
        <div className="eyebrow">Results</div>
        <h1 className="title">{winners.length} winner{winners.length !== 1 ? 's' : ''} drawn</h1>
        <p className="subtitle">From <a href={url} target="_blank" rel="noreferrer">{url}</a></p>
      </div>

      <div className="stats">
        <div className="stat"><div className="k">Unique commenters</div><div className="v">{commenters.toLocaleString()}</div></div>
        {keyword && <div className="stat"><div className="k">Keyword</div><div className="v small">&ldquo;{keyword}&rdquo;</div></div>}
      </div>

      {winners.length ? (
        <>
          <div className="section-label"><h2>Winners</h2></div>
          {canReroll && <p className="reroll-hint">Check any winner you want to swap out, then reroll just those slots.</p>}
          <ul className="winners">
            {winners.map((w, i) => (
              <li className="winner" key={w.id} data-marked={marked[w.id] ? '1' : '0'}>
                <span className="wnum">{i + 1}</span>
                <div className="winner-body">
                  <div className="winner-name">{w.author}</div>
                  <div className="winner-comment">&ldquo;{w.text}&rdquo;</div>
                  <div className="winner-meta">{w.time}<span className="sep">·</span>{w.votes} likes</div>
                </div>
                {canReroll && (
                  <span className="rr" data-on={marked[w.id] ? '1' : '0'}
                        onClick={() => toggle(w.id)} role="checkbox"
                        aria-checked={!!marked[w.id]} title="Reroll this winner" />
                )}
              </li>
            ))}
          </ul>
          <div className="btn-row">
            <button className="btn btn-outline" onClick={onBack}>New draw</button>
            {canReroll
              ? <button className="btn btn-primary" disabled={!anyMarked} onClick={doReroll}>Reroll selected</button>
              : null
            }
          </div>
          {shareUrl
            ? <SharePanel shareUrl={shareUrl} />
            : <button className="btn btn-outline" style={{ marginTop: 10 }} onClick={onShare}>Share draw ↗</button>
          }
          <FairProof seed={seed} seedHash={seedHash} />
        </>
      ) : (
        <>
          <div className="empty">
            <div className="emoji">[ no matching comments ]</div>
            <p>Try a different keyword or another video.</p>
          </div>
          <button className="btn btn-primary" onClick={onBack}>Try again <Arrow /></button>
        </>
      )}
    </div>
  );
}

/* ─────────────── Provably Fair proof ─────────────── */
function FairProof({ seed, seedHash }) {
  if (!seed) return null;
  return (
    <div className="fair">
      <div className="fair-head">Provably Fair</div>
      <div className="fair-row">
        <span className="fair-key">Seed</span>
        <code className="fair-val" title="Click to select">{seed}</code>
      </div>
      <div className="fair-row">
        <span className="fair-key">SHA-256</span>
        <code className="fair-val" title="Click to select">{seedHash}</code>
      </div>
      <p className="fair-hint">
        Verify: compute <strong>SHA-256(seed)</strong> and confirm it matches the hash above using any{' '}
        <a href="https://emn178.github.io/online-tools/sha256.html" target="_blank" rel="noreferrer">online tool</a>.
      </p>
    </div>
  );
}

/* ─────────────── Kick Giveaway ─────────────── */
const PUSHER_KEY = '32cbd69e4b950bf97679';
const SPIN_ITEM_W = 128;
const SPIN_VISIBLE = 5;
const SPIN_CENTER = 2;

function KickAvatar({ username, avatarUrl, size }) {
  const [errored, setErrored] = React.useState(false);
  const initial = (username || '?').charAt(0).toUpperCase();
  const s = size || 38;
  if (avatarUrl && !errored) {
    return (
      <img src={avatarUrl} alt={username}
           className="kick-avatar-img"
           style={{ width: s, height: s }}
           onError={() => setErrored(true)} />
    );
  }
  return (
    <div className="kick-avatar-fallback" style={{ width: s, height: s }}>
      {initial}
    </div>
  );
}

function KickGiveaway() {
  const [phase, setPhase] = useStateS('setup'); // setup | live
  const [channel, setChannel] = useStateS('');
  const [chatroomId, setChatroomId] = useStateS(null);
  const [keyword, setKeyword] = useStateS('!enter');
  const [wsStatus, setWsStatus] = useStateS('disconnected');
  const [isListening, setIsListening] = useStateS(false);
  const [entries, setEntries] = useStateS([]);
  const [winner, setWinner] = useStateS(null);
  const [winnerMessages, setWinnerMessages] = useStateS([]);
  const [isSpinning, setIsSpinning] = useStateS(false);
  const [spinStrip, setSpinStrip] = useStateS([]);
  const [stripX, setStripX] = useStateS(0);
  const [isAnimating, setIsAnimating] = useStateS(false);
  const [spinKey, setSpinKey] = useStateS(0);
  const [avatars, setAvatars] = useStateS({});
  const [setupError, setSetupError] = useStateS('');

  const wsRef = React.useRef(null);
  const isListeningRef = React.useRef(false);
  const keywordRef = React.useRef('!enter');
  const winnerRef = React.useRef(null);
  const spinWinnerRef = React.useRef('');
  const spinTargetRef = React.useRef(0);
  const fetchingRef = React.useRef(new Set());

  React.useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  React.useEffect(() => { keywordRef.current = keyword; }, [keyword]);
  React.useEffect(() => { winnerRef.current = winner; }, [winner]);

  // Fetch avatars from Kick for new entries
  React.useEffect(() => {
    entries.forEach(async (entry) => {
      const key = entry.username.toLowerCase();
      if (fetchingRef.current.has(key) || avatars[key]) return;
      fetchingRef.current.add(key);
      try {
        const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(entry.username)}`,
          { headers: { Accept: 'application/json' } });
        const data = await res.json();
        const url = data?.user?.profile_pic ?? data?.user?.profile_picture ?? null;
        if (url) setAvatars(prev => ({ ...prev, [key]: url }));
      } catch {}
    });
  }, [entries]);

  // Start spin animation after strip renders at x=0
  React.useEffect(() => {
    if (spinStrip.length === 0) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      setIsAnimating(true);
      setStripX(spinTargetRef.current);
    }));
    return () => cancelAnimationFrame(id);
  }, [spinKey]);

  const connectWs = (roomId) => {
    const ws = new WebSocket(
      `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=7.4.0&flash=false`
    );
    wsRef.current = ws;
    ws.onopen = () => {
      setWsStatus('connected');
      ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel: `chatrooms.${roomId}.v2` } }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event !== 'App\\Events\\ChatMessageEvent') return;
        const data = JSON.parse(msg.data);
        const username = data?.sender?.username ?? data?.sender?.slug ?? '';
        const text = data?.content ?? '';
        if (!username || !text) return;
        const chatMsg = { username, message: text, timestamp: Date.now() };
        if (winnerRef.current && username.toLowerCase() === winnerRef.current.toLowerCase()) {
          setWinnerMessages(p => [chatMsg, ...p].slice(0, 30));
        }
        if (isListeningRef.current && text.trim().toLowerCase() === keywordRef.current.trim().toLowerCase()) {
          setEntries(prev => {
            if (prev.some(en => en.username.toLowerCase() === username.toLowerCase())) return prev;
            return [...prev, { username, enteredAt: Date.now() }];
          });
        }
      } catch {}
    };
    ws.onerror = () => setWsStatus('error');
    ws.onclose = () => { setWsStatus('disconnected'); wsRef.current = null; setIsListening(false); };
  };

  const handleConnect = async () => {
    if (!channel.trim()) { setSetupError('Enter a Kick channel name.'); return; }
    setSetupError('');
    setWsStatus('connecting');
    try {
      const res = await fetch(`/api/kick/chatroom?channel=${encodeURIComponent(channel.trim().toLowerCase())}`);
      const data = await res.json();
      if (data.error) { setSetupError(data.error); setWsStatus('disconnected'); return; }
      setChatroomId(data.chatroomId);
      connectWs(data.chatroomId);
      setPhase('live');
    } catch {
      setSetupError('Could not reach the server. Try again.');
      setWsStatus('disconnected');
    }
  };

  const disconnect = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setWsStatus('disconnected');
    setIsListening(false);
  };

  const spin = () => {
    if (entries.length === 0 || isSpinning) return;
    setIsSpinning(true);
    setWinner(null);
    setWinnerMessages([]);
    const names = entries.map(e => e.username);
    const rand = () => names[Math.floor(Math.random() * names.length)];
    const picked = rand();
    spinWinnerRef.current = picked;
    const strip = [
      ...Array.from({ length: SPIN_CENTER }, rand),
      ...Array.from({ length: 55 }, rand),
      picked,
      ...Array.from({ length: SPIN_CENTER }, rand),
    ];
    const winnerIdx = SPIN_CENTER + 55;
    spinTargetRef.current = -(winnerIdx - SPIN_CENTER) * SPIN_ITEM_W;
    setStripX(0);
    setIsAnimating(false);
    setSpinStrip(strip);
    setSpinKey(k => k + 1);
    setTimeout(() => {
      const p = spinWinnerRef.current;
      setWinner(p);
      setIsSpinning(false);
      setEntries(prev => prev.filter(e => e.username.toLowerCase() !== p.toLowerCase()));
    }, 4700);
  };

  const clearAll = () => {
    setEntries([]); setWinner(null); setWinnerMessages([]);
    setSpinStrip([]); setIsAnimating(false); setStripX(0);
    fetchingRef.current.clear(); setAvatars({});
  };

  React.useEffect(() => () => disconnect(), []);

  const containerW = SPIN_VISIBLE * SPIN_ITEM_W;

  const statusLabel = { disconnected: 'Disconnected', connecting: 'Connecting…', connected: 'Live', error: 'Error' };
  const statusClass = { disconnected: 'kick-status-off', connecting: 'kick-status-connecting', connected: 'kick-status-live', error: 'kick-status-error' };

  /* ── Setup phase ── */
  if (phase === 'setup') {
    return (
      <div className="screen">
        <div className="form-card">
          {setupError && <div className="alert error">{setupError}</div>}
          <Field label="Kick channel name">
            <TextInput value={channel} onChange={e => setChannel(e.target.value)}
                       placeholder="e.g. trainwreckstv"
                       onKeyDown={e => e.key === 'Enter' && handleConnect()} />
          </Field>
          <Field label="Entry keyword" hint="Viewers type this in chat to enter.">
            <TextInput value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="!enter" />
          </Field>
          <button className="btn btn-primary" style={{ marginTop: 8 }}
                  disabled={wsStatus === 'connecting'}
                  onClick={handleConnect}>
            {wsStatus === 'connecting' ? 'Connecting…' : 'Connect & Start →'}
          </button>
        </div>
      </div>
    );
  }

  /* ── Live phase ── */
  return (
    <div className="screen kick-live">

      {/* Top bar */}
      <div className="kick-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="icon-kick.webp" alt="Kick" style={{ width: 22, height: 22, objectFit: 'contain' }} />
          <span className="kick-channel-name">kick.com/<strong>{channel}</strong></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={`kick-status-dot ${statusClass[wsStatus]}`}>{statusLabel[wsStatus]}</span>
          <button className="kick-btn-ghost" onClick={() => { disconnect(); setPhase('setup'); clearAll(); setChatroomId(null); }}>
            ← Change channel
          </button>
        </div>
      </div>

      <div className="kick-grid">
        {/* Left col: controls + entries */}
        <div className="kick-left">
          <div className="kick-panel">
            <div className="kick-panel-title">Controls</div>
            <div style={{ marginBottom: 14 }}>
              <label className="kick-label">Entry keyword</label>
              <TextInput value={keyword} onChange={e => setKeyword(e.target.value)}
                         disabled={isListening} placeholder="!enter" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!isListening ? (
                <button className="kick-btn-primary" onClick={() => setIsListening(true)}
                        disabled={wsStatus !== 'connected'}>
                  ▶ Start collecting
                </button>
              ) : (
                <button className="kick-btn-danger" onClick={() => setIsListening(false)}>
                  ■ Stop collecting
                </button>
              )}
              <button className="kick-btn-spin"
                      disabled={entries.length === 0 || isSpinning}
                      onClick={spin}>
                ⟳ Spin ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})
              </button>
              <button className="kick-btn-ghost" onClick={clearAll}>Clear all</button>
            </div>
          </div>

          <div className="kick-panel" style={{ flex: 1 }}>
            <div className="kick-panel-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Entries</span>
              <span style={{ color: '#53fc18', fontWeight: 700 }}>{entries.length}</span>
            </div>
            <div className="kick-entries">
              {entries.length === 0 ? (
                <p className="kick-empty-text">
                  {isListening ? `Waiting for "${keyword}" in chat…` : 'Start collecting to see entries.'}
                </p>
              ) : (
                entries.map((e, i) => (
                  <div key={e.username} className="kick-entry">
                    <KickAvatar username={e.username} avatarUrl={avatars[e.username.toLowerCase()]} size={30} />
                    <span className="kick-entry-name">{e.username}</span>
                    <span className="kick-entry-num">#{i + 1}</span>
                    <button className="kick-entry-remove"
                            onClick={() => setEntries(prev => prev.filter(x => x.username !== e.username))}
                            title="Remove">✕</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right col: spinner + winner */}
        <div className="kick-right">
          <div className="kick-panel kick-spinner-panel">
            {spinStrip.length > 0 ? (
              <div className="kick-spinner-wrap" style={{ width: containerW }}>
                <div style={{ position: 'relative', width: containerW }}>
                  <div className="kick-pointer kick-pointer-top"
                       style={{ left: SPIN_CENTER * SPIN_ITEM_W + SPIN_ITEM_W / 2 }} />
                <div className="kick-strip-outer" style={{ width: containerW, height: 100 }}>
                  <div className="kick-spinner-fade-l" />
                  <div className="kick-spinner-fade-r" />
                  <div className="kick-spinner-center" style={{ left: SPIN_CENTER * SPIN_ITEM_W, width: SPIN_ITEM_W }} />
                  <div className="kick-strip-inner"
                       style={{
                         transform: `translateX(${stripX}px)`,
                         transition: isAnimating ? 'transform 4.5s cubic-bezier(0.12, 0.8, 0.15, 1.0)' : 'none',
                       }}>
                    {spinStrip.map((name, i) => (
                      <div key={i} className="kick-strip-item" style={{ width: SPIN_ITEM_W }}>
                        <KickAvatar username={name} avatarUrl={avatars[name.toLowerCase()]} size={38} />
                        <span className="kick-strip-name">{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                  <div className="kick-pointer kick-pointer-bottom"
                       style={{ left: SPIN_CENTER * SPIN_ITEM_W + SPIN_ITEM_W / 2 }} />
                </div>
                {isSpinning && <p className="kick-spinning-label">Spinning…</p>}
              </div>
            ) : (
              <div className="kick-spinner-placeholder">
                <div className="kick-spinner-placeholder-strip" style={{ width: containerW }}>
                  {Array.from({ length: SPIN_VISIBLE }).map((_, i) => (
                    <div key={i} className="kick-strip-item kick-strip-ghost" style={{ width: SPIN_ITEM_W }}>
                      <div className="kick-avatar-ghost" />
                      <div className="kick-name-ghost" />
                    </div>
                  ))}
                </div>
                <p className="kick-spinning-label" style={{ opacity: .4 }}>
                  {entries.length === 0 ? 'Collect entries then spin' : `${entries.length} entries ready — hit Spin`}
                </p>
              </div>
            )}
          </div>

          {winner && !isSpinning && (
            <div className="kick-winner-card">
              <KickAvatar username={winner} avatarUrl={avatars[winner.toLowerCase()]} size={52} />
              <div>
                <div className="kick-winner-label">🎉 Winner</div>
                <div className="kick-winner-name">{winner}</div>
              </div>
              <a className="kick-winner-link"
                 href={`https://kick.com/${winner}`} target="_blank" rel="noreferrer">
                View profile ↗
              </a>
            </div>
          )}

          {winner && (
            <div className="kick-panel">
              <div className="kick-panel-title">{winner}'s recent messages</div>
              <div className="kick-winner-msgs">
                {winnerMessages.length === 0 ? (
                  <p className="kick-empty-text">Waiting for {winner} to chat…</p>
                ) : (
                  winnerMessages.map((m, i) => (
                    <div key={i} className="kick-msg">
                      <span className="kick-msg-user">{m.username}:</span>
                      <span className="kick-msg-text">{m.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Wheel Giveaway ─────────────── */
function WheelGiveaway() {
  const COLORS = [
    '#2454d6','#7c3aed','#db2777','#ea580c',
    '#16a34a','#0891b2','#9333ea','#dc2626',
    '#ca8a04','#0d9488','#6366f1','#d97706',
  ];
  const W = 320, R = 142, CX = 160, CY = 160;

  const [entries, setEntries] = React.useState([]);
  const [inputVal, setInputVal] = React.useState('');
  const [removeOnWin, setRemoveOnWin] = React.useState(true);
  const [spinning, setSpinning] = React.useState(false);
  const [winner, setWinner] = React.useState(null);

  const canvasRef = React.useRef(null);
  const animRef = React.useRef(null);
  const stateRef = React.useRef({ angle: 0, entries: [] });

  // Keep stateRef in sync after every render
  React.useEffect(() => { stateRef.current.entries = entries; });

  const redraw = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { angle, entries: ents } = stateRef.current;
    const n = ents.length;
    ctx.clearRect(0, 0, W, W);

    if (n === 0) {
      ctx.fillStyle = '#f0f4fb';
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#8a9ab8';
      ctx.font = '500 13px Epilogue, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Add participants to start', CX, CY);
    } else if (n === 1) {
      ctx.fillStyle = COLORS[0];
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = 'white';
      ctx.font = 'bold 15px Epilogue, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lbl = ents[0].length > 16 ? ents[0].slice(0, 15) + '…' : ents[0];
      ctx.fillText(lbl, CX, CY);
    } else {
      const seg = (2 * Math.PI) / n;
      for (let i = 0; i < n; i++) {
        const a0 = angle - Math.PI / 2 + i * seg;
        const a1 = a0 + seg;
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.beginPath(); ctx.moveTo(CX, CY); ctx.arc(CX, CY, R, a0, a1); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.lineWidth = n > 20 ? 1 : 1.5;
        ctx.stroke();

        const mid = a0 + seg / 2;
        const maxLen = n > 20 ? 5 : n > 12 ? 8 : 12;
        const fs = n > 20 ? 9 : n > 12 ? 10 : 12;
        const label = ents[i].length > maxLen ? ents[i].slice(0, maxLen - 1) + '…' : ents[i];
        ctx.save();
        ctx.translate(CX, CY); ctx.rotate(mid);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = `600 ${fs}px Epilogue, sans-serif`;
        ctx.fillText(label, R - 8, 0);
        ctx.restore();
      }
    }

    // Rim
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, 2 * Math.PI); ctx.stroke();
    // Hub
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(CX, CY, 16, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = '#e0eaf6'; ctx.lineWidth = 2; ctx.stroke();
  }, []);

  // Redraw when entries change (not during spin — RAF handles that)
  React.useEffect(() => {
    if (!spinning) redraw();
  }, [entries, spinning, redraw]);

  React.useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  const spin = () => {
    if (entries.length < 2 || spinning) return;
    const n = entries.length;
    const wIdx = Math.floor(Math.random() * n);
    const wName = entries[wIdx];
    const seg = (2 * Math.PI) / n;

    const tMod = ((-(wIdx + 0.5) * seg % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const cMod = ((stateRef.current.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let delta = (tMod - cMod + 2 * Math.PI) % (2 * Math.PI);
    if (delta < 0.05) delta += 2 * Math.PI;

    const startAngle = stateRef.current.angle;
    const endAngle = startAngle + (6 + Math.floor(Math.random() * 4)) * 2 * Math.PI + delta;
    const duration = 4000 + Math.random() * 1500;
    const startTime = performance.now();
    const doRemove = removeOnWin;

    setSpinning(true);
    setWinner(null);

    const frame = (ts) => {
      const elapsed = ts - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 5);
      stateRef.current.angle = startAngle + (endAngle - startAngle) * eased;
      redraw();
      if (progress < 1) {
        animRef.current = requestAnimationFrame(frame);
      } else {
        stateRef.current.angle = endAngle;
        if (doRemove) {
          setEntries(prev => {
            const idx = prev.indexOf(wName);
            return idx === -1 ? prev : [...prev.slice(0, idx), ...prev.slice(idx + 1)];
          });
        }
        setSpinning(false);
        setWinner(wName);
      }
    };
    animRef.current = requestAnimationFrame(frame);
  };

  const addEntries = () => {
    const names = inputVal.split(',').map(n => n.trim()).filter(Boolean);
    if (!names.length) return;
    setEntries(prev => {
      const set = new Set(prev);
      return [...prev, ...names.filter(n => !set.has(n))];
    });
    setInputVal('');
    setWinner(null);
  };

  const removeEntry = (i) => { setEntries(prev => prev.filter((_, idx) => idx !== i)); setWinner(null); };
  const clearAll = () => { setEntries([]); setWinner(null); stateRef.current.angle = 0; };

  return (
    <div className="screen">
      <div className="wheel-layout">

        {/* ── Sidebar ── */}
        <div className="wheel-sidebar">
          <div className="form-card">
            <Field label="Add participants">
              <TextInput value={inputVal} onChange={e => setInputVal(e.target.value)}
                         placeholder="Alice, Bob, Charlie…"
                         onKeyDown={e => e.key === 'Enter' && addEntries()} />
            </Field>
            <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={addEntries}>
              Add to wheel <Arrow />
            </button>
            <div className="checks" style={{ marginTop: 14 }}>
              <Checkbox checked={removeOnWin} onChange={setRemoveOnWin}>
                Remove winner after spin
              </Checkbox>
            </div>
            {entries.length > 0 && (
              <>
                <div className="section-label" style={{ marginTop: 18 }}>
                  <h2>On the wheel ({entries.length})</h2>
                  <button className="wheel-clear-btn" onClick={clearAll}>Clear all</button>
                </div>
                <ul className="wheel-entry-list">
                  {entries.map((e, i) => (
                    <li key={i} className="wheel-entry-item">
                      <span className="wheel-dot" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="wheel-entry-name">{e}</span>
                      <button className="wheel-entry-remove" onClick={() => removeEntry(i)}>✕</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* ── Wheel ── */}
        <div className="wheel-area">
          <div className="wheel-outer">
            <div className="wheel-pointer" />
            <canvas ref={canvasRef} width={W} height={W} className="wheel-canvas" />
          </div>
          <button className="btn btn-primary" style={{ maxWidth: 220, marginTop: 24 }}
                  disabled={entries.length < 2 || spinning} onClick={spin}>
            {spinning ? 'Spinning…' : 'Spin the wheel'}
          </button>
          {entries.length < 2 && !spinning && (
            <p className="wheel-hint">Add at least 2 participants to spin</p>
          )}
          {winner && !spinning && (
            <div className="wheel-winner">
              <div className="wheel-winner-label">🎉 Winner</div>
              <div className="wheel-winner-name">{winner}</div>
              {entries.length >= 2 && (
                <button className="btn btn-outline" style={{ marginTop: 12, maxWidth: 220 }} onClick={spin}>
                  Spin again <Arrow />
                </button>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

Object.assign(window, { TwitterForm, TwitterResults, YoutubeForm, YoutubeResults, FairProof, KickGiveaway, WheelGiveaway });
