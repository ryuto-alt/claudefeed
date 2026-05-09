# ClaudeFeed

Claude Code 中心ユーザー向けの、毎日最大20件の AI/Anthropic/GitHub ニュースを **X風タイムライン** で表示する個人サイト。

- 月額コスト: **$0**（Anthropic Max Plan + GitHub Pages のみ）
- 自動実行: Claude Code の `/schedule` で毎朝7時 (JST)
- AI採点: スケジュール agent 自身が tmp/candidates.json を読んでスコアを付ける（API課金ゼロ）

## 構成

```
claudefeed/
├── index.html / app.js / style.css   # GitHub Pages 配信
├── data/news.json                    # 毎朝 agent が更新
├── scripts/
│   ├── fetch.mjs                     # 6ソースから候補取得
│   └── publish.mjs                   # news.json 書込 + git push
├── tmp/                              # candidates.json / scored.json (gitignore)
└── docs/superpowers/specs/           # 設計仕様
```

## ローカルで試す

```bash
npm install
node scripts/fetch.mjs                    # tmp/candidates.json を作る
# (ここで採点 → tmp/scored.json を手書き or Claude Code で生成)
CLAUDEFEED_NO_GIT=1 node scripts/publish.mjs   # data/news.json に書く
npx serve .                               # http://localhost:3000
```

## デプロイ（GitHub Pages）

1. このディレクトリを GitHub の **public repo** に push
2. リポジトリ Settings → Pages → Source: `Deploy from a branch` → `main / (root)`
3. URL は `https://<username>.github.io/claudefeed/`

## 自動実行のセットアップ — `/schedule`

Claude Code を起動して以下を実行（一度だけ）:

```
/schedule
```

cron に `0 22 * * *`（UTC = 07:00 JST）、プロンプトに **下の "Schedule Prompt"** を貼り付ける。

### Schedule Prompt

```
You are the daily news fetcher for ClaudeFeed (https://github.com/<USER>/claudefeed).

Steps:
1. Clone or pull the claudefeed repo into the working directory.
2. Run: npm install --omit=dev
3. Run: node scripts/fetch.mjs
4. Read tmp/candidates.json. Score each item 0-100 with these weights:
   - Claude Code official / release notes: x1.0  (target 80-100)
   - MCP / Skills / Agent SDK / Hooks news: x0.95
   - Practical Claude Code tips & tutorials: x0.85
   - General LLM / AI news, hot OSS: x0.55
   - FX automation / Minecraft AI / Web automation / personal interests: x0.45
     (raise to x0.8 if it intersects with Claude Code)
   - Promotional, duplicate, low-substance: large penalty
5. For each candidate, write { id, source, title, url, score, summary_oneline, tags, published_at }.
   - summary_oneline: <=80 Japanese characters, neutral tone, no marketing speak.
   - tags: up to 3 short tags (lowercase, hyphenated).
6. Sort by score desc. Take top 20 -> "top". Remaining items with score >= 60 -> "extras".
7. Write tmp/scored.json with shape { "date": "YYYY-MM-DD (JST)", "top": [...], "extras": [...] }.
8. Run: node scripts/publish.mjs
   This writes data/news.json and pushes to origin/main.
9. Done. Report: counts, any source failures, any errors.

Constraints:
- Use only Read, Write, Edit, Bash. No external API calls beyond what scripts already do.
- If fetch.mjs returns < 5 items total, abort and report — likely a source outage.
- Never commit anything outside data/news.json.
```

## 仕組みのサマリ

- **ニュース源（無料・APIキー不要）:**
  Anthropic news / Claude Code GitHub Releases / GitHub Trending / GitHub topic検索 / Hacker News (Algolia) / Reddit r/ClaudeAI, r/LocalLLaMA
- **20件超のとき:** ブラウザを開いた瞬間、中央ダイアログ「今日はやめとく / 見てみる」。選択は `localStorage` に当日キーで保存。
- **AI採点:** Anthropic API は呼ばない。`/schedule` の agent セッション自体が Max Plan 内で採点する。

## ライセンス

個人用。元記事の著作権は各発信者に帰属。
