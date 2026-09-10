(ns air-book.view
  "この appview の説明ページ。純 hiccup。

  基盤は `jp-go-dds`（デジタル庁デザインシステム）—— superproject の skill
  `kotoba-uiux` が定める新規 UI の base。色・寸法は `--hig-*` トークン契約で
  書き、raw hex も px フォントサイズも置かない。

  **表示する事実は引数で受け取る。ページの中に焼かない。** これは装飾の都合
  ではなく ADR-0001 が測った欠陥そのものへの答えである —— 移行前の
  `+page.svelte` は `routeCount: 0` / `routes: []` / `vars: []` を literal で
  持っており、同じディレクトリの `wrangler.jsonc` が route 2 本・var 8 個を
  宣言していることに気づけなかった。ここでは route 表と env を渡す側が持ち、
  ページは描くだけなので、両者がずれる余地が無い。"
  (:require [jp-go-dds.core :as dds]
            [jp-go-dds.page :as page]
            [jp-go-dds.tokens :as tokens]
            [kotoba.lang.text :as str]))

(def app-css
  "app 固有の最小 CSS。`--hig-*` 契約だけを使う（bridge が DADS の上に再定義
  する）。DADS を base にした app の下に `shitsuke.hig` は居ないので、bridge が
  運んでいないトークンは何にも解決しない —— 使うのは運ばれている中だけ。"
  (str/join
   "\n"
   [".ab-lede { color: var(--hig-color-secondary-label); max-width: 42rem; }"
    ".ab-note { color: var(--hig-color-secondary-label); font-size: var(--hig-text-footnote-font-size); }"
    ".ab-mono { font-family: var(--hig-font-mono); }"]))

(defn- route-rows [routes]
  (mapv (fn [r]
          [(str/upper (name (:route/method r)))
           [:span {:class "ab-mono"} (:route/path r)]
           (:route/doc r)])
        routes))

(defn body
  "opts:
   :routes   air-book.route/routes（この Worker が実際に答えるもの）
   :vars     wrangler が渡した env の**キー**（値は出さない）
   :mcp-url  XRPC の中継先（route/mcp-router-url の戻り値）

  `:mcp-url` は env の**値**から出る唯一の表示である。意図的にそうしている
  —— 中継先が読めないページは、中継が壊れているときに何も助けにならない。
  したがってこのページの約束は「値を一切出さない」ではなく
  **「キーは出す、値は出さない、ただし中継先だけは出す」**である。検査も
  その形（値の sentinel は出ない / 中継先は出る）で書いてある。"
  [{:keys [routes vars mcp-url]}]
  (dds/container
   (dds/section
    {}
    (dds/heading 1 "air-book — Airline Reservations")
    [:p {:class "ab-lede"}
     "航空券の予約・発券（PNR 作成、予約確定、発券、座席指定、付帯サービス、"
     "取消、リプロテクション、BSP 精算）を扱う appview の公開面。"
     "業務そのものは MCP router の先にあり、ここには無い。"])

   (dds/section
    {:title "この面が答えるもの"}
    (dds/table {:caption "公開ルート"
                :headers ["METHOD" "PATH" "何をするか"]
                :rows (route-rows routes)})
    [:p {:class "ab-note"}
     "この表は Worker の route 表そのものから描いている。ページに焼いた値では"
     "ないので、実際に答えるものと表示がずれない。"])

   (dds/section
    {:title "実行時の設定"}
    (if (seq vars)
      [:div (into [:p] (interpose " " (map (fn [k] (dds/chip-label (name k))) vars)))
       [:p {:class "ab-note"} "キー名のみ。値は出さない。"]]
      [:p {:class "ab-note"} "env が渡されていない（ローカル描画）。"])
    [:p {:class "ab-note"} "XRPC の中継先: "
     [:span {:class "ab-mono"} mcp-url]
     "（これだけは値を出す。中継先が読めなければ、壊れたときに何も分からない）"])

   (dds/section
    {:title "現在地"}
    [:p {:class "ab-lede"}
     "この appview は TypeScript/Svelte から ClojureScript へ移行済み。"
     "deploy される bundle は、いま読んでいるソースからコンパイルされたもので"
     "ある（docs/adr/0001）。"])))

(defn render
  "完全な HTML 文書。`css` は呼び出し側が渡す（ライブラリは I/O を持たない）。"
  [{:keys [css] :as opts}]
  (page/->page
   {:title "air-book — Airline Reservations"
    :description "航空券の予約・発券を扱う appview の公開面。"
    :lang "ja"
    :css css
    :app-css (str tokens/bridge-css "\n" app-css)}
   (body opts)))
