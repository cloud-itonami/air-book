# operator-quickstart

**この repo で今日実際にできることを、踏める形で上から書く。** 所要 5 分。
Cloudflare のアカウントは要らない（§5 の deploy だけが要る）。

出力はすべて実際に walk した結果である（2026-08-18）。

## 0. 前提

| 要るもの | 確認 | この walk で使った版 |
|---|---|---|
| git | `git --version` | 2.51.0 |
| nbb | `npx --yes nbb --version` | v1.4.208 |
| clojure | `clojure --version` | ビルド時のみ |

## 1. 取得して、書いてあることが本当か検査する

```bash
git clone git@github.com:cloud-itonami/air-book.git
cd air-book
REPO=$PWD
npx --yes nbb scripts/verify-docs-claims.cljs .
```

末尾が `OK` なら README の数値・存在・不在は tree と一致している。
**exit 2（UNDETERMINED）は 0 ではない** —— tree を読み切れなかったという別の
答えで、「検査して問題なし」と混ぜない。

この検査には移行の不変条件が入っている: appview の TypeScript が戻っていない
こと（撤去した 9 パスの不在 + `.ts` の総数）、`kotoba/` の TypeScript が
**増えていない**こと、`wrangler.jsonc` の `main` が shadow の出力先を指している
こと、`:warnings-as-errors` が `:compiler-options` の中に在ること（`grep` では
なく EDN として読んで位置を見る）、ページが route 表から描かれていること。

実際の出力（末尾）:

```
PASS	page-renders-route-table	expected=true	actual=true
OK	every claim in README.md and docs/operator-quickstart.md holds
```

## 2. テストを走らせる（ビルド不要・ブラウザ不要）

