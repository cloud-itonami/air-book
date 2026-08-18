# air-book

**航空券の予約・発券（PNR 作成、予約確定、発券、座席指定、付帯サービス、取消、
リプロテクション、BSP 精算）を扱う appview。**

`etzhayyim/root` の `60-apps/etzhayyim-project-air-book` からの抽出物で、
**2026-08-18 に appview を TypeScript/Svelte から ClojureScript へ移行した**
（ADR-0001）。数字はすべて `scripts/verify-docs-claims.cljs` が tree から
再計算して検査する。

## deploy されるものは、いま読んでいるソースである

```
src/air_book/route.cljc    判断（どの handler が答えるか）  ← 純 .cljc、テスト対象
src/air_book/view.cljc     ページ（jp-go-dds の hiccup）    ← 純 .cljc、テスト対象
src/air_book/worker.cljs   Request/Response に触る唯一の層
        ↓ shadow-cljs :target :esm
dist/worker.js             ← wrangler.jsonc の "main" が指すもの
```

移行前は `main` が `svelte/.svelte-kit/cloudflare/_worker.js`（SvelteKit の
ビルド出力、**この tree に無い**）を指し、読み手が開く `src/app.ts` は
**どの bundle にも入っていなかった**（tree 全体を検索して app.ts への参照は
0 件）。いまは `main` が指す bundle が上のソースからコンパイルされたもの
なので、その形は構造的に起こり得ない。`scripts/verify-docs-claims.cljs` が
**shadow の出力先と wrangler の `main` と export の ns 名の 3 つが噛み合って
いること**を検査し、噛み合わなくなれば落ちる。

判断を `.cljc` に置いてあるのは、ブラウザもビルドも無しに検査するためであり、
ingress capability が qualify した時に **最初に `.kotoba` へ移る部分**だから
である（入口を当面 cljs に置くのは ADR-2606290000 の判断）。

## 公開ルート

| METHOD | PATH | 何をするか |
|---|---|---|
| GET | `/` | この appview の説明ページ |
| GET | `/health` | 生存確認。deploy された面が答えることを外から確かめられる |
| POST | `/xrpc/:nsid` | XRPC を MCP router へ中継する |
| OPTIONS | `/xrpc/*` | CORS preflight |

**この表の出所は `air-book.route/routes` で、ページもそこから描く。** 移行前の
ページは `Routes 0` と表示し「No public route is declared next to this app
surface」と書いていたが、同じディレクトリの `wrangler.jsonc` は route 2 本・
var 8 個を宣言していた。値が `+page.svelte` に literal で焼かれていたためで、
いまは route 表を渡す側が持ちページは描くだけなので、両者がずれる余地が無い。

`/health` は**移行が足した**経路である（移行前の deploy 面には無い）。
`/xrpc/a/b` のような多段パスは、移行前の rest parameter `[...path]` と同じく
**そのまま中継する** —— 空文字だけが 400。1 セグメントに絞るのは移行ではなく
方針変更なので、ここではしない。

## いま在るもの — 25 ファイル

| 面 | ファイル |
|---|---|
| 判断・描画・edge | `src/air_book/{route.cljc, view.cljc, worker.cljs}` |
| テスト | `test/air_book/route_test.cljc`（6 tests / 24 assertions） |
| ビルド | `deps.edn` / `shadow-cljs.edn` |
| Worker 設定 | `wrangler.jsonc` |
| actor 記述子 | `kotodama.jsonld` |
| domain library（**TypeScript のまま**） | `kotoba/`（7 ファイル） |
| 検証 | `scripts/{smoke-worker.cljs, verify-docs-claims.cljs}` |
| 由来・権利・識別 | `NOTICE` / `README.edn` / `migration.edn` / `MIGRATION-TODO.md` |
| 文書 | `README.md` / `docs/operator-quickstart.md` / `docs/adr/0001-*.edn` |

**appview の production TypeScript は 0 本、正本言語（`.cljs`/`.cljc`）が 4 本。**
移行前は 3 対 0 だった。この 2 つは検証器の claim なので、TS が戻れば落ちる ——
撤去した 9 パスに戻る場合（`removed-by-migration-absent`）も、別名で入る場合
（`appview-ts-files`）も、別々の claim が捕まえる。

