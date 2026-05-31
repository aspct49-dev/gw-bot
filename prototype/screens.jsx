// screens.jsx — the four app screens. Presentational; App owns flow + data.

const { useState: useStateS } = React;

/* ─────────────── Twitter form ─────────────── */
function TwitterForm({ error, onSubmit }) {
  const [url, setUrl] = useStateS('');
  const [num, setNum] = useStateS(1);
  const [retweet, setRetweet] = useStateS(true);
  const [follow, setFollow] = useStateS(false);
  const noneSelected = !retweet && !follow;

  return (
    <div className="screen">
      <div className="head">
        <h1 className="title">Pick winners from a post</h1>
        <p className="subtitle">Randomly draw winners from a post&rsquo;s reposts and followers — fair, fast, and verifiable.</p>
      </div>

      {error && <div className="alert error">{error}</div>}

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
        <p className="help">Follow checks run slower due to rate limits.</p>
      </div>

      <button className="btn btn-primary" style={{ marginTop: 22 }}
              disabled={noneSelected}
              onClick={() => onSubmit({ url, num: Number(num) || 1, retweet, follow })}>
        Pick winners <Arrow />
      </button>
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
  const { url, winners, retweeters, eligible, retweet, follow, author, seed, seedHash, shareUrl } = data;
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
                  <div className="winner-handle">
                    <a href={`https://twitter.com/${w.username}`} target="_blank" rel="noreferrer">@{w.username}</a>
                  </div>
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
      <div className="head">
        <h1 className="title">Pick winners from comments</h1>
        <p className="subtitle">Randomly draw winners from a YouTube video&rsquo;s comment section.</p>
      </div>

      {error && <div className="alert error">{error}</div>}

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

Object.assign(window, { TwitterForm, TwitterResults, YoutubeForm, YoutubeResults, FairProof });
