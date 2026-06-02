import os
import json
import base64
import asyncio
import random
import secrets
import hashlib
from random import shuffle
from datetime import datetime, timezone
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
    leg_raw = safe.get('legacy')
    leg = _SafeDict(leg_raw) if isinstance(leg_raw, dict) else _SafeDict()
    if isinstance(leg_raw, dict) and isinstance(leg.get('entities'), dict):
        ent = leg['entities']
        if isinstance(ent.get('description'), dict):
            ent['description'] = _SafeDict(ent['description'])
        if isinstance(ent.get('url'), dict):
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
    username = (getattr(user, 'screen_name', '') or '').strip()
    name = getattr(user, 'name', '') or username
    return {
        'id': user.id,
        'username': username,
        'name': name,
        'avatar': avatar,
        'bio': getattr(user, 'description', '') or '',
        'location': getattr(user, 'location', '') or '',
        'followers_count': getattr(user, 'followers_count', 0) or 0,
        'created_at': str(getattr(user, 'created_at', '') or ''),
    }


def _account_age_days(s):
    for fmt in ('%a %b %d %H:%M:%S +0000 %Y', '%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%SZ'):
        try:
            dt = datetime.strptime(str(s), fmt).replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - dt).days
        except ValueError:
            continue
    return 0


def _has_custom_avatar(avatar):
    return bool(avatar) and 'default_profile_images' not in avatar


def apply_profile_filters(pool, min_followers, min_account_age_days, require_profile_pic):
    out = []
    for u in pool:
        if min_followers > 0 and (u.get('followers_count') or 0) < min_followers:
            continue
        if min_account_age_days > 0 and _account_age_days(u.get('created_at', '')) < min_account_age_days:
            continue
        if require_profile_pic and not _has_custom_avatar(u.get('avatar', '')):
            continue
        out.append(u)
    return out




async def fetch_all_users(fetch_func, tweet_id, max_pages=10):
    users = []
    result = await fetch_func(tweet_id, count=100)
    for user in result:
        d = _user_dict(user)
        if d.get('username'):
            users.append(d)
    pages = 1
    while pages < max_pages:
        try:
            result = await result.next()
            if not result:
                break
            for user in result:
                d = _user_dict(user)
                if d.get('username'):
                    users.append(d)
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