判断（`route.cljc`）と描画（`view.cljc`）は純 `.cljc` なので、nbb だけで回る。

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:test:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/run.cljs <<'EOF'
(require '[cljs.test :refer [run-tests]] 'air-book.route-test)
(run-tests 'air-book.route-test)
EOF
npx --yes nbb --classpath "$CP" /tmp/run.cljs
```

実際の出力:

```
Testing air-book.route-test

Ran 6 tests containing 24 assertions.
0 failures, 0 errors.
```

何を固定しているか: `/xrpc/` は**空の nsid だけ** 400 にする（`/xrpc/a/b` は
移行前の rest parameter `[...path]` と同じく転送する。1 セグメントに絞るのは
移行ではなく方針変更）、MCP router の URL 解決（空白だけの設定は未設定として
扱う）、`result` / `structuredContent` の剥がし方、**ページが route 表から
描かれること**（固定値を焼いていたら落ちる）、そして**キーは出て値は出ない
こと**（印を 2 つ独立に当てる）。

## 3. ページを描画して採点する

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/render.cljs <<'EOF'
(require '["node:fs" :as fs] '[air-book.view :as view] '[air-book.route :as route])
(let [css (.readFileSync fs (str (.-DDS js/process.env) "/resources/jp_go_dds/dds.css") "utf8")]
  (.writeFileSync fs "/tmp/ab-page.html"
    (view/render {:css css :routes route/routes
                  :vars [:AGENTGATEWAY_MCP_ROUTER_URL :APP_CAPABILITIES :APP_DESCRIPTION
                         :APP_DISPLAY_NAME :APP_FRAMEWORK :APP_NANOID
                         :APP_PERFORMER_TYPE :APP_UI_TYPE]
                  :mcp-url "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}))
  (println "ok"))
EOF
DDS="$K/jp-go-digital-design-system" npx --yes nbb --classpath "$CP" /tmp/render.cljs

cd $K/design-quality && npx --yes nbb -m design-quality.cli score /tmp/ab-page.html --min 95
```

実際の出力（末尾）:

```
  100.00  /tmp/ab-page.html
aggregate: 100.00
gate: aggregate 100.00 >= min 95.00 -> PASS
```

**この点数は「design system が在る」ことを言わない。** 実測では design system を
一切使わないページでも 96.63 を出して `--min 95` を通る。DADS が bundle に載って
いることは §4.5 の smoke が `dads-table` class を直接見て主張する。

## 4. bundle をビルドする

**高負荷ビルドは同時 1 本に制限されている**（superproject `CLAUDE.md` の
resource governor）。直接叩かず、必ず guard 経由で:

```bash
cd "$REPO"
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
  npx --yes shadow-cljs release worker
ls -la dist/worker.js
```

lock を他セッションが持っていると exit 2 で拒否される。**迂回しない** ——
`resource-guard: build is already running (pid=…)` はエラーではなく順番待ちで
ある（この walk では 4 回目の試行で通った）。

実際の出力（末尾）と成果物:

```
[:worker] Build completed. (55 files, 12 compiled, 0 warnings, 55.13s)
-rw-r--r--  1 junkawasaki  wheel  245547  dist/worker.js
```

`shadow-cljs.edn` は `:compiler-options` に `:warnings-as-errors true` を持つ。
**緑のビルドはそれだけでは検査ではない** —— 既定では未宣言 var も改名された var も
警告どまりで `release` が exit 0 を返し、最初のリクエストで throw する bundle が
出荷される。このキーは `:build-options` ではなく `:compiler-options` に置く
（shadow は前者に置かれたものを黙って無視するので、置き場所を間違えた検査は
それ自体が「落ちない検査」になる）。

## 4.5 ビルドした成果物を実際に叩く

ここが deploy されるものに触る唯一の検査である。

```bash
cd "$REPO" && npx --yes nbb scripts/smoke-worker.cljs dist/worker.js
```

実際の出力（抜粋、18 項目すべて PASS）:

```
PASS	default export has fetch	expected=true	actual=true
PASS	page shows a var key	expected=true	actual=true
PASS	page hides var values	expected=false	actual=false
PASS	page shows the relay destination	expected=true	actual=true
PASS	page carries the design system	expected=true	actual=true
PASS	POST /xrpc/ status	expected=400	actual=400
PASS	single-segment xrpc is relayed (upstream unreachable)	expected=502	actual=502
PASS	multi-segment xrpc is relayed the same way	expected=502	actual=502
OK	the built bundle answers as the route table says
```

**bundle が無ければ exit 2**（「判定できなかった」であって合格ではない）。
smoke は中継先を `https://router.invalid/...` に向ける —— `.invalid` は予約 TLD で
決して解決しないので、「中継しようとしたか」を**実在の DNS に依存せず**観測できる
（`mcp.etzhayyim.com` が今日 NXDOMAIN であることに寄りかからない）。

## 4.6 Workers ランタイム（workerd）で動かす

Node で import する smoke より強い検査。実際の workerd で起こす。

```bash
cd "$REPO"
npx --yes wrangler@latest dev --local --port 8798 --ip 127.0.0.1
# 別シェルで
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8798/
curl -s http://127.0.0.1:8798/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8798/xrpc/
curl -s -X POST http://127.0.0.1:8798/xrpc/a/b
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS http://127.0.0.1:8798/xrpc/x
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8798/nope
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8798/health
```

実際の出力:

```
200 text/html; charset=utf-8
{"ok":true,"app":"air-book","runtime":"cljs","routes":["/","/health","/xrpc/:nsid"]}
400
{"error":"MCP router unreachable","detail":"internal error; reference = 6fqlgtljkr6d0i2e5o7vt8fj","url":"https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}
204
404
405
```

返ってきた HTML には `dads-table` が 71 箇所あり、DADS が bundle に焼かれている
ことも workerd 上で確かめられる。

`compatibility_flags`（`nodejs_compat` / `nodejs_als`）は SvelteKit の
adapter-cloudflare 由来で、この bundle には要らない。**撤去は憶測ではなく
この実測で確かめてから行った** —— 上の walk は flags を外した `wrangler.jsonc`
そのままで通っている。

## 5. deploy

```bash
cd "$REPO"
npx wrangler deploy
```

**この walk では実行していない。** route が指すホストは解決しない
（`air-book.etzhayyim.com` / `a1rb00k1.etzhayyim.com` とも A レコード無し）ので、
deploy が成功しても誰も到達できない。`/xrpc/` の中継先 `mcp.etzhayyim.com` も
同様なので、到達できたとしても中継は **502 を返す**（成功と同じ形で隠さない）。

superproject の deploy guard は `origin/main` を含む checkout からの deploy しか
許さない点も併せて注意。

## 6. ここに無いもの

- 旧 `src/app.ts` の 8 メソッド（`createPnr` … `settleBsp`）と `/_app/meta`
  —— どこにも deploy されておらず、中継先 `dispatcher.etzhayyim.com` が解決せず、
  読む binding（`DISPATCHER_URL` / `DISPATCHER_INTERNAL_SECRET`）が
  `wrangler.jsonc` に宣言されていない。**持ち越していない**（README の
  「持ち越さなかったもの」）
- `kotoba/` の cljs 化 —— あれは appview ではない domain library で、移行の対象外。
  TypeScript のまま残してある（README の「残した TypeScript」）
- `MIGRATION-TODO.md` の 7 項目の憲章適合レビュー
