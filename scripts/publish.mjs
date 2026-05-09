// publish.mjs — read tmp/scored.json, write data/news.json, optional git commit/push.
// Skips commit if content equals the existing data/news.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp', 'scored.json');
const OUT = path.join(ROOT, 'data', 'news.json');

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' });
}

function ymd(d = new Date()) {
  const off = -d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() + off).toISOString().slice(0, 10);
}

async function main() {
  const scored = JSON.parse(await fs.readFile(TMP, 'utf8'));

  const top = (scored.top || []).slice(0, 20);
  const extras = scored.extras || [];

  const payload = {
    date: scored.date || ymd(),
    generated_at: new Date().toISOString(),
    top,
    extras,
  };

  let prev = null;
  try { prev = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}

  const sameContent = prev
    && prev.date === payload.date
    && JSON.stringify(prev.top) === JSON.stringify(payload.top)
    && JSON.stringify(prev.extras) === JSON.stringify(payload.extras);

  if (sameContent) {
    console.error('no change - skipping write');
    return;
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.error(`wrote ${OUT} (top:${top.length}, extras:${extras.length})`);

  if (process.env.CLAUDEFEED_NO_GIT === '1') {
    console.error('CLAUDEFEED_NO_GIT=1 - skipping git');
    return;
  }
  try {
    git('add data/news.json');
    const status = git('status --porcelain data/news.json').trim();
    if (!status) { console.error('git: nothing to commit'); return; }
    git(`commit -m "feed: ${payload.date}"`);
    try { git('push'); console.error('git: pushed'); }
    catch (e) { console.error('git push failed:', e.message); }
  } catch (e) {
    console.error('git operation failed:', e.message);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
