// data.jsx — mock pools + winner generators for the prototype.

const FIRST = ['Maya','Leo','Aria','Noah','Zoe','Kai','Ivy','Eli','Nina','Omar',
  'Luca','Sana','Theo','Remy','Cora','Finn','Aria','Jude','Lena','Cyrus',
  'Priya','Marco','Yuki','Dario','Elsa','Tariq','Mira','Sven','Aisha','Bruno'];
const LAST = ['Rivera','Okafor','Lindqvist','Tanaka','Mendez','Brooks','Haddad','Novak',
  'Castro','Bauer','Singh','Moreau','Kowalski','Reyes','Fischer','Dlamini',
  'Romano','Petrov','Andersson','Cohen','Nakamura','Vargas','Khan','Lund'];

const WORDS = ['count me in','done all three','huge fan of this','retweeted + following',
  'this is awesome','fingers crossed','love the content','entered, good luck everyone',
  'subscribed and liked','been waiting for this','my dream prize','shared with friends too',
  'first time entering!','let\u2019s gooo','hope I win this one','great giveaway as always'];

const TIMES = ['2 hours ago','5 hours ago','1 day ago','3 days ago','6 hours ago',
  '12 hours ago','2 days ago','40 minutes ago','4 days ago','8 hours ago'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function handleFrom(name) {
  const base = name.toLowerCase().replace(/[^a-z]/g, '');
  const suffixes = ['', '_', '.dev', 'x', '_io', '0' + Math.floor(Math.random()*90+10), 'hq'];
  return base + pick(suffixes);
}

// Returns n unique twitter winners.
function makeTwitterWinners(n, seedExclude = []) {
  const used = new Set(seedExclude);
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < 400) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const username = handleFrom(name) + (Math.random() < .3 ? Math.floor(Math.random()*99) : '');
    if (used.has(username)) continue;
    used.add(username);
    out.push({ id: username, name, username });
  }
  return out;
}

// Returns n unique youtube winners.
function makeYoutubeWinners(n, keyword = '', seedExclude = []) {
  const used = new Set(seedExclude);
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < 400) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const author = name;
    if (used.has(author)) continue;
    used.add(author);
    let text = pick(WORDS);
    if (keyword) text = `${text} ${keyword}`;
    out.push({
      id: author + Math.random().toString(36).slice(2, 6),
      author,
      text: text.charAt(0).toUpperCase() + text.slice(1),
      time: pick(TIMES),
      votes: Math.floor(Math.random() * 240),
    });
  }
  return out;
}

window.makeTwitterWinners = makeTwitterWinners;
window.makeYoutubeWinners = makeYoutubeWinners;
