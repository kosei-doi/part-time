let unsubscribeEvents = null;
let unsubscribeChildAdded = null;
let unsubscribeChildChanged = null;
let unsubscribeChildRemoved = null;

// イベントリスナーのクリーンアップ用
const eventListeners = {
  // { element, event, handler, options }
  listeners: [],
  add: function(element, event, handler, options) {
    if (!element) return null;
    element.addEventListener(event, handler, options);
    const listener = { element, event, handler, options };
    this.listeners.push(listener);
    return listener;
  },
  remove: function(listener) {
    if (!listener) return;
    try {
      listener.element.removeEventListener(listener.event, listener.handler, listener.options);
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    } catch (error) {
    }
  },
  removeAll: function() {
    this.listeners.forEach(listener => {
      try {
        listener.element.removeEventListener(listener.event, listener.handler, listener.options);
      } catch (error) {
      }
    });
    this.listeners = [];
  }
};

// グローバル変数
let events = []; // シフトをイベントとして扱う（互換性のため）
let workplaces = []; // 職場データ
let currentDate = new Date();
let currentView = 'month'; // 月次ビューのみ
let currentTab = 'calendar'; // 現在のタブ
let editingEventId = null;
let editingWorkplaceId = null;
let isFirebaseEnabled = false;
const clientId = (() => Date.now().toString(36) + Math.random().toString(36).slice(2))();
let messageTimeoutId = null;
const VISIBLE_START_HOUR = 4;
const VISIBLE_END_HOUR = 23;
const HOUR_HEIGHT_PX = 25; // フォールバック値（実際の値は動的に取得）
const MIN_EVENT_HEIGHT_PX = 15;
const VISIBLE_HOURS = VISIBLE_END_HOUR - VISIBLE_START_HOUR + 1;


// 月次ビューのみなのでviewCachesは不要

// Google Apps Script Web アプリ（POSTエンドポイント）
// デプロイ済み Google Apps Script Web アプリの URL
function showMessage(message, type = 'info', duration = 4000) {
  const area = safeGetElementById('notificationArea');
  if (!area) {
    if (type === 'error') {
    } else {
    }
    return;
  }
  area.textContent = message;
  area.className = `notification show${type !== 'info' ? ' ' + type : ''}`;
  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
  }
  if (duration > 0) {
    messageTimeoutId = setTimeout(() => {
      area.className = 'notification';
      area.textContent = '';
    }, duration);
  }
}

// 確認モーダルを表示
function showConfirmModal(message, title = '確認') {
  return new Promise((resolve) => {
    const modal = safeGetElementById('confirmModal');
    const titleEl = safeGetElementById('confirmTitle');
    const messageEl = safeGetElementById('confirmMessage');
    const okBtn = safeGetElementById('confirmOkBtn');
    const cancelBtn = safeGetElementById('confirmCancelBtn');
    
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
      // フォールバック: ブラウザのconfirmを使用
      resolve(confirm(message));
      return;
    }
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    
    let escHandler = null;
    
    const cleanup = () => {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdrop);
      if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
      }
    };
    
    const handleOk = () => {
      cleanup();
      resolve(true);
    };
    
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };
    
    const handleBackdrop = (e) => {
      if (e.target.id === 'confirmModal') {
        handleCancel();
      }
    };
    
    // ESCキーでキャンセル
    escHandler = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdrop);
    document.addEventListener('keydown', escHandler);
  });
}

// ローディングオーバーレイを表示/非表示
function showLoading(message = '処理中...') {
  const overlay = safeGetElementById('loadingOverlay');
  const textEl = overlay?.querySelector('.loading-text');
  if (overlay) {
    if (textEl) textEl.textContent = message;
    overlay.classList.remove('hidden');
  }
}

function hideLoading() {
  const overlay = safeGetElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
  } else {
  }
}

// 安全にgetElementByIdを取得（nullチェック付き）
function safeGetElementById(id) {
  const element = document.getElementById(id);
  if (!element) {
  }
  return element;
}

// Firebase接続チェック
function checkFirebase() {
  try {
    if (typeof window.firebase !== 'undefined' && window.firebase.db) {
      isFirebaseEnabled = true;
      return true;
    }
  } catch (error) {
  }
  isFirebaseEnabled = false;
  return false;
}

// （part-time 用）Firebase 重複削除のダミー実装
// schedule_mgr では events ノードの重複レコードを整理しているが、
// このプロジェクトではまだ同等ロジックを持たないため、
// 呼び出し元と互換性を保つだけの no-op 関数として実装しておく。
async function deduplicateFirebaseEvents() {
  // ここでは何も削除せず、常に 0 件だったことにする
  return { deleted: 0 };
}

