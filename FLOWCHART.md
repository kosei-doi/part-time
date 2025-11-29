# Part-Time Tracker アプリケーション フローチャート

このドキュメントは、Part-Time Trackerアプリケーションの主要なロジックフローをMermaidを使用して可視化したものです。

## 目次

1. [アプリケーション初期化フロー](#アプリケーション初期化フロー)
2. [Firebase接続・シフト読み込みフロー](#firebase接続シフト読み込みフロー)
3. [月次カレンダー表示フロー](#月次カレンダー表示フロー)
4. [シフト追加フロー](#シフト追加フロー)
5. [シフトフォーム送信フロー](#シフトフォーム送信フロー)
6. [シフト編集・削除フロー](#シフト編集削除フロー)
7. [月次ナビゲーションフロー](#月次ナビゲーションフロー)
8. [シフトデータ変換フロー](#シフトデータ変換フロー)

---

## アプリケーション初期化フロー

```mermaid
flowchart TD
    A[ページ読み込み] --> B[DOMContentLoaded]
    B --> C[checkFirebase実行]
    C --> D{Firebase<br/>利用可能？}
    D -->|いいえ| E[エラーメッセージ表示]
    D -->|はい| F[loadEvents実行]
    F --> G[setupEventListeners実行]
    G --> H[currentView = 'month' に設定]
    H --> I[switchView実行]
    I --> J[updateViews実行]
    J --> K[アプリケーション初期化完了]
```

---

## Firebase接続・シフト読み込みフロー

```mermaid
flowchart TD
    A[loadEvents呼び出し] --> B{Firebase<br/>有効？}
    B -->|いいえ| C[エラーメッセージ表示]
    B -->|はい| D[既存リスナーを解除]
    D --> E[ref: /shifts]
    E --> F[初回: 全件取得]
    F --> G{データ<br/>存在？}
    G -->|いいえ| H[events = []]
    G -->|はい| I[normalizeEventFromSnapshot実行]
    I --> J{シフト形式<br/>date, start, end？}
    J -->|はい| K[シフトデータをイベント形式に変換]
    J -->|いいえ| L[既存イベント形式として処理]
    K --> M[date + T + start → startTime]
    M --> N[date + T + end → endTime]
    N --> O[role → title]
    O --> P[notes → description]
    P --> Q[日付範囲でフィルタリング]
    L --> Q
    Q --> R[開始時刻でソート]
    R --> S[events配列に設定]
    H --> T[updateViews実行]
    S --> T
    T --> U[scheduleAllNotifications実行]
    U --> V[リアルタイムリスナー設定]
    V --> W[onChildAdded: シフト追加を検知]
    V --> X[onChildChanged: シフト更新を検知]
    V --> Y[onChildRemoved: シフト削除を検知]
    W --> Z[events配列に追加]
    X --> AA[events配列を更新]
    Y --> AB[events配列から削除]
    Z --> AC[updateViews実行]
    AA --> AC
    AB --> AC
```

---

## 月次カレンダー表示フロー

```mermaid
flowchart TD
    A[renderMonthView呼び出し] --> B[monthGridをクリア]
    B --> C[現在の年・月を取得]
    C --> D[月の最初の日を計算]
    D --> E[月の最初の週の開始日を計算<br/>日曜日]
    E --> F[6週間分の日付を生成]
    F --> G{各日付について}
    G --> H[createMonthDayElement実行]
    H --> I[日付要素を作成]
    I --> J[other-monthクラスを判定]
    J --> K[todayクラスを判定]
    K --> L[getEventsByDate実行]
    L --> M{その日の<br/>シフトあり？}
    M -->|あり| N[has-eventsクラスを追加]
    M -->|なし| O[シフトなし表示]
    N --> P[シフトを最大3件まで表示]
    P --> Q{シフト数 > 3？}
    Q -->|はい| R[+N表示を追加]
    Q -->|いいえ| S[シフトアイテムを作成]
    R --> S
    S --> T[時間・職種を表示]
    T --> U[クリックイベント: showShiftModal]
    O --> V[日付番号のみ表示]
    U --> W[月次グリッドに追加]
    V --> W
    W --> X{6週間分<br/>完了？}
    X -->|いいえ| G
    X -->|はい| Y[月次カレンダー表示完了]
```

---

## シフト追加フロー

```mermaid
flowchart TD
    A[カレンダーセルをクリック] --> B[openShiftModal実行]
    B --> C[showShiftModal実行]
    C --> D{編集モード？}
    D -->|いいえ| E[新規作成モード]
    D -->|はい| F[既存シフトデータで<br/>フォームを埋める]
    E --> G[フォームを空で初期化]
    G --> H[デフォルト値を設定<br/>日付: 選択した日<br/>開始: 09:00<br/>終了: 17:00]
    H --> I[モーダルを表示]
    F --> I
    I --> J[ユーザーが入力]
    J --> K{保存ボタン<br/>クリック？}
    K -->|いいえ| L[キャンセル]
    K -->|はい| M[フォーム送信処理]
    L --> N[モーダルを閉じる]
```

---

## シフトフォーム送信フロー

```mermaid
flowchart TD
    A[フォーム送信] --> B[preventDefault]
    B --> C[フォームデータを取得]
    C --> D[date, start, end, role, rate, notes]
    D --> E{必須項目<br/>入力済み？}
    E -->|いいえ| F[エラー: 日付・開始・終了は必須]
    E -->|はい| G[開始時刻・終了時刻を結合]
    G --> H[startTime = date + T + start]
    H --> I[endTime = date + T + end]
    I --> J[労働時間を計算]
    J --> K[durationHours = endTime - startTime]
    K --> L[totalPay = rate * durationHours]
    L --> M[シフトデータをイベント形式に変換]
    M --> N{編集モード？}
    N -->|いいえ| O[addEvent実行]
    N -->|はい| P[updateEvent実行]
    O --> Q[Firebase: /shifts に追加]
    P --> R[Firebase: /shifts/{id} を更新]
    Q --> S[リアルタイムリスナーが検知]
    R --> S
    S --> T[events配列を更新]
    T --> U[updateViews実行]
    U --> V[月次カレンダーが更新]
    V --> W[モーダルを閉じる]
    W --> X[成功メッセージ表示]
    F --> Y[エラーメッセージ表示]
```

---

## シフト編集・削除フロー

```mermaid
flowchart TD
    A[シフトアイテムをクリック] --> B[showShiftModal実行]
    B --> C[編集モードでモーダルを開く]
    C --> D[既存シフトデータでフォームを埋める]
    D --> E[deleteBtnを表示]
    E --> F{操作を選択}
    F -->|編集| G[フォームを編集]
    F -->|削除| H[削除ボタンをクリック]
    G --> I[フォーム送信]
    I --> J[updateEvent実行]
    J --> K[Firebase: /shifts/{id} を更新]
    K --> L[リアルタイムリスナーが検知]
    L --> M[events配列を更新]
    M --> N[updateViews実行]
    N --> O[月次カレンダーが更新]
    H --> P[showConfirmModal実行]
    P --> Q{確認<br/>OK？}
    Q -->|いいえ| R[キャンセル]
    Q -->|はい| S[deleteEvent実行]
    S --> T[Firebase: /shifts/{id} を削除]
    T --> U[リアルタイムリスナーが検知]
    U --> V[events配列から削除]
    V --> W[updateViews実行]
    W --> X[月次カレンダーが更新]
    X --> Y[モーダルを閉じる]
    Y --> Z[成功メッセージ表示]
    R --> AA[モーダルを閉じない]
    O --> Y
```

---

## 月次ナビゲーションフロー

```mermaid
flowchart TD
    A[前月ボタンクリック] --> B[addMonths実行]
    B --> C[currentDate -= 1ヶ月]
    C --> D[updateViews実行]
    D --> E[月次カレンダーが更新]
    
    F[次月ボタンクリック] --> G[addMonths実行]
    G --> H[currentDate += 1ヶ月]
    H --> D
    
    I[今日ボタンクリック] --> J[currentDate = new Date]
    J --> D
```

---

## 月次ビュー更新フロー

```mermaid
flowchart TD
    A[updateViews呼び出し] --> B[updateDateDisplay実行]
    B --> C[現在の年月を表示<br/>YYYY年M月]
    C --> D{currentView ==<br/>'month'？}
    D -->|はい| E[renderMonthView実行]
    D -->|いいえ| F[何もしない]
    E --> G[scheduleAllNotifications実行]
    G --> H[月次カレンダー表示完了]
    F --> H
```

---

## シフトデータ変換フロー

```mermaid
flowchart TD
    A[Firebaseからシフトデータ取得] --> B{シフト形式<br/>date, start, end？}
    B -->|はい| C[normalizeEventFromSnapshot実行]
    C --> D[date + T + start → startTime]
    D --> E[date + T + end → endTime]
    E --> F[role → title]
    F --> G[notes → description]
    G --> H[color = '#3b82f6'<br/>デフォルト青色]
    H --> I[イベント形式に変換]
    I --> J[events配列に追加]
    B -->|いいえ| K[既存イベント形式として処理]
    K --> L[startTime, endTimeを正規化]
    L --> J
```

---

## 主要なデータ構造

### シフトデータ（Firebase保存形式）

```javascript
{
  date: "2024-01-15",        // 日付（YYYY-MM-DD）
  start: "09:00",            // 開始時間（HH:MM）
  end: "17:00",              // 終了時間（HH:MM）
  role: "レストラン",         // 職種/場所
  rate: 1200,                // 時給
  notes: "メモ",              // メモ
  durationHours: 8.0,        // 労働時間（時間）
  totalPay: 9600,            // 合計給与
  createdAt: "2024-01-15T00:00:00.000Z",
  updatedAt: "2024-01-15T00:00:00.000Z"
}
```

### イベント形式（内部処理形式）

```javascript
{
  id: "abc123",
  date: "2024-01-15",
  start: "09:00",
  end: "17:00",
  role: "レストラン",
  rate: 1200,
  notes: "メモ",
  title: "レストラン",        // roleから変換
  description: "メモ",        // notesから変換
  startTime: "2024-01-15T09:00",  // date + T + start
  endTime: "2024-01-15T17:00",    // date + T + end
  color: "#3b82f6",          // デフォルトの青色
  durationHours: 8.0,
  totalPay: 9600,
  createdAt: "2024-01-15T00:00:00.000Z",
  updatedAt: "2024-01-15T00:00:00.000Z"
}
```

---

## 補足説明

### キーポイント

1. **リアルタイム同期**: Firebase Realtime Databaseを使用して、データ変更が即座に反映されます。
2. **月次ビューのみ**: 日次ビューと週次ビューは削除され、月次ビューのみを表示します。
3. **シフト管理**: シフトの追加・編集・削除が可能です。
4. **データ変換**: Firebase保存形式（date, start, end）と内部処理形式（startTime, endTime）を自動変換します。
5. **Google Syncなし**: Googleカレンダー同期機能は削除されています。
6. **Firebaseパス**: すべてのデータは`/shifts`パスに保存されます。

---

## 作成日

2024年12月
