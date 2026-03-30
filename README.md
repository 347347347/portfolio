# タスク割当システム — サーバー版

複数人で同時に使えるサーバー版です。SQLiteでデータを保存し、3秒ごとに自動同期します。

---

## 必要環境

- **Node.js** v18以上（https://nodejs.org）
- npm（Node.jsに付属）

---

## セットアップ手順

### 1. ファイルを配置

以下の3ファイルを同じフォルダに置いてください：

```
task-app/
├── server.js        ← サーバー
├── index.html       ← フロントエンド（ブラウザ画面）
└── package.json     ← パッケージ設定
```

### 2. パッケージをインストール

ターミナル（コマンドプロンプト）でフォルダを開き、実行：

```bash
npm install
```

### 3. サーバーを起動

```bash
node server.js
```

以下のように表示されれば成功です：

```
🚀 タスク割当システム起動
   URL: http://localhost:3000
   DB:  /path/to/data.db
```

### 4. ブラウザでアクセス

`http://localhost:3000` を開いてください。

複数人で使う場合は **サーバーのIPアドレス** を使います：
- 例：`http://192.168.1.100:3000`

---

## データ保存場所

- `data.db` — SQLiteデータベース（自動生成）
- このファイルをバックアップすれば全データを保存できます

---

## 外部サーバー（VPS等）への公開

```bash
# ポートを変更したい場合
PORT=8080 node server.js

# バックグラウンドで動かしたい場合（pm2推奨）
npm install -g pm2
pm2 start server.js --name task-app
pm2 save
pm2 startup
```

### nginx リバースプロキシ設定例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 同期の仕組み

- 操作するたびに **0.6秒後** にサーバーへ自動保存
- **3秒ごと** にサーバーの更新を確認し、他のユーザーの変更を自動反映
- 画面左上のバッジで接続状態を確認できます（🟢 サーバー同期中 / 🔴 オフライン）

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| `npm install` でエラー | Node.jsのバージョンを確認（v18以上必要） |
| 「🔴 オフライン」表示 | サーバーが起動しているか確認 |
| ポートが使えない | `PORT=8080 node server.js` で変更 |
| データを初期化したい | `data.db` を削除して再起動 |