async def pick_winners_async(tweet_url, num_winners, require_retweet, require_follow,
                              min_followers=0, min_account_age_days=0, require_profile_pic=False):
    tweet_id, author_username = parse_tweet_url(tweet_url)
    client = make_client()
    errors = []
    server_seed, seed_hash = make_seed()

    fetch_tasks = []
    task_keys = []
    if require_retweet:
        fetch_tasks.append(fetch_all_users(client.get_retweeters, tweet_id))
        task_keys.append('retweet')
    # Follow-only mode: fall back to retweeters as proxy pool
    if not fetch_tasks:
        fetch_tasks.append(fetch_all_users(client.get_retweeters, tweet_id))
        task_keys.append('retweet')

    pool_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
    pools = {}
    for key, result in zip(task_keys, pool_results):
        if isinstance(result, Exception):
            errors.append(f'Could not fetch {key}s: {result}')
            pools[key] = None  # None = API failure, excluded from intersection
        else:
            pools[key] = result  # [] = no results (kept), [...] = has users

    # Only exclude pools that failed outright; empty [] pools stay in intersection
    active_pools = {k: v for k, v in pools.items() if v is not None}
    if not active_pools:
        raise ValueError('No participants found. Make sure the tweet has the required engagement.')

    pool_values = list(active_pools.values())
    if len(pool_values) == 1:
        pool = list(pool_values[0])
    else:
        id_sets = [set(u['id'] for u in p) for p in pool_values]
        common_ids = id_sets[0]
        for s in id_sets[1:]:
            common_ids &= s
        pool = [u for u in pool_values[0] if u['id'] in common_ids]

    num_pool = len(pool)
    seeded_shuffle(pool, server_seed)

    pool = apply_profile_filters(pool, min_followers, min_account_age_days, require_profile_pic)
    if not pool and num_pool > 0:
        errors.append('No users passed account filters — try relaxing requirements.')

    if require_follow and author_username and pool:
        eligible = []
        check_limit = min(len(pool), max(num_winners * 6, 15))
        for user in pool[:check_limit]:
            if await check_follows(client, user['id'], author_username):
                eligible.append(user)
        if eligible:
            pool = eligible
        else:
            errors.append('No followers found among eligible users — showing all eligible users.')

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
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Epilogue:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Epilogue',-apple-system,sans-serif;background:#fff;color:#0d1832;min-height:100vh;-webkit-font-smoothing:antialiased}
/* Nav */
.nav{background:#fff;border-bottom:1px solid #e6edf8;padding:0 36px;height:72px;display:flex;align-items:center}
.nav-logo{height:48px;width:auto;display:block}
/* Page */
.page{max-width:760px;margin:0 auto;padding:44px 24px 80px}
/* Header */
.header{text-align:center;margin-bottom:40px}
.draw-title{font-size:28px;font-weight:800;letter-spacing:-.025em;color:#0d1832;margin-bottom:8px}
.draw-meta{font-size:13.5px;color:#5c6c8a;line-height:1.7}
.draw-meta a{color:#2454d6;text-decoration:none}
.draw-meta a:hover{text-decoration:underline}
.meta-pills{display:flex;flex-wrap:wrap;justify-content:center;gap:7px;margin-top:12px}
.meta-pill{background:#eef2fd;border:1px solid rgba(36,84,214,.14);border-radius:999px;padding:5px 13px;font-size:12px;font-weight:600;color:#1c3aa8}
/* Winners */
.section-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a9ab8;margin-bottom:18px}
.winners{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;margin-bottom:36px}
.winner-card{background:#fff;border:1px solid #dde8f8;border-radius:18px;overflow:hidden;box-shadow:0 2px 4px rgba(15,30,70,.04),0 8px 24px -10px rgba(15,30,70,.1);transition:box-shadow .2s,border-color .2s}
.winner-card:hover{border-color:rgba(36,84,214,.28);box-shadow:0 4px 8px rgba(15,30,70,.06),0 14px 32px -12px rgba(36,84,214,.2)}
.winner-avatar{width:100%;aspect-ratio:1;object-fit:cover;background:#eef2fd;display:block}
.winner-avatar-placeholder{width:100%;aspect-ratio:1;background:linear-gradient(135deg,#eef2fd,#dde8f8);display:flex;align-items:center;justify-content:center;font-size:44px;color:#b4c8ec}
.winner-info{padding:14px 16px}
.winner-num{font-size:11px;font-weight:700;color:#8a9ab8;letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px}
.winner-name{font-size:15px;font-weight:700;color:#0d1832;letter-spacing:-.01em;margin-bottom:3px}
.winner-handle{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#2454d6;margin-bottom:8px}
.winner-bio{font-size:12px;color:#5c6c8a;line-height:1.5;margin-bottom:6px;word-break:break-word}
.winner-location{font-size:11.5px;color:#8a9ab8}
.profile-btn{display:block;margin:10px 16px 14px;padding:9px;background:#eef2fd;border:1.5px solid rgba(36,84,214,.22);border-radius:10px;text-align:center;font-size:13px;font-weight:600;color:#2454d6;text-decoration:none;transition:background .15s}
.profile-btn:hover{background:#e0e8fb}
/* Fair */
.fair{background:#fff;border:1px solid #dde8f8;border-radius:14px;padding:18px 20px;margin-bottom:28px;box-shadow:0 1px 3px rgba(15,30,70,.04)}
.fair-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a9ab8;margin-bottom:14px;display:flex;align-items:center;gap:7px}
.fair-title::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:rgba(36,84,214,.45);box-shadow:0 0 0 2.5px rgba(36,84,214,.14)}
.fair-row{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}
.fair-key{font-size:10.5px;font-weight:700;color:#8a9ab8;text-transform:uppercase;letter-spacing:.06em;width:52px;flex-shrink:0}
.fair-val{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#5c6c8a;word-break:break-all;background:#fafcff;padding:5px 8px;border-radius:6px;border:1px solid #dde8f8;flex:1;user-select:all;cursor:pointer}
.fair-val:hover{border-color:rgba(36,84,214,.3)}
.fair-hint{font-size:11px;color:#8a9ab8;margin-top:10px;line-height:1.55}
.fair-hint a{color:#2454d6;text-decoration:none}
.fair-hint a:hover{text-decoration:underline}
/* Footer */
.footer{border-top:1px solid #e6edf8;padding-top:28px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.footer-logo{height:28px;width:auto;display:block;opacity:.7}
.footer-text{font-size:12px;color:#8a9ab8}
@media(max-width:520px){
  .nav{padding:0 20px}
  .winners{grid-template-columns:1fr 1fr}
  .footer{flex-direction:column;text-align:center}
}
</style>
</head>
<body>
<nav class="nav">
  <img class="nav-logo" src="/drawr-logo.png" alt="drawr">
</nav>
<div class="page">
  <div class="header">
    <div class="draw-title" id="draw-title">Giveaway Results</div>
    <div class="draw-meta" id="draw-meta"></div>
  </div>
  <div class="section-title">Winners</div>
  <div class="winners" id="winners"></div>
  <div id="fair-section"></div>
  <div class="footer">
    <img class="footer-logo" src="/drawr-logo.png" alt="drawr">
    <span class="footer-text">Powered by drawr &mdash; Provably Fair</span>
  </div>
</div>
<script>
var DRAW = {{ data_json | safe }};
var isYoutube = DRAW.type === 'youtube';

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

var meta = document.getElementById('draw-meta');
var titleEl = document.getElementById('draw-title');
if (isYoutube) {
  var url = DRAW.video_url || '';
  titleEl.textContent = DRAW.winners.length + ' Winner' + (DRAW.winners.length !== 1 ? 's' : '') + ' Drawn';
  var pills = '<span class="meta-pill">' + ((DRAW.commenters||0).toLocaleString()) + ' commenters</span>';
  pills += '<span class="meta-pill">' + DRAW.winners.length + ' winner' + (DRAW.winners.length !== 1 ? 's' : '') + '</span>';
  if (DRAW.keyword) pills += '<span class="meta-pill">Keyword: &ldquo;' + esc(DRAW.keyword) + '&rdquo;</span>';
  meta.innerHTML = '<div>From <a href="' + esc(url) + '" target="_blank" rel="noreferrer">' + esc(url) + '</a></div><div class="meta-pills">' + pills + '</div>';
} else {
  var turl = DRAW.tweet_url || '';
  var author = DRAW.author || '';
  titleEl.textContent = DRAW.winners.length + ' Winner' + (DRAW.winners.length !== 1 ? 's' : '') + ' Drawn';
  var pills = '<span class="meta-pill">' + ((DRAW.eligible||0).toLocaleString()) + ' eligible</span>';
  pills += '<span class="meta-pill">' + DRAW.winners.length + ' winner' + (DRAW.winners.length !== 1 ? 's' : '') + '</span>';
  if (DRAW.retweet) pills += '<span class="meta-pill">&#10003; Reposted</span>';
  if (DRAW.follow) pills += '<span class="meta-pill">&#10003; Follows @' + esc(author) + '</span>';
  if (DRAW.require_profile_pic) pills += '<span class="meta-pill">&#10003; Has profile pic</span>';
  if (DRAW.min_followers) pills += '<span class="meta-pill">&#10003; ' + Number(DRAW.min_followers).toLocaleString() + '+ followers</span>';
  if (DRAW.min_account_age_days) pills += '<span class="meta-pill">&#10003; Account ' + DRAW.min_account_age_days + '+ days old</span>';
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

@app.route('/drawr-logo.png')
def drawr_logo():
    return send_from_directory(os.path.join(BASE_DIR, 'prototype'), 'drawr-logo.png')


_PAGE_BASE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} — drawr</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Epilogue:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Epilogue',-apple-system,sans-serif;background:#fff;color:#0d1832;-webkit-font-smoothing:antialiased;line-height:1.6}}
a{{color:#2454d6;text-decoration:none}}a:hover{{text-decoration:underline}}
.nav{{background:#fff;border-bottom:1px solid #e6edf8;padding:0 36px;height:72px;display:flex;align-items:center;position:sticky;top:0;z-index:100}}
.nav-logo{{height:48px;width:auto;display:block}}
.page{{max-width:760px;margin:0 auto;padding:56px 24px 96px}}
.eyebrow{{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#2454d6;margin-bottom:14px;display:flex;align-items:center;gap:8px}}
.eyebrow::before{{content:'';width:18px;height:1.5px;background:#2454d6;opacity:.5}}
h1{{font-size:32px;font-weight:800;letter-spacing:-.025em;margin-bottom:10px}}
.sub{{font-size:16px;color:#5c6c8a;margin-bottom:48px;line-height:1.65}}
h2{{font-size:18px;font-weight:700;letter-spacing:-.01em;margin:36px 0 10px}}
h2:first-of-type{{margin-top:0}}
p{{font-size:14.5px;color:#5c6c8a;margin-bottom:14px;line-height:1.75}}
ul,ol{{padding-left:22px;margin-bottom:14px}}
li{{font-size:14.5px;color:#5c6c8a;line-height:1.75;margin-bottom:4px}}
.card-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin:24px 0 36px}}
.card{{background:#fafcff;border:1px solid #dde8f8;border-radius:14px;padding:20px 22px}}
.card-icon{{font-size:22px;margin-bottom:10px}}
.card-title{{font-size:14px;font-weight:700;color:#0d1832;margin-bottom:5px}}
.card-body{{font-size:13px;color:#66768f;line-height:1.6}}
.pill{{display:inline-flex;align-items:center;gap:6px;background:#eef2fd;color:#1c3aa8;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid rgba(36,84,214,.14);margin:3px}}
.divider{{border:0;border-top:1px solid #e6edf8;margin:36px 0}}
.footer{{background:#f7f9fd;border-top:1px solid #e0eaf6;padding:32px 36px;text-align:center;font-size:12.5px;color:#8a9ab8;margin-top:auto}}
.footer a{{color:#66768f}}
@media(max-width:520px){{.page{{padding:36px 16px 72px}};h1{{font-size:26px}}}}
</style>
</head>
<body>
<nav class="nav">
  <a href="/"><img class="nav-logo" src="/drawr-logo.png" alt="drawr"></a>
</nav>
<div class="page">{body}</div>
<footer class="footer">
  © 2026 drawr &mdash;
  <a href="/about">About</a> &middot;
  <a href="/features">Features</a> &middot;
  <a href="/privacy">Privacy Policy</a> &middot;
  <a href="/terms">Terms of Service</a> &middot;
  <a href="/">Back to app</a>
</footer>
</body>
</html>"""

def _page(title, body):
    from flask import render_template_string
    return render_template_string(_PAGE_BASE.format(title=title, body=body))


@app.route('/about')
def page_about():
    body = """
<div class="eyebrow">Company</div>
<h1>About drawr</h1>
<p class="sub">drawr makes online giveaways fair, transparent, and verifiable — for creators and their communities.</p>

<h2>Our mission</h2>
<p>Giveaways should be trustworthy. Whether you're running a contest for 100 followers or 100,000, every participant deserves to know the winner was chosen fairly. drawr was built to make that a given.</p>
<p>We use seeded, provably-fair randomization so anyone can independently verify results. No black boxes, no tampering — just a transparent draw your audience can trust.</p>

<h2>What we support</h2>
<div class="card-grid">
  <div class="card"><div class="card-icon">𝕏</div><div class="card-title">X (Twitter) Picker</div><div class="card-body">Draw winners from reposts and followers on any X post, with optional account filters.</div></div>
  <div class="card"><div class="card-icon">▶</div><div class="card-title">YouTube Picker</div><div class="card-body">Pick winners from video comment sections, with optional keyword filtering.</div></div>
  <div class="card"><div class="card-icon">🟢</div><div class="card-title">Kick Giveaway</div><div class="card-body">Collect live chat entries by keyword and spin a winner in real time.</div></div>
  <div class="card"><div class="card-icon">🎡</div><div class="card-title">Wheel</div><div class="card-body">Add any list of names and spin a customisable prize wheel for instant picks.</div></div>
</div>

<h2>Provably fair</h2>
<p>Every draw generates a random seed and its SHA-256 hash. The hash is shown upfront — before winners are revealed — so you can verify the seed wasn't chosen after the fact. Anyone can check the result using a free online SHA-256 tool.</p>

<hr class="divider">
<p style="font-size:13px;color:#8a9ab8">drawr is an independent tool built for creators.</p>
"""
    return _page('About', body)


@app.route('/features')
def page_features():
    body = """
<div class="eyebrow">Features</div>
<h1>Everything you need for a fair draw</h1>
<p class="sub">drawr packs powerful giveaway tools into a clean, no-fuss interface.</p>

<h2>Multi-platform support</h2>
<p>Run giveaways across X (Twitter), YouTube, Kick live chat, or any custom list — all from one place.</p>

<h2>Provably fair randomization</h2>
<p>Results are generated using a seeded shuffle (SHA-256). The hash is published before the draw, so anyone can independently verify the outcome wasn't manipulated.</p>
<div style="margin:8px 0 20px">
  <span class="pill">&#10003; Seeded shuffle</span>
  <span class="pill">&#10003; SHA-256 verification</span>
  <span class="pill">&#10003; Shareable proof</span>
</div>

<h2>Account filters (X)</h2>
<p>Exclude low-quality entries before the draw with optional filters:</p>
<ul>
  <li>Minimum follower count</li>
  <li>Minimum account age (in days)</li>
  <li>Must have a custom profile picture</li>
</ul>

<h2>Follow verification (X)</h2>
<p>Optionally require that entrants follow the post author. drawr checks each eligible user's following list directly via the Twitter API.</p>

<h2>Reroll</h2>
<p>Not happy with a winner? Check the box next to any winner and reroll just those slots — the rest stay locked in.</p>

<h2>Shareable results</h2>
<p>Save any draw to a permanent link and share it with your audience. The results page includes winner profiles, criteria, and the full fairness proof.</p>

<h2>Keyword filtering (YouTube)</h2>
<p>Only draw from comments that contain a specific word or phrase — useful for "comment ENTER to win" style giveaways.</p>

<h2>Live Kick giveaways</h2>
<p>Connect to any Kick channel's live chat, collect entries by keyword in real time, and spin a winner with a slot-machine animation.</p>

<h2>Prize wheel</h2>
<p>Add any list of names — typed or pasted comma-separated — and spin a colourful prize wheel. Optional auto-removal keeps each spin drawing unique winners.</p>
"""
    return _page('Features', body)


@app.route('/privacy')
def page_privacy():
    body = """
<div class="eyebrow">Legal</div>
<h1>Privacy Policy</h1>
<p class="sub">Last updated: June 2, 2026</p>

<h2>Overview</h2>
<p>drawr ("we", "us", or "our") is committed to protecting your privacy. This policy explains what information we collect, how we use it, and your rights regarding that information.</p>

<h2>Information we collect</h2>
<p>drawr does not require account registration. We collect only what is necessary to operate the service:</p>
<ul>
  <li><strong>Draw data you submit:</strong> When you save a draw result, we store the winner list, entry criteria, and fairness proof in our database (Supabase). This data is associated with a random draw ID, not your identity.</li>
  <li><strong>Twitter/X data:</strong> When you run an X giveaway, drawr fetches public retweet and follower data from the Twitter API on your behalf. This data is processed in memory and not retained beyond the draw session, unless you choose to save the results.</li>
  <li><strong>YouTube data:</strong> Comments are fetched from public videos via the YouTube Comment Downloader. No YouTube account credentials are required or stored.</li>
  <li><strong>Kick data:</strong> Chat messages are received via Kick's public WebSocket API. No Kick credentials are required or stored.</li>
</ul>

<h2>Cookies and tracking</h2>
<p>drawr uses a single session cookie to maintain your Flask session. We do not use advertising cookies, third-party trackers, or analytics services.</p>

<h2>Data retention</h2>
<p>Saved draw results are stored indefinitely so shareable links remain valid. You can request deletion of any draw by contacting us with the draw ID.</p>

<h2>Third-party services</h2>
<p>We use Supabase to store draw results. Please refer to <a href="https://supabase.com/privacy">Supabase's privacy policy</a> for details on how they handle data.</p>

<h2>Children's privacy</h2>
<p>drawr is not directed at children under the age of 13. We do not knowingly collect personal information from children.</p>

<h2>Changes to this policy</h2>
<p>We may update this policy from time to time. Changes will be reflected on this page with an updated date.</p>

"""
    return _page('Privacy Policy', body)


@app.route('/terms')
def page_terms():
    body = """
<div class="eyebrow">Legal</div>
<h1>Terms of Service</h1>
<p class="sub">Last updated: June 2, 2026</p>

<h2>Acceptance of terms</h2>
<p>By using drawr ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, please do not use the Service.</p>

<h2>Use of the service</h2>
<p>You may use drawr to conduct giveaways, raffles, and similar selection events for lawful purposes. You agree not to:</p>
<ul>
  <li>Use the Service to violate any applicable law or regulation</li>
  <li>Abuse or overload Twitter, YouTube, or Kick APIs through the Service</li>
  <li>Attempt to manipulate draw outcomes or misrepresent results to participants</li>
  <li>Use the Service in a way that interferes with or disrupts its infrastructure</li>
</ul>

<h2>Third-party platforms</h2>
<p>drawr interacts with third-party APIs (Twitter/X, YouTube, Kick) on your behalf. You are responsible for ensuring your use of those platforms complies with their respective terms of service. drawr is not affiliated with, endorsed by, or sponsored by any of these platforms.</p>

<h2>Saved draw results</h2>
<p>When you save a draw, the results are stored and accessible via a shareable link. You are responsible for the content of draws you share publicly. drawr reserves the right to remove saved draws that violate these terms.</p>

<h2>No warranty</h2>
<p>The Service is provided "as is" without warranty of any kind, express or implied. We do not guarantee uninterrupted access, accuracy of third-party data, or fitness for any particular purpose.</p>

<h2>Limitation of liability</h2>
<p>To the fullest extent permitted by law, drawr shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service.</p>

<h2>Modifications</h2>
<p>We reserve the right to modify these terms at any time. Continued use of the Service after changes constitutes acceptance of the revised terms.</p>

"""
    return _page('Terms of Service', body)


@app.route('/api/pick', methods=['POST'])
def api_pick():
    data = request.get_json()
    tweet_url = (data.get('url') or '').strip()
    num_winners = max(1, int(data.get('num', 1)))
    require_retweet = bool(data.get('retweet', True))
    require_follow = bool(data.get('follow', False))
    try:
        min_followers = max(0, int(data.get('min_followers') or 0))
    except (TypeError, ValueError):
        min_followers = 0
    try:
        min_account_age_days = max(0, int(data.get('min_account_age_days') or 0))
    except (TypeError, ValueError):
        min_account_age_days = 0
    require_profile_pic = bool(data.get('require_profile_pic', False))

    if not tweet_url:
        return jsonify(error='Tweet URL is required.')
    has_req = require_retweet or require_follow
    if not has_req:
        return jsonify(error='Select at least one entry requirement.')

    try:
        result = asyncio.run(
            pick_winners_async(tweet_url, num_winners, require_retweet, require_follow,
                               min_followers=min_followers,
                               min_account_age_days=min_account_age_days,
                               require_profile_pic=require_profile_pic)
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


@app.route('/api/kick/chatroom')
def api_kick_chatroom():
    channel = (request.args.get('channel') or '').strip().lower()
    if not channel:
        return jsonify(error='Channel name is required.')
    try:
        r = req_lib.get(
            f'https://kick.com/api/v2/channels/{channel}',
            headers={
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout=10
        )
        if r.status_code == 404:
            return jsonify(error=f'Channel "{channel}" not found on Kick.')
        if not r.ok:
            return jsonify(error=f'Kick API returned {r.status_code}.')
        data = r.json()
        chatroom_id = (data.get('chatroom') or {}).get('id')
        if not chatroom_id:
            return jsonify(error='Could not find chatroom for this channel.')
        return jsonify(chatroomId=chatroom_id, channel=data.get('slug', channel))
    except Exception as e:
        return jsonify(error=f'Failed to look up channel: {e}'), 500


if __name__ == '__main__':
    if not os.path.exists(COOKIES_FILE):
        print("WARNING: No cookies.json found. Twitter features won't work.")
        print("Run 'python login.py' first to authenticate.")
    app.run(debug=True, port=5000)
