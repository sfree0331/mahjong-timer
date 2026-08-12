# 麻雀対局タイマー — システム設計書

## 1. 概要

競技麻雀・健康麻雀・セット麻雀向けの**持ち時間制対局タイマー** PWA。
チェスクロックのように各プレイヤーが独立した持ち時間バンクを持ち、手番の間だけ減少する。
対局中に片手で操作できることを最優先に設計する。

- 依存ライブラリ **ゼロ**（Vanilla JS / ES Modules）。ビルド工程なし、静的ホスティングのみで動作
- 完全オフライン動作（Service Worker によるアプリシェルキャッシュ）
- コアロジックは DOM 非依存の純粋モジュール → Node.js 単体でテスト可能

## 2. アーキテクチャ（MVVM）

```
┌─────────────────────────────────────────────┐
│ View 層（DOM 描画・入力のみ。ロジックなし）      │
│  BoardView / ControlsView / ModalsView       │
└──────────────┬──────────────────────────────┘
        subscribe(event, state) ↑   ↓ メソッド呼び出し
┌──────────────┴──────────────────────────────┐
│ ViewModel + Model（DOM 非依存・テスト対象）     │
│  GameStore … 状態の単一ソース + 全遷移ロジック   │
│  Ticker    … 実時間差分の供給（クロック注入可）   │
│  exporter  … CSV/JSON 変換・集計（純粋関数）    │
└──────────────┬──────────────────────────────┘
               ↓
┌──────────────┴──────────────────────────────┐
│ Service 層（ブラウザ API の薄いラッパ）          │
│  StorageService … localStorage 自動保存/復元   │
│  AudioService   … Web Audio 効果音合成         │
│  HapticsService … navigator.vibrate           │
└─────────────────────────────────────────────┘
```

原則:
- **状態の単一ソース**は `GameStore.state`。View は状態を持たず、毎回 state から描画する
- View → Store はメソッド呼び出し、Store → View は `subscribe(event, state, payload)` の一方向
- 効果音・バイブは Store のイベント（`call` / `warn10` / `timeout` …）を購読して発火。ロジックと演出を分離
- `app.js` は配線（wiring）のみを行い、ロジックを一切持たない

## 3. ディレクトリ構成

```
麻雀タイマー/
├── index.html              # 単一画面 + モーダル群
├── manifest.webmanifest    # PWA マニフェスト
├── sw.js                   # Service Worker（キャッシュ優先）
├── package.json            # npm test 用（依存なし）
├── css/
│   └── style.css           # Apple 風テーマ・ダークモード・横向き対応
├── js/
│   ├── app.js              # エントリポイント（配線のみ）
│   ├── core/               # ★ DOM 非依存・テスト対象
│   │   ├── store.js        # GameStore（状態 + 全ロジック）
│   │   ├── ticker.js       # タイマー刻み供給
│   │   └── exporter.js     # CSV/JSON/集計・時間フォーマット
│   ├── services/
│   │   ├── audio.js        # AudioService / HapticsService
│   │   └── storage.js      # StorageService / downloadText
│   └── views/
│       ├── boardView.js    # 卓 + プレイヤータイル
│       ├── controlsView.js # 和了/進行ボタンバー
│       └── modalsView.js   # 設定/保存ログ
├── icons/                  # 192/512/maskable/apple-touch
├── tests/                  # node:test（npm test）
└── docs/DESIGN.md          # 本書
```

## 4. データ構造

### GameStore.state

```js
{
  players: [                    // 添字 = 座席（0東 1南 2西 3北）
    {
      id: 0,
      name: "東",
      color: "#0A84FF",
      remainingMs: 600000,      // 残り持ち時間（局をまたいで持ち越し）
      handThinkMs: 0,           // 現在局の思考時間
      overtimeUsed: false,      // 切れ後の延長（1回）を使ったか
      warnStage: 0,             // 0通常 1→30秒警告済 2→10秒警告済 3→切れ
    }, ×4（3人打ち時は ×3）
  ],
  activeIndex: 0,               // 手番
  phase: "idle",                // 下記の状態機械を参照
  timeoutIndex: null,           // 時間切れしたプレイヤー
  handStartedAt: 1700…,         // 現在局の開始 epoch ms
  records: [HandRecord],        // 局ごとの確定記録（通し番号）
  settings: { timeMs, overtimeMs, sound, vibration, theme, fontScale },
}
```

