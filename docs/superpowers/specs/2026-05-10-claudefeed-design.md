# ClaudeFeed — 設計仕様

**日付:** 2026-05-10
**目的:** Claude Code を中心に使うユーザー向けに、AI/Anthropic/GitHub の有益情報を毎日最大20件、X風タイムラインで配信する個人用ニュースサイト。

## 1. ゴール

- 1日に取り込む量を **最大20件** に制限し、情報過多による疲労を防ぐ
- 採点軸を **Claude Code 実務 最優先** に固定し、ノイズを下げる
- 月額コスト **$0**（Anthropic Max Plan 枠内 + 無料サービスのみ）
- 操作はクリックだけ。ダッシュボードや設定画面は作らない

## 2. アーキテクチャ

```
[Anthropic /schedule cron 22:00 UTC = 07:00 JST]
        ↓
[Claude Code agent (リモート) が claudefeed repo 内で実行]
        ↓
   node scripts/fetch.mjs
   ├── Anthropic news / engineering blog (HTMLスクレイプ)
   ├── docs.claude.com release notes (HTMLスクレイプ)
   ├── github.com/anthropics/claude-code/releases (GitHub API)
   ├── github.com/trending (HTMLスクレイプ)
   ├── HN Algolia API (claude / anthropic / mcp 検索)
   └── Reddit r/ClaudeAI, r/LocalLLaMA (.json エンドポイント)
        ↓ tmp/candidates.json
[Agent が直接読んで採点 (別途AI呼び出しは不要)]
        ↓ tmp/scored.json
   node scripts/publish.mjs
   ├── data/news.json を書き換え
   └── git add / commit / push
        ↓
[GitHub Pages が静的サイトとして公開]
        ↓
[ユーザー: ブラウザで news.json を fetch → X風タイムライン]
```

## 3. コンポーネント

### 3.1 `scripts/fetch.mjs`
- ニュース源を並列フェッチして候補を集約
- 出力: `tmp/candidates.json` に最大100件
- 各件: `{ id, source, title, url, content_snippet, published_at }`
- ネットワーク失敗は単一ソース単位でスキップ。全部落ちた場合は exit 1。
- 依存: `cheerio` のみ

### 3.2 採点（agent 自身が実行）
- `tmp/candidates.json` を Read
- 重み:
  - Claude Code 公式・リリース系: ×1.0
  - MCP / Skills / Agent SDK / Hooks: ×0.95
  - Claude Code 実務Tips・記事: ×0.85
  - LLM一般・GitHub話題OSS: ×0.55
  - FX自動化・Minecraft AI・Web自動化など個人興味: ×0.45（Claude Code絡みで×0.8まで）
  - 重複・宣伝色強・薄い記事: 大幅減点
- スコア降順で上位20件 = `top`、残りで60点以上 = `extras`
- 各件に `summary_oneline`（80字以内・日本語）と `tags`（最大3個）を付与
- 出力: `tmp/scored.json` の形 `{ date, top, extras }`

### 3.3 `scripts/publish.mjs`
- `tmp/scored.json` を Read
- `data/news.json` に書き出し（整形JSON）
- `git add data/news.json && git commit -m "feed: YYYY-MM-DD" && git push`
- 既に当日分が同内容ならコミットしない（noop）

### 3.4 静的フロントエンド（`index.html` + `app.js` + `style.css`）
- `./data/news.json` を fetch
- 1カード = アイコン + ソース名 + 日付 + タイトル + AI一行要約 + スコア + タグ
- カードクリック → 元ソースを新規タブで開く
- `extras.length > 0` のとき、当日 localStorage に判断未保存なら中央ダイアログ:
  - 「今日はさらに N 件あります。見ますか？」
  - ボタン: 「今日はやめとく」「見てみる」
  - 選択は `extras_decision_<date>` キーで保存

## 4. データ形状（`data/news.json`）

```json
{
  "date": "2026-05-10",
  "generated_at": "2026-05-10T07:00:12+09:00",
  "top": [
    {
      "id": "anthropic-news-abc123",
      "source": "anthropic",
      "title": "...",
      "url": "...",
      "summary_oneline": "...",
      "score": 92,
      "tags": ["claude-code", "skills"],
      "published_at": "2026-05-09T18:00:00Z"
    }
  ],
  "extras": []
}
```

## 5. 自動実行（`/schedule`）

ユーザーは Claude Code 内で1回だけ次を実行する:

```
/schedule
プロンプト: README.md の "Schedule Prompt" セクションの内容
cron: 0 22 * * *  (UTC = 07:00 JST)
```

## 6. コスト

| 項目 | 月額 |
|---|---|
| `/schedule` 実行（Max Plan 枠内） | $0 |
| GitHub public repo + Pages | $0 |
| RSS / GitHub API / HN / Reddit | $0 |
| **合計** | **$0** |

予算 $20 は将来の OG画像CDN・カスタムドメイン・フォールバックHaiku API 用の予備。

## 7. 非ゴール（YAGNI）

- ユーザー認証・複数ユーザー対応
- ダッシュボード・グラフ・統計
- 検索機能・カテゴリフィルタUI
- プッシュ通知
- 過去ログ閲覧（当日分のみ表示）
- X 連携（API高額のため除外）

## 8. リスクと対策

| リスク | 対策 |
|---|---|
| ソースHTMLが変わって fetch 失敗 | ソース単位の `try/catch`。一部失敗でも残りで続行 |
| `/schedule` agent が長時間化 | フェッチ100件上限、採点はバッチ1回で完結 |
| 同一記事の重複 | URL正規化と title 類似度で重複排除 |
| public repo に個人興味が露出 | 公開情報のみ扱う。気になればプライベート + Cloudflare Pages に移行可 |
