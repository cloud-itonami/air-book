#!/usr/bin/env nbb
;; verify-docs-claims — README.md と docs/operator-quickstart.md が述べる数値・
;; 存在・不在を tree から**derive し直して**照合し、食い違えば落ちる。
;;
;; 移行前、この repo の load-bearing な事実は GAP だった: deploy される Worker は
;; tree に存在しない SvelteKit のビルド出力で、アプリケーションのように読める
;; src/app.ts はどの bundle にも入っていなかった。その GAP は閉じたので、claim は
;; **閉じたこと**を主張する。しかも黙って戻れないように書いてある —— TypeScript の
;; 不在は byte 合計ではなく**名前で**主張する。
;;
;; Usage:  nbb scripts/verify-docs-claims.cljs [<dir>]     (<dir> は先頭、既定 ".")
;; Exit:   0 全 claim が成立 · 1 claim が偽 · 2 答えられなかった

(require '["node:fs" :as fs]
         '["node:child_process" :as cp]
         '["node:crypto" :as crypto]
         '[cljs.reader :as edn]
         '[kotoba.lang.text :as str])

(def root (or (first (remove #(str/starts-with? % "--") *command-line-args*)) "."))

(def claims
  {:tracked-files 26
   :inherited-bytes 41756          ; 継承した 12 ファイルを 1 バイトも変えていない
   :svelte-artifacts 0             ; .svelte / svelte.config / svelte ディレクトリ
   :sveltekit-compat-flags 0       ; nodejs_compat / nodejs_als は adapter-cloudflare のもの
   :appview-ts-files 0             ; appview の production TypeScript（kotoba/ と scripts/ を除く）
   :retained-kotoba-ts-files 5     ; 意図的に残した domain library。増えたら落ちる
   :appview-canonical-files 4      ; .cljs / .cljc / .clj / .kotoba
   :declared-vars 8
   :declared-routes 2
   :wrangler-main "dist/worker.js"
   :shadow-output-dir "dist"
   :shadow-export 'air-book.worker/handler})

;; 出所から 1 バイトも変えずに運んでいるファイル。wrangler.jsonc は**意図的に
;; 変更した**のでこの集合から外し、内容で検査する（意図的な変更と勝手な変更を
;; 区別するため）。kotoba/ の 7 ファイルもここに入る —— 移行は appview が対象で、
;; あの domain library は触っていないという主張そのものである。
(def preserved
  {"MIGRATION-TODO.md" "fe57a8df30f6e8c61f34f58603cdea2b84a08cb5e1ef6a47f594d0369c6669c9"
   "NOTICE" "9d3bd5678f857c647a465987cd8538580215416648991fd9de47e6dc648544f0"
   "README.edn" "ab8c350e8a3dcce09376df3764c286c9dea7c2268a42827cca363180ee51532e"
   "migration.edn" "8a0e6ea029899a1dc781c79e0acfe9c0f86e8d2b78b1b53d509db98637b827d5"
   "kotodama.jsonld" "1db2dc678e9b9929b6b8cabfecfd4041b857ffe9bb586fe271d57978272d35c3"
   "kotoba/package.json" "365705c30aa67fb01f36900d55416dc2c0b27cfc715078ad3b8bebc8eab935b9"
   "kotoba/src/index.ts" "2ea12c0f9e65a7f4bf3f187ba32bdc37b35d303007d12fdd37f13b182a51a6b2"
   "kotoba/src/registry.ts" "f552de07f42d387a9177475b4a83109eaf86c293ef3e11286e25dcec5086bbd1"
   "kotoba/src/types.ts" "1946c2c2ffae78877909a733cbbc9a54e8bc807f53878cbc8cf9e766143580cc"
   "kotoba/test/air-book.test.ts" "b3635bc2b6f15538253249a304eebf6e4a7246b9d15284168ab692f6c2acfb26"
   "kotoba/tsconfig.json" "95a429e51d6162cb7205b603f745e7604d93ffbb1ea6c346e5c6215a79ae541e"
   "kotoba/vitest.config.ts" "f82a551ef4da1c9cbf17985a3bee96eee450a3e4a46bff0d96c6150263121eff"})

;; 移行が撤去したもの、名前で。byte 合計は『TypeScript が消えた』と言えない。
(def removed-by-migration
  ["src/app.ts"
   "package.json"
   "svelte/package.json"
   "svelte/src/app.html"
   "svelte/src/routes/+page.svelte"
   "svelte/src/routes/xrpc/[...path]/+server.ts"
   "svelte/svelte.config.js"
   "svelte/tsconfig.json"
   "svelte/vite.config.ts"])

(def undetermined (atom []))
(def failures (atom []))
(defn undet! [m] (swap! undetermined conj m))

(defn tracked-files []
  (try (->> (.execSync cp "git ls-files" #js {:cwd root :encoding "utf8"})
            str/split-lines (remove str/blank?) vec)
       (catch :default e (undet! (str "git ls-files failed: " (.-message e))) nil)))
(defn slurp* [rel] (try (.readFileSync fs (str root "/" rel) "utf8") (catch :default _ nil)))
(defn bytes-of [rel] (try (.-size (.statSync fs (str root "/" rel))) (catch :default _ nil)))
(defn sha256 [rel]
  (try (-> (.createHash crypto "sha256") (.update (.readFileSync fs (str root "/" rel))) (.digest "hex"))
       (catch :default _ nil)))
(defn strip-jsonc [s] (str/replace s #"(?m)^\s*//.*$" ""))

(defn check! [label expected actual]
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" (name label)
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))
    ok))

(let [files (tracked-files)]
  (when (nil? files) (println "UNDETERMINED\tcould not list tracked files") (js/process.exit 2))
  (println (str "SCANNED\t" (count files)))
  (when (zero? (count files)) (println "UNDETERMINED\tscanned 0 files") (js/process.exit 2))

  (let [sizes (into {} (map (juxt identity bytes-of)) files)]
    (when-let [bad (seq (keep (fn [[f s]] (when (nil? s) f)) sizes))]
      (undet! (str "tracked but unreadable: " (str/join ", " bad))))

    (check! :tracked-files (:tracked-files claims) (count files))
    (check! :inherited-bytes (:inherited-bytes claims)
            (reduce + 0 (keep #(get sizes %) (keys preserved))))
    (check! :preserved-files-unchanged []
            (vec (keep (fn [[f want]] (let [got (sha256 f)]
                                        (when-not (= want got) (str f " " (or got "MISSING")))))
                       preserved)))

    ;; appview の TypeScript は名前で不在を主張する
    (check! :removed-by-migration-absent []
            (vec (filter #(some? (bytes-of %)) removed-by-migration)))

    ;; Svelte は消えており、戻ってはならない。上の 9 パスは名前を押さえるが、
    ;; ここは**別名で戻る**場合を捕まえる（新しい .svelte / svelte.config /
    ;; svelte/ ディレクトリ）。
    (check! :svelte-artifacts (:svelte-artifacts claims)
            (count (filter #(or (str/ends-with? % ".svelte")
                                (str/includes? % "svelte.config")
                                (str/includes? % "/svelte/")
                                (str/starts-with? % "svelte/"))
                           files)))

    ;; production source の言語。scripts/（検証器そのもの）は数から外す —— 入れると
    ;; 移行の差が見えなくなる。kotoba/ は意図的に残した domain library なので
    ;; **別の claim** として固定する（0 にするのではなく、増えないことを固定する）。
    (let [prod (remove #(str/starts-with? % "scripts/") files)
          appview (remove #(str/starts-with? % "kotoba/") prod)]
      (check! :appview-ts-files (:appview-ts-files claims)
              (count (filter #(str/ends-with? % ".ts") appview)))
      (check! :retained-kotoba-ts-files (:retained-kotoba-ts-files claims)
              (count (filter #(and (str/starts-with? % "kotoba/") (str/ends-with? % ".ts")) prod)))
      (check! :appview-canonical-files (:appview-canonical-files claims)
              (count (filter #(re-find #"\.(cljs|cljc|clj|kotoba)$" %) appview))))

    ;; deploy される bundle は、この tree のソースからビルドされる
    (let [w (some-> (slurp* "wrangler.jsonc") strip-jsonc)
          sh (slurp* "shadow-cljs.edn")]
      (if (or (nil? w) (nil? sh))
        (undet! "wrangler.jsonc or shadow-cljs.edn unreadable")
        (let [j (js->clj (.parse js/JSON w) :keywordize-keys false)
              cfg (try (edn/read-string sh) (catch :default e (undet! (str "shadow-cljs.edn unreadable as EDN: " (.-message e))) nil))
              build (get-in cfg [:builds :worker])]
          (check! :wrangler-main (:wrangler-main claims) (get j "main"))
          (check! :declared-vars (:declared-vars claims) (count (get j "vars")))
          (check! :declared-routes (:declared-routes claims) (count (get j "routes")))
          ;; 旧設定は、もう存在しない SvelteKit の client ディレクトリを配っていた
          (check! :no-stale-assets-binding true (nil? (get j "assets")))
          (check! :sveltekit-compat-flags (:sveltekit-compat-flags claims)
                  (count (filter #{"nodejs_compat" "nodejs_als"}
                                 (or (get j "compatibility_flags") []))))
          (check! :framework-not-sveltekit true
                  (not (str/includes? (str/lower (or (get-in j ["vars" "APP_FRAMEWORK"]) "")) "svelte")))
          (if (nil? build)
            (undet! "shadow-cljs.edn has no :builds :worker")
            (do
              (check! :shadow-builds-that-main true
                      (and (= (:output-dir build) (:shadow-output-dir claims))
                           (= (get-in build [:modules :worker :exports 'default]) (:shadow-export claims))
                           (= (get j "main") (str (:shadow-output-dir claims) "/worker.js"))))
              ;; 緑のビルドは検査ではない。未宣言 var / 改名された var は既定では
              ;; 警告どまりで release が exit 0 を返し、最初のリクエストで throw する
              ;; bundle が出荷される。**このファイルを grep で見ない** —— 上のコメント
              ;; 自身が文字列を含むので、grep は自分の説明文で通ってしまう。EDN として
              ;; 読んで、キーが**どこに在るか**を見る。
              (check! :warnings-as-errors-in-compiler-options true
                      (true? (get-in build [:compiler-options :warnings-as-errors])))
              ;; 置き場所を間違えた検査は、それ自体が落ちない検査になる。
              ;; shadow は :build-options に置かれたこのキーを黙って無視する。
              (check! :warnings-as-errors-not-misplaced true
                      (nil? (get-in build [:build-options :warnings-as-errors]))))))))

    ;; ページは route **表**を描く。固定値ではない —— ADR-0001 が記録した欠陥は
    ;; literal な routeCount: 0 が、route 2 本を宣言する設定の隣に在ったことである。
    ;; 構造で主張し、部分文字列の禁止では主張しない（『routeCount を含まないこと』に
    ;; すると、旧欠陥を説明する docstring 自身が引っかかる。コメントで落ちる検査は
    ;; 散文についての検査である）。
    (let [v (slurp* "src/air_book/view.cljc")
          w (slurp* "src/air_book/worker.cljs")]
      (if (or (nil? v) (nil? w))
        (undet! "view.cljc or worker.cljs unreadable")
        (check! :page-renders-route-table true
                (and (str/includes? v "[{:keys [routes vars mcp-url]}]")
                     (str/includes? v "(route-rows routes)")
                     (str/includes? w ":routes route/routes")))))))

(let [u @undetermined f @failures]
  (when (seq u)
    (doseq [m u] (println (str "UNDETERMINED\t" m)))
    (println "Refusing to report a pass: the tree could not be read completely.")
    (js/process.exit 2))
  (if (seq f)
    (do (println (str "FAILED\t" (count f) " claim(s): " (str/join ", " (map name f)))) (js/process.exit 1))
    (do (println "OK\tevery claim in README.md and docs/operator-quickstart.md holds") (js/process.exit 0))))