### 残した TypeScript — `kotoba/`（意図的）

`kotoba/` は `@etzhayyim/sdk` を使う domain library（7 ファイル / 37,445 バイト、
うち `.ts` が 5 本）で、vitest のテストを持つ。**これは appview ではない**:
`wrangler.jsonc` の `main` が指す bundle に入らず（移行前も後も）、tree の外から
参照されず、tree の外を参照しない。移行の対象は appview なので**触っていない**
——撤去も移植もしていない。検証器は `kotoba/` の `.ts` をちょうど 5 本に固定
するので、ここが黙って増えれば落ちる。cljs/kotoba への移行は別の決定であり、
そのとき `@etzhayyim/sdk` の cljs 面が要る。

## UI

基盤は `kotoba-lang/jp-go-digital-design-system`（デジタル庁デザインシステム）。
色・寸法は `--hig-*` トークン契約だけで書き、raw hex も px フォントサイズも
置かない。app 固有 CSS は 3 行。CSS は外部リクエストゼロの方針どおり
`shadow.resource/inline` で bundle に焼く。

決定論的 audit（`kotoba-lang/design-quality`）で **100.00 / 100（gate 95）**。
**ただしこの点数は「design system が在る」ことを言わない** —— design system を
一切使わないページでも 96.63 を出して `--min 95` を通ることが実測されている。
「DADS が bundle に載っている」ことは smoke が `dads-table` class を直接見て
主張する（点数ではなく）。

ページは env の**キー**を出し、**値**は出さない —— ただし XRPC の中継先 URL
だけは意図的に出す（中継先が読めないページは、中継が壊れたときに何の助けにも
ならない）。検査は印を 2 つ独立に当てる: 出てはならない値と、出なければならない
キー。片方だけでは「全部隠す」も「全部出す」も通ってしまう。

## 呼び先が 1 つも解決しない（移行では直らない）

| ホスト | 役割 | dig +short（2026-08-18） |
|---|---|---|
| `air-book.etzhayyim.com` | 公開ホスト（wrangler の route） | **応答なし** |
| `a1rb00k1.etzhayyim.com` | 同（nanoid 側） | **応答なし** |
| `mcp.etzhayyim.com` | `/xrpc/:nsid` の中継先 | **応答なし** |
| `dispatcher.etzhayyim.com` | 旧 `src/app.ts` の中継先 | **応答なし** |

親ドメイン `etzhayyim.com` だけは解決する。deploy 先も中継先も、いま存在しない。
`/xrpc/` は到達できなければ **502 を返す** —— 成功と同じ形で隠さない。

## 持ち越さなかったもの（黙って消していない）

移行前の `src/app.ts` にあってどこにも deploy されていなかった経路は
**意図的に移していない**:

- 8 メソッド（`createPnr` / `confirmBooking` / `issueTicket` / `assignSeat` /
  `addAncillary` / `cancelBooking` / `reprotectPassenger` / `settleBsp`）の
  `dispatcher.etzhayyim.com` への中継 —— 宛先が解決せず、かつ読む binding
  （`DISPATCHER_URL` / `DISPATCHER_INTERNAL_SECRET`）が `wrangler.jsonc` に
  **宣言されていない**（vars 8 個のどれでもない）
- `/_app/meta`（同上の静的 JSON）

**動かない経路を移植して「移行済み」と言わないため**である。必要になった時点で
`route.cljc` に足し、テストと binding を伴って戻す。

## 残っている欠陥（移行では直っていない）

1. **4 ホストとも解決しない。** 移行はホストを立てない。deploy するか retire
   するかは別の決定。
2. **`MIGRATION-TODO.md` のチェックボックス 7 件が未チェック**のまま。憲章適合の
   手動レビューは未実施であると文書自身が書いている。
3. **`kotoba/` は TypeScript のまま**（上記）。

## 検証

```bash
npx --yes nbb scripts/verify-docs-claims.cljs .   # <dir> は先頭に置く
```

exit 0 = 全一致 / 1 = 食い違い / **2 = 判定できなかった**（0 と区別する）。
テストとビルドは `docs/operator-quickstart.md`。
