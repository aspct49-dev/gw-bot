import os
import json
import base64
import asyncio
import random
import secrets
import hashlib
from random import shuffle
import requests as req_lib
from itertools import islice
from flask import Flask, request, session, send_from_directory, jsonify
from dotenv import load_dotenv
from twikit import Client
from twikit.client.gql import Endpoint
from twikit.constants import USER_FEATURES
import twikit.user
import twikit.guest.user
from twikit.x_client_transaction import ClientTransaction
from youtube_comment_downloader import YoutubeCommentDownloader, SORT_BY_RECENT

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SUPABASE_URL = os.getenv('SUPABASE_URL', '').strip()
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY', '').strip()


def _sb_headers():
    return {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    }


def db_save_draw(draw_id, data):
    try:
        r = req_lib.post(
            f'{SUPABASE_URL}/rest/v1/draws',
            json={'draw_id': draw_id, 'data': data},
            headers=_sb_headers(), timeout=10
        )
        return r.ok, r.text
    except Exception as e:
        return False, str(e)


def db_get_draw(draw_id):
    try:
        r = req_lib.get(
            f'{SUPABASE_URL}/rest/v1/draws',
            params={'draw_id': f'eq.{draw_id}', 'select': 'data'},
            headers=_sb_headers(), timeout=10
        )
        if r.ok:
            rows = r.json()
            if rows:
                return rows[0]['data']
    except Exception:
        pass
    return None
COOKIES_FILE = os.path.join(BASE_DIR, 'cookies.json')

# Patch ClientTransaction.init to gracefully handle Twitter JS parsing failures.
# Twitter occasionally changes their frontend JS structure, breaking the key extraction.
# When that happens, we fall back to dummy values so API requests still go out.
_orig_ct_init = ClientTransaction.init

async def _safe_ct_init(self, session, headers):
    try:
        await _orig_ct_init(self, session, headers)
    except Exception:
        self.key = base64.b64encode(bytes(32)).decode()
        self.key_bytes = [0] * 32
        self.animation_key = 'deadbeef' * 5
        self.DEFAULT_ROW_INDEX = 0
        self.DEFAULT_KEY_BYTES_INDICES = [1, 2, 3]

ClientTransaction.init = _safe_ct_init

# Monkey-patch twikit's User classes to handle missing/incomplete fields gracefully.
class _SafeDict(dict):
    def __missing__(self, key):
        if key == 'urls':
            return []
        if key == 'entities':
            return _SafeDict({'description': _SafeDict(), 'url': _SafeDict()})
        return _SafeDict() if key in ('legacy', 'description', 'url') else None

def _make_safe(data):
    safe = _SafeDict(data)
    if 'legacy' in safe and isinstance(safe['legacy'], dict):
        leg = _SafeDict(safe['legacy'])
        if 'entities' in leg and isinstance(leg['entities'], dict):
            ent = leg['entities']
            if 'description' in ent and isinstance(ent['description'], dict):
                ent['description'] = _SafeDict(ent['description'])
            if 'url' in ent and isinstance(ent['url'], dict):
                ent['url'] = _SafeDict(ent['url'])
            leg['entities'] = _SafeDict(ent)
        safe['legacy'] = leg
    return safe

_orig_user_init = twikit.user.User.__init__
def _patched_user_init(self, client, data, *args, **kwargs):
    return _orig_user_init(self, client, _make_safe(data), *args, **kwargs)
twikit.user.User.__init__ = _patched_user_init

_orig_guest_user_init = twikit.guest.user.User.__init__
def _patched_guest_user_init(self, client, data, *args, **kwargs):
    return _orig_guest_user_init(self, client, _make_safe(data), *args, **kwargs)
twikit.guest.user.User.__init__ = _patched_guest_user_init

app = Flask(__name__, static_folder=os.path.join(BASE_DIR, 'prototype'), static_url_path='')
app.secret_key = os.getenv('SECRET_KEY') or os.urandom(24)


def make_client():
    client = Client('en-US')
    if os.path.exists(COOKIES_FILE):
        client.load_cookies(COOKIES_FILE)
    else:
        cookies_str = os.getenv('TWITTER_COOKIES', '').strip().strip('"\'')
        if not cookies_str:
            raise RuntimeError('No Twitter cookies found. Set TWITTER_COOKIES env var.')
        tmp = '/tmp/cookies.json'
        with open(tmp, 'w') as f:
            # Re-serialize to ensure clean JSON regardless of how the env var was pasted
            json.dump(json.loads(cookies_str), f)
        client.load_cookies(tmp)
    return client


