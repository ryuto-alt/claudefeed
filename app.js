// app.js — fetch news.json and render an X-style compact timeline.
const NEWS_URL = './data/news.json';

const SOURCE_LABEL = {
  anthropic: 'Anthropic',
  github: 'GitHub',
  hackernews: 'HN',
  reddit: 'Reddit',
};
const SOURCE_ICON = {
  anthropic: 'A',
  github: 'GH',
  hackernews: 'Y',
  reddit: 'R',
};

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffH = Math.floor(diffMs / 3600_000);
  if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / 60_000))}分前`;
  if (diffH < 24) return `${diffH}時間前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}日前`;
  return d.toISOString().slice(0, 10);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function makeCard(item) {
  const meta = el('div', { class: 'card-meta' }, [
    el('span', { class: `source source-${item.source}`, text: SOURCE_ICON[item.source] || '?' }),
    el('span', { class: 'source-name', text: SOURCE_LABEL[item.source] || item.source }),
    el('span', { class: 'dot', text: '·' }),
    el('span', { class: 'date', text: fmtDate(item.published_at) }),
    el('span', { class: 'spacer' }),
    el('span', { class: 'score', title: 'AIスコア', text: String(item.score ?? '') }),
  ]);

  const title = el('a', {
    class: 'title',
    href: item.url,
    target: '_blank',
    rel: 'noopener noreferrer',
    text: item.title,
  });

  const summary = item.summary_oneline
    ? el('p', { class: 'summary', text: item.summary_oneline })
    : null;

  const tags = (item.tags && item.tags.length)
    ? el('div', { class: 'tags' }, item.tags.map(t => el('span', { class: 'tag', text: '#' + t })))
    : null;

  return el('article', { class: 'card' }, [meta, title, summary, tags]);
}

function render(container, items) {
  for (const item of items) container.appendChild(makeCard(item));
}

function showDialog(data) {
  const dialog = document.getElementById('extras-dialog');
  const msg = document.getElementById('dialog-msg');
  msg.textContent = `今日はさらに ${data.extras.length} 件あります。見ますか？`;
  dialog.classList.remove('hidden');

  document.getElementById('skip-extras').onclick = () => {
    localStorage.setItem(`extras_decision_${data.date}`, 'skip');
    dialog.classList.add('hidden');
  };
  document.getElementById('show-extras').onclick = () => {
    localStorage.setItem(`extras_decision_${data.date}`, 'show');
    dialog.classList.add('hidden');
    appendExtras(data);
  };
}

function appendExtras(data) {
  const tl = document.getElementById('timeline');
  const sep = el('div', { class: 'extras-sep', text: `— ここから extras (${data.extras.length}) —` });
  tl.appendChild(sep);
  render(tl, data.extras);
  document.getElementById('show-extras-btn').classList.add('hidden');
}

async function init() {
  const tl = document.getElementById('timeline');
  const meta = document.getElementById('meta');

  let data;
  try {
    const res = await fetch(NEWS_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`news.json ${res.status}`);
    data = await res.json();
  } catch (e) {
    meta.textContent = `読み込み失敗: ${e.message}`;
    return;
  }

  meta.textContent = `${data.date} · ${data.top.length}件` + (data.extras?.length ? ` (+${data.extras.length})` : '');

  render(tl, data.top);

  if (data.extras && data.extras.length > 0) {
    const decided = localStorage.getItem(`extras_decision_${data.date}`);
    if (decided === 'show') {
      appendExtras(data);
    } else if (decided === 'skip') {
      const btn = document.getElementById('show-extras-btn');
      btn.classList.remove('hidden');
      btn.textContent = `やっぱり残り ${data.extras.length} 件を見る`;
      btn.onclick = () => {
        localStorage.setItem(`extras_decision_${data.date}`, 'show');
        appendExtras(data);
      };
    } else {
      showDialog(data);
    }
  }
}

init();
