# 電話ログイン導入手順（本番未反映）

## 完了条件と費用

Firebase Authentication の電話認証を使います。SMSは従量課金です。2026-09-24確認時のIdentity Platform料金表は日本宛 $0.03/通（無料枠等は契約・実際の請求を確認）。本番の課金有効化・実SMS送信は所有者の承認後に行ってください。既存のGeminiキーをFirebase Web設定に流用しません。

公式: https://firebase.google.com/docs/auth/web/phone-auth
料金: https://cloud.google.com/identity-platform/pricing
制限: https://firebase.google.com/docs/auth/limits

## 1. Google/Firebase 側の準備

1. 所有者のGoogleアカウントでFirebaseプロジェクトを用意し、Webアプリを登録。
2. Authenticationで電話認証を有効化。最初は公式の架空テスト電話番号と固定確認コードで検証（実SMS・料金は発生しません）。テスト番号・コードは秘密として扱い、本番の既存記録へ対応付けないこと。
3. Authorized domainsに afcp0721-oss.github.io とテストWorkerのドメインを登録。localhostでは本物の電話認証は使えません。
4. 実SMSに進むときだけ所有者が課金を承認しBlazeを設定。SMS地域はまず日本だけ許可。予算通知と設定可能なSMS割当を設定。ブラウザの再送待機は操作補助であり不正送信対策の上限にはなりません。reCAPTCHAとFirebase側の制限が必要です。
5. FirebaseのWeb設定4項目（apiKey, authDomain, projectId, appId）を取得。これは公開用設定で、Gemini APIキーや管理用サービスアカウント秘密鍵とは別物です。Google側のAPI制限はFirebase公式ガイドに従い、認証APIを妨げないようにしてください。

## 2. Cloudflare 設定（まずステージング）

- FIREBASE_PROJECT_ID: 対象FirebaseプロジェクトID。
- FIREBASE_WEB_CONFIG: 上の4項目だけのJSON。authDomainは PROJECT_ID.firebaseapp.com。
- PHONE_USERS: 暗号化シークレット。最初は空の `{}` でも設定APIとSMSログインは利用可能、記録APIは承認待ち403になります。
- ACCESS_LIMITER / AI_LIMITER: このブランチのwrangler設定を使う（Wrangler >=4.36）。既存のDB/GEMINI_API_KEY等は維持。
- ステージングは従来のBasic認証を維持。APIへ渡すFirebase IDトークンは X-Meshi-Token。ステージング用Firebaseプロジェクトと承認表を分け、テスト番号が本番で記録にアクセスしないようにする。

PHONE_USERSの形式（以下はダミー。実データをGitやチャットへ貼らない）:

```json
{
  "FIREBASE_UID": {
    "userId": "usr_existing_record_id",
    "expiresAt": "2026-12-31T23:59:59Z",
    "validAfter": 0
  }
}
```

## 3. 利用者承認と以前の記録の引き継ぎ

1. 既存利用者はログイン前に設定の「以前の記録」欄のIDを控える。自分の元の端末からの申請を運営者が対面などで確認する。IDを知っているだけでは所有者の証明にならない。
2. 利用者がSMS認証。初回は「運営者の承認が必要」と表示。
3. 所有者がFirebase AuthenticationのUsersで確認したUIDを、本人の記録IDに対応付けてPHONE_USERSに追加。新規はランダムな内部ID（例usr_とランダム32桁hex）を割り当てる。異なるUIDへ同じ記録IDを割り当てない。
4. 設定更新後、もう一度アプリを操作すれば利用可能。ブラウザにログイン状態を保持し、IDトークンはFirebase SDKが更新。スマホ機種変更後も同じ認証アカウントで同じ記録に戻る。Discord保存先・呼び名は新端末で再設定。

## 4. 紛失・番号変更・失効

番号所有だけの認証にはSIM乗っ取りや番号再割当のリスクがあります。生の電話番号をD1のIDにはしませんが、同じ番号の新しい所有者を自動で見分けられるわけではありません。

番号を手放す前、紛失・不正利用時は運営者へ連絡。運営者が直ちにPHONE_USERSを削除（またはdisabled:true）してからFirebase側で停止・セッション失効。再開時は本人を別経路で確認し、新UIDへ既存内部IDを付け直し、旧UIDを削除します。validAfterにUTC Unix秒を設定すると、それより古いauth_timeのトークンを拒否します。メール・パスキーによるセルフ復旧はこの変更には含まれません。電話番号はアプリDB/Discordに保存しませんが、認証事業者Googleは認証・不正利用防止のため扱います（画面で同意取得）。

## 5. 切り替えの確認（未実施なら本番マージしない）

- CIの署名検証・所有者分離・既存写真/レポート/Discord/D1/画像proxy回帰テスト。
- ステージングで公式テスト番号のログイン、再読み込み、ログアウト、承認待ち/期限切れ/取り消しを確認。
- 所有者承認後の実SMSが携帯で届くことを確認。
- 運営者の既存IDを先に対応付ける。本番の現在のWorkerバージョンを控える。旧フロントはログイン必須化後使えないため、Workerとフロントを同じ作業枠で切り替えて再読み込みを案内。
- 実写真の保存と過去ログを所有者が確認。テストのモック成功を実SMS・実保存の成功とは扱わない。
- 失敗時は旧Workerバージョンと旧Pagesコミットへ両方戻す。DBスキーマ変更なし。ただし旧Workerは認証必須ではないため、切戻しはセキュリティ上の後退になることも伝える。