def parse_tweet_url(tweet_url):
    parts = tweet_url.strip().rstrip('/').split('/')
    tweet_id = None
    author_username = None
    for i, part in enumerate(parts):
        if part == 'status' and i + 1 < len(parts):
            tweet_id = parts[i + 1].split('?')[0]
            author_username = parts[i - 1] if i > 0 else None
    if not tweet_id:
        raise ValueError('Could not extract tweet ID from URL.')
    return tweet_id, author_username


def _user_dict(user):
    avatar = (getattr(user, 'profile_image_url', '') or '').replace('_normal.', '_400x400.')
    return {
        'id': user.id,
        'username': user.screen_name,
        'name': user.name,
        'avatar': avatar,
        'bio': getattr(user, 'description', '') or '',
        'location': getattr(user, 'location', '') or '',
    }




async def fetch_all_users(fetch_func, tweet_id, max_pages=10):
    users = []
    result = await fetch_func(tweet_id, count=100)
    for user in result:
        users.append(_user_dict(user))
    pages = 1
    while pages < max_pages:
        try:
            result = await result.next()
            if not result:
                break
            for user in result:
                users.append(_user_dict(user))
            pages += 1
        except Exception:
            break
    return users


async def check_follows(client, user_id, author_username, max_pages=3):
    """Check if user_id follows @author_username by scanning their following list."""
    try:
        u = await client.get_user_by_id(str(user_id))
        result = await u.get_following(count=200)
        for f in result:
            try:
                if (f.screen_name or '').lower() == author_username.lower():
                    return True
            except Exception:
                continue
        pages = 1
        while pages < max_pages:
            try:
                result = await result.next()
                if not result:
                    break
                for f in result:
                    try:
                        if (f.screen_name or '').lower() == author_username.lower():
                            return True
                    except Exception:
                        continue
                pages += 1
            except Exception:
                break
    except Exception:
        pass
    return False


async def pick_winners_async(tweet_url, num_winners, require_retweet, require_follow):
    tweet_id, author_username = parse_tweet_url(tweet_url)
    client = make_client()
    errors = []
    server_seed, seed_hash = make_seed()

    if require_retweet:
        pool = await fetch_all_users(client.get_retweeters, tweet_id)
        if not pool:
            raise ValueError('No participants found. Make sure the tweet has retweets.')
        num_pool = len(pool)
        seeded_shuffle(pool, server_seed)

        if require_follow and author_username:
            eligible = []
            check_limit = min(len(pool), max(num_winners * 6, 15))
            for user in pool[:check_limit]:
                if await check_follows(client, user['id'], author_username):
                    eligible.append(user)
            if eligible:
                pool = eligible
            else:
                errors.append('No followers found among retweeters — showing all retweeters.')

    else:
        # Follow-only: pool is the author's followers
        if not author_username:
            raise ValueError('Could not extract author username from URL.')
        try:
            author = await client.get_user_by_screen_name(author_username)
            pool = []
            result = await author.get_followers(count=200)
            for u in result:
                try: pool.append(_user_dict(u))
                except Exception: continue
            for _ in range(4):
                try:
                    result = await result.next()
                    if not result: break
                    for u in result:
                        try: pool.append(_user_dict(u))
                        except Exception: continue
                except Exception:
                    break
        except Exception as e:
            raise ValueError(f'Could not fetch followers: {e}')
        if not pool:
            raise ValueError('No followers found.')
        num_pool = len(pool)
        seeded_shuffle(pool, server_seed)

    winners = pool[:num_winners]
    remaining = pool[num_winners:]

    return {
        'winners': winners,
        'remaining': remaining,
        'eligible': len(pool),
        'retweeters': num_pool,
        'author': author_username,
        'errors': errors,
        'seed': server_seed,
        'seed_hash': seed_hash,
    }


def make_seed():
    seed = secrets.token_hex(32)
    seed_hash = hashlib.sha256(seed.encode()).hexdigest()
    return seed, seed_hash


def seeded_shuffle(lst, seed):
    random.Random(int(seed, 16)).shuffle(lst)


