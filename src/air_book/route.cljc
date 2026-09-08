(ns air-book.route
  "どの handler が答えるか —— データと、それを読む純関数。

  `.cljs` ではなく `.cljc` なのは意図的である。edge worker のうち検査する
  価値があるのは routing の判断で、ここならブラウザもビルドもネットワークも
  無しに検査できる。`air-book.worker` がこの repo で唯一 Request/Response に
  触る層で、そこはこのファイルが既に決めたことしかしない。

  ingress capability が qualify した時（`:native-aot` / `:wasm-aot` とも今日は
  pending —— ADR-2606290000）に最初に `.kotoba` へ移るのもここである。route 表は
  スカラと文字列の上の判断で、それはその移動を生き延びる形そのものだからだ。"
  (:require [kotoba.lang.text :as str]))

(def routes
  "公開面をデータとして持つ。**説明ページはこの表を描く**ので、実際に在る
  route とページが広告する route がずれる余地が無い —— 移行前の
  `svelte/src/routes/+page.svelte` は `routeCount: 0` と `routes: []` を
  literal で焼いており、隣の `wrangler.jsonc` が route 2 本と var 8 個を
  宣言していることに気づけなかった（ADR-0001）。"
  [{:route/path "/"           :route/method :get  :route/kind :page
    :route/doc "この appview の説明ページ"}
   {:route/path "/health"     :route/method :get  :route/kind :json
    :route/doc "生存確認。deploy された面が答えることを外から確かめられる"}
   {:route/path "/xrpc/:nsid" :route/method :post :route/kind :proxy
    :route/doc "XRPC を MCP router へ中継する"}])

(defn- xrpc-nsid
  "`/xrpc/<nsid>` の nsid。**空文字だけが nil。**

  多段パス（`/xrpc/a/b`）も通す。移行前の SvelteKit route は rest parameter
  `[...path]` で受けており、`event.params.path` が `\"a/b\"` になるので、
  そのまま tool 名として転送していた。ここで 1 セグメントに絞ると挙動が
  変わる —— NSID に `/` は現れないので上流で失敗するだけだが、**それは移行
  ではなく方針変更**であって、移行の commit に紛れ込ませるものではない。
  絞るなら別の決定として記録する。"
  [path]
  (when (str/starts-with? path "/xrpc/")
    (let [rest' (subs path (count "/xrpc/"))]
      (when (seq rest') rest'))))

(defn dispatch
  "method + path → 何をするか。Request も Response も知らない。

  返すのは `{:action …}` で、`:action` は
  `:page` / `:health` / `:xrpc` / `:cors-preflight` / `:not-found` /
  `:method-not-allowed` / `:bad-request` のいずれか。"
  [method path]
  (let [m (keyword (str/lower (or method "get")))
        p (or path "")]
    (cond
      (and (= m :options) (str/starts-with? p "/xrpc/"))
      {:action :cors-preflight}

      (str/starts-with? p "/xrpc/")
      (if (= m :post)
        (if-let [nsid (xrpc-nsid p)]
          {:action :xrpc :nsid nsid}
          {:action :bad-request :reason "Missing XRPC method"})
        {:action :method-not-allowed :allow "POST, OPTIONS"})

      (= p "/health") (if (= m :get)
                        {:action :health}
                        {:action :method-not-allowed :allow "GET"})
      (= p "/")       (if (= m :get)
                        {:action :page}
                        {:action :method-not-allowed :allow "GET"})
      :else {:action :not-found})))

(defn mcp-router-url
  "env の設定 → MCP router の URL。末尾スラッシュは落とす。

  既定値をここに置くのは、設定が無いときに黙って何処かへ POST しないためでは
  なく、**どこへ行くのかを 1 箇所で読めるようにする**ため。移行前の
  `+server.ts` の `mcpRouterUrl` と同じ優先順（AGENTGATEWAY → MCP_ROUTER →
  既定）で、空白だけの設定は未設定として扱うところまで同じである。"
  [{:keys [AGENTGATEWAY_MCP_ROUTER_URL MCP_ROUTER_URL]}]
  (let [pick (fn [s] (when (and (string? s) (seq (str/trim s))) (str/trim s)))]
    (-> (or (pick AGENTGATEWAY_MCP_ROUTER_URL)
            (pick MCP_ROUTER_URL)
            "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message")
        (str/replace #"/+$" ""))))

(defn unwrap-mcp
  "MCP router の応答から、呼び手に返す値を取り出す。

  `{:result {:structuredContent X}}` → X、`{:result X}` → X、それ以外は素通し。
  `{:error …}` は呼び出し側が 502 にするので、ここでは判定だけ返す。
  移行前の `+server.ts` の剥がし方と同じ。"
  [payload]
  (cond
    (and (map? payload) (contains? payload :error))
    {:ok? false
     :error (get-in payload [:error :message] "MCP router returned an error")
     :upstream payload}

    (and (map? payload) (contains? payload :result))
    (let [r (:result payload)]
      {:ok? true :value (if (and (map? r) (contains? r :structuredContent))
                          (:structuredContent r)
                          r)})

    :else {:ok? true :value payload}))