// Firebase set をタイムアウト付きで実行するヘルパー
async function firebaseSetWithTimeout(ref, value, timeoutMs = 10000) {
  try {
    return await Promise.race([
      window.firebase.set(ref, value),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Firebase set timeout (${timeoutMs}ms)`)),
          timeoutMs
        )
      ),
    ]);
  } catch (error) {
    throw error;
  }
}

// 特定のイベントが影響するビューだけを更新（月次ビューのみ）
function updateViewsForEvent(event) {
  if (!event || !event.id) {
    // イベント情報がない場合も更新（削除後の場合など）
    updateViews();
    return;
  }
  
  // 常に月次ビューを更新（イベントが表示範囲外でも、他の月でも更新する）
  renderMonthView();
  scheduleAllNotifications();
  
  // 収入タブが表示中の場合は更新
  if (currentTab === 'income') {
    renderIncomeViews();
  }
}

// イベントを正規化
function normalizeEventFromSnapshot(snapshot, key) {
  const payload = snapshot.val() || {};
  
  // シフトデータの場合はイベント形式に変換
  if (payload.date && payload.start && payload.end) {
    // シフトデータ（date, start, end, role, rate, notes, workplaceId, workplaceName）
    const startTime = `${payload.date}T${payload.start}`;
    const endTime = `${payload.date}T${payload.end}`;
    // 職場名を取得（workplaceNameがあればそれを使う、なければroleを使う）
    const workplaceName = payload.workplaceName || payload.role || 'シフト';

    // 職場IDがある場合は職場の色を取得
    let eventColor = '#3b82f6'; // デフォルトの青色
    if (payload.workplaceId) {
      const workplace = workplaces.find(w => w.id === payload.workplaceId);
      if (workplace && workplace.color) {
        eventColor = workplace.color;
      }
    }

    return {
      ...payload,
      id: key,
      title: workplaceName,
      description: payload.notes || '',
      startTime: startTime,
      endTime: endTime,
      color: eventColor,
      role: workplaceName, // 互換性のため
    };
  }
  
  // イベントデータ（既存形式）
  const normalizedStart = normalizeEventDateTimeString(payload.startTime) || payload.startTime || '';
  const normalizedEnd = normalizeEventDateTimeString(payload.endTime) || payload.endTime || '';
  return {
    ...payload,
    id: key,
    startTime: normalizedStart,
    endTime: normalizedEnd,
    allDay: payload.allDay === true,
    isTimetable: payload.isTimetable === true,
    source: payload.source || 'local',
  };
}

// イベントを読み込む関数（差分更新版）
async function loadEvents() {
  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebaseが無効のため、予定を読み込めません。設定を確認してください。';
    showMessage(message, 'error', 6000);
    return;
  }
  
  const allowedRanges = getAllowedDateRanges();
  logAllowedRanges('Firebase');
  
  // 既存のリスナーを解除
  if (typeof unsubscribeEvents === 'function') {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }
  if (typeof unsubscribeChildAdded === 'function') {
    unsubscribeChildAdded();
    unsubscribeChildAdded = null;
  }
  if (typeof unsubscribeChildChanged === 'function') {
    unsubscribeChildChanged();
    unsubscribeChildChanged = null;
  }
  if (typeof unsubscribeChildRemoved === 'function') {
    unsubscribeChildRemoved();
    unsubscribeChildRemoved = null;
  }
  
  const eventsRef = window.firebase.ref(window.firebase.db, "shifts");
  
  // 初回: 全件取得
  try {
    const snapshot = await window.firebase.get(eventsRef);
    const data = snapshot.val();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const newEvents = Object.keys(data).map(key => {
        const payload = data[key] || {};
        return normalizeEventFromSnapshot({ val: () => payload }, key);
      });
      const filteredEvents = newEvents.filter(ev => isEventInAllowedRange(ev, allowedRanges));
      events = filteredEvents;
      events.sort((a, b) => {
        const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      });
      
      // Firebase内の重複チェックを実行
      try {
        const { deleted } = await deduplicateFirebaseEvents();
        if (deleted > 0) {
        }
      } catch (error) {
      }
      
      updateViews();
      scheduleAllNotifications();
    } else {
      events = [];
      updateViews();
    }
  } catch (error) {
    showMessage('予定の読み込みに失敗しました。ネットワークを確認してください。', 'error', 6000);
    return;
  }
  
  // 以降: child イベントで差分更新
  unsubscribeChildAdded = window.firebase.onChildAdded(eventsRef, (snapshot) => {
    try {
      const key = snapshot.key;
      if (!key) return;
      
      const newEvent = normalizeEventFromSnapshot(snapshot, key);
      if (!isEventInAllowedRange(newEvent, allowedRanges)) return;
      
      // 既存のイベントをチェック
      const existingIndex = events.findIndex(e => e.id === key);
      if (existingIndex === -1) {
        events.push(newEvent);
        events.sort((a, b) => {
          const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
          const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
          if (Number.isNaN(aTime)) return 1;
          if (Number.isNaN(bTime)) return -1;
          return aTime - bTime;
        });
        updateViewsForEvent(newEvent);
      }
    } catch (error) {
      // エラーが発生してもアプリを停止させない
    }
  }, (error) => {
    showMessage('予定の追加に失敗しました。', 'error', 4000);
  });
  
  unsubscribeChildChanged = window.firebase.onChildChanged(eventsRef, (snapshot) => {
    try {
      const key = snapshot.key;
      if (!key) return;
      
      const updatedEvent = normalizeEventFromSnapshot(snapshot, key);
      const existingIndex = events.findIndex(e => e.id === key);
      
      if (existingIndex !== -1) {
        const oldEvent = events[existingIndex];
        // updatedAt が変わっていない場合はスキップ（無限ループ防止）
        if (oldEvent.updatedAt === updatedEvent.updatedAt && oldEvent.lastWriteClientId === updatedEvent.lastWriteClientId) {
          return;
        }
        
        events[existingIndex] = updatedEvent;
        events.sort((a, b) => {
          const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
          const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
          if (Number.isNaN(aTime)) return 1;
          if (Number.isNaN(bTime)) return -1;
          return aTime - bTime;
        });
        
        const wasInRange = isEventInAllowedRange(oldEvent, allowedRanges);
        const isInRange = isEventInAllowedRange(updatedEvent, allowedRanges);
        
        // 範囲外→範囲内、範囲内→範囲外、範囲内で日付変更の場合は更新
        if (wasInRange || isInRange) {
          updateViewsForEvent(updatedEvent);
          if (wasInRange && !isInRange) {
            // 範囲外に移動した場合、旧日付も更新
            updateViewsForEvent(oldEvent);
          }
        }
      }
    } catch (error) {
      // エラーが発生してもアプリを停止させない
    }
  }, (error) => {
    showMessage('予定の更新に失敗しました。', 'error', 4000);
  });
  
  unsubscribeChildRemoved = window.firebase.onChildRemoved(eventsRef, (snapshot) => {
    try {
      const key = snapshot.key;
      if (!key) return;
      
      const existingIndex = events.findIndex(e => e.id === key);
      if (existingIndex !== -1) {
        const removedEvent = events[existingIndex];
        events.splice(existingIndex, 1);
        updateViewsForEvent(removedEvent);
      }
    } catch (error) {
      // エラーが発生してもアプリを停止させない
    }
  }, (error) => {
    showMessage('予定の削除に失敗しました。', 'error', 4000);
  });
  
  // 統合解除関数
  unsubscribeEvents = () => {
    if (typeof unsubscribeChildAdded === 'function') {
      unsubscribeChildAdded();
      unsubscribeChildAdded = null;
    }
    if (typeof unsubscribeChildChanged === 'function') {
      unsubscribeChildChanged();
      unsubscribeChildChanged = null;
    }
    if (typeof unsubscribeChildRemoved === 'function') {
      unsubscribeChildRemoved();
      unsubscribeChildRemoved = null;
    }
  };
}

// イベントを追加
async function addEvent(event, options = {}) {
  const normalizedStart = normalizeEventDateTimeString(event.startTime);
  const normalizedEnd = normalizeEventDateTimeString(event.endTime);
  const newEvent = {
    ...event,
    startTime: normalizedStart || event.startTime || '',
    endTime: normalizedEnd || event.endTime || '',
    allDay: event.allDay === true,
    source: event.source || 'local',
    isTimetable: event.isTimetable === true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastWriteClientId: clientId
  };

  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebaseが無効のため、イベントを保存できません。設定を確認してください。';
    showMessage(message, 'error', 6000);
    return null;
  }

  try {
    const eventsRef = window.firebase.ref(window.firebase.db, "shifts");
    const newEventRef = window.firebase.push(eventsRef);
    // シフトデータの場合はシフト形式で保存、イベントデータの場合はイベント形式で保存
    const { id: _omitId, ...payload } = newEvent;
    await window.firebase.set(newEventRef, payload);
    const newId = newEventRef.key;

    return newId;
  } catch (error) {
    showMessage('シフトを保存できませんでした。ネットワークやFirebase設定を確認してください。', 'error', 6000);
    return null;
  }
}

// イベントを更新
async function updateEvent(id, event, options = {}) {
  const existingEvent = (Array.isArray(events) ? events.find(e => e.id === id) : null) || {};
  const startSource = event.startTime ?? existingEvent.startTime ?? '';
  const endSource = event.endTime ?? existingEvent.endTime ?? '';
  const normalizedStart = normalizeEventDateTimeString(startSource);
  const normalizedEnd = normalizeEventDateTimeString(endSource);
  const updatedEvent = {
    ...existingEvent,
    ...event,
    startTime: normalizedStart || startSource,
    endTime: normalizedEnd || endSource,
    allDay: event.allDay === true,
    isTimetable: event.isTimetable === true ? true : existingEvent.isTimetable === true,
    source: event.source || existingEvent.source || 'local',
    updatedAt: new Date().toISOString(),
    lastWriteClientId: clientId
  };

  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebaseが無効のため、イベントを更新できません。設定を確認してください。';
    showMessage(message, 'error', 6000);
    return false;
  }

  const eventRef = window.firebase.ref(window.firebase.db, `shifts/${id}`);
  try {
    await window.firebase.update(eventRef, updatedEvent);
  } catch (error) {
    showMessage('シフトの更新に失敗しました。ネットワーク状況を確認してください。', 'error', 6000);
    return false;
  }

  return true;
}

// イベントを削除
async function deleteEvent(id, options = {}) {
  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebaseが無効のため、イベントを削除できません。設定を確認してください。';
    showMessage(message, 'error', 6000);
    return false;
  }

  const existingEvent = Array.isArray(events) ? events.find(e => e.id === id) : null;
  const eventRef = window.firebase.ref(window.firebase.db, `shifts/${id}`);

  try {
    await window.firebase.remove(eventRef);
  } catch (error) {
    showMessage('シフトの削除に失敗しました。再度お試しください。', 'error', 6000);
    return false;
  }

  return true;
}

async function clearAllEvents({ skipConfirm = false, silent = false } = {}) {
  if (!skipConfirm) {
    const confirmed = await showConfirmModal('全ての予定と時間割データを削除します。よろしいですか？', '削除の確認');
    if (!confirmed) return false;
  }

  const deletableIds = Array.isArray(events)
    ? events.filter(ev => ev?.id && ev.isTimetable !== true).map(ev => ev.id)
    : [];

  try {
    if (!silent) {
      showLoading('削除中...');
    }
    
    if (isFirebaseEnabled && window.firebase?.db) {
      const eventsRef = window.firebase.ref(window.firebase.db, 'shifts');
      await window.firebase.remove(eventsRef);
    }
    
    events = [];
    updateViews();
    clearScheduledNotifications();

    if (!silent) {
      hideLoading();
      showMessage('全ての予定を削除しました。', 'success');
    }
    return true;
  } catch (error) {
    if (!silent) {
      hideLoading();
      showMessage('予定の削除に失敗しました。再度お試しください。', 'error', 6000);
    }
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.clearAllEvents = clearAllEvents;
}


// 特定日のイベント（シフト）を取得
function getEventsByDate(date) {
  const dateStr = formatDate(date, 'YYYY-MM-DD');
  const list = [];
  if (!Array.isArray(events)) return list;
  events.forEach(ev => {
    // シフトデータの場合（dateフィールドがある）
    if (ev.date) {
      if (ev.date === dateStr) list.push(ev);
      return;
    }
    
    // イベントデータの場合
    if (!ev.recurrence || ev.recurrence === 'none') {
      if (!ev.startTime) return;
      const eventDate = ev.startTime.split('T')[0];
      if (eventDate === dateStr) list.push(ev);
      return;
    }
    // 繰り返し展開（簡易）
    if (!ev.startTime || !ev.endTime) return;
    const start = new Date(ev.startTime);
    const end = new Date(ev.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    // recurrenceEnd is a date-only string (YYYY-MM-DD), append time if needed
    const recurEnd = ev.recurrenceEnd 
      ? new Date(ev.recurrenceEnd.includes('T') ? ev.recurrenceEnd : ev.recurrenceEnd + 'T23:59:59')
      : null;
    const target = new Date(date);
    target.setHours(start.getHours(), start.getMinutes(), 0, 0);
    if (recurEnd && !Number.isNaN(recurEnd.getTime()) && target > recurEnd) return;
    const matches = (
      ev.recurrence === 'daily' ||
      (ev.recurrence === 'weekly' && target.getDay() === start.getDay()) ||
      (ev.recurrence === 'monthly' && target.getDate() === start.getDate())
    );
    if (matches && target >= start) {
      const inst = { ...ev };
      const duration = end.getTime() - start.getTime();
      if (duration > 0) {
        inst.startTime = formatDateTimeLocal(target);
        inst.endTime = formatDateTimeLocal(new Date(target.getTime() + duration));
        list.push(inst);
      }
    }
  });
  return list;
}

// getEventsByWeek関数は削除（weekビューのみで使用）

// 日次ビューと週次ビューは削除（月次ビューのみ）

// calculateEventGroups関数は削除（day/weekビューのみで使用）







// 日次ビューでのイベント配置

// モーダル表示
// シフトモーダルを開く（日付を指定して新規作成）
function openShiftModal(date = null) {
  showShiftModal(null, date);
}

// シフトモーダルを表示
function showShiftModal(shiftId = null, defaultDate = null) {
  const modal = safeGetElementById('shiftModal');
  const modalTitle = safeGetElementById('modalTitle');
  const form = safeGetElementById('shiftForm');
  const deleteBtn = safeGetElementById('deleteBtn');
  const dateInput = safeGetElementById('shiftDate');
  const startInput = safeGetElementById('shiftStart');
  const endInput = safeGetElementById('shiftEnd');
  const workplaceSelect = safeGetElementById('shiftWorkplace');
  const rateInput = safeGetElementById('shiftRate');
  const notesInput = safeGetElementById('shiftNotes');
  
  // 必須要素のチェック
  if (!modal || !modalTitle || !form || !dateInput || !startInput || !endInput || !workplaceSelect) {
    return;
  }
  
  // 職場選択を更新
  updateWorkplaceSelect();
  
  editingEventId = shiftId;
  
  if (shiftId && typeof shiftId === 'string' && !shiftId.startsWith('temp-')) {
    // 編集モード
    if (!Array.isArray(events)) return;
    const event = events.find(e => e.id === shiftId);
    if (!event) return;
    
    if (modalTitle) modalTitle.textContent = 'シフトを編集';
    if (deleteBtn) deleteBtn.style.display = 'block';
    
    // シフトデータをイベントから取得（互換性のため）
    const shiftDate = event.date || (event.startTime ? event.startTime.split('T')[0] : '');
    const shiftStart = event.start || (event.startTime ? event.startTime.split('T')[1]?.substring(0, 5) : '');
    const shiftEnd = event.end || (event.endTime ? event.endTime.split('T')[1]?.substring(0, 5) : '');
    const shiftWorkplaceId = event.workplaceId || '';
    const shiftRate = event.rate || '';
    const shiftNotes = event.notes || event.description || '';
    
    if (dateInput) dateInput.value = shiftDate;
    if (startInput) startInput.value = shiftStart;
    if (endInput) endInput.value = shiftEnd;
    if (workplaceSelect) workplaceSelect.value = shiftWorkplaceId;
    if (rateInput) rateInput.value = shiftRate;
    if (notesInput) notesInput.value = shiftNotes;
    
    // 職場が選択されたら時給を自動入力
    if (shiftWorkplaceId) {
      const workplace = workplaces.find(w => w.id === shiftWorkplaceId);
      if (workplace && rateInput && !rateInput.value) {
        rateInput.value = workplace.rate || '';
      }
    }
  } else {
    // 新規作成モード
    if (modalTitle) modalTitle.textContent = 'シフトを追加';
    if (deleteBtn) deleteBtn.style.display = 'none';
    
    // デフォルト値を設定
    const targetDate = defaultDate || currentDate;
    const dateStr = formatDate(targetDate, 'YYYY-MM-DD');
    
    if (dateInput) dateInput.value = dateStr;
    if (startInput) startInput.value = '09:00';
    if (endInput) endInput.value = '17:00';
    if (workplaceSelect) workplaceSelect.value = '';
    if (rateInput) rateInput.value = '';
    if (notesInput) notesInput.value = '';
  }
  
  // 時間履歴を更新（モーダルを開いた直後）
  setTimeout(updateTimeHistory, 100);
  
  if (modal) {
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }
}

// モーダルを閉じる
function closeEventModal() {
  const modal = safeGetElementById('shiftModal');
  if (modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }
  
  // 一時的イベントの場合は削除
  if (editingEventId && typeof editingEventId === 'string' && editingEventId.startsWith('temp-')) {
    if (Array.isArray(events)) {
      const tempEventIndex = events.findIndex(e => e.id === editingEventId);
      if (tempEventIndex !== -1) {
        events.splice(tempEventIndex, 1);
        updateViews();
      }
    }
  }
  
  editingEventId = null;
}

// 日付表示を更新
function updateDateDisplay() {
  const currentDateElement = safeGetElementById('currentDate');
  if (!currentDateElement) return;
  
  // 月次ビューのみ
  currentDateElement.textContent = formatDate(currentDate, 'YYYY年M月');
}

// 月次ビューの描画
function renderMonthView() {
  const monthGrid = safeGetElementById('monthGrid');
  if (!monthGrid) {
    return;
  }
  monthGrid.innerHTML = '';
  
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // 月の最初の日と最後の日
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  // 月の最初の週の開始日（日曜日）
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDay.getDay());
  
  // 6週間分の日付を生成
  for (let week = 0; week < 6; week++) {
    for (let day = 0; day < 7; day++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + (week * 7) + day);
      
      const dayElement = createMonthDayElement(date, month);
      monthGrid.appendChild(dayElement);
    }
  }
}

// 月次ビューの日付要素を作成
function createMonthDayElement(date, currentMonth) {
  const div = document.createElement('div');
  div.className = 'month-day';
  // Validate date before calling toISOString()
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return div;
  }
  div.dataset.date = date.toISOString().split('T')[0];
  
  // 他の月の日付かどうか
  if (date.getMonth() !== currentMonth) {
    div.classList.add('other-month');
  }
  
  // 今日かどうか
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    div.classList.add('today');
  }
  
  // その日のイベント（時間割は月次ビューで非表示）
  const dayEvents = getEventsByDate(date);
  const visibleEvents = dayEvents.filter(event => event.isTimetable !== true);
  const hasTimetableEvents = dayEvents.some(event => event.isTimetable === true);
  
  // 日付番号
  const dayNumber = document.createElement('div');
  dayNumber.className = 'month-day-number';
  dayNumber.textContent = date.getDate();
  div.appendChild(dayNumber);
  
  // その日の収入を計算
  let dailyIncome = 0;
  visibleEvents.forEach(event => {
    const income = calculateShiftIncome(event);
    if (income && income.totalPay) {
      dailyIncome += income.totalPay;
    }
  });
  
  // 収入を表示（ブロックなしで日付の下に）
  if (dailyIncome > 0) {
    const incomeDiv = document.createElement('div');
    incomeDiv.className = 'month-day-income';
    incomeDiv.textContent = formatCurrency(dailyIncome);
    div.appendChild(incomeDiv);
  }

  if (hasTimetableEvents) {
    div.classList.add('has-timetable');
  }

  if (visibleEvents.length > 0) {
    div.classList.add('has-events');
    
    const eventsContainer = document.createElement('div');
    eventsContainer.className = 'month-day-events';
    
    // 最大5件まで表示（色付きドット + 時間）
    visibleEvents.slice(0, 5).forEach(event => {
      const eventElement = document.createElement('div');
      eventElement.className = 'month-event-dot-item';

      // イベントの色を取得（職場の色を優先）
      let eventColor = '#3b82f6'; // デフォルトの青色

      // workplaceIdがある場合は職場の色を優先的に使用
      if (event.workplaceId) {
        const workplace = workplaces.find(w => w.id === event.workplaceId);
        if (workplace && workplace.color) {
          eventColor = workplace.color;
        }
      }

      // 職場が見つからない場合のみevent.colorを使用
      if (eventColor === '#3b82f6' && event.color) {
        eventColor = event.color;
      }

      // 開始時間と終了時間を取得（短縮表記）
      let startTimeText = '';
      if (event.start) {
        startTimeText = event.start;
      } else if (event.startTime) {
        startTimeText = formatTimeShort(event.startTime);
      }

      let endTimeText = '';
      if (event.end) {
        endTimeText = event.end;
      } else if (event.endTime) {
        endTimeText = formatTimeShort(event.endTime);
      }

      // 色付きドットを作成
      const dotElement = document.createElement('span');
      dotElement.className = 'month-event-dot';
      dotElement.style.backgroundColor = eventColor;
      eventElement.appendChild(dotElement);

      // 時間を表示（開始時間と終了時間を別行で）
      const timeContainer = document.createElement('div');
      timeContainer.className = 'month-event-times';

      if (startTimeText) {
        const startSpan = document.createElement('span');
        startSpan.className = 'month-event-time-start';
        startSpan.textContent = startTimeText;
        timeContainer.appendChild(startSpan);
      }

      if (endTimeText) {
        const endSpan = document.createElement('span');
        endSpan.className = 'month-event-time-end';
        endSpan.textContent = endTimeText;
        timeContainer.appendChild(endSpan);
      }

      if (startTimeText || endTimeText) {
        eventElement.appendChild(timeContainer);
      }

      // シフトの場合、職場名（workplaceName）を優先表示、次にrole、最後にtitle
      const displayText = event.workplaceName || event.role || event.title || 'シフト';

      // Escape title for tooltip to prevent XSS
      const safeTitle = escapeHtml(displayText);
      let timeStr = '';
      if (startTimeText && endTimeText) {
        timeStr = `${startTimeText}-${endTimeText}`;
      } else if (startTimeText) {
        timeStr = startTimeText;
      } else if (endTimeText) {
        timeStr = endTimeText;
      }
      eventElement.title = timeStr ? `${safeTitle} (${timeStr})` : safeTitle;
      eventElement.addEventListener('click', (e) => {
        e.stopPropagation();
        showShiftModal(event.id);
      });
      eventsContainer.appendChild(eventElement);
    });
    
    // 5件を超える場合は「+N」を表示
    if (visibleEvents.length > 5) {
      const moreElement = document.createElement('div');
      moreElement.className = 'month-event-dot-item';
      const moreSpan = document.createElement('span');
      moreSpan.className = 'month-event-more';
      moreSpan.textContent = `+${visibleEvents.length - 5}`;
      moreElement.appendChild(moreSpan);
      eventsContainer.appendChild(moreElement);
    }
    
    div.appendChild(eventsContainer);
  }
  
  // 日付クリックでシフト追加モーダルを開く
  div.addEventListener('click', () => {
    openShiftModal(date);
  });
  
  div.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openShiftModal(date);
    }
  });
  
  div.tabIndex = 0;
  div.setAttribute('role', 'button');
  div.setAttribute('aria-label', `${date.getDate()}日`);
  
  return div;
}

// ビューを更新
function updateViews() {
  updateDateDisplay();
  
  if (currentView === 'month') {
    renderMonthView();
  }
  // 表示更新のたびに近接通知を再スケジュール
  scheduleAllNotifications();
}

// ユーティリティ関数

// 日付フォーマット
function formatDate(date, format) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dayName = dayNames[date.getDay()];
  
  return format
    .replace('YYYY', year)
    .replace('MM', month.toString().padStart(2, '0'))
    .replace('M', month)
    .replace('DD', day.toString().padStart(2, '0'))
    .replace('D', day)
    .replace('ddd', dayName);
}

// テキストを指定長で切り詰める
function truncateText(text, maxLength) {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// 時間フォーマット
function formatTime(dateTimeString) {
  const date = new Date(dateTimeString);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// 短縮版フォーマット（カレンダー表示用）
function formatTimeShort(dateTimeString) {
  const date = new Date(dateTimeString);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hours = date.getHours(); // 先頭の0を付けない
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// datetime-local用のフォーマット
function formatDateTimeLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toDateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateTimeLocal(date);
}

function formatDateOnly(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    // 日付のみ（YYYY-MM-DD）の場合はそのまま返す
    if (!value.includes('T')) {
      const match = value.match(/^(\d{4}-\d{2}-\d{2})$/);
      if (match) return match[1];
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isAllDayEvent(event) {
  return event?.allDay === true;
}

function splitEventsByAllDay(eventList = []) {
  const allDayEvents = [];
  const timedEvents = [];
  eventList.forEach((event) => {
    const lacksTime =
      !event?.startTime ||
      !event?.endTime ||
      Number.isNaN(new Date(event.startTime).getTime()) ||
      Number.isNaN(new Date(event.endTime).getTime());
    if (isAllDayEvent(event) || lacksTime) {
      allDayEvents.push(event);
    } else {
      timedEvents.push(event);
    }
  });
  return { allDayEvents, timedEvents };
}

function applyAllDayMode(isAllDay, controls) {
  const { startInput, endInput, allDayRow } = controls;
  if (isAllDay) {
    allDayRow?.classList.remove('hidden');
    startInput?.classList.add('readonly-input');
    endInput?.classList.add('readonly-input');
    startInput?.setAttribute('disabled', 'disabled');
    endInput?.setAttribute('disabled', 'disabled');
  } else {
    allDayRow?.classList.add('hidden');
    startInput?.classList.remove('readonly-input');
    endInput?.classList.remove('readonly-input');
    startInput?.removeAttribute('disabled');
    endInput?.removeAttribute('disabled');
  }
}

function normalizeEventDateTimeString(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateTimeLocal(date);
}

function getAllowedDateRanges() {
  const now = new Date();
  
  // 6ヶ月前の日付を安全に計算
  const rangeStart = new Date(now);
  const currentMonth = rangeStart.getMonth();
  const targetMonth = currentMonth - 6;
  
  // 月が負の値になる場合の処理
  if (targetMonth < 0) {
    rangeStart.setFullYear(rangeStart.getFullYear() - 1);
    rangeStart.setMonth(12 + targetMonth);
  } else {
    rangeStart.setMonth(targetMonth);
  }
  rangeStart.setDate(1); // 月の最初の日
  rangeStart.setHours(0, 0, 0, 0);

  // 1年後の日付を計算
  const rangeEnd = new Date(now);
  rangeEnd.setFullYear(rangeEnd.getFullYear() + 1);
  rangeEnd.setMonth(11); // 12月
  rangeEnd.setDate(31); // 月末
  rangeEnd.setHours(23, 59, 59, 999);

  return { rangeStart, rangeEnd };
}

function logAllowedRanges(label) {
  const { rangeStart, rangeEnd } = getAllowedDateRanges();
}

function isEventInAllowedRange(event, ranges) {
  if (!event || !event.startTime) return false;
  const eventDate = new Date(event.startTime);
  if (Number.isNaN(eventDate.getTime())) return false;
  const { rangeStart, rangeEnd } = ranges || getAllowedDateRanges();
  return eventDate >= rangeStart && eventDate <= rangeEnd;
}

// 通知スケジュール
let scheduledTimeouts = [];
async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    try { const res = await Notification.requestPermission(); return res === 'granted'; } catch { return false; }
  }
  return false;
}

function clearScheduledNotifications() {
  if (!Array.isArray(scheduledTimeouts)) {
    scheduledTimeouts = [];
    return;
  }
  scheduledTimeouts.forEach(id => {
    if (id != null) clearTimeout(id);
  });
  scheduledTimeouts = [];
}

function scheduleAllNotifications() {
  clearScheduledNotifications();
  ensureNotificationPermission().then((ok) => {
    if (!ok) return;
    if (!Array.isArray(events)) return;
    const now = Date.now();
    const soon = now + 7 * 24 * 60 * 60 * 1000; // 7日以内のみ
    events.forEach(ev => {
      if (!ev.reminderMinutes && ev.reminderMinutes !== 0) return;
      if (isAllDayEvent(ev)) return;
      if (!ev.startTime) return;
      const start = new Date(ev.startTime).getTime();
      if (Number.isNaN(start)) return;
      const fireAt = start - (ev.reminderMinutes * 60000);
      if (fireAt < now || fireAt > soon) return;
      const timeoutDelay = fireAt - now;
      if (timeoutDelay <= 0) return; // Additional safety check
      const timeout = setTimeout(() => {
        try { new Notification(ev.title || '予定', { body: `${formatTime(ev.startTime)} 開始`, silent: false }); } catch {}
      }, timeoutDelay);
      scheduledTimeouts.push(timeout);
    });
  }).catch((error) => {
  });
}

// エクスポート/インポート（JSONのみ、ICSは後続）
function exportEventsAsJSON(range = 'all') {
  try {
    // range パラメータは現在未使用（将来の拡張用）
    const data = { version: '1.1', exportedAt: new Date().toISOString(), events };
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'events.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMessage('イベントをエクスポートしました', 'success', 3000);
  } catch (error) {
    showMessage('エクスポートに失敗しました。', 'error', 6000);
  }
}

async function importEventsFromJSONData(obj) {
  if (!obj || !Array.isArray(obj.events)) throw new Error('フォーマット不正');
  let importedCount = 0;
  for (const ev of obj.events) {
    const dup = Array.isArray(events)
      ? events.find(e => e.startTime === ev.startTime && (e.title || '') === (ev.title || ''))
      : null;
    if (dup) continue;
    const toAdd = {
      title: ev.title || '',
      description: ev.description || '',
      startTime: ev.startTime,
      endTime: ev.endTime,
      allDay: ev.allDay === true,
      color: ev.color || '#3b82f6',
      recurrence: ev.recurrence || 'none',
      recurrenceEnd: ev.recurrenceEnd || '',
      reminderMinutes: ev.reminderMinutes ?? null,
      isTimetable: ev.isTimetable === true,
    };
    const newId = await addEvent(toAdd);
    if (newId) {
      importedCount++;
    }
  }
  return importedCount;
}

async function handleJSONImport(jsonData) {
  if (!jsonData || typeof jsonData !== 'object') {
    throw new Error('JSONデータが不正です');
  }
  // Check if it's a timetable file
  const isTimetable = 
    jsonData.type === 'timetable' ||
    jsonData.timetableData ||
    Array.isArray(jsonData.schoolDays) ||
    (jsonData.schedule && jsonData.periodTimes && Array.isArray(jsonData.periodTimes));
  
  if (!Array.isArray(jsonData) && isTimetable) {
    const count = await importTimetableFromData(jsonData);
    showMessage(`時間割をインポートしました: ${count}件の予定を追加`, 'success');
    return;
  }
  if (Array.isArray(jsonData.events)) {
    const count = await importEventsFromJSONData(jsonData);
    showMessage(`イベントをインポートしました: ${count}件`, 'success');
    return;
  }
  throw new Error('対応していないJSON形式です');
}

// 時間割データを取り込む
async function importTimetableFromData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('時間割データが不正です');
  }

  if (data.type && data.type !== 'timetable') {
    throw new Error('時間割ファイルではありません');
  }

  if (Array.isArray(data.schoolDays)) {
    const title = (typeof data.title === 'string' && data.title.trim().length > 0)
      ? data.title.trim()
      : 'school';
    const description = typeof data.description === 'string' ? data.description : '';
    const baseColor = typeof data.color === 'string' && data.color.trim() ? data.color.trim() : '#f9a8d4';
    const allDay = data.allDay === true;
    const timePattern = /^\d{2}:\d{2}$/;
    const timeToMinutes = (timeStr) => {
      if (typeof timeStr !== 'string' || !timePattern.test(timeStr)) return null;
      const parts = timeStr.split(':');
      if (parts.length !== 2) return null;
      const [h, m] = parts.map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };
    const normalizeTime = (value, fallback) => (typeof value === 'string' && timePattern.test(value) ? value : fallback);
    
    const defaultStart = typeof data.dayStart === 'string' && /^\d{2}:\d{2}$/.test(data.dayStart)
      ? data.dayStart
      : '00:00';
    const defaultEndCandidate = typeof data.dayEnd === 'string' && /^\d{2}:\d{2}$/.test(data.dayEnd)
      ? data.dayEnd
      : '23:59';
    // Compare times properly by converting to minutes
    const startMinutes = timeToMinutes(defaultStart) ?? 0;
    const endMinutes = timeToMinutes(defaultEndCandidate) ?? 1439; // 23:59 in minutes
    const defaultEnd = endMinutes > startMinutes ? defaultEndCandidate : '23:59';

    const dayConfigMap = new Map();
    data.schoolDays.forEach((entry) => {
      let dateStr;
      let entryAllDay = allDay;
      let startStr = defaultStart;
      let endStr = defaultEnd;
      let entryColor = baseColor;

      if (typeof entry === 'string') {
        dateStr = entry;
      } else if (entry && typeof entry === 'object') {
        dateStr = entry.date;
        if (entry.allDay === true) entryAllDay = true;
        if (entry.allDay === false) entryAllDay = false;
        startStr = normalizeTime(entry.start, defaultStart);
        endStr = normalizeTime(entry.end, defaultEnd);
        if (typeof entry.color === 'string' && entry.color.trim()) {
          entryColor = entry.color.trim();
        }
      } else {
        return;
      }

      if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
      dayConfigMap.set(dateStr, {
        allDay: entryAllDay,
        start: startStr,
        end: endStr,
        color: entryColor,
      });
    });

    const uniqueDates = Array.from(dayConfigMap.keys())
      .sort((a, b) => new Date(a) - new Date(b));

    let importedCount = 0;

    for (const dateStr of uniqueDates) {
      const config = dayConfigMap.get(dateStr);
      const eventAllDay = config.allDay === true;
      let startTime;
      let endTime;
      if (eventAllDay) {
        startTime = `${dateStr}T00:00`;
        endTime = `${dateStr}T23:59`;
      } else {
        const startMinutes = timeToMinutes(config.start) ?? timeToMinutes(defaultStart) ?? 0;
        let endMinutes = timeToMinutes(config.end) ?? timeToMinutes(defaultEnd) ?? (startMinutes + 60);
        if (endMinutes <= startMinutes) {
          endMinutes = startMinutes + 60;
        }
        if (endMinutes >= 24 * 60) {
          endMinutes = 23 * 60 + 59;
        }
        const formatMinutes = (min) => {
          const h = String(Math.floor(min / 60)).padStart(2, '0');
          const m = String(min % 60).padStart(2, '0');
          return `${h}:${m}`;
        };
        startTime = `${dateStr}T${formatMinutes(startMinutes)}`;
        endTime = `${dateStr}T${formatMinutes(endMinutes)}`;
      }
      const duplicate = Array.isArray(events) ? events.find((e) =>
        e.startTime === startTime &&
        e.endTime === endTime &&
        (e.title || '') === title &&
        e.isTimetable === true
      ) : null;
      if (duplicate) return;

      const newEvent = {
        title,
        description,
        startTime,
        endTime,
        allDay: eventAllDay,
        color: config.color || baseColor,
        recurrence: 'none',
        recurrenceEnd: '',
        reminderMinutes: null,
        isTimetable: true,
      };

      const newId = await addEvent(newEvent);
      if (newId) {
        importedCount++;
      }
    }

    return importedCount;
  }

  const weekdays = Array.isArray(data.weekdays) && data.weekdays.length > 0
    ? data.weekdays
    : ['月', '火', '水', '木', '金'];
  const classDaysByWeekday = data.classDays || {};
  const timetableGrid = Array.isArray(data.timetableData) ? data.timetableData : [];
  const periodTimes = Array.isArray(data.periodTimes) ? data.periodTimes : [];
  const scheduleByWeekday = data.schedule && typeof data.schedule === 'object' ? data.schedule : null;
  const title = (typeof data.title === 'string' && data.title.trim().length > 0)
    ? data.title.trim()
    : 'school';
  const description = typeof data.description === 'string' ? data.description : '';
  const baseColor = typeof data.color === 'string' && data.color.trim() ? data.color.trim() : '#f9a8d4';

  let importedCount = 0;

  if (scheduleByWeekday && periodTimes.length > 0) {
    const periodMap = new Map(periodTimes.map((p, idx) => [idx + 1, p]));
    for (const weekdaySymbol of weekdays) {
      const classDates = Array.isArray(classDaysByWeekday[weekdaySymbol])
        ? classDaysByWeekday[weekdaySymbol]
        : [];
      const periodsForDay = Array.isArray(scheduleByWeekday[weekdaySymbol])
        ? scheduleByWeekday[weekdaySymbol].map(Number).filter((n) => Number.isFinite(n) && periodMap.has(n))
        : [];
      if (periodsForDay.length === 0) continue;

      const minPeriod = Math.min(...periodsForDay);
      const maxPeriod = Math.max(...periodsForDay);
      const startPeriodTime = periodMap.get(minPeriod);
      const endPeriodTime = periodMap.get(maxPeriod);
      if (!startPeriodTime || !startPeriodTime.start || !endPeriodTime || !endPeriodTime.end) continue;

      for (const classDate of classDates) {
        if (typeof classDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(classDate)) continue;
        const startTime = `${classDate}T${startPeriodTime.start}`;
        const endTime = `${classDate}T${endPeriodTime.end}`;

        const duplicate = Array.isArray(events) ? events.find((e) =>
          e.startTime === startTime &&
          e.endTime === endTime &&
          (e.title || '') === title &&
          e.isTimetable === true
        ) : null;
        if (duplicate) continue;

        const newEvent = {
          title,
          description,
          startTime,
          endTime,
          color: baseColor,
          allDay: false,
          recurrence: 'none',
          recurrenceEnd: '',
          reminderMinutes: null,
          isTimetable: true,
        };

        const newId = await addEvent(newEvent);
        if (newId) {
          importedCount++;
        }
      }
    }
    return importedCount;
  }

  for (const [weekdayIndex, weekdaySymbol] of weekdays.entries()) {
    const classDates = Array.isArray(classDaysByWeekday[weekdaySymbol])
      ? classDaysByWeekday[weekdaySymbol]
      : [];

    for (const classDate of classDates) {
      if (!classDate || typeof classDate !== 'string') continue;

      for (let periodIndex = 0; periodIndex < timetableGrid.length; periodIndex += 1) {
        const subjectsForPeriod = timetableGrid[periodIndex];
        const subjectEntry = subjectsForPeriod?.[weekdayIndex];
        const subjectName = typeof subjectEntry === 'object' ? subjectEntry.title : subjectEntry;
        if (!subjectName || subjectName.trim() === '') continue;

        const periodTime = periodTimes[periodIndex];
        if (!periodTime || !periodTime.start || !periodTime.end) continue;

        const startTime = `${classDate}T${periodTime.start}`;
        const endTime = `${classDate}T${periodTime.end}`;
        const descriptionLabel = `${periodIndex + 1}限`;

        const duplicate = Array.isArray(events) ? events.find(e =>
          e.startTime === startTime &&
          e.endTime === endTime &&
          (e.title || '') === subjectName &&
          (e.description || '').includes(descriptionLabel) &&
          e.isTimetable === true
        ) : null;
        if (duplicate) continue;

        const newEvent = {
          title: subjectName,
          description: descriptionLabel,
          startTime,
          endTime,
          color: baseColor,
          recurrence: 'none',
          recurrenceEnd: '',
          reminderMinutes: null,
          isTimetable: true
        };

        const newId = await addEvent(newEvent);
        if (newId) {
          importedCount++;
        }
      }
    }
  }

  return importedCount;
}

// 日付計算
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// 月の計算
function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// ビュー切り替え
function switchView(view) {
  // 月次ビューのみ
  const monthView = safeGetElementById('monthView');
  const monthViewBtn = safeGetElementById('monthViewBtn');
  
  if (monthView) monthView.classList.add('active');
  if (monthViewBtn) monthViewBtn.classList.add('active');
  
  currentView = 'month';
}

// 週の開始日を取得（日曜日）
function getWeekStart(date) {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

// HTMLエスケープ
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// 入力値をサニタイズ
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  // HTMLタグを削除し、危険な文字をエスケープ
  return input
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// テキスト入力のサニタイズ（HTMLタグは削除、特殊文字は保持）
function sanitizeTextInput(input) {
  if (typeof input !== 'string') return '';
  return input.trim();
}

// ID生成関数
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// 職場の色変更時に関連するイベントの色も更新
function updateEventsColorForWorkplace(workplaceId) {
  const workplace = workplaces.find(w => w.id === workplaceId);
  if (!workplace) return;

  // 指定された職場IDを持つイベントの色を更新
  events.forEach(event => {
    if (event.workplaceId === workplaceId) {
      event.color = workplace.color || '#3b82f6';
    }
  });

  // カレンダーを再描画
  updateViews();
}

// ========== 職場管理機能 ==========

// 職場データを読み込む
async function loadWorkplaces() {
  if (!checkFirebase()) {
    workplaces = [];
    return;
  }
  
  try {
    const workplacesRef = window.firebase.ref(window.firebase.db, 'workplaces');
    const snapshot = await window.firebase.get(workplacesRef);
    const data = snapshot.val();
    
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      workplaces = Object.keys(data).map(key => ({
        id: key,
        name: data[key].name || '',
        rate: data[key].rate || 0,
        color: data[key].color || '#3b82f6' // デフォルトの青色
      }));
    } else {
      workplaces = [];
    }
    
    updateWorkplaceSelect();
    renderWorkplacesList();
  } catch (error) {
    workplaces = [];
  }
}

// 職場を追加
async function addWorkplace(workplace) {
  
  if (!checkFirebase()) {
    const id = generateId();
    workplaces.push({ ...workplace, id });
    return id;
  }
  
  try {
    const workplacesRef = window.firebase.ref(window.firebase.db, 'workplaces');
    const newRef = window.firebase.push(workplacesRef);
    
    // set操作を実行（タイムアウト付きで安全に実行）
    await firebaseSetWithTimeout(newRef, workplace, 10000);
    
    const id = newRef.key;
    workplaces.push({ ...workplace, id });
    return id;
  } catch (error) {
    throw error;
  }
}

// 職場を更新
async function updateWorkplace(id, workplace) {
  if (!checkFirebase()) {
    const index = workplaces.findIndex(w => w.id === id);
    if (index !== -1) {
      workplaces[index] = { ...workplace, id };
    }
    updateEventsColorForWorkplace(id); // 職場の色変更時にイベントの色も更新
    return;
  }

  try {
    const workplaceRef = window.firebase.ref(window.firebase.db, `workplaces/${id}`);
    await window.firebase.set(workplaceRef, workplace);
    const index = workplaces.findIndex(w => w.id === id);
    if (index !== -1) {
      workplaces[index] = { ...workplace, id };
    }
    updateEventsColorForWorkplace(id); // 職場の色変更時にイベントの色も更新
  } catch (error) {
    throw error;
  }
}

// 職場を削除
async function deleteWorkplace(id) {
  if (!checkFirebase()) {
    workplaces = workplaces.filter(w => w.id !== id);
    return;
  }
  
  try {
    const workplaceRef = window.firebase.ref(window.firebase.db, `workplaces/${id}`);
    await window.firebase.remove(workplaceRef);
    workplaces = workplaces.filter(w => w.id !== id);
  } catch (error) {
    throw error;
  }
}

// 職場選択セレクトボックスを更新
function updateWorkplaceSelect() {
  const select = safeGetElementById('shiftWorkplace');
  if (!select) return;
  
  const currentValue = select.value;
  select.innerHTML = '<option value="">選択してください</option>';
  
  workplaces.forEach(workplace => {
    const option = document.createElement('option');
    option.value = workplace.id;
    option.textContent = `${workplace.name} (${workplace.rate}円/時)`;
    select.appendChild(option);
  });
  
  if (currentValue) {
    select.value = currentValue;
  }
}

// 職場リストを表示
function renderWorkplacesList() {
  const container = safeGetElementById('workplacesList');
  if (!container) return;
  
  if (workplaces.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">職場が登録されていません。職場を追加してください。</p>';
    return;
  }
  
  container.innerHTML = workplaces.map(workplace => `
    <div class="workplace-item">
      <div class="workplace-info">
        <div class="workplace-name">${escapeHtml(workplace.name)}</div>
        <div class="workplace-rate">時給: ${workplace.rate}円</div>
        <div class="workplace-color">
          <span class="color-dot" style="background-color: ${workplace.color || '#3b82f6'}"></span>
          色: ${workplace.color || '#3b82f6'}
        </div>
      </div>
      <div class="workplace-actions">
        <button class="btn btn-secondary edit-workplace-btn" data-id="${workplace.id}">編集</button>
        <button class="btn btn-danger delete-workplace-btn" data-id="${workplace.id}">削除</button>
      </div>
    </div>
  `).join('');
  
  // 編集ボタンのイベントリスナー
  container.querySelectorAll('.edit-workplace-btn').forEach(btn => {
    const id = btn.dataset.id;
    eventListeners.add(btn, 'click', () => {
      showWorkplaceModal(id);
    });
  });
  
  // 削除ボタンのイベントリスナー（確認モーダル付き）
  container.querySelectorAll('.delete-workplace-btn').forEach(btn => {
    const id = btn.dataset.id;
    eventListeners.add(btn, 'click', async () => {
      const workplace = workplaces.find(w => w.id === id);
      if (!workplace) return;
      const confirmed = await showConfirmModal(`「${workplace.name}」を削除してもよろしいですか？`, '職場の削除');
      if (confirmed) {
        try {
          showLoading('削除中...');
          await deleteWorkplace(id);
          hideLoading();
          showMessage('職場を削除しました', 'success', 3000);
          renderWorkplacesList();
          updateWorkplaceSelect();
        } catch (error) {
          hideLoading();
          showMessage('職場の削除に失敗しました。', 'error', 6000);
        }
      }
    });
  });
}

// 職場モーダルを表示
function showWorkplaceModal(workplaceId = null) {
  const modal = safeGetElementById('workplaceModal');
  const modalTitle = safeGetElementById('workplaceModalTitle');
  const form = safeGetElementById('workplaceForm');
  const deleteBtn = safeGetElementById('deleteWorkplaceBtn');
  const nameInput = safeGetElementById('workplaceName');
  const rateInput = safeGetElementById('workplaceRate');
  const colorInput = safeGetElementById('workplaceColor');

  if (!modal || !modalTitle || !form || !nameInput || !rateInput || !colorInput) {
    return;
  }

  editingWorkplaceId = workplaceId;

  if (workplaceId) {
    const workplace = workplaces.find(w => w.id === workplaceId);
    if (!workplace) return;

    modalTitle.textContent = '職場を編集';
    nameInput.value = workplace.name || '';
    rateInput.value = workplace.rate || '';
    colorInput.value = workplace.color || '#3b82f6';
    if (deleteBtn) deleteBtn.style.display = 'block';
  } else {
    modalTitle.textContent = '職場を追加';
    nameInput.value = '';
    rateInput.value = '';
    colorInput.value = '#3b82f6'; // デフォルトの青色
    if (deleteBtn) deleteBtn.style.display = 'none';
  }

  // 色選択のパレット機能を設定
  const updateColorPaletteSelection = () => {
    // パレットの選択状態を更新
    const colorOptions = modal.querySelectorAll('.color-option');
    const currentColor = colorInput.value.toLowerCase();

    colorOptions.forEach(option => {
      const optionColor = option.dataset.color.toLowerCase();
      if (optionColor === currentColor) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });
  };

  // パレットクリックイベントを設定
  const colorOptions = modal.querySelectorAll('.color-option');
  colorOptions.forEach(option => {
    eventListeners.add(option, 'click', () => {
      const selectedColor = option.dataset.color;
      colorInput.value = selectedColor;
      updateColorPaletteSelection();
    });
  });

  // 初期選択状態を設定
  updateColorPaletteSelection();

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

// 職場モーダルを閉じる
function closeWorkplaceModal() {
  const modal = safeGetElementById('workplaceModal');
  if (modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }
  editingWorkplaceId = null;
}

// ========== 時間候補機能 ==========

// すべての時間履歴を取得
function getAllTimeHistory() {
  if (!Array.isArray(events)) return [];
  
  const history = [];
  const seen = new Map(); // 時間+職場の組み合わせをキーにする
  
  events.forEach(event => {
    if (!event.start || !event.end) return;
    
    const workplaceId = event.workplaceId || '';
    const workplaceName = event.workplaceName || event.role || '職場未設定';
    const key = `${event.start}-${event.end}-${workplaceId}`;
    
    // 既に同じ時間+職場の組み合わせがあれば、より新しい日付のものを使う
    const existing = seen.get(key);
    if (existing) {
      const eventDate = event.date || (event.startTime ? event.startTime.split('T')[0] : '');
      const existingDate = existing.date || '';
      if (eventDate && (!existingDate || eventDate > existingDate)) {
        seen.set(key, {
          start: event.start,
          end: event.end,
          workplaceId: workplaceId,
          workplaceName: workplaceName,
          date: eventDate,
          timestamp: event.createdAt || event.updatedAt || event.startTime || ''
        });
      }
    } else {
      seen.set(key, {
        start: event.start,
        end: event.end,
        workplaceId: workplaceId,
        workplaceName: workplaceName,
        date: event.date || (event.startTime ? event.startTime.split('T')[0] : ''),
        timestamp: event.createdAt || event.updatedAt || event.startTime || ''
      });
    }
  });
  
  // Mapから配列に変換
  const historyArray = Array.from(seen.values());
  
  // タイムスタンプでソート（新しい順）
  historyArray.sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    }
    if (a.date && b.date) {
      return b.date.localeCompare(a.date);
    }
    return 0;
  });
  
  return historyArray.slice(0, 20); // 最大20件
}

// 時間履歴を表示
function updateTimeHistory() {
  const container = safeGetElementById('timeHistoryContainer');
  if (!container) return;
  
  const history = getAllTimeHistory();
  
  if (history.length === 0) {
    container.innerHTML = '<p class="time-history-empty">入力履歴がありません。シフトを追加すると、ここに表示されます。</p>';
    return;
  }
  
  container.innerHTML = history.map(item => {
    const workplaceName = item.workplaceName || '職場未設定';
    return `
      <button type="button" class="time-history-item" 
              data-start="${item.start}" 
              data-end="${item.end}" 
              data-workplace-id="${item.workplaceId || ''}">
        <div class="time-history-workplace">${escapeHtml(workplaceName)}</div>
        <div class="time-history-time-range">${item.start} - ${item.end}</div>
      </button>
    `;
  }).join('');
  
  // 履歴アイテムのイベントリスナー（クリックで直接予定を追加）
  container.querySelectorAll('.time-history-item').forEach(btn => {
    const start = btn.dataset.start;
    const end = btn.dataset.end;
    const workplaceId = btn.dataset.workplaceId || '';
    
    eventListeners.add(btn, 'click', async () => {
      const dateInput = safeGetElementById('shiftDate');
      const dateStr = dateInput ? dateInput.value : '';
      
      if (!dateStr) {
        showMessage('日付を選択してください。', 'error', 3000);
        return;
      }
      
      if (!workplaceId) {
        showMessage('職場が設定されていない履歴です。', 'error', 3000);
        return;
      }
      
      const workplace = workplaces.find(w => w.id === workplaceId);
      if (!workplace) {
        showMessage('職場が見つかりません。', 'error', 3000);
        return;
      }
      
      try {
        showLoading('保存中...');
        
        const rate = workplace.rate || 0;
        const startTime = `${dateStr}T${start}`;
        const endTime = `${dateStr}T${end}`;
        
        // 労働時間と深夜時間を計算（22:00〜5:00 は深夜）
        const { totalHours, nightHours } = calculateWorkAndNightHours(start, end);
        // 6時間以上なら1時間休憩（無給）を引く
        const breakHours = totalHours >= 6 ? 1 : 0;
        const paidHours = Math.max(0, totalHours - breakHours);
        
        // 深夜割増（22:00〜5:00は1.25倍）
        const basePay = paidHours * rate;
        const nightExtra = nightHours * rate * 0.25;
        const totalPay = basePay + nightExtra;

        const event = {
          title: workplace.name || 'シフト',
          description: '',
          startTime: startTime,
          endTime: endTime,
          color: '#3b82f6',
          date: dateStr,
          start: start,
          end: end,
          role: workplace.name,
          workplaceId: workplaceId,
          workplaceName: workplace.name,
          rate: rate,
          notes: '',
          durationHours: paidHours,
          rawDurationHours: totalHours,
          breakHours: breakHours,
          nightHours: nightHours,
          totalPay: totalPay
        };
        
        const newId = await addEvent(event);
        if (newId) {
          hideLoading();
          closeEventModal();
          showMessage('シフトを追加しました', 'success', 3000);
          
          // 収入タブが表示中の場合は更新
          if (currentTab === 'income') {
            renderIncomeViews();
          }
        } else {
          hideLoading();
          showMessage('シフトの保存に失敗しました。', 'error', 6000);
        }
      } catch (error) {
        hideLoading();
        showMessage('シフトの追加に失敗しました。再度お試しください。', 'error', 6000);
      }
    });
  });
}

// 時間の差を計算して表示（例: "8時間"）
function calculateDuration(start, end) {
  if (!start || !end) return '';
  
  const [startHour, startMin] = start.split(':').map(Number);
  const [endHour, endMin] = end.split(':').map(Number);
  
  if (Number.isNaN(startHour) || Number.isNaN(startMin) || 
      Number.isNaN(endHour) || Number.isNaN(endMin)) return '';
  
  let startTotalMin = startHour * 60 + startMin;
  let endTotalMin = endHour * 60 + endMin;
  
  // 日をまたぐ場合は24時間を加算
  if (endTotalMin <= startTotalMin) {
    endTotalMin += 24 * 60;
  }
  
  const totalMinutes = endTotalMin - startTotalMin;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours > 0 && minutes > 0) {
    return `${hours}時間${minutes}分`;
  } else if (hours > 0) {
    return `${hours}時間`;
  } else if (minutes > 0) {
    return `${minutes}分`;
  }
  return '';
}

// ========== 収入タブ機能 ==========

// 収入タブを表示
function renderIncomeTab() {
  const container = safeGetElementById('incomeStats');
  if (!container) return;
  
  if (!Array.isArray(events) || events.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">データがありません。</p>';
    return;
  }
  
  // 収入を集計
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisYear = new Date(now.getFullYear(), 0, 1);
  
  let thisMonthTotal = 0;
  let lastMonthTotal = 0;
  let thisYearTotal = 0;
  let allTimeTotal = 0;
  
  events.forEach(event => {
    if (!event.workplaceId) return; // 職場が設定されていないシフトは除外
    
    // 日付を取得
    let eventDate = null;
    if (event.date) {
      eventDate = new Date(event.date + 'T00:00:00');
    } else if (event.startTime) {
      eventDate = new Date(event.startTime.split('T')[0] + 'T00:00:00');
    }
    if (!eventDate || Number.isNaN(eventDate.getTime())) return;
    
    // 労働時間と深夜時間を計算
    const rate = event.rate || 0;
    let durationHours = event.durationHours || 0;
    let nightHours = event.nightHours || 0;
    if ((!durationHours || !nightHours) && event.start && event.end) {
      const hoursInfo = calculateWorkAndNightHours(event.start, event.end);
      durationHours = hoursInfo.totalHours;
      nightHours = hoursInfo.nightHours;
    } else if ((!durationHours || !nightHours) && event.startTime && event.endTime) {
      const start = new Date(event.startTime);
      const end = new Date(event.endTime);
      const durationMs = end.getTime() - start.getTime();
      durationHours = durationMs / (1000 * 60 * 60);
      // startTime/endTime からは深夜時間を厳密には出せないので 0 扱い（古いデータ用）
      nightHours = nightHours || 0;
    }

    // 深夜割増（22:00〜5:00は1.25倍）
    const basePay = durationHours * rate;
    const nightExtra = nightHours * rate * 0.25;
    const totalPay = basePay + nightExtra;
    
    const eventYear = eventDate.getFullYear();
    const eventMonth = eventDate.getMonth();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth();
    
    if (eventYear === nowYear && eventMonth === nowMonth) {
      thisMonthTotal += totalPay;
    }
    if (eventYear === nowYear && eventMonth === nowMonth - 1) {
      lastMonthTotal += totalPay;
    } else if (eventYear === nowYear - 1 && eventMonth === 11 && nowMonth === 0) {
      lastMonthTotal += totalPay;
    }
    if (eventYear === nowYear) {
      thisYearTotal += totalPay;
    }
    allTimeTotal += totalPay;
  });
  
  container.innerHTML = `
    <div class="income-stat-card">
      <h3>今月</h3>
      <div class="amount">${formatCurrency(thisMonthTotal)}</div>
    </div>
    <div class="income-stat-card">
      <h3>先月</h3>
      <div class="amount">${formatCurrency(lastMonthTotal)}</div>
    </div>
    <div class="income-stat-card">
      <h3>今年</h3>
      <div class="amount">${formatCurrency(thisYearTotal)}</div>
    </div>
    <div class="income-stat-card">
      <h3>累計</h3>
      <div class="amount">${formatCurrency(allTimeTotal)}</div>
    </div>
  `;
}

// 通貨フォーマット
function formatCurrency(amount) {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY'
  }).format(Math.round(amount || 0));
}

// イベントバリデーション
function validateEvent(event) {
  const errors = [];
  
  // タイトルは空でも許可
  if (event.title && event.title.length > 100) {
    errors.push('タイトルは100文字以内で入力してください');
  }
  
  if (!event.startTime) {
    errors.push(event.allDay ? '開始日を入力してください' : '開始時刻を入力してください');
  }
  
  if (!event.endTime) {
    errors.push(event.allDay ? '終了日を入力してください' : '終了時刻を入力してください');
  }
  
  if (event.startTime && event.endTime) {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      errors.push('無効な日付形式です');
    } else if (end <= start) {
      errors.push(event.allDay ? '終了日は開始日以降にしてください' : '終了時刻は開始時刻より後にしてください');
    }
  }
  
  if (event.description && event.description.length > 500) {
    errors.push('説明は500文字以内で入力してください');
  }
  
  // 繰り返しのバリデーション
  if (event.recurrence && event.recurrence !== 'none') {
    if (event.recurrenceEnd) {
      if (!event.startTime) {
        errors.push('繰り返しを設定するには開始時刻が必要です');
      } else {
        const start = new Date(event.startTime);
        // recurrenceEnd is a date-only string (YYYY-MM-DD), so we need to parse it correctly
        const recurEndStr = (event.recurrenceEnd && typeof event.recurrenceEnd === 'string' && event.recurrenceEnd.includes('T'))
          ? event.recurrenceEnd 
          : (event.recurrenceEnd || '') + 'T23:59:59';
        const recurEnd = new Date(recurEndStr);
        if (Number.isNaN(start.getTime()) || Number.isNaN(recurEnd.getTime())) {
          errors.push('繰り返し終了日の形式が正しくありません');
        } else if (recurEnd < start) {
          errors.push('繰り返し終了日は開始日以降にしてください');
        }
      }
    }
  }
  
  return errors;
}


// 初期化（combiと同じロジック）
document.addEventListener('DOMContentLoaded', function() {
  
  // Firebase接続チェック
  if (!checkFirebase()) {
    showMessage('Firebaseに接続できません。設定を確認してから再読み込みしてください。', 'error', 6000);
    return;
  }
  
  // シフトを読み込み
  loadEvents();
  
  // 職場データを読み込み
  loadWorkplaces();
  
  // イベントリスナーを登録
  setupEventListeners();
  
  // タブ機能を初期化
  setupTabs();
  
  // 月次ビューを表示
  currentView = 'month';
  switchView('month');
  updateViews();
  
});

window.addEventListener('beforeunload', () => {
  // Firebaseリスナーのクリーンアップ
  if (typeof unsubscribeEvents === 'function') {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }
  // すべてのイベントリスナーのクリーンアップ
  eventListeners.removeAll();
  clearScheduledNotifications();
});

// タブ切り替え機能
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    eventListeners.add(btn, 'click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  currentTab = tabName;
  
  // タブボタンの状態を更新
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // タブコンテンツの表示を切り替え
  document.querySelectorAll('.tab-content').forEach(content => {
    if (content.id === `${tabName}TabContent`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
  
  // タブに応じた処理
  if (tabName === 'income') {
    setupIncomeViewControlsOnce();
    renderIncomeViews();
  } else if (tabName === 'settings') {
    renderWorkplacesList();
  }
}

// イベントリスナーの設定
function setupEventListeners() {
  // 既存のリスナーをクリーンアップ（再初期化時）
  eventListeners.removeAll();
  
  // 月次ナビゲーション
  const prevMonthBtn = safeGetElementById('prevMonth');
  if (prevMonthBtn) {
    const handler = () => {
      try {
        currentDate = addMonths(currentDate, -1);
        updateViews();
      } catch (error) {
        showMessage('月の移動に失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(prevMonthBtn, 'click', handler);
  }
  
  const nextMonthBtn = safeGetElementById('nextMonth');
  if (nextMonthBtn) {
    const handler = () => {
      try {
        currentDate = addMonths(currentDate, 1);
        updateViews();
      } catch (error) {
        showMessage('月の移動に失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(nextMonthBtn, 'click', handler);
  }
  
  // 月次ナビゲーション（ヘッダーの矢印を使用）
  // prevDay/nextDay が月次ビュー時は前月/翌月に動作するように既に実装済み
  
  const todayBtn = safeGetElementById('todayBtn');
  if (todayBtn) {
    const handler = () => {
      try {
        currentDate = new Date();
        updateViews();
      } catch (error) {
        showMessage('今日の日付への移動に失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(todayBtn, 'click', handler);
  }
  
  // 月次ビューのみ（ビュー切り替えは不要）
  const monthViewBtn = safeGetElementById('monthViewBtn');
  if (monthViewBtn) {
    // 月次ビューのみなので、何もしない
  }
  
  // モーダル関連
  const closeModalBtn = safeGetElementById('closeModal');
  if (closeModalBtn) {
    eventListeners.add(closeModalBtn, 'click', closeEventModal);
  }
  
  // モーダル外クリックで閉じる
  const eventModal = safeGetElementById('shiftModal');
  if (eventModal) {
    const handler = (e) => {
      try {
        if (e.target.id === 'shiftModal' || e.target.classList.contains('modal')) {
          closeEventModal();
        }
      } catch (error) {
      }
    };
    eventListeners.add(eventModal, 'click', handler);
  }
  
  // ESCキーでモーダルを閉じる
  const escHandler = (e) => {
    try {
      if (e.key === 'Escape') {
        const modal = safeGetElementById('shiftModal');
        if (modal && modal.classList.contains('show')) {
          closeEventModal();
        }
      }
    } catch (error) {
    }
  };
  eventListeners.add(document, 'keydown', escHandler);
  
  // フォーム送信
  const eventForm = safeGetElementById('shiftForm');
  if (!eventForm) {
    return;
  }
  
  const submitHandler = async (e) => {
    e.preventDefault();
    
    // Prevent double submission
    if (eventForm.dataset.submitting === 'true') {
      return;
    }
    eventForm.dataset.submitting = 'true';
    
    try {
      showLoading('保存中...');
      
      const formData = new FormData(e.target);
      const date = formData.get('date') || '';
      const start = formData.get('start') || '';
      const end = formData.get('end') || '';
      const workplaceId = formData.get('workplace') || '';
      const rate = formData.get('rate') ? Number(formData.get('rate')) : null;
      const notes = sanitizeTextInput(formData.get('notes') || '');
      
      // バリデーション
      if (!date || !start || !end) {
        hideLoading();
        showMessage('日付、開始時間、終了時間は必須です。', 'error', 6000);
        delete eventForm.dataset.submitting;
        return;
      }
      
      if (!workplaceId) {
        hideLoading();
        showMessage('職場を選択してください。', 'error', 6000);
        delete eventForm.dataset.submitting;
        return;
      }
      
      // 職場情報を取得
      const workplace = workplaces.find(w => w.id === workplaceId);
      if (!workplace) {
        hideLoading();
        showMessage('選択された職場が見つかりません。', 'error', 6000);
        delete eventForm.dataset.submitting;
        return;
      }
      
      // 時給が未入力の場合は職場の時給を使用
      const finalRate = rate || workplace.rate || 0;
      
      // シフトデータをイベント形式に変換（互換性のため）
      const startTime = `${date}T${start}`;
      const endTime = `${date}T${end}`;
      
      // 労働時間と深夜時間を計算（22:00〜5:00 は深夜）
      const { totalHours, nightHours } = calculateWorkAndNightHours(start, end);
      // 6時間以上なら1時間休憩（無給）を引く
      const breakHours = totalHours >= 6 ? 1 : 0;
      const paidHours = Math.max(0, totalHours - breakHours);
      
      // 深夜割増（22:00〜5:00は1.25倍）
      const basePay = paidHours * finalRate;
      const nightExtra = nightHours * finalRate * 0.25;
      const totalPay = basePay + nightExtra;

      const event = {
        title: workplace.name || 'シフト',
        description: notes,
        startTime: startTime,
        endTime: `${date}T${end}`,
        color: workplace.color || '#3b82f6', // 職場の色を使用
        // シフトデータも保持（互換性のため）
        date: date,
        start: start,
        end: end,
        role: workplace.name, // 職場名をroleとして保存（互換性のため）
        workplaceId: workplaceId,
        workplaceName: workplace.name,
        rate: finalRate,
        notes: notes,
        durationHours: paidHours,
        rawDurationHours: totalHours,
        breakHours: breakHours,
        nightHours: nightHours,
        totalPay: totalPay
      };
      
      if (editingEventId && typeof editingEventId === 'string' && editingEventId.startsWith('temp-')) {
        // 一時的イベントを正式なイベントに変換
        if (!Array.isArray(events)) {
          hideLoading();
          showMessage('シフトの保存に失敗しました。', 'error', 6000);
          delete eventForm.dataset.submitting;
          return;
        }
        const tempEventIndex = events.findIndex(e => e.id === editingEventId);
        if (tempEventIndex !== -1) {
          events.splice(tempEventIndex, 1);
        }
        
        const newEvent = {
          ...event,
          createdAt: new Date().toISOString()
        };
        
        const newId = await addEvent(newEvent);
        if (newId && !isFirebaseEnabled) {
          newEvent.id = newId;
          events.push(newEvent);
        }
      } else if (editingEventId) {
        // 既存シフトを更新
        await updateEvent(editingEventId, event);
        if (Array.isArray(events)) {
          const eventIndex = events.findIndex(e => e.id === editingEventId);
          if (eventIndex !== -1) {
            events[eventIndex] = {
              ...events[eventIndex],
              ...event,
              updatedAt: new Date().toISOString()
            };
          }
        }
      } else {
        // 新規シフトを作成
        const newId = await addEvent(event);
        if (newId && !isFirebaseEnabled) {
          const newEvent = { ...event, id: newId, createdAt: new Date().toISOString() };
          events.push(newEvent);
        }
      }
      
      hideLoading();
      closeEventModal();
      showMessage(editingEventId ? 'シフトを更新しました' : 'シフトを追加しました', 'success', 3000);
      
      // 収入タブが表示中の場合は更新
      if (currentTab === 'income') {
        renderIncomeViews();
      }
    } catch (error) {
      hideLoading();
      showMessage('シフトの保存に失敗しました。再度お試しください。', 'error', 6000);
    } finally {
      delete eventForm.dataset.submitting;
    }
  };
  eventListeners.add(eventForm, 'submit', submitHandler);
  
  // 削除ボタン
  const deleteBtn = safeGetElementById('deleteBtn');
  if (deleteBtn) {
    const deleteHandler = async () => {
      if (!editingEventId) return;
      
      const confirmed = await showConfirmModal('この予定を削除してもよろしいですか？', '削除の確認');
      if (confirmed) {
        try {
          showLoading('削除中...');
          await deleteEvent(editingEventId);
          hideLoading();
          closeEventModal();
          showMessage('予定を削除しました', 'success', 3000);
          
          // 収入タブが表示中の場合は更新
          if (currentTab === 'income') {
            renderIncomeViews();
          }
        } catch (error) {
          hideLoading();
          showMessage('イベントの削除に失敗しました。', 'error', 6000);
        }
      }
    };
    eventListeners.add(deleteBtn, 'click', deleteHandler);
  }
  
  // 繰り返し機能はpart-timeアプリには不要（削除）
  
  // 職場管理のイベントリスナー
  const addWorkplaceBtn = safeGetElementById('addWorkplaceBtn');
  if (addWorkplaceBtn) {
    const handler = () => {
      try {
        showWorkplaceModal();
      } catch (error) {
        showMessage('職場追加の表示に失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(addWorkplaceBtn, 'click', handler);
  }
  
  const closeWorkplaceModalBtn = safeGetElementById('closeWorkplaceModal');
  if (closeWorkplaceModalBtn) {
    eventListeners.add(closeWorkplaceModalBtn, 'click', closeWorkplaceModal);
  }
  
  const workplaceForm = safeGetElementById('workplaceForm');
  const workplaceSubmitBtn = workplaceForm ? workplaceForm.querySelector('button[type="submit"]') : null;
  
  if (workplaceForm) {
    const submitHandler = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (workplaceForm.dataset.submitting === 'true') {
        return;
      }
      workplaceForm.dataset.submitting = 'true';
      
      try {
        showLoading('保存中...');
        
        const formData = new FormData(e.target);
        const name = sanitizeTextInput(formData.get('name') || '');
        const rate = Number(formData.get('rate')) || 0;
        const color = formData.get('color') || '#3b82f6';


        if (!name || name.trim() === '') {
          hideLoading();
          showMessage('職場名を入力してください。', 'error', 6000);
          delete workplaceForm.dataset.submitting;
          return;
        }

        if (rate <= 0 || Number.isNaN(rate)) {
          hideLoading();
          showMessage('時給を正しく入力してください。', 'error', 6000);
          delete workplaceForm.dataset.submitting;
          return;
        }

        const workplace = { name: name.trim(), rate, color };
        
        let success = false;
        try {
          if (editingWorkplaceId) {
            await updateWorkplace(editingWorkplaceId, workplace);
            showMessage('職場を更新しました', 'success', 3000);
            success = true;
          } else {
            const newId = await addWorkplace(workplace);
            showMessage('職場を追加しました', 'success', 3000);
            success = true;
          }
        } catch (saveError) {
          throw saveError; // エラーを再スローしてcatchブロックで処理
        } finally {
          // 成功・失敗に関わらずローディングを非表示にする
          hideLoading();
          
          if (success) {
            closeWorkplaceModal();
            renderWorkplacesList();
            updateWorkplaceSelect();
          }
        }
      } catch (error) {
        showMessage(`職場の保存に失敗しました: ${error.message || '不明なエラー'}`, 'error', 6000);
      } finally {
        // 確実にローディングを非表示にする
        hideLoading();
        delete workplaceForm.dataset.submitting;
      }
    };
    eventListeners.add(workplaceForm, 'submit', submitHandler);
    
    // 念のため、送信ボタンにも直接イベントリスナーを追加
    if (workplaceSubmitBtn) {
      const buttonHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // フォームのsubmitイベントを手動で発火
        if (workplaceForm) {
          const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
          workplaceForm.dispatchEvent(submitEvent);
        }
      };
      eventListeners.add(workplaceSubmitBtn, 'click', buttonHandler);
    }
  } else {
  }
  
  const deleteWorkplaceBtn = safeGetElementById('deleteWorkplaceBtn');
  if (deleteWorkplaceBtn) {
    const handler = async () => {
      if (!editingWorkplaceId) return;
      const confirmed = await showConfirmModal('この職場を削除してもよろしいですか？', '削除の確認');
      if (confirmed) {
        try {
          showLoading('削除中...');
          await deleteWorkplace(editingWorkplaceId);
          hideLoading();
          closeWorkplaceModal();
          showMessage('職場を削除しました', 'success', 3000);
          renderWorkplacesList();
          updateWorkplaceSelect();
        } catch (error) {
          hideLoading();
          showMessage('職場の削除に失敗しました。', 'error', 6000);
        }
      }
    };
    eventListeners.add(deleteWorkplaceBtn, 'click', handler);
  }
  
  // 職場選択の変更時に時給を自動入力
  const shiftWorkplaceSelect = safeGetElementById('shiftWorkplace');
  if (shiftWorkplaceSelect) {
    const handler = () => {
      try {
        const workplaceId = shiftWorkplaceSelect.value;
        if (workplaceId) {
          const workplace = workplaces.find(w => w.id === workplaceId);
          if (workplace) {
            const rateInput = safeGetElementById('shiftRate');
            if (rateInput) {
              rateInput.value = workplace.rate || '';
            }
          }
        }
        // 時間候補を更新
      } catch (error) {
      }
    };
    eventListeners.add(shiftWorkplaceSelect, 'change', handler);
  }
}

// 労働時間と深夜時間（22:00〜5:00）を計算
function calculateWorkAndNightHours(startStr, endStr) {
  if (!startStr || !endStr) {
    return { totalHours: 0, nightHours: 0 };
  }
  const [startHour, startMin] = startStr.split(':').map(Number);
  const [endHour, endMin] = endStr.split(':').map(Number);
  if (
    Number.isNaN(startHour) ||
    Number.isNaN(startMin) ||
    Number.isNaN(endHour) ||
    Number.isNaN(endMin)
  ) {
    return { totalHours: 0, nightHours: 0 };
  }

  const startTotalMin = startHour * 60 + startMin;
  let endTotalMin = endHour * 60 + endMin;
  // 日をまたぐ場合は24時間を加算
  if (endTotalMin <= startTotalMin) {
    endTotalMin += 24 * 60;
  }

  const totalMinutes = endTotalMin - startTotalMin;

  // 深夜帯: 22:00〜29:00 (翌5:00) を 1日の時間軸上で扱う
  const nightStart1 = 22 * 60; // 22:00
  const nightEnd1 = 24 * 60; // 24:00
  const nightStart2 = 24 * 60; // 24:00
  const nightEnd2 = 29 * 60; // 29:00 (翌5:00)

  const overlap = (s1, e1, s2, e2) => {
    const start = Math.max(s1, s2);
    const end = Math.min(e1, e2);
    return Math.max(0, end - start);
  };

  const nightMinutes1 = overlap(startTotalMin, endTotalMin, nightStart1, nightEnd1);
  const nightMinutes2 = overlap(startTotalMin, endTotalMin, nightStart2, nightEnd2);
  const nightMinutes = nightMinutes1 + nightMinutes2;

  return {
    totalHours: totalMinutes / 60,
    nightHours: nightMinutes / 60,
  };
}

// ========== 収入タブ（月/年ビュー） ==========
let incomeViewMode = 'month'; // 'month' | 'year'
const nowForIncome = new Date();
let incomeCurrentMonth = new Date(nowForIncome.getFullYear(), nowForIncome.getMonth(), 1);
let incomeCurrentYear = nowForIncome.getFullYear();
let incomeControlsInitialized = false;

function calculateShiftIncome(event) {
  if (!event || !event.workplaceId) return null;

  // 日付
  let eventDate = null;
  if (event.date) {
    eventDate = new Date(event.date + 'T00:00:00');
  } else if (event.startTime) {
    eventDate = new Date(event.startTime.split('T')[0] + 'T00:00:00');
  }
  if (!eventDate || Number.isNaN(eventDate.getTime())) return null;

  const rate = event.rate || 0;
  const start = event.start || (event.startTime ? event.startTime.split('T')[1]?.slice(0, 5) : '');
  const end = event.end || (event.endTime ? event.endTime.split('T')[1]?.slice(0, 5) : '');
  if (!start || !end) return null;

  const { totalHours, nightHours } = calculateWorkAndNightHours(start, end);
  if (!Number.isFinite(totalHours) || totalHours <= 0) return null;

  const breakHours = totalHours >= 6 ? 1 : 0;
  const paidHours = Math.max(0, totalHours - breakHours);

  const basePay = paidHours * rate;
  const nightExtra = nightHours * rate * 0.25;
  const totalPay = basePay + nightExtra;

  return {
    date: eventDate,
    rate,
    totalHours,
    paidHours,
    nightHours,
    breakHours,
    totalPay,
  };
}

function renderIncomeViews() {
  const monthStatsContainer = safeGetElementById('incomeMonthStats');
  const yearChartContainer = safeGetElementById('incomeYearChart');
  const monthLabel = safeGetElementById('incomeCurrentMonthLabel');
  const yearLabel = safeGetElementById('incomeCurrentYearLabel');

  if (!monthStatsContainer || !yearChartContainer || !monthLabel || !yearLabel) return;

  const yearStatsContainer = safeGetElementById('incomeYearStats');
  
  const monthProgressContainer = safeGetElementById('incomeMonthProgress');
  
  if (!Array.isArray(events) || events.length === 0) {
    monthStatsContainer.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">データがありません。</p>';
    if (monthProgressContainer) {
      monthProgressContainer.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem; text-align: center;">データがありません。</p>';
    }
    yearChartContainer.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem; text-align: center;">データがありません。</p>';
    if (yearStatsContainer) {
      yearStatsContainer.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem; text-align: center;">データがありません。</p>';
    }
    return;
  }

  const incomes = events
    .map(ev => calculateShiftIncome(ev))
    .filter(info => info !== null);

  if (incomes.length === 0) {
    monthStatsContainer.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">データがありません。</p>';
    if (monthProgressContainer) {
      monthProgressContainer.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem; text-align: center;">データがありません。</p>';
    }
    yearChartContainer.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem; text-align: center;">データがありません。</p>';
    if (yearStatsContainer) {
      yearStatsContainer.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem; text-align: center;">データがありません。</p>';
    }
    return;
  }

  // 月ビュー
  const monthBase = new Date(incomeCurrentMonth.getFullYear(), incomeCurrentMonth.getMonth(), 1);
  const monthYear = monthBase.getFullYear();
  const monthIndex = monthBase.getMonth();
  monthLabel.textContent = `${monthYear}年${monthIndex + 1}月`;

  let monthPaidHours = 0;
  let monthTotalPay = 0;

  incomes.forEach(info => {
    const y = info.date.getFullYear();
    const m = info.date.getMonth();
    if (y === monthYear && m === monthIndex) {
      monthPaidHours += info.paidHours;
      monthTotalPay += info.totalPay;
    }
  });

  // 月収入の円形プログレスバーを表示
  const MONTHLY_TARGET = 90000; // 月9万円を目標
  if (monthProgressContainer) {
    const progressPercent = Math.min(100, (monthTotalPay / MONTHLY_TARGET) * 100);
    const circumference = 2 * Math.PI * 45; // 半径45pxの円周
    const offset = circumference - (progressPercent / 100) * circumference;
    const isAchieved = monthTotalPay >= MONTHLY_TARGET;
    const progressColor = isAchieved ? '#10b981' : 'var(--primary-color)';
    const remainingText = monthTotalPay < MONTHLY_TARGET 
      ? `あと ${formatCurrency(MONTHLY_TARGET - monthTotalPay)}` 
      : '目標達成！';
    
    monthProgressContainer.innerHTML = `
      <div class="income-progress-card">
        <div class="income-progress-title">
          <h3>月収目標</h3>
          <div class="income-progress-target">目標: ${formatCurrency(MONTHLY_TARGET)}</div>
        </div>
        <div class="income-circular-progress">
          <svg class="income-progress-svg" viewBox="0 0 100 100">
            <!-- 背景の円 -->
            <circle
              class="income-progress-background"
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="var(--bg-hover)"
              stroke-width="8"
            />
            <!-- プログレスバーの円 -->
            <circle
              class="income-progress-circle ${isAchieved ? 'achieved' : ''}"
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="${progressColor}"
              stroke-width="8"
              stroke-linecap="round"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${offset}"
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div class="income-progress-content">
            <div class="income-progress-amount" style="color: ${progressColor};">${formatCurrency(monthTotalPay)}</div>
            <div class="income-progress-percent">${progressPercent.toFixed(1)}%</div>
            <div class="income-progress-remaining ${isAchieved ? 'achieved' : ''}">
              ${remainingText}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  monthStatsContainer.innerHTML = `
    <div class="income-stat-card">
      <h3>勤務時間（有給）</h3>
      <div class="amount">${monthPaidHours.toFixed(2)} h</div>
    </div>
    <div class="income-stat-card">
      <h3>給料見込み</h3>
      <div class="amount">${formatCurrency(monthTotalPay)}</div>
    </div>
  `;

  // 年ビュー（統計情報と棒グラフ）
  const year = incomeCurrentYear;
  yearLabel.textContent = `${year}年`;

  // 月ごとのデータを集計
  const monthBuckets = Array.from({ length: 12 }, () => ({
    totalPay: 0,
    paidHours: 0,
    shiftCount: 0,
  }));

  incomes.forEach(info => {
    const y = info.date.getFullYear();
    const m = info.date.getMonth();
    if (y === year) {
      monthBuckets[m].totalPay += info.totalPay;
      monthBuckets[m].paidHours += info.paidHours;
      monthBuckets[m].shiftCount += 1;
    }
  });

  // 年間統計を計算
  const yearTotalPay = monthBuckets.reduce((sum, bucket) => sum + bucket.totalPay, 0);
  const yearTotalHours = monthBuckets.reduce((sum, bucket) => sum + bucket.paidHours, 0);
  const yearShiftCount = monthBuckets.reduce((sum, bucket) => sum + bucket.shiftCount, 0);
  const avgMonthlyPay = yearTotalPay / 12;
  
  // 最高/最低月を求める
  const monthsWithData = monthBuckets.map((bucket, idx) => ({ ...bucket, month: idx + 1 }));
  const monthsWithPay = monthsWithData.filter(b => b.totalPay > 0);
  const maxMonth = monthsWithPay.length > 0 
    ? monthsWithPay.reduce((max, bucket) => bucket.totalPay > max.totalPay ? bucket : max, monthsWithPay[0])
    : null;
  const minMonth = monthsWithPay.length > 0
    ? monthsWithPay.reduce((min, bucket) => bucket.totalPay < min.totalPay ? bucket : min, monthsWithPay[0])
    : null;

  // 年間統計情報を表示
  if (yearStatsContainer) {
    yearStatsContainer.innerHTML = `
      <div class="income-stat-card">
        <h3>年間合計</h3>
        <div class="amount">${formatCurrency(yearTotalPay)}</div>
      </div>
      <div class="income-stat-card">
        <h3>平均月収</h3>
        <div class="amount">${formatCurrency(avgMonthlyPay)}</div>
      </div>
      <div class="income-stat-card">
        <h3>年間勤務時間</h3>
        <div class="amount">${yearTotalHours.toFixed(2)} h</div>
      </div>
      <div class="income-stat-card">
        <h3>シフト回数</h3>
        <div class="amount">${yearShiftCount} 回</div>
      </div>
      ${maxMonth ? `
      <div class="income-stat-card">
        <h3>最高月収</h3>
        <div class="amount">${formatCurrency(maxMonth.totalPay)}</div>
        <div class="amount-sub">${maxMonth.month}月</div>
      </div>
      ` : ''}
      ${minMonth && minMonth.month !== maxMonth?.month ? `
      <div class="income-stat-card">
        <h3>最低月収</h3>
        <div class="amount">${formatCurrency(minMonth.totalPay)}</div>
        <div class="amount-sub">${minMonth.month}月</div>
      </div>
      ` : ''}
    `;
  }

  // グラフを描画
  const maxPay = Math.max(...monthBuckets.map(b => b.totalPay), 0) || 1;
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  
  // グラフコンテナを作成
  let chartHTML = '<div class="income-year-chart-wrapper">';
  
  // Y軸のラベル（最大値の約25%, 50%, 75%, 100%）
  chartHTML += '<div class="income-year-chart-y-axis">';
  const yAxisValues = [
    Math.ceil(maxPay),
    Math.ceil(maxPay * 0.75),
    Math.ceil(maxPay * 0.5),
    Math.ceil(maxPay * 0.25)
  ];
  yAxisValues.forEach(val => {
    chartHTML += `<div class="income-year-chart-y-label">${formatCurrency(val)}</div>`;
  });
  chartHTML += '</div>';
  
  // グラフエリア
  chartHTML += '<div class="income-year-chart-bars">';
  chartHTML += monthBuckets
    .map((bucket, idx) => {
      const heightPercent = bucket.totalPay > 0 
        ? Math.max(4, (bucket.totalPay / maxPay) * 100)
        : 0;
      const hasData = bucket.totalPay > 0;
      const tooltipText = hasData
        ? `${monthNames[idx]}\n収入: ${formatCurrency(bucket.totalPay)}\n勤務時間: ${bucket.paidHours.toFixed(2)}h\nシフト: ${bucket.shiftCount}回`
        : `${monthNames[idx]}\nデータなし`;
      
      return `
        <div class="income-year-bar-wrapper">
          <div 
            class="income-year-bar ${hasData ? 'has-data' : 'no-data'}" 
            data-month="${idx + 1}"
            data-amount="${bucket.totalPay}"
            data-hours="${bucket.paidHours.toFixed(2)}"
            data-shifts="${bucket.shiftCount}"
            data-width-percent="${heightPercent}"
            title="${escapeHtml(tooltipText)}"
          >
            <div class="income-year-bar-inner" style="height: ${heightPercent}%;" data-width-percent="${heightPercent}">
              ${hasData ? `<div class="income-year-bar-value">${formatCurrency(bucket.totalPay)}</div>` : ''}
            </div>
            <div class="income-year-bar-label">${monthNames[idx]}</div>
          </div>
        </div>
      `;
    })
    .join('');
  chartHTML += '</div>';
  
  chartHTML += '</div>'; // chart-wrapper終了
  
  yearChartContainer.innerHTML = chartHTML;
  
  // モバイル表示時にバーの幅を設定（横バーグラフ用）
  const isMobile = window.innerWidth <= 640;
  if (isMobile) {
    setTimeout(() => {
      yearChartContainer.querySelectorAll('.income-year-bar').forEach(bar => {
        const inner = bar.querySelector('.income-year-bar-inner');
        if (!inner) return;
        
        const widthPercent = parseFloat(inner.dataset.widthPercent) || 0;
        if (widthPercent <= 0) {
          inner.style.width = '0px';
          return;
        }
        
        // 親要素の幅を取得
        const wrapper = bar.closest('.income-year-bar-wrapper');
        if (!wrapper || wrapper.offsetWidth === 0) return;
        
        const wrapperWidth = wrapper.offsetWidth;
        // ラベル部分の幅を取得
        const labelElement = bar.querySelector('.income-year-bar-label');
        const labelWidth = labelElement ? labelElement.offsetWidth : 32;
        const gap = 6.4; // 0.4rem ≈ 6.4px
        const availableWidth = wrapperWidth - labelWidth - gap;
        
        // 最大値に対する収入の割合を横幅（ピクセル）に変換
        // widthPercentは0-100の範囲で、これを利用可能な幅（availableWidth）に対する割合として計算
        const calculatedWidthPx = Math.max(5, (widthPercent / 100) * availableWidth);
        inner.style.width = `${calculatedWidthPx}px`;
        inner.style.height = '1.25rem';
        inner.style.minHeight = '1.25rem';
        inner.style.maxHeight = '1.25rem';
      });
    }, 150);
  }
  
  // ホバー時の詳細表示を設定
  yearChartContainer.querySelectorAll('.income-year-bar.has-data').forEach(bar => {
    const amount = parseFloat(bar.dataset.amount) || 0;
    const hours = parseFloat(bar.dataset.hours) || 0;
    const shifts = parseInt(bar.dataset.shifts) || 0;
    const month = bar.dataset.month;
    
    bar.addEventListener('mouseenter', (e) => {
      const tooltip = document.createElement('div');
      tooltip.className = 'income-year-bar-tooltip';
      tooltip.innerHTML = `
        <div class="tooltip-header">${monthNames[parseInt(month) - 1]}</div>
        <div class="tooltip-content">
          <div class="tooltip-item">
            <span class="tooltip-label">収入:</span>
            <span class="tooltip-value">${formatCurrency(amount)}</span>
          </div>
          <div class="tooltip-item">
            <span class="tooltip-label">勤務時間:</span>
            <span class="tooltip-value">${hours.toFixed(2)}h</span>
          </div>
          <div class="tooltip-item">
            <span class="tooltip-label">シフト:</span>
            <span class="tooltip-value">${shifts}回</span>
          </div>
        </div>
      `;
      
      const rect = bar.getBoundingClientRect();
      tooltip.style.position = 'fixed';
      tooltip.style.top = `${rect.top - tooltip.offsetHeight - 10}px`;
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
      tooltip.style.transform = 'translateX(-50%)';
      
      document.body.appendChild(tooltip);
      bar.dataset.tooltipId = 'tooltip-' + Date.now();
      tooltip.id = bar.dataset.tooltipId;
    });
    
    bar.addEventListener('mouseleave', () => {
      const tooltipId = bar.dataset.tooltipId;
      if (tooltipId) {
        const tooltip = document.getElementById(tooltipId);
        if (tooltip) {
          tooltip.remove();
        }
        delete bar.dataset.tooltipId;
      }
    });
  });
}

function setupIncomeViewControlsOnce() {
  if (incomeControlsInitialized) return;
  incomeControlsInitialized = true;

  const monthBtn = safeGetElementById('incomeMonthViewBtn');
  const yearBtn = safeGetElementById('incomeYearViewBtn');
  const monthView = safeGetElementById('incomeMonthView');
  const yearView = safeGetElementById('incomeYearView');
  const monthNav = safeGetElementById('incomeMonthNav');
  const yearNav = safeGetElementById('incomeYearNav');

  if (!monthBtn || !yearBtn || !monthView || !yearView || !monthNav || !yearNav) {
    return;
  }

  const switchIncomeView = (view) => {
    incomeViewMode = view;
    if (view === 'month') {
      monthBtn.classList.add('active');
      yearBtn.classList.remove('active');
      monthView.classList.add('active');
      yearView.classList.remove('active');
      monthNav.style.display = 'flex';
      yearNav.style.display = 'none';
    } else {
      monthBtn.classList.remove('active');
      yearBtn.classList.add('active');
      monthView.classList.remove('active');
      yearView.classList.add('active');
      monthNav.style.display = 'none';
      yearNav.style.display = 'flex';
    }
    renderIncomeViews();
  };

  eventListeners.add(monthBtn, 'click', () => switchIncomeView('month'));
  eventListeners.add(yearBtn, 'click', () => switchIncomeView('year'));

  const monthPrev = safeGetElementById('incomeMonthPrev');
  const monthNext = safeGetElementById('incomeMonthNext');
  if (monthPrev && monthNext) {
    eventListeners.add(monthPrev, 'click', () => {
      incomeCurrentMonth = new Date(
        incomeCurrentMonth.getFullYear(),
        incomeCurrentMonth.getMonth() - 1,
        1
      );
      incomeCurrentYear = incomeCurrentMonth.getFullYear();
      renderIncomeViews();
    });
    eventListeners.add(monthNext, 'click', () => {
      incomeCurrentMonth = new Date(
        incomeCurrentMonth.getFullYear(),
        incomeCurrentMonth.getMonth() + 1,
        1
      );
      incomeCurrentYear = incomeCurrentMonth.getFullYear();
      renderIncomeViews();
    });
  }

  const yearPrev = safeGetElementById('incomeYearPrev');
  const yearNext = safeGetElementById('incomeYearNext');
  if (yearPrev && yearNext) {
    eventListeners.add(yearPrev, 'click', () => {
      incomeCurrentYear -= 1;
      renderIncomeViews();
    });
    eventListeners.add(yearNext, 'click', () => {
      incomeCurrentYear += 1;
      renderIncomeViews();
    });
  }
}