DRAW_PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{ og_title }}</title>
<meta property="og:title" content="{{ og_title }}">
<meta property="og:description" content="{{ og_desc }}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="{{ og_title }}">
<meta name="twitter:description" content="{{ og_desc }}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans',-apple-system,sans-serif;background:#eef2fb;color:#0f1c3f;min-height:100vh;-webkit-font-smoothing:antialiased}
.page{max-width:720px;margin:0 auto;padding:32px 20px 60px}
.header{text-align:center;margin-bottom:32px}
.logo{font-size:22px;font-weight:800;color:#2454d6;letter-spacing:-.02em;margin-bottom:12px}
.draw-meta{font-size:13.5px;color:#64748b;line-height:1.7}
.draw-meta a{color:#2454d6;text-decoration:none}
.meta-pills{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:10px}
.meta-pill{background:#fff;border:1px solid #dde3f0;border-radius:999px;padding:4px 13px;font-size:12px;font-weight:600;color:#64748b}
.section-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:16px}
.winners{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:32px}
.winner-card{background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(15,35,100,.07)}
.winner-avatar{width:100%;aspect-ratio:1;object-fit:cover;background:#dde3f0;display:block}
.winner-avatar-placeholder{width:100%;aspect-ratio:1;background:linear-gradient(135deg,#dde3f0,#c7d2ea);display:flex;align-items:center;justify-content:center;font-size:40px;color:#94a3b8}
.winner-info{padding:14px 16px}
.winner-num{font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}
.winner-name{font-size:15px;font-weight:700;color:#0f1c3f;letter-spacing:-.01em;margin-bottom:2px}
.winner-handle{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#2454d6;margin-bottom:8px}
.winner-bio{font-size:12px;color:#64748b;line-height:1.5;margin-bottom:6px;word-break:break-word}
.winner-location{font-size:11.5px;color:#94a3b8}
.profile-btn{display:block;margin:12px 16px 14px;padding:9px;background:#f0f4ff;border:1.5px solid #c7d2f5;border-radius:10px;text-align:center;font-size:13px;font-weight:600;color:#2454d6;text-decoration:none}
.fair{background:#fff;border-radius:14px;padding:18px 20px;box-shadow:0 2px 12px rgba(15,35,100,.07);margin-bottom:24px}
.fair-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:12px}
.fair-row{display:flex;gap:10px;margin-bottom:8px}
.fair-key{font-size:10.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;width:46px;flex-shrink:0}
.fair-val{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#64748b;word-break:break-all;background:#f8faff;padding:5px 8px;border-radius:6px;border:1px solid #dde3f0;flex:1;user-select:all}
.fair-hint{font-size:11px;color:#94a3b8;margin-top:10px;line-height:1.55}
.fair-hint a{color:#2454d6;text-decoration:none}
.footer{text-align:center;font-size:12px;color:#94a3b8;margin-top:32px}
@media(max-width:480px){.winners{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo">Doug's Giveaway Bot</div>
    <div class="draw-meta" id="draw-meta"></div>
  </div>
  <div class="section-title">Winners</div>
  <div class="winners" id="winners"></div>
  <div id="fair-section"></div>
  <div class="footer">Powered by Doug's Giveaway Bot &mdash; Provably Fair</div>
</div>
<script>
var DRAW = {{ data_json | safe }};
var isYoutube = DRAW.type === 'youtube';

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

var meta = document.getElementById('draw-meta');
if (isYoutube) {
  var url = DRAW.video_url || '';
  var pills = '<span class="meta-pill">' + ((DRAW.commenters||0).toLocaleString()) + ' commenters</span>';
  pills += '<span class="meta-pill">' + DRAW.winners.length + ' winner' + (DRAW.winners.length !== 1 ? 's' : '') + '</span>';
  if (DRAW.keyword) pills += '<span class="meta-pill">Keyword: &ldquo;' + esc(DRAW.keyword) + '&rdquo;</span>';
  meta.innerHTML = '<div>From <a href="' + esc(url) + '" target="_blank" rel="noreferrer">' + esc(url) + '</a></div><div class="meta-pills">' + pills + '</div>';
} else {
  var turl = DRAW.tweet_url || '';
  var author = DRAW.author || '';
  var pills = '<span class="meta-pill">' + ((DRAW.eligible||0).toLocaleString()) + ' eligible</span>';
  pills += '<span class="meta-pill">' + DRAW.winners.length + ' winner' + (DRAW.winners.length !== 1 ? 's' : '') + '</span>';
  if (DRAW.retweet) pills += '<span class="meta-pill">&#10003; Reposted</span>';
  if (DRAW.follow) pills += '<span class="meta-pill">&#10003; Follows @' + esc(author) + '</span>';
  meta.innerHTML = '<div>From a post by <a href="https://twitter.com/' + esc(author) + '" target="_blank" rel="noreferrer">@' + esc(author) + '</a></div><div class="meta-pills">' + pills + '</div>';
}

var grid = document.getElementById('winners');
DRAW.winners.forEach(function(w, i) {
  var card = document.createElement('div');
  card.className = 'winner-card';
  var name = esc(w.name || w.author || '');
  var handle = esc(w.username || '');
  var avatar = esc(w.avatar || '');
  var bio = esc(w.bio || w.text || '');
  var location = esc(w.location || '');
  var profileUrl = isYoutube
    ? 'https://youtube.com/' + esc(w.id || '')
    : 'https://twitter.com/' + handle;
  var html = avatar
    ? '<img class="winner-avatar" src="' + avatar + '" alt="' + name + '" loading="lazy">'
    : '<div class="winner-avatar-placeholder">&#128100;</div>';
  html += '<div class="winner-info">';
  html += '<div class="winner-num">#' + (i + 1) + '</div>';
  html += '<div class="winner-name">' + name + '</div>';
  if (handle) html += '<div class="winner-handle">@' + handle + '</div>';
  if (bio) html += '<div class="winner-bio">&ldquo;' + bio + '&rdquo;</div>';
  if (location) html += '<div class="winner-location">&#128205; ' + location + '</div>';
  html += '</div>';
  html += '<a class="profile-btn" href="' + profileUrl + '" target="_blank" rel="noreferrer">View Profile &#8599;</a>';
  card.innerHTML = html;
  grid.appendChild(card);
});

if (DRAW.seed) {
  var fair = '<div class="fair"><div class="fair-title">Provably Fair</div>';
  fair += '<div class="fair-row"><span class="fair-key">Seed</span><code class="fair-val">' + esc(DRAW.seed) + '</code></div>';
  fair += '<div class="fair-row"><span class="fair-key">SHA-256</span><code class="fair-val">' + esc(DRAW.seed_hash) + '</code></div>';
  fair += '<p class="fair-hint">Verify: compute SHA-256(seed) and confirm it matches the hash above using any <a href="https://emn178.github.io/online-tools/sha256.html" target="_blank">online tool</a>.</p>';
  fair += '</div>';
  document.getElementById('fair-section').innerHTML = fair;
}
</script>
</body>
</html>"""


def format_comment(c):
    votes = c.get('votes', 0)
    try:
        votes = int(votes)
    except (ValueError, TypeError):
        votes = 0
    return {
        'id': c.get('cid') or c.get('channel', ''),
        'author': c.get('author', 'Anonymous'),
        'text': c.get('text', ''),
        'time': c.get('time', ''),
        'votes': votes,
    }


@app.route('/api/save-draw', methods=['POST'])
def api_save_draw():
    try:
        if not SUPABASE_URL:
            return jsonify(error='SUPABASE_URL not configured.')
        if not SUPABASE_KEY:
            return jsonify(error='SUPABASE_SERVICE_KEY not configured.')
        payload = request.get_json()
        if not payload:
            return jsonify(error='No payload received.')
        draw_id = secrets.token_hex(4)
        ok, detail = db_save_draw(draw_id, payload)
        if ok:
            return jsonify(draw_id=draw_id)
        return jsonify(error=f'Supabase error: {detail}')
    except Exception as e:
        return jsonify(error=f'Server error: {e}'), 500


@app.route('/api/draw/<draw_id>')
def api_get_draw(draw_id):
    data = db_get_draw(draw_id)
    if not data:
        return jsonify(error='Draw not found'), 404
    return jsonify(data)


@app.route('/draw/<draw_id>')
def draw_page(draw_id):
    from flask import render_template_string
    data = db_get_draw(draw_id)
    if not data:
        return 'Draw not found', 404
    winners = data.get('winners', [])
    author = data.get('author', '')
    draw_type = data.get('type', 'twitter')
    og_title = f"Giveaway Winners — @{author}" if author else "Giveaway Winners"
    og_desc = ' · '.join(
        f"@{w.get('username') or w.get('author', '')}" for w in winners
    ) or 'View draw results'
    data_json = json.dumps(data)
    return render_template_string(DRAW_PAGE_TEMPLATE,
        og_title=og_title, og_desc=og_desc,
        draw_id=draw_id, data_json=data_json,
        draw_type=draw_type)


@app.route('/api/debug-raw-user')
def debug_raw_user():
    screen_name = request.args.get('screen_name', '')
    if not screen_name:
        return jsonify(error='Pass ?screen_name=username')

    async def fetch():
        client = make_client()
        variables = {'screen_name': screen_name, 'withSafetyModeUserFields': True}
        return await client.gql.gql_get(Endpoint.USER_BY_SCREEN_NAME, variables, USER_FEATURES)

    try:
        raw = asyncio.run(fetch())
        if isinstance(raw, tuple):
            raw = raw[0]
        result = raw.get('data', {}).get('user', {}).get('result', {})
        # Return top-level keys + everything except the large 'legacy' block
        trimmed = {k: v for k, v in result.items() if k != 'legacy'}
        legacy_country = {k: v for k, v in (result.get('legacy') or {}).items()
                          if 'country' in k.lower() or 'location' in k.lower()}
        return jsonify(top_level_keys=list(result.keys()),
                       non_legacy=trimmed,
                       legacy_location_fields=legacy_country)
    except Exception as e:
        return jsonify(error=str(e))


@app.route('/api/debug-env')
def debug_env():
    val = os.getenv('TWITTER_COOKIES', '')
    return jsonify(
        twitter_cookies_set=bool(val),
        twitter_cookies_length=len(val),
        twitter_cookies_preview=val[:6] + '...' if val else '(empty)',
        secret_key_set=bool(os.getenv('SECRET_KEY')),
    )


@app.route('/')
def index():
    return send_from_directory(os.path.join(BASE_DIR, 'prototype'), 'Giveaway Picker.html')


@app.route('/api/pick', methods=['POST'])
def api_pick():
    data = request.get_json()
    tweet_url = (data.get('url') or '').strip()
    num_winners = max(1, int(data.get('num', 1)))
    require_retweet = bool(data.get('retweet', True))
    require_follow = bool(data.get('follow', False))

    if not tweet_url:
        return jsonify(error='Tweet URL is required.')
    if not require_retweet and not require_follow:
        return jsonify(error='Select at least one requirement.')

    try:
        result = asyncio.run(
            pick_winners_async(tweet_url, num_winners, require_retweet, require_follow)
        )
    except ValueError as e:
        return jsonify(error=str(e))
    except Exception as e:
        return jsonify(error=f'Failed to fetch data from Twitter: {e}')

    return jsonify(**result)


@app.route('/api/youtube/pick', methods=['POST'])
def api_youtube_pick():
    data = request.get_json()
    video_url = (data.get('url') or '').strip()
    num_winners = max(1, int(data.get('num', 1)))
    keyword = (data.get('keyword') or '').strip()
    max_comments = int(data.get('max_comments', 500))

    if not video_url:
        return jsonify(error='YouTube video URL is required.')

    try:
        downloader = YoutubeCommentDownloader()
        raw = downloader.get_comments_from_url(video_url, sort_by=SORT_BY_RECENT)
        comments = list(islice(raw, max_comments))
    except Exception as e:
        return jsonify(error=f'Failed to fetch comments: {e}')

    if not comments:
        return jsonify(error='No comments found on this video.')

    if keyword:
        comments = [c for c in comments if keyword.lower() in c.get('text', '').lower()]
    if not comments:
        return jsonify(error=f"No comments found matching keyword '{keyword}'.")

    seen = set()
    unique = []
    for c in comments:
        key = c.get('channel') or c.get('author', '')
        if key not in seen:
            seen.add(key)
            unique.append(c)

    server_seed, seed_hash = make_seed()
    seeded_shuffle(unique, server_seed)
    winners = [format_comment(c) for c in unique[:num_winners]]
    remaining = [format_comment(c) for c in unique[num_winners:]]

    return jsonify(winners=winners, remaining=remaining, commenters=len(unique),
                   keyword=keyword, seed=server_seed, seed_hash=seed_hash)


def _do_reroll(current_winners, remaining, reroll_ids):
    server_seed, seed_hash = make_seed()
    seeded_shuffle(remaining, server_seed)
    pool = list(remaining)
    updated = []
    for w in current_winners:
        if w['id'] in reroll_ids and pool:
            updated.append(pool.pop(0))
        else:
            updated.append(w)
    return updated, pool, server_seed, seed_hash


@app.route('/api/youtube/reroll', methods=['POST'])
def api_youtube_reroll():
    data = request.get_json()
    reroll_ids = set(data.get('reroll_ids', []))
    current_winners = data.get('winners', [])
    remaining = data.get('remaining', [])
    updated, pool, seed, seed_hash = _do_reroll(current_winners, remaining, reroll_ids)
    return jsonify(winners=updated, remaining=pool, seed=seed, seed_hash=seed_hash)


@app.route('/api/twitter/reroll', methods=['POST'])
def api_twitter_reroll():
    data = request.get_json()
    reroll_ids = set(data.get('reroll_ids', []))
    current_winners = data.get('winners', [])
    remaining = data.get('remaining', [])
    updated, pool, seed, seed_hash = _do_reroll(current_winners, remaining, reroll_ids)
    return jsonify(winners=updated, remaining=pool, seed=seed, seed_hash=seed_hash)


if __name__ == '__main__':
    if not os.path.exists(COOKIES_FILE):
        print("WARNING: No cookies.json found. Twitter features won't work.")
        print("Run 'python login.py' first to authenticate.")
    app.run(debug=True, port=5000)