局の概念（東1局・場風・局番号）は UI からもデータからも排除している（高速対局向け）。
記録は通し番号 `index` のみで識別する。

### HandRecord（ロン/ツモ/流局時に確定・エクスポート対象）

```js
{
  index: 1,                     // 通し番号（新しい対局でも継続）
  result: "ron" | "tsumo" | "ryukyoku",
  startedAt, endedAt,           // epoch ms
  avgThinkMs,                   // 人数平均の思考時間
  players: [{ name, thinkMs, remainingMs }, ×人数],
}
```

### Undo スナップショット（最大 20 件）

`{ activeIndex, phase, timeoutIndex, handStartedAt, recordsLen, players: [{remainingMs, handThinkMs, overtimeUsed, warnStage}] }`
`endHand()` の取り消しにも対応: `recordsLen` より records が伸びていれば末尾を切り捨てる
（誤タップで局を終了しても 1 タップで完全に戻せる）。

## 5. 状態管理設計（状態機械）

```
        start() / tapPlayer(i)
 idle ──────────► running ──── passTurn() / jumpTo(i) で手番移動
  ▲                │  ▲
  │        pause() │  │ resume() / tapPlayer(i)
  │                ▼  │
  │              paused ◄── tick() が延長も使い切った残 0 を検知（timeoutIndex 記録）
  │                │
  └── endHand(result) ← running/paused から可。即記録して idle へ（モーダルなし）
```

状態は idle / running / paused の 3 つだけ。`endHand()` はワンタップで
記録を確定して idle に戻るため、**次の局を間を置かず開始できる**（高速対局対応）。
保存確認はトースト表示＋卓中央の「記録 n局」で行う。

| phase | 意味 | tick で減る |
|---|---|---|
| idle | 局開始前。タイルタップで running へ | ✕ |
| running | 計測中 | 手番のみ ○ |
| paused | 一時停止（時間切れ含む） | ✕ |

### 3人打ち（サンマ）対応

- 人数は `state.players.length` から導出（`store.playerCount`）。別フラグは持たない
- `setPlayerCount(3|4)` で切替。タイマーは初期化するが**記録は残す**。
  3人化は `players.slice(0,3)`（北家を除去）、4人化はデフォルトの北家を追加
- 手番回転・平均思考時間は `playerCount` ベースで計算
- 北家スロットは `body[data-players="3"]` の CSS で非表示

### データ保持の方針

- `newGame()` … タイマー・延長・手番を初期化。**records はそのまま**（通し番号も継続）
- `clearRecords()` … 記録の全削除。保存ログ画面から明示的にのみ実行
- LocalStorage への自動保存は全操作で発火（500ms スロットル + pagehide 即時保存）

### 手番移動の設計（タップ = 移動）

専用の鳴きボタンは持たない。手番移動は 2 メソッドに集約:

| 操作 | メソッド | 動作 |
|---|---|---|
| 手番の人のタイル / 卓をタップ | `passTurn()` | 次の人へ送る（通常の打牌） |
| それ以外の人のタイルをタップ | `jumpTo(i)` | その人へ直接移動（**ポン・チー・カンはこれで表現**、記録なし） |

### 延長ルール（10分切れ → 3分）

- `tick()` が残り 0 を検知したとき、`overtimeUsed` が未使用かつ `settings.overtimeMs > 0` なら
  **残り時間を overtimeMs にリセットして続行**（`overtime` イベント発火・警告段階もリセット）
- 延長は 1 人 1 回。延長も使い切ると `timeout` で自動停止（以降その人の時間は減らない）
- 延長状態は局をまたいで持ち越し。持ち時間変更・対局リセットで解除

### 時間計測の正確性

- `Ticker` は 100ms 周期の `setInterval` だが、減算は**毎回 `performance.now()` との実差分**で行う
  → interval のブレ・バックグラウンド遅延があっても実経過時間と一致する
