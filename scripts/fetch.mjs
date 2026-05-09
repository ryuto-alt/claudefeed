// fetch.mjs — collect news candidates from public sources, no AI involved.
// Output: tmp/candidates.json with up to MAX_CANDIDATES items.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp');
const MAX_CANDIDATES = 100;
const UA = 'ClaudeFeed/0.1 (+https://github.com/)';

async function getHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}
async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const norm = (u) => { try { const x = new URL(u); x.hash = ''; x.search = ''; return x.toString(); } catch { return u; } };

function cleanAnthropicTitle(raw, slug) {
  let s = raw.trim().replace(/\s+/g, ' ');
  // strip leading category label
  s = s.replace(/^(Product|Announcements?|Research|Policy|Engineering|Society|Education|Customers|Interpretability|Alignment|Featured|Labs|News)\s*/i, '');
  // strip "Mon DD, YYYY" date prefix
  s = s.replace(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*\d{1,2},?\s*\d{4}\s*/i, '');
  // sometimes date comes BEFORE category: "May 6, 2026Announcements..."
  s = s.replace(/^(Product|Announcements?|Research|Policy|Engineering|Society|Education|Customers|Interpretability|Alignment|Featured|Labs|News)\s*/i, '');
  // mid-string boundary: "Title<Category><Date>Description" → keep Title
  const CAT = '(?:Product|Announcements?|Research|Policy|Engineering|Society|Education|Customers|Interpretability|Alignment|Featured|Labs|News)';
  const MON = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const mid = s.match(new RegExp(`^(.+?)${CAT}${MON}`));
  if (mid && mid[1].length >= 8) s = mid[1].trim();
  // truncate at sentence boundary: ". " + uppercase = description start (don't break "4.7")
  const breakIdx = s.search(/[.!?]\s+[A-Z]/);
  if (breakIdx > 8) s = s.slice(0, breakIdx + 1);
  // hard cap
  if (s.length > 140) s = s.slice(0, 140).trim() + '…';
  // fallback to slug if cleanup left nothing useful
  if (!s || s.length < 6) {
    s = slug.replace(/^\/news\//, '').replace(/-/g, ' ').trim();
  }
  return s;
}

async function fetchAnthropicNews() {
  const out = [];
  const html = await getHtml('https://www.anthropic.com/news');
  const $ = cheerio.load(html);
  $('a').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!/^\/news\/[^?#]+/.test(href)) return;
    const raw = $(a).text().trim().replace(/\s+/g, ' ');
    if (!raw || raw.length < 8) return;
    const title = cleanAnthropicTitle(raw, href);
    const url = new URL(href, 'https://www.anthropic.com').toString();
    out.push({
      id: `anthropic-${slug(title)}`,
      source: 'anthropic',
      title,
      url: norm(url),
      content_snippet: raw.slice(0, 240),
      published_at: null,
    });
  });
  return dedupeBy(out, (x) => x.url).slice(0, 30);
}

async function fetchClaudeCodeReleases() {
  const data = await getJson('https://api.github.com/repos/anthropics/claude-code/releases?per_page=10');
  return (Array.isArray(data) ? data : []).map((r) => ({
    id: `cc-release-${r.id}`,
    source: 'anthropic',
    title: `Claude Code ${r.tag_name || r.name}`,
    url: r.html_url,
    content_snippet: (r.body || '').slice(0, 400),
    published_at: r.published_at,
  }));
}

async function fetchGithubTrending() {
  const out = [];
  const html = await getHtml('https://github.com/trending?since=daily');
  const $ = cheerio.load(html);
  $('article.Box-row').each((_, el) => {
    const a = $(el).find('h2 a').first();
    const repo = a.attr('href')?.replace(/^\//, '') || '';
    if (!repo) return;
    const desc = $(el).find('p').first().text().trim().replace(/\s+/g, ' ');
    out.push({
      id: `gh-trending-${slug(repo)}`,
      source: 'github',
      title: repo,
      url: `https://github.com/${repo}`,
      content_snippet: desc,
      published_at: null,
    });
  });
  return out.slice(0, 25);
}

async function fetchGithubClaudeTopic() {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  const topics = ['claude-code', 'mcp', 'claude'];
  const out = [];
  for (const topic of topics) {
    const q = encodeURIComponent(`topic:${topic} pushed:>${since}`);
    try {
      const data = await getJson(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=5`);
      for (const r of data.items || []) {
        out.push({
          id: `gh-topic-${r.id}`,
          source: 'github',
          title: r.full_name,
          url: r.html_url,
          content_snippet: (r.description || '') + ` ★${r.stargazers_count}`,
          published_at: r.pushed_at,
        });
      }
    } catch (e) { console.error('gh-topic fail:', topic, e.message); }
  }
  return dedupeBy(out, (x) => x.id);
}

async function fetchHN() {
  const queries = ['claude code', 'anthropic', 'mcp protocol', 'claude skills'];
  const cutoff = Math.floor((Date.now() - 7 * 86400_000) / 1000);
  const out = [];
  for (const q of queries) {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${cutoff}&hitsPerPage=10`;
    try {
      const data = await getJson(url);
      for (const h of data.hits || []) {
        if (!h.url && !h.story_text) continue;
        out.push({
          id: `hn-${h.objectID}`,
          source: 'hackernews',
          title: h.title || h.story_title || '',
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          content_snippet: `points:${h.points} comments:${h.num_comments}`,
          published_at: h.created_at,
        });
      }
    } catch (e) { console.error('HN fail:', q, e.message); }
  }
  return dedupeBy(out, (x) => x.id);
}

async function fetchReddit() {
  const subs = ['ClaudeAI', 'LocalLLaMA'];
  const out = [];
  for (const sub of subs) {
    try {
      const data = await getJson(`https://www.reddit.com/r/${sub}/top/.json?t=day&limit=20`);
      for (const c of data?.data?.children || []) {
        const p = c.data;
        if (p.over_18 || p.stickied) continue;
        out.push({
          id: `reddit-${p.id}`,
          source: 'reddit',
          title: p.title,
          url: p.url_overridden_by_dest || `https://www.reddit.com${p.permalink}`,
          content_snippet: `r/${sub} ↑${p.ups} \u{1F4AC}${p.num_comments}`,
          published_at: new Date((p.created_utc || 0) * 1000).toISOString(),
        });
      }
    } catch (e) { console.error('Reddit fail:', sub, e.message); }
  }
  return out;
}

function dedupeBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

async function safe(name, fn) {
  try {
    const out = await fn();
    console.error(`ok ${name}: ${out.length} items`);
    return out;
  } catch (e) {
    console.error(`fail ${name}: ${e.message}`);
    return [];
  }
}

async function main() {
  await fs.mkdir(TMP, { recursive: true });
  const groups = await Promise.all([
    safe('anthropic-news', fetchAnthropicNews),
    safe('claude-code-releases', fetchClaudeCodeReleases),
    safe('github-trending', fetchGithubTrending),
    safe('github-claude-topic', fetchGithubClaudeTopic),
    safe('hackernews', fetchHN),
    safe('reddit', fetchReddit),
  ]);
  const all = dedupeBy(groups.flat(), (x) => norm(x.url));
  if (all.length === 0) {
    console.error('all sources empty — bailing');
    process.exit(1);
  }
  const trimmed = all.slice(0, MAX_CANDIDATES);
  await fs.writeFile(path.join(TMP, 'candidates.json'), JSON.stringify({
    fetched_at: new Date().toISOString(),
    count: trimmed.length,
    items: trimmed,
  }, null, 2));
  console.error(`-> tmp/candidates.json (${trimmed.length} items)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
