(ns air-book.route-test
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.string :as str]
            [air-book.route :as route]
            [air-book.view :as view]))

(deftest dispatch-page-and-health
  (is (= :page (:action (route/dispatch "GET" "/"))))
  (is (= :health (:action (route/dispatch "GET" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/"))))
  (is (= :not-found (:action (route/dispatch "GET" "/nope"))))
  (is (= :not-found (:action (route/dispatch "GET" "/_app/meta")))))

(deftest dispatch-xrpc
  (testing "単一セグメントの nsid"
    (is (= {:action :xrpc :nsid "com.etzhayyim.apps.airBook.createPnr"}
           (route/dispatch "POST" "/xrpc/com.etzhayyim.apps.airBook.createPnr"))))
  (testing "空だけが 400。多段は移行前の [...path] と同じく転送する（絞るのは方針変更）"
    (is (= :bad-request (:action (route/dispatch "POST" "/xrpc/"))))
    (is (= {:action :xrpc :nsid "a/b"} (route/dispatch "POST" "/xrpc/a/b"))))
  (testing "preflight と method"
    (is (= :cors-preflight (:action (route/dispatch "OPTIONS" "/xrpc/x"))))
    (is (= :method-not-allowed (:action (route/dispatch "GET" "/xrpc/x"))))))

(deftest mcp-url-resolution
  (is (= "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"
         (route/mcp-router-url {})))
  (is (= "https://a.example/x"
         (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "https://a.example/x/"})))
  (testing "空白だけの設定は未設定として扱う（移行前の +server.ts と同じ）"
    (is (= "https://b.example"
           (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "   "
                                  :MCP_ROUTER_URL "https://b.example"})))))

(deftest unwrap
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:structuredContent {:a 1}}})))
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:a 1}})))
  (is (false? (:ok? (route/unwrap-mcp {:error {:message "boom"}})))))

(def ^:private probe
  "描画経路に載っていることを確かめるための印。実在しそうな値（wrangler の
  APP_UI_TYPE は \"yoro\"）を使うと 2 つ壊れる: 他の文言と偶然一致しうるし、
  引用符ごと探すと renderer が \" を &quot; に escape するので**決して一致せず、
  検査が構造的に落ちなくなる**。"
  "SENTINEL-VALUE-4d81ba")

(deftest page-shows-the-real-routes
  (testing "ページは route 表から描く。0 を焼かない（ADR-0001 の欠陥）"
    (let [html (view/render {:css "/*x*/" :routes route/routes
                             :vars [:APP_NANOID :APP_UI_TYPE]
                             :mcp-url "https://mcp.example/x"})]
      (doseq [r route/routes]
        (is (str/includes? html (:route/path r))
            (str (:route/path r) " がページに出ていない")))
      (is (not (str/includes? html "No public route is declared"))
          "移行前の literal な空表示が残っている"))))

(deftest page-renders-what-it-is-handed
  (testing "渡されたキーと中継先が出る"
    (let [html (view/render {:css "/*x*/" :routes route/routes
                             :vars [:APP_NANOID :APP_UI_TYPE]
                             :mcp-url "https://mcp.example/x"})]
      (is (str/includes? html "APP_NANOID") "env のキーが出ていない")
      (is (str/includes? html "https://mcp.example/x") "中継先が出ていない")))

  (testing "印は描画経路に載っている"
    ;; **『env の値がページに出ていない』をここで主張しない。** worker は view に
    ;; キーしか渡さない（`(sort (keys e))`）ので、この層に漏れる値は存在せず、
    ;; 「出ていない」という assertion は**何をどう壊しても落ちない**。落ちない
    ;; 検査は、測って問題が無かったことと測れなかったことを同じ値で返す
    ;; （superproject ADR-2608136000 が名指しした class）。
    ;;
    ;; 値の露出は env が実在する層 —— ビルド済み bundle —— でしか主張できないので、
    ;; scripts/smoke-worker.cljs が実 env で 2 つの印を独立に当てる
    ;; （出てはならない値 / 出なければならないキー）。実測でその 2 つは
    ;; Object.keys を Object.values にする mutation で同時に反転する。
    ;;
    ;; ここで言えるのは、その印が**描画経路に載る文字列である**ことだけ。
    ;; これが偽なら smoke の否定検査は構造的に落ちない検査になる。
    (let [html (view/render {:css "/*x*/" :routes route/routes
                             :vars [:APP_NANOID]
                             :mcp-url probe})]
      (is (str/includes? html probe)
          "印が描画経路に載っていない —— smoke の否定検査が構造的に落ちなくなる"))))