- 持ち時間制なのでバックグラウンド放置分もそのまま減る（意図的仕様）。一時停止はワンタップ

## 6. イベントフロー図

```
[ユーザー]                [View]              [GameStore]            [Services]
 タイル タップ ──────► onTileTap(i) ───► tapPlayer(i)
                                              │ emit("start"/"turn")
                                              ├────────────────► audio.turn()
                                              └────────────────► storage.save（500ms スロットル）
 卓タップ ──────────► onCenterTap ────► start/passTurn/resume
                                              │ emit("turn")
 （100ms ごと）        Ticker ─────────► tick(deltaMs)
                                              │ 閾値通過時 emit("overtime"/"warn30"/"warn10"/"timeout")
                                              └────────────────► audio.warn()/timeup()
 ロン押下 ─────────► onResult("ron") ─► endHand
                                              │ records 確定、emit("handEnd",{result,count})
                                              ├────────────────► audio.ron()
                                              └── トースト「✓ 記録しました」→ そのまま次局へ
```

## 7. UI デザイン

- **Apple 風**: 白ベース `#F7F7F9` / 面 `#FFFFFF`、影は `0 1px 3px 6%` のみ、角丸 14–22px、
  `-apple-system` フォント、`cubic-bezier(0.2,0.9,0.3,1)` のシート出現、`scale(0.96)` の押下感
- 卓（グリーンフェルト）を中央、北=上・西=左・東=右・南=下
- 手番タイルはプレイヤーカラーの **グロー**（box-shadow 2 重）+「計測中」バッジ点滅
- 残り 30 秒で黄色 / 10 秒で赤 / 0 秒で点滅（CSS class 切替のみ）
- ボタン最小 60px（`--tap-min`）、ダブルタップズーム抑止、`user-select:none`
- ダークモード: `data-theme` 属性 + CSS 変数。`auto` は `prefers-color-scheme` 追従
- 文字サイズ: `--fs` 変数（0.88 / 1 / 1.16）を全 font-size に乗算
- 横向き: `orientation:landscape` で操作バーを右カラム化（親指位置）

## 8. 実装ロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | コアロジック（GameStore/Ticker/exporter）+ テスト | ✅ |
| 2 | 盤面 UI・手番送り・警告色 | ✅ |
| 3 | 鳴き・和了・Undo・局管理 | ✅ |
| 4 | 設定・履歴・CSV/JSON 出力・自動保存 | ✅ |
| 5 | PWA（SW/manifest/アイコン）・効果音・バイブ | ✅ |
| 6 | リーチ管理・点数/供託/本場表示 | 拡張 |
| 7 | Bluetooth/フットスイッチ（Web Bluetooth / HID） | 拡張 |
| 8 | クラウド同期・複数端末同期・AI 分析 | 拡張 |

## 9. 将来拡張の設計余地

- **リーチ管理/点数/供託/本場**: `KyokuRecord` と `players[i]` にフィールド追加 + View 追加のみ。
  Store のイベント駆動構造は変更不要（`emit("riichi")` を足すだけで効果音・記録が接続できる）
- **物理ボタン**: 入力は全て `tapPlayer()` / `endHand()` 等のメソッド呼び出しに集約済みのため、
  Web Bluetooth / キーボードイベントをこれらへマップするアダプタを `services/` に足すだけ
- **クラウド同期**: `serialize()/hydrate()` が既に状態の完全なシリアライズ境界。
  StorageService と同じ購読口で fetch 送信するサービスを追加すればよい
- **AI 分析**: `records` の JSON エクスポートがそのまま分析入力になる

## 10. テスト方針

- `tests/store.test.mjs` … 状態機械・手番・鳴き・Undo・局管理・タイマー閾値・永続化（22 ケース）
- `tests/exporter.test.mjs` … 時間フォーマット・CSV エスケープ/BOM・JSON・集計（6 ケース）
- クロックは `now` 注入によりテスト内で決定論的に制御
- View 層はロジックを持たないため、ブラウザでの手動確認（+ 実機確認）を基本とする
