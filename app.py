import os
import json
import base64
import asyncio
from random import shuffle
from itertools import islice
from flask import Flask, request, session, send_from_directory, jsonify
from dotenv import load_dotenv
from twikit import Client
import twikit.user
import twikit.guest.user
from twikit.x_client_transaction import ClientTransaction
from youtube_comment_downloader import YoutubeCommentDownloader, SORT_BY_RECENT

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
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


async def fetch_all_users(fetch_func, tweet_id, max_pages=10):
    users = []
    result = await fetch_func(tweet_id, count=100)
    for user in result:
        users.append({'id': user.id, 'username': user.screen_name, 'name': user.name})
    pages = 1
    while pages < max_pages:
        try:
            result = await result.next()
            if not result:
                break
            for user in result:
                users.append({'id': user.id, 'username': user.screen_name, 'name': user.name})
            pages += 1
        except Exception:
            break
    return users


async def fetch_follower_ids(client, screen_name, max_pages=20):
    """Fetch follower IDs via GraphQL (cookie-auth friendly)."""
    ids = set()
    error = None
    try:
        author = await client.get_user_by_screen_name(screen_name)
        result = await author.get_followers(count=200)
        for user in result:
            ids.add(str(user.id))
        pages = 1
        while pages < max_pages:
            try:
                result = await result.next()
                if not result:
                    break
                for user in result:
                    ids.add(str(user.id))
                pages += 1
            except Exception:
                break
    except Exception as e:
        error = str(e)
    return ids, error


async def pick_winners_async(tweet_url, num_winners, require_retweet, require_follow):
    tweet_id, author_username = parse_tweet_url(tweet_url)
    client = make_client()

    retweeters = []
    if require_retweet:
        retweeters = await fetch_all_users(client.get_retweeters, tweet_id)

    if not retweeters:
        raise ValueError('No participants found. Make sure the tweet has retweets.')

    num_retweeters = len(retweeters)
    shuffle(retweeters)

    errors = []
    if require_follow and author_username:
        follower_ids, fid_error = await fetch_follower_ids(client, author_username)
        errors.append(f'[debug] follower_ids fetched: {len(follower_ids)}, error: {fid_error}, sample retweeter id: {retweeters[0]["id"] if retweeters else "none"}, in_followers: {str(retweeters[0]["id"]) in follower_ids if retweeters else "n/a"}')
        if follower_ids:
            retweeters = [u for u in retweeters if str(u['id']) in follower_ids]
        else:
            errors.append('Could not fetch follower list — showing all retweeters.')

    winners = retweeters[:num_winners]
    remaining = retweeters[num_winners:]

    return {
        'winners': winners,
        'remaining': remaining,
        'eligible': len(retweeters),
        'retweeters': num_retweeters,
        'author': author_username,
        'errors': errors,
    }


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
    if not require_retweet:
        return jsonify(error='Retweet requirement must be selected.')

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

    shuffle(unique)
    winners = [format_comment(c) for c in unique[:num_winners]]
    remaining = [format_comment(c) for c in unique[num_winners:]]

    return jsonify(winners=winners, remaining=remaining, commenters=len(unique), keyword=keyword)


def _do_reroll(current_winners, remaining, reroll_ids):
    shuffle(remaining)
    pool = list(remaining)
    updated = []
    for w in current_winners:
        if w['id'] in reroll_ids and pool:
            updated.append(pool.pop(0))
        else:
            updated.append(w)
    return updated, pool


@app.route('/api/youtube/reroll', methods=['POST'])
def api_youtube_reroll():
    data = request.get_json()
    reroll_ids = set(data.get('reroll_ids', []))
    current_winners = data.get('winners', [])
    remaining = data.get('remaining', [])
    updated, pool = _do_reroll(current_winners, remaining, reroll_ids)
    return jsonify(winners=updated, remaining=pool)


@app.route('/api/twitter/reroll', methods=['POST'])
def api_twitter_reroll():
    data = request.get_json()
    reroll_ids = set(data.get('reroll_ids', []))
    current_winners = data.get('winners', [])
    remaining = data.get('remaining', [])
    updated, pool = _do_reroll(current_winners, remaining, reroll_ids)
    return jsonify(winners=updated, remaining=pool)


if __name__ == '__main__':
    if not os.path.exists(COOKIES_FILE):
        print("WARNING: No cookies.json found. Twitter features won't work.")
        print("Run 'python login.py' first to authenticate.")
    app.run(debug=True, port=5000)
