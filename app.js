/*
 * Part-Time Tracker - Clean Rebuild
 * Firebase v11 modular SDK integration
 */
const { DateTime } = luxon;

// DOM References
const dom = {
  shiftList: document.getElementById('shift-list'),
  recurringForm: document.getElementById('recurring-form'),
  recurringList: document.getElementById('recurring-list'),
  reminderForm: document.getElementById('reminder-form'),
  reminderList: document.getElementById('reminder-list'),
  jobForm: document.getElementById('job-form'),
  jobList: document.getElementById('job-list'),
  summaryHours: document.getElementById('summary-hours'),
  summaryIncome: document.getElementById('summary-income'),
  summaryDetails: document.getElementById('summary-details'),
  calendarMonth: document.getElementById('calendar-month'),
  calendarGrid: document.getElementById('calendar-grid'),
  calendarPrev: document.getElementById('calendar-prev'),
  calendarNext: document.getElementById('calendar-next'),
  notificationBtn: document.getElementById('enable-notifications'),
  workSettingsForm: document.getElementById('work-settings-form'),
  workLocation: document.getElementById('work-location'),
  defaultWage: document.getElementById('default-wage'),
  defaultStartTime: document.getElementById('default-start-time'),
  defaultEndTime: document.getElementById('default-end-time'),
  taxRate: document.getElementById('tax-rate'),
  shiftModal: document.getElementById('shift-modal'),
  calendarShiftForm: document.getElementById('calendar-shift-form'),
  modalClose: document.querySelector('.modal-close'),
  modalCancel: document.querySelector('.modal-cancel'),
  modalShiftDate: document.getElementById('modal-shift-date'),
  modalShiftStart: document.getElementById('modal-shift-start'),
  modalShiftStartHour: document.getElementById('modal-shift-start-hour'),
  modalShiftStartMinute: document.getElementById('modal-shift-start-minute'),
  modalShiftEnd: document.getElementById('modal-shift-end'),
  modalShiftEndHour: document.getElementById('modal-shift-end-hour'),
  modalShiftEndMinute: document.getElementById('modal-shift-end-minute'),
  modalShiftRate: document.getElementById('modal-shift-rate'),
  modalShiftRole: document.getElementById('modal-shift-role'),
  modalShiftNotes: document.getElementById('modal-shift-notes'),
  startSuggestion: document.getElementById('start-suggestion'),
  endSuggestion: document.getElementById('end-suggestion'),
  rateSuggestion: document.getElementById('rate-suggestion'),
  roleSuggestion: document.getElementById('role-suggestion'),
  modalDeleteBtn: document.getElementById('modal-delete-btn'),
};

const firebasePaths = {
  shifts: '/shifts',
  recurring: '/recurring',
  income: '/income',
  expenses: '/expenses',
  reminders: '/reminders',
  jobs: '/jobs',
};

const STORAGE_KEYS = {
  cache: 'part-time-tracker-cache',
  workSettings: 'work-settings',
};

// App State
let isFirebaseEnabled = false;
const appState = {
  listeners: {},
  shifts: {},
  recurring: {},
  income: {},
  expenses: {},
  reminders: {},
  jobs: {},
  calendarCursor: DateTime.now().startOf('month'),
};

const charts = {
  incomeExpense: null,
  hours: null,
  monthlyIncome: null,
  yearlyIncome: null,
};

const reminderTimers = new Map();
let notificationsEnabled = typeof Notification !== 'undefined' && Notification.permission === 'granted';
let isHydrating = false;
let cacheSaveTimeout = null;

// Initialize Firebase connection
function checkFirebase() {
  try {
    if (typeof window.firebase !== 'undefined' && window.firebase.db) {
      isFirebaseEnabled = true;
      console.log('Firebase connected');
      attachRealtimeListeners();
      return true;
    }
  } catch (e) {
    console.warn('Firebase not available', e);
  }
  isFirebaseEnabled = false;
  return false;
}

// Prevent browser extension interference
function preventExtensionInterference() {
  // エラーハンドリングのみ残す（入力フィールドへの干渉は削除）
  window.addEventListener('error', function(e) {
    if (e.filename && e.filename.includes('content_script.js')) {
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
  }, true);
  
  window.addEventListener('unhandledrejection', function(e) {
    if (e.reason && e.reason.stack && e.reason.stack.includes('content_script')) {
      e.preventDefault();
      return true;
    }
  });
}

// 入力フィールドを有効化する関数
function enableInputFields(container = document) {
  const inputs = container.querySelectorAll('input:not([type="hidden"]), select, textarea');
  inputs.forEach(input => {
    input.removeAttribute('readonly');
    input.removeAttribute('disabled');
    input.removeAttribute('autocomplete');
    input.style.pointerEvents = 'auto';
    input.style.userSelect = 'auto';
    input.style.webkitUserSelect = 'auto';
    // 入力フィールドがクリック可能であることを確認
    if (input.tagName === 'INPUT' || input.tagName === 'SELECT' || input.tagName === 'TEXTAREA') {
      input.setAttribute('tabindex', '0');
    }
  });
}

// Initialize app
function init() {
  preventExtensionInterference();
  attachEventListeners();
  syncNotificationButton();
  renderPlaceholders();
  hydrateFromCache();
  loadWorkSettings();
  
  setTimeout(() => {
    checkFirebase();
  }, 100);
  
  renderCalendar();
}

// Event Listeners
function attachEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = button.dataset.tab;
      if (tabName) switchTab(tabName);
    });
  });

  // Forms
  dom.recurringForm?.addEventListener('submit', handleRecurringSubmit);
  dom.reminderForm?.addEventListener('submit', handleReminderSubmit);
  dom.jobForm?.addEventListener('submit', handleJobSubmit);
  dom.workSettingsForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveWorkSettings();
    alert('Settings saved!');
  });

  // Calendar navigation
  dom.calendarPrev?.addEventListener('click', () => {
    appState.calendarCursor = appState.calendarCursor.minus({ months: 1 });
    renderCalendar();
  });
  dom.calendarNext?.addEventListener('click', () => {
    appState.calendarCursor = appState.calendarCursor.plus({ months: 1 });
    renderCalendar();
  });

  // Notifications
  dom.notificationBtn?.addEventListener('click', requestNotificationPermission);

  // List actions (edit/delete)
  document.body.addEventListener('click', handleListAction);

  // Modal handlers
  dom.modalClose?.addEventListener('click', closeShiftModal);
  dom.modalCancel?.addEventListener('click', closeShiftModal);
  dom.shiftModal?.addEventListener('click', (e) => {
    // 入力フィールドやフォーム要素のクリックは無視
    if (e.target.closest('input, select, textarea, form, button, .modal-content')) {
      return;
    }
    // モーダルの背景のみクリックで閉じる
    if (e.target === dom.shiftModal) {
      closeShiftModal();
    }
  });
  dom.modalDeleteBtn?.addEventListener('click', async () => {
    const shiftId = dom.calendarShiftForm?.dataset.editId;
    if (shiftId && confirm('Delete this shift?')) {
      await deleteEntity('shifts', shiftId);
      closeShiftModal();
    }
  });
  dom.calendarShiftForm?.addEventListener('submit', handleCalendarShiftSubmit);
  
  // 職場選択時に時給を自動設定
  if (dom.modalShiftRole) {
    dom.modalShiftRole.addEventListener('change', (e) => {
      const selectedRole = e.target.value;
      if (selectedRole && dom.modalShiftRate) {
        const job = getJobByName(selectedRole);
        if (job && job.rate) {
          dom.modalShiftRate.value = job.rate;
        }
      }
    });
  }
  
  // 時間選択の初期化
  initializeTimeSelects();
  
  // 時間と分のセレクトボックスの変更時にhidden inputに値を設定
  if (dom.modalShiftStartHour && dom.modalShiftStartMinute) {
    dom.modalShiftStartHour.addEventListener('change', updateTimeValue);
    dom.modalShiftStartMinute.addEventListener('change', updateTimeValue);
  }
  if (dom.modalShiftEndHour && dom.modalShiftEndMinute) {
    dom.modalShiftEndHour.addEventListener('change', updateTimeValue);
    dom.modalShiftEndMinute.addEventListener('change', updateTimeValue);
  }
}

// 時間選択の初期化（15分単位）
function initializeTimeSelects() {
  // 時間のオプション（0-23時）
  const hourOptions = Array.from({ length: 24 }, (_, i) => {
    const hour = i.toString().padStart(2, '0');
    return `<option value="${hour}">${i}</option>`;
  }).join('');
  
  // 分のオプション（0, 15, 30, 45分）
  const minuteOptions = ['00', '15', '30', '45'].map(m => {
    return `<option value="${m}">${m}</option>`;
  }).join('');
  
  // 開始時間のセレクトボックスにオプションを追加
  if (dom.modalShiftStartHour) {
    dom.modalShiftStartHour.innerHTML = '<option value="">時</option>' + hourOptions;
  }
  if (dom.modalShiftStartMinute) {
    dom.modalShiftStartMinute.innerHTML = '<option value="">分</option>' + minuteOptions;
  }
  
  // 終了時間のセレクトボックスにオプションを追加
  if (dom.modalShiftEndHour) {
    dom.modalShiftEndHour.innerHTML = '<option value="">時</option>' + hourOptions;
  }
  if (dom.modalShiftEndMinute) {
    dom.modalShiftEndMinute.innerHTML = '<option value="">分</option>' + minuteOptions;
  }
}

// 時間と分のセレクトボックスからhidden inputに値を設定
function updateTimeValue(e) {
  const isStart = e.target.id.includes('start');
  const hourSelect = isStart ? dom.modalShiftStartHour : dom.modalShiftEndHour;
  const minuteSelect = isStart ? dom.modalShiftStartMinute : dom.modalShiftEndMinute;
  const hiddenInput = isStart ? dom.modalShiftStart : dom.modalShiftEnd;
  
  if (!hourSelect || !minuteSelect || !hiddenInput) return;
  
  const hour = hourSelect.value;
  const minute = minuteSelect.value;
  
  if (hour && minute) {
    hiddenInput.value = `${hour}:${minute}`;
  } else {
    hiddenInput.value = '';
  }
}

// HH:MM形式の時間を時間と分のセレクトボックスに設定
function setTimeSelects(timeString, isStart = true) {
  if (!timeString || !timeString.includes(':')) {
    const hourSelect = isStart ? dom.modalShiftStartHour : dom.modalShiftEndHour;
    const minuteSelect = isStart ? dom.modalShiftStartMinute : dom.modalShiftEndMinute;
    if (hourSelect) hourSelect.value = '';
    if (minuteSelect) minuteSelect.value = '';
    return;
  }
  
  const [hour, minute] = timeString.split(':');
  const hourSelect = isStart ? dom.modalShiftStartHour : dom.modalShiftEndHour;
  const minuteSelect = isStart ? dom.modalShiftStartMinute : dom.modalShiftEndMinute;
  
  if (hourSelect) {
    // 15分単位に丸める
    let roundedMinute = '00';
    const min = parseInt(minute, 10);
    if (min < 8) roundedMinute = '00';
    else if (min < 23) roundedMinute = '15';
    else if (min < 38) roundedMinute = '30';
    else if (min < 53) roundedMinute = '45';
    else {
      // 53分以上は次の時間に繰り上げ
      const nextHour = (parseInt(hour, 10) + 1) % 24;
      hourSelect.value = nextHour.toString().padStart(2, '0');
      minuteSelect.value = '00';
      if (isStart && dom.modalShiftStart) dom.modalShiftStart.value = `${nextHour.toString().padStart(2, '0')}:00`;
      if (!isStart && dom.modalShiftEnd) dom.modalShiftEnd.value = `${nextHour.toString().padStart(2, '0')}:00`;
      return;
    }
    
    hourSelect.value = hour.padStart(2, '0');
    if (minuteSelect) minuteSelect.value = roundedMinute;
    
    // hidden inputにも設定
    const hiddenInput = isStart ? dom.modalShiftStart : dom.modalShiftEnd;
    if (hiddenInput) hiddenInput.value = `${hour.padStart(2, '0')}:${roundedMinute}`;
  }
}

function renderPlaceholders() {
  if (dom.shiftList) dom.shiftList.innerHTML = '<div class="placeholder">No shifts yet.</div>';
  if (dom.recurringList) dom.recurringList.innerHTML = '<div class="placeholder">No templates yet.</div>';
  if (dom.reminderList) dom.reminderList.innerHTML = '<div class="placeholder">No reminders yet.</div>';
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  document.querySelectorAll('.tab-content').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `${tabName}-tab`);
  });

  if (tabName === 'calendar') {
    setTimeout(() => renderCalendar(), 100);
  }
}

function syncNotificationButton() {
  if (!dom.notificationBtn) return;
  if (typeof Notification === 'undefined') {
    dom.notificationBtn.disabled = true;
    dom.notificationBtn.textContent = 'Alerts unavailable';
    return;
  }
  dom.notificationBtn.textContent = notificationsEnabled ? 'Alerts enabled' : 'Enable Alerts';
}

// Work Settings
function loadWorkSettings() {
  if (typeof localStorage === 'undefined') return;
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEYS.workSettings) || '{}');
    if (dom.workLocation) dom.workLocation.value = settings.workLocation || '';
    if (dom.defaultWage) dom.defaultWage.value = settings.defaultWage || '';
    if (dom.defaultStartTime) dom.defaultStartTime.value = settings.defaultStartTime || '';
    if (dom.defaultEndTime) dom.defaultEndTime.value = settings.defaultEndTime || '';
    if (dom.taxRate) dom.taxRate.value = settings.taxRate || '';
  } catch (error) {
    console.warn('Failed to load work settings', error);
  }
}

function saveWorkSettings() {
  if (typeof localStorage === 'undefined') return;
  try {
    const settings = {
      workLocation: dom.workLocation?.value || '',
      defaultWage: dom.defaultWage?.value || '',
      defaultStartTime: dom.defaultStartTime?.value || '',
      defaultEndTime: dom.defaultEndTime?.value || '',
      taxRate: dom.taxRate?.value || '',
    };
    localStorage.setItem(STORAGE_KEYS.workSettings, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save work settings', error);
  }
}

function getWorkSettings() {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.workSettings) || '{}');
  } catch (error) {
    return {};
  }
}

// Form Handlers
async function handleRecurringSubmit(event) {
  event.preventDefault();
  if (!isFirebaseEnabled) {
    alert('Firebase is not connected.');
    return;
  }
  
  const data = Object.fromEntries(new FormData(dom.recurringForm));
  if (!data.duration || Number(data.duration) <= 0) {
    alert('Duration must be greater than zero.');
    return;
  }
  if (!data.rate || Number(data.rate) <= 0) {
    alert('Rate must be greater than zero.');
    return;
  }
  
  const payload = {
    weekday: Number(data.weekday),
    start: data.start,
    duration: Number(data.duration),
    rate: Number(data.rate),
    updatedAt: Date.now(),
    createdAt: dom.recurringForm.dataset.editId 
      ? (appState.recurring[dom.recurringForm.dataset.editId]?.createdAt || Date.now())
      : Date.now(),
  };
  
  const id = dom.recurringForm.dataset.editId;
  await saveEntity('recurring', payload, id);
  dom.recurringForm.reset();
  if (dom.recurringForm.dataset.editId) delete dom.recurringForm.dataset.editId;
}

async function handleFinanceSubmit(event, collectionKey) {
  event.preventDefault();
  if (!isFirebaseEnabled) {
    alert('Firebase is not connected.');
    return;
  }
  
  if (collectionKey !== 'income') return;
  
  const form = dom.incomeForm;
  const data = Object.fromEntries(new FormData(form));
  const amount = Math.round(Number(data.amount) || 0);
  
  if (amount <= 0) {
    alert('金額は0より大きい値を入力してください。');
    return;
  }
  
  const payload = {
    date: data.date,
    amount,
    category: data.category || '',
    type: 'income',
    updatedAt: Date.now(),
    createdAt: form.dataset.editId 
      ? (appState[collectionKey][form.dataset.editId]?.createdAt || Date.now())
      : Date.now(),
  };
  
  const id = form.dataset.editId;
  await saveEntity(collectionKey, payload, id);
  form.reset();
  if (form.dataset.editId) delete form.dataset.editId;
}

async function handleReminderSubmit(event) {
  event.preventDefault();
  if (!isFirebaseEnabled) {
    alert('Firebase is not connected.');
    return;
  }
  
  const data = Object.fromEntries(new FormData(dom.reminderForm));
  const schedule = DateTime.fromISO(`${data.date}T${data.time || '09:00'}`);
  
  if (!schedule.isValid) {
    alert('Please choose a valid reminder date/time.');
    return;
  }
  
  const payload = {
    date: data.date,
    time: data.time || '09:00',
    message: data.message,
    lead: Number(data.lead) || 0,
    updatedAt: Date.now(),
    createdAt: dom.reminderForm.dataset.editId 
      ? (appState.reminders[dom.reminderForm.dataset.editId]?.createdAt || Date.now())
      : Date.now(),
  };
  
  const id = dom.reminderForm.dataset.editId;
  await saveEntity('reminders', payload, id);
  dom.reminderForm.reset();
  if (dom.reminderForm.time) dom.reminderForm.time.value = '09:00';
  if (dom.reminderForm.dataset.editId) delete dom.reminderForm.dataset.editId;
}

async function handleJobSubmit(event) {
  event.preventDefault();
  if (!isFirebaseEnabled) {
    alert('Firebase is not connected.');
    return;
  }
  
  const data = Object.fromEntries(new FormData(dom.jobForm));
  
  if (!data.name || data.name.trim() === '') {
    alert('職場名を入力してください。');
    return;
  }
  
  const payload = {
    name: data.name.trim(),
    rate: data.rate ? Number(data.rate) : 0,
    updatedAt: Date.now(),
    createdAt: dom.jobForm.dataset.editId 
      ? (appState.jobs[dom.jobForm.dataset.editId]?.createdAt || Date.now())
      : Date.now(),
  };
  
  const id = dom.jobForm.dataset.editId;
  await saveEntity('jobs', payload, id);
  dom.jobForm.reset();
  if (dom.jobForm.dataset.editId) delete dom.jobForm.dataset.editId;
}

async function handleCalendarShiftSubmit(event) {
  event.preventDefault();
  if (!isFirebaseEnabled) {
    alert('Firebase is not connected.');
    return;
  }
  
  // 時間と分のセレクトボックスからhidden inputに値を設定
  if (dom.modalShiftStartHour && dom.modalShiftStartMinute && dom.modalShiftStart) {
    const hour = dom.modalShiftStartHour.value;
    const minute = dom.modalShiftStartMinute.value;
    if (hour && minute) {
      dom.modalShiftStart.value = `${hour}:${minute}`;
    }
  }
  if (dom.modalShiftEndHour && dom.modalShiftEndMinute && dom.modalShiftEnd) {
    const hour = dom.modalShiftEndHour.value;
    const minute = dom.modalShiftEndMinute.value;
    if (hour && minute) {
      dom.modalShiftEnd.value = `${hour}:${minute}`;
    }
  }
  
  const data = Object.fromEntries(new FormData(dom.calendarShiftForm));
  
  if (!data.start || !data.end) {
    alert('開始時間と終了時間を入力してください。');
    return;
  }
  
  if (!data.role || data.role.trim() === '') {
    alert('職場を選択してください。');
    return;
  }
  
  const start = DateTime.fromISO(`${data.date}T${data.start}`);
  const end = DateTime.fromISO(`${data.date}T${data.end}`);
  
  if (!start.isValid || !end.isValid || end <= start) {
    alert('有効な時間範囲を入力してください。');
    return;
  }
  
  const durationHours = end.diff(start, 'hours').hours;
  const workSettings = getWorkSettings();
  let rate = Number(data.rate) || 0;
  
  // 職場から時給を取得
  if (rate <= 0 && data.role) {
    const job = getJobByName(data.role.trim());
    if (job && job.rate) {
      rate = Number(job.rate);
    } else if (workSettings.defaultWage) {
      rate = Number(workSettings.defaultWage);
    } else {
      alert('時給を設定してください。');
      return;
    }
  }
  
  const payload = {
    date: data.date,
    start: data.start,
    end: data.end,
    role: data.role.trim(),
    notes: data.notes || '',
    rate: rate,
    durationHours,
    totalPay: +(durationHours * rate).toFixed(2),
    updatedAt: Date.now(),
    createdAt: dom.calendarShiftForm.dataset.editId 
      ? (appState.shifts[dom.calendarShiftForm.dataset.editId]?.createdAt || Date.now())
      : Date.now(),
  };
  
  const id = dom.calendarShiftForm.dataset.editId;
  await saveEntity('shifts', payload, id);
  closeShiftModal();
}

// Firebase Operations
async function saveEntity(collectionKey, payload, id) {
  if (!isFirebaseEnabled) return;
  try {
    const path = firebasePaths[collectionKey];
    if (id) {
      const entityRef = window.firebase.ref(window.firebase.db, `${path}/${id}`);
      await window.firebase.set(entityRef, payload);
    } else {
      const collectionRef = window.firebase.ref(window.firebase.db, path);
      const newRef = window.firebase.push(collectionRef);
      await window.firebase.set(newRef, payload);
    }
  } catch (error) {
    console.error('Save error:', error);
    alert(`Failed to save ${collectionKey.slice(0, -1)}.`);
  }
}

async function deleteEntity(collectionKey, id) {
  if (!isFirebaseEnabled) return;
  if (!confirm('Delete this entry?')) return;
  try {
    const entityRef = window.firebase.ref(window.firebase.db, `${firebasePaths[collectionKey]}/${id}`);
    await window.firebase.remove(entityRef);
  } catch (error) {
    console.error('Delete error:', error);
    alert('Failed to delete entry.');
  }
}

function handleListAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, collection, id } = button.dataset;
  if (!collection || !id) return;

  if (action === 'delete') {
    deleteEntity(collection, id);
  } else if (action === 'edit') {
    startEdit(collection, id);
  }
}

function startEdit(collectionKey, id) {
  const data = appState[collectionKey]?.[id];
  if (!data) return;
  
  switch (collectionKey) {
    case 'shifts':
      openShiftModal(data.date, id);
      break;
    case 'recurring':
      if (dom.recurringForm) {
        dom.recurringForm.weekday.value = data.weekday;
        dom.recurringForm.start.value = data.start;
        dom.recurringForm.duration.value = data.duration;
        dom.recurringForm.rate.value = data.rate;
        dom.recurringForm.dataset.editId = id;
      }
      break;
    case 'income':
      if (dom.incomeForm) {
        dom.incomeForm.date.value = data.date;
        dom.incomeForm.amount.value = data.amount;
        dom.incomeForm.category.value = data.category || '';
        dom.incomeForm.dataset.editId = id;
      }
      break;
    case 'reminders':
      if (dom.reminderForm) {
        dom.reminderForm.date.value = data.date;
        dom.reminderForm.time.value = data.time || '09:00';
        dom.reminderForm.message.value = data.message || '';
        dom.reminderForm.lead.value = data.lead ?? 30;
        dom.reminderForm.dataset.editId = id;
      }
      break;
    case 'jobs':
      if (dom.jobForm) {
        dom.jobForm.name.value = data.name || '';
        dom.jobForm.rate.value = data.rate || '';
        dom.jobForm.dataset.editId = id;
      }
      break;
  }
}

// Firebase Realtime Listeners
function attachRealtimeListeners() {
  if (!isFirebaseEnabled) return;
  detachRealtimeListeners();
  
  Object.entries(firebasePaths).forEach(([key, path]) => {
    const pathRef = window.firebase.ref(window.firebase.db, path);
    const handler = (snapshot) => {
      appState[key] = snapshot.val() || {};
      refreshUI();
      persistToCacheSoon();
    };
    const unsubscribe = window.firebase.onValue(pathRef, handler);
    appState.listeners[key] = { unsubscribe };
  });
}

function detachRealtimeListeners() {
  Object.values(appState.listeners).forEach((entry) => {
    if (entry && entry.unsubscribe) {
      entry.unsubscribe();
    }
  });
  appState.listeners = {};
}

// UI Rendering
function refreshUI() {
  renderShiftList();
  renderRecurringList();
  renderReminderList();
  renderJobList();
  const aggregates = computeAggregates();
  renderSummary(aggregates);
  updateCharts(aggregates);
  renderCalendar();
}

function computeAggregates() {
  const totals = {
    totalHours: 0,
    shiftIncome: 0,
    manualIncome: 0,
    totalIncome: 0,
    weekBuckets: new Map(),
    weekdayHours: Array(7).fill(0),
  };

  Object.values(appState.shifts || {}).forEach((shift) => {
    const hours = Number(shift.durationHours) || 0;
    totals.totalHours += hours;
    const pay = Number(shift.totalPay) || 0;
    totals.shiftIncome += pay;
    bucketWeek(shift.date, pay, 0, totals.weekBuckets);
    bucketWeekday(shift.date, hours, totals.weekdayHours);
  });

  Object.values(appState.income || {}).forEach((income) => {
    const amount = Number(income.amount) || 0;
    totals.manualIncome += amount;
    bucketWeek(income.date, amount, 0, totals.weekBuckets);
  });

  totals.totalIncome = totals.shiftIncome + totals.manualIncome;
  return totals;
}

function bucketWeek(date, income, expense, map) {
  if (!date) return;
  const dt = DateTime.fromISO(date);
  if (!dt.isValid) return;
  const start = dt.startOf('week');
  const key = start.toISODate();
  const bucket = map.get(key) || {
    label: `Week of ${start.toFormat('LLL d')}`,
    income: 0,
    expense: 0,
    order: start.toMillis(),
  };
  bucket.income += income;
  map.set(key, bucket);
}

function bucketWeekday(date, hours, array) {
  if (!date) return;
  const dt = DateTime.fromISO(date);
  if (!dt.isValid) return;
  array[dt.weekday % 7] += hours;
}

function computeMonthlyIncome() {
  const monthlyMap = new Map();
  
  Object.values(appState.shifts || {}).forEach((shift) => {
    if (!shift.date) return;
    const dt = DateTime.fromISO(shift.date);
    if (!dt.isValid) return;
    
    const monthKey = dt.toFormat('yyyy-MM');
    const pay = Number(shift.totalPay) || 0;
    
    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, {
        label: dt.toFormat('yyyy年M月'),
        income: 0,
        order: dt.startOf('month').toMillis(),
      });
    }
    
    const bucket = monthlyMap.get(monthKey);
    bucket.income += pay;
  });
  
  return Array.from(monthlyMap.values()).sort((a, b) => b.order - a.order);
}

function computeYearlyIncome() {
  const yearlyMap = new Map();
  
  Object.values(appState.shifts || {}).forEach((shift) => {
    if (!shift.date) return;
    const dt = DateTime.fromISO(shift.date);
    if (!dt.isValid) return;
    
    const yearKey = dt.toFormat('yyyy');
    const pay = Number(shift.totalPay) || 0;
    
    if (!yearlyMap.has(yearKey)) {
      yearlyMap.set(yearKey, {
        label: `${yearKey}年`,
        income: 0,
        order: dt.startOf('year').toMillis(),
      });
    }
    
    const bucket = yearlyMap.get(yearKey);
    bucket.income += pay;
  });
  
  return Array.from(yearlyMap.values()).sort((a, b) => b.order - a.order);
}

function renderMonthlyIncome() {
  const container = document.getElementById('monthly-income');
  const chartCtx = document.getElementById('monthly-income-chart')?.getContext('2d');
  
  const monthlyData = computeMonthlyIncome();
  
  if (monthlyData.length === 0) {
    if (container) container.innerHTML = '<div class="placeholder">データがありません</div>';
    if (charts.monthlyIncome) {
      charts.monthlyIncome.destroy();
      charts.monthlyIncome = null;
    }
    return;
  }
  
  // グラフを更新
  if (chartCtx) {
    const labels = monthlyData.map(item => item.label);
    const data = monthlyData.map(item => Math.round(item.income));
    
    if (!charts.monthlyIncome) {
      charts.monthlyIncome = new Chart(chartCtx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: '月別給料',
            data: data,
            backgroundColor: 'rgba(99, 102, 241, 0.8)',
            borderColor: 'rgba(99, 102, 241, 1)',
            borderWidth: 2,
            borderRadius: 8,
            borderSkipped: false,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return '¥' + Math.round(context.parsed.y).toLocaleString();
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return '¥' + Math.round(value).toLocaleString();
                }
              },
              grid: {
                color: 'rgba(0, 0, 0, 0.05)'
              }
            },
            x: {
              grid: {
                display: false
              }
            }
          }
        }
      });
    } else {
      charts.monthlyIncome.data.labels = labels;
      charts.monthlyIncome.data.datasets[0].data = data;
      charts.monthlyIncome.update();
    }
  }
  
  // リストも表示
  if (container) {
    container.innerHTML = monthlyData.map(item => `
      <div class="income-item">
        <span class="income-label">${item.label}</span>
        <strong class="income-amount">¥${Math.round(item.income).toLocaleString()}</strong>
      </div>
    `).join('');
  }
}

function renderYearlyIncome() {
  const container = document.getElementById('yearly-income');
  const chartCtx = document.getElementById('yearly-income-chart')?.getContext('2d');
  
  const yearlyData = computeYearlyIncome();
  
  if (yearlyData.length === 0) {
    if (container) container.innerHTML = '<div class="placeholder">データがありません</div>';
    if (charts.yearlyIncome) {
      charts.yearlyIncome.destroy();
      charts.yearlyIncome = null;
    }
    return;
  }
  
  // グラフを更新
  if (chartCtx) {
    const labels = yearlyData.map(item => item.label);
    const data = yearlyData.map(item => Math.round(item.income));
    
    if (!charts.yearlyIncome) {
      charts.yearlyIncome = new Chart(chartCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: '年別給料',
            data: data,
            borderColor: 'rgba(99, 102, 241, 1)',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 6,
            pointHoverRadius: 8,
            pointBackgroundColor: 'rgba(99, 102, 241, 1)',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return '¥' + Math.round(context.parsed.y).toLocaleString();
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return '¥' + Math.round(value).toLocaleString();
                }
              },
              grid: {
                color: 'rgba(0, 0, 0, 0.05)'
              }
            },
            x: {
              grid: {
                display: false
              }
            }
          }
        }
      });
    } else {
      charts.yearlyIncome.data.labels = labels;
      charts.yearlyIncome.data.datasets[0].data = data;
      charts.yearlyIncome.update();
    }
  }
  
  // リストも表示
  if (container) {
    container.innerHTML = yearlyData.map(item => `
      <div class="income-item">
        <span class="income-label">${item.label}</span>
        <strong class="income-amount">¥${Math.round(item.income).toLocaleString()}</strong>
      </div>
    `).join('');
  }
}

function renderSummary(aggregates) {
  if (dom.summaryHours) dom.summaryHours.textContent = aggregates.totalHours.toFixed(1);
  if (dom.summaryIncome) dom.summaryIncome.textContent = `¥${Math.round(aggregates.totalIncome).toLocaleString()}`;

  const weeklyHours = aggregates.weekBuckets.size
    ? (aggregates.totalHours / Math.max(aggregates.weekBuckets.size, 1)).toFixed(1)
    : '0.0';
  
  if (dom.summaryDetails) {
    dom.summaryDetails.innerHTML = `
      <span>週平均労働時間: <strong>${weeklyHours} 時間</strong></span>
    `;
  }
  
  // 月別・年別の給料を表示
  renderMonthlyIncome();
  renderYearlyIncome();
}

function updateCharts(aggregates) {
  const weekData = [...aggregates.weekBuckets.values()].sort((a, b) => a.order - b.order);
  const incomeExpenseCtx = document.getElementById('income-expense-chart')?.getContext('2d');
  const hoursCtx = document.getElementById('hours-chart')?.getContext('2d');

  if (incomeExpenseCtx) {
    const labels = weekData.map((bucket) => bucket.label);
    const incomeData = weekData.map((bucket) => Number(bucket.income.toFixed(2)));
    const expenseData = weekData.map((bucket) => Number(bucket.expense.toFixed(2)));
    
    if (!charts.incomeExpense) {
      charts.incomeExpense = new Chart(incomeExpenseCtx, {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'Income', data: incomeData, backgroundColor: 'rgba(78, 107, 255, 0.8)' },
          { label: 'Expenses', data: expenseData, backgroundColor: 'rgba(255, 99, 132, 0.7)' },
        ]},
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: { y: { beginAtZero: true } },
        },
      });
    } else {
      charts.incomeExpense.data.labels = labels;
      charts.incomeExpense.data.datasets[0].data = incomeData;
      charts.incomeExpense.data.datasets[1].data = expenseData;
      charts.incomeExpense.update();
    }
  }

  if (hoursCtx) {
    const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hoursData = aggregates.weekdayHours.map((value) => Number(value.toFixed(2)));
    
    if (!charts.hours) {
      charts.hours = new Chart(hoursCtx, {
        type: 'line',
        data: {
          labels: weekdayLabels,
          datasets: [{
            label: 'Hours by Weekday',
            data: hoursData,
            tension: 0.3,
            borderColor: 'rgba(78, 107, 255, 1)',
            backgroundColor: 'rgba(78, 107, 255, 0.2)',
            fill: true,
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } },
        },
      });
    } else {
      charts.hours.data.datasets[0].data = hoursData;
      charts.hours.update();
    }
  }
}

function renderShiftList() {
  const entries = Object.entries(appState.shifts || {});
  if (!dom.shiftList) return;
  
  if (!entries.length) {
    dom.shiftList.innerHTML = '<div class="placeholder">No shifts yet.</div>';
    return;
  }
  
  dom.shiftList.innerHTML = entries
    .sort(([, a], [, b]) => (a.date > b.date ? -1 : 1))
    .map(([id, shift]) => {
      const pay = `¥${Math.round(Number(shift.totalPay || 0)).toLocaleString()}`;
      const hours = Number(shift.durationHours || 0).toFixed(1);
      return `
        <article class="list-item">
          <header>
            <span>${shift.date} · ${shift.start}–${shift.end}</span>
            <span>${pay}</span>
          </header>
          <p>${shift.role || 'シフト'} (${hours} 時間)</p>
          ${shift.notes ? `<p class="muted">${shift.notes}</p>` : ''}
          <footer>
            <button data-action="edit" data-collection="shifts" data-id="${id}">編集</button>
            <button data-action="delete" data-collection="shifts" data-id="${id}" class="danger">削除</button>
          </footer>
        </article>
      `;
    })
    .join('');
}

function renderRecurringList() {
  const entries = Object.entries(appState.recurring || {});
  if (!dom.recurringList) return;
  
  if (!entries.length) {
    dom.recurringList.innerHTML = '<div class="placeholder">No templates yet.</div>';
    return;
  }
  
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dom.recurringList.innerHTML = entries
    .map(([id, template]) => `
      <article class="list-item">
        <header>
          <span>${weekdayNames[template.weekday]} · ${template.start}</span>
          <span>${template.duration} hrs @ $${template.rate}</span>
        </header>
        <footer>
          <button data-action="edit" data-collection="recurring" data-id="${id}">Edit</button>
          <button data-action="delete" data-collection="recurring" data-id="${id}" class="danger">Delete</button>
        </footer>
      </article>
    `)
    .join('');
}

function renderFinanceList() {
  const incomes = Object.entries(appState.income || {}).map(([id, entry]) => ({
    id, collection: 'income', ...entry,
  }));
  
  if (!dom.financeList) return;
  
  if (!incomes.length) {
    dom.financeList.innerHTML = '<div class="placeholder">収入データがありません</div>';
    return;
  }
  
  dom.financeList.innerHTML = incomes
    .sort((a, b) => (a.date > b.date ? -1 : 1))
    .map((entry) => {
      const amount = Math.round(Number(entry.amount || 0));
      return `
        <article class="list-item">
          <header>
            <span>${entry.date} · ${entry.category || 'その他'}</span>
            <span>¥${amount.toLocaleString()}</span>
          </header>
          <footer>
            <button data-action="edit" data-collection="${entry.collection}" data-id="${entry.id}">編集</button>
            <button data-action="delete" data-collection="${entry.collection}" data-id="${entry.id}" class="danger">削除</button>
          </footer>
        </article>
      `;
    })
    .join('');
}

function renderReminderList() {
  const entries = Object.entries(appState.reminders || {});
  if (!dom.reminderList) return;
  
  if (!entries.length) {
    dom.reminderList.innerHTML = '<div class="placeholder">No reminders yet.</div>';
    clearReminderTimers();
    return;
  }
  
  const now = DateTime.now();
  const markup = entries
    .map(([id, reminder]) => {
      const schedule = DateTime.fromISO(`${reminder.date}T${reminder.time || '09:00'}`);
      return { id, schedule, ...reminder };
    })
    .filter((entry) => entry.schedule.isValid)
    .sort((a, b) => a.schedule.toMillis() - b.schedule.toMillis())
    .map((entry) => {
      const notifyAt = entry.schedule.minus({ minutes: Number(entry.lead) || 0 });
      const diffMinutes = notifyAt.diff(now, 'minutes').minutes;
      const upcoming = diffMinutes >= 0;
      const relative = upcoming ? formatRelativeMinutes(diffMinutes) : 'Past due';
      return `
        <article class="list-item">
          <header>
            <span>${entry.schedule.toFormat('LLL d, t')}</span>
            <span class="badge ${upcoming ? 'upcoming' : 'past'}">${upcoming ? `In ${relative}` : relative}</span>
          </header>
          <p>${entry.message}</p>
          <p class="muted">Notify ${entry.lead || 0} mins before (${notifyAt.toFormat('LLL d, t')})</p>
          <footer>
            <button data-action="edit" data-collection="reminders" data-id="${entry.id}">Edit</button>
            <button data-action="delete" data-collection="reminders" data-id="${entry.id}" class="danger">Delete</button>
          </footer>
        </article>
      `;
    })
    .join('');
  
  dom.reminderList.innerHTML = markup;
  scheduleReminders();
}

function renderJobList() {
  const entries = Object.entries(appState.jobs || {});
  if (!dom.jobList) return;
  
  if (!entries.length) {
    dom.jobList.innerHTML = '<div class="placeholder">職場がまだ登録されていません。</div>';
    return;
  }
  
  dom.jobList.innerHTML = entries
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([id, job]) => {
      const rate = job.rate ? `¥${Math.round(Number(job.rate)).toLocaleString()}/時` : '時給未設定';
      return `
        <article class="list-item">
          <header>
            <span>${job.name}</span>
            <span>${rate}</span>
          </header>
          <footer>
            <button data-action="edit" data-collection="jobs" data-id="${id}">編集</button>
            <button data-action="delete" data-collection="jobs" data-id="${id}" class="danger">削除</button>
          </footer>
        </article>
      `;
    })
    .join('');
}

function formatRelativeMinutes(minutes) {
  if (!isFinite(minutes)) return '?';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} day`;
}

function clearReminderTimers() {
  reminderTimers.forEach((timer) => clearTimeout(timer));
  reminderTimers.clear();
}

function scheduleReminders() {
  clearReminderTimers();
  const entries = Object.entries(appState.reminders || {});
  if (!entries.length) return;
  
  const now = DateTime.now();
  entries.forEach(([id, reminder]) => {
    const eventTime = DateTime.fromISO(`${reminder.date}T${reminder.time || '09:00'}`);
    if (!eventTime.isValid) return;
    const notifyAt = eventTime.minus({ minutes: Number(reminder.lead) || 0 });
    const diffMs = notifyAt.diff(now).milliseconds;
    if (diffMs <= 0 || diffMs > 1000 * 60 * 60 * 24) return;
    const timer = setTimeout(() => triggerReminder({ id, ...reminder }), diffMs);
    reminderTimers.set(id, timer);
  });
}

async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') {
    alert('Browser notifications are not supported here.');
    return;
  }
  if (Notification.permission === 'granted') {
    notificationsEnabled = true;
    syncNotificationButton();
    return;
  }
  if (Notification.permission === 'denied') {
    alert('Notifications have been blocked in your browser settings.');
    return;
  }
  const permission = await Notification.requestPermission();
  notificationsEnabled = permission === 'granted';
  if (!notificationsEnabled) {
    alert('Notifications remain disabled.');
  }
  syncNotificationButton();
}

function triggerReminder(reminder) {
  const title = 'Part-Time Reminder';
  const body = `${reminder.message} (${reminder.date} ${reminder.time})`;
  if (notificationsEnabled && typeof Notification !== 'undefined') {
    new Notification(title, { body });
  } else {
    alert(body);
  }
}

// Calendar
function renderCalendar() {
  const calendarEl = dom.calendarGrid;
  if (!calendarEl) return;

  const month = appState.calendarCursor;
  if (dom.calendarMonth) {
    dom.calendarMonth.textContent = month.toFormat('yyyy年M月');
  }

  const startOfMonth = month.startOf('month');
  const startOfGrid = startOfMonth.startOf('week');
  const endOfMonth = month.endOf('month');
  const endOfGrid = endOfMonth.endOf('week');

  const shiftsByDate = Object.entries(appState.shifts || {}).reduce((acc, [id, shift]) => {
    if (!shift.date) return acc;
    if (!acc[shift.date]) acc[shift.date] = [];
    acc[shift.date].push({ id, ...shift });
    return acc;
  }, {});

  const recurringTemplates = Object.entries(appState.recurring || {}).map(([id, template]) => ({
    id,
    ...template,
  }));

  const cells = [];
  let cursor = startOfGrid;

  while (cursor <= endOfGrid) {
    const dayId = cursor.toISODate();
    const weekdayIndex = cursor.weekday % 7;
    const shifts = shiftsByDate[dayId] || [];

    const sortedShifts = [...shifts].sort((a, b) => {
      if (!a.start || !b.start) return 0;
      return a.start.localeCompare(b.start);
    });

    let shiftMarkup = sortedShifts.slice(0, 3).map((shift) => {
      const startTime = shift.start || '';
      const endTime = shift.end || '';
      const role = shift.role || 'シフト';
      const timeDisplay = startTime && endTime ? `${startTime}-${endTime}` : startTime || '';
      const duration = shift.durationHours || 0;
      return `
        <div class="shift-chip" data-shift-id="${shift.id}" title="${role} · ${timeDisplay}">
          ${timeDisplay ? `<span class="shift-time">${timeDisplay}</span>` : ''}
          <span class="shift-role">${role}</span>
          ${duration > 0 ? `<span class="shift-duration">${duration.toFixed(1)}h</span>` : ''}
        </div>`;
    }).join('');

    if (sortedShifts.length > 3) {
      shiftMarkup += `<div class="shift-chip" style="background: rgba(107,114,128,0.15); color: var(--text);">+${sortedShifts.length - 3}</div>`;
    }

    const recurringMarkup = sortedShifts.length === 0
      ? recurringTemplates
          .filter((template) => Number(template.weekday) === weekdayIndex)
          .map((template) => {
            const startTime = template.start || '';
            const duration = template.duration || 0;
            return `
              <div class="shift-chip recurring" title="テンプレート · ${startTime}">
                ${startTime ? `<span class="shift-time">${startTime}</span>` : ''}
                <span class="shift-role">テンプレ</span>
                ${duration ? `<span class="shift-duration">${duration}h</span>` : ''}
              </div>`;
          })
          .join('')
      : '';

    const isToday = cursor.toISODate() === DateTime.now().toISODate();
    const isCurrentMonth = cursor.month === month.month;

    cells.push(`
      <div class="calendar-cell ${!isCurrentMonth ? 'muted-cell' : ''} ${isToday ? 'today' : ''}" data-date="${dayId}">
        <div class="cell-date">${cursor.day}</div>
        <div class="shift-container">
          ${shiftMarkup || recurringMarkup ? `${shiftMarkup}${recurringMarkup}` : ''}
        </div>
      </div>
    `);

    cursor = cursor.plus({ days: 1 });
  }

  calendarEl.innerHTML = cells.join('');

  calendarEl.querySelectorAll('.calendar-cell').forEach((cell) => {
    cell.addEventListener('click', (e) => {
      const shiftChip = e.target.closest('.shift-chip[data-shift-id]');
      if (shiftChip) {
        e.stopPropagation();
        const shiftId = shiftChip.dataset.shiftId;
        const shift = appState.shifts[shiftId];
        if (shift) {
          openShiftModal(shift.date, shiftId);
          return;
        }
      }

      const date = cell.dataset.date;
      if (date) openShiftModal(date);
    });
  });
}

function getUniqueRoles() {
  const roles = new Set();
  // まず設定済みの職場を追加（優先）
  Object.values(appState.jobs || {}).forEach(job => {
    if (job.name && job.name.trim()) {
      roles.add(job.name.trim());
    }
  });
  // 次に過去のシフトから職場を追加
  Object.values(appState.shifts || {}).forEach(shift => {
    if (shift.role && shift.role.trim()) {
      roles.add(shift.role.trim());
    }
  });
  const workSettings = getWorkSettings();
  if (workSettings.workLocation) {
    roles.add(workSettings.workLocation);
  }
  return Array.from(roles).sort();
}

function getJobByName(name) {
  return Object.values(appState.jobs || {}).find(job => job.name === name);
}

function populateRoleSelect(selectedRole = '') {
  if (!dom.modalShiftRole) return;
  
  const roles = getUniqueRoles();
  dom.modalShiftRole.innerHTML = '<option value="">選択してください</option>';
  
  roles.forEach(role => {
    const option = document.createElement('option');
    option.value = role;
    const job = getJobByName(role);
    option.textContent = job && job.rate ? `${role} (¥${Math.round(Number(job.rate)).toLocaleString()}/時)` : role;
    if (role === selectedRole) {
      option.selected = true;
    }
    dom.modalShiftRole.appendChild(option);
  });
  
  // 編集モードで、現在の職場がリストにない場合は追加
  if (selectedRole && !roles.includes(selectedRole)) {
    const option = document.createElement('option');
    option.value = selectedRole;
    option.textContent = selectedRole;
    option.selected = true;
    dom.modalShiftRole.appendChild(option);
  }
}

function openShiftModal(date, shiftId = null) {
  if (!dom.shiftModal || !date) return;
  
  if (dom.calendarShiftForm) {
    dom.calendarShiftForm.reset();
    if (dom.calendarShiftForm.dataset.editId) delete dom.calendarShiftForm.dataset.editId;
  }
  
  // モーダル内の入力フィールドを有効化
  enableInputFields(dom.shiftModal);
  
  if (shiftId && appState.shifts[shiftId]) {
    const shift = appState.shifts[shiftId];
    if (dom.calendarShiftForm) dom.calendarShiftForm.dataset.editId = shiftId;
    if (dom.modalShiftDate) dom.modalShiftDate.value = shift.date || date;
    
    // 時間をセレクトボックスに設定
    setTimeSelects(shift.start || '', true);
    setTimeSelects(shift.end || '', false);
    
    if (dom.modalShiftRate) dom.modalShiftRate.value = shift.rate || '';
    if (dom.modalShiftNotes) dom.modalShiftNotes.value = shift.notes || '';
    
    populateRoleSelect(shift.role || '');
    
    const modalTitle = dom.shiftModal.querySelector('.modal-header h2');
    if (modalTitle) modalTitle.textContent = 'シフトを編集';
    if (dom.modalDeleteBtn) dom.modalDeleteBtn.style.display = 'block';
    
    dom.shiftModal.classList.add('active');
    
    setTimeout(() => {
      if (dom.modalShiftStartHour) {
        dom.modalShiftStartHour.focus();
      }
    }, 100);
    return;
  }
  
  if (dom.modalShiftDate) dom.modalShiftDate.value = date;
  const modalTitle = dom.shiftModal.querySelector('.modal-header h2');
  if (modalTitle) modalTitle.textContent = 'シフトを追加';
  if (dom.modalDeleteBtn) dom.modalDeleteBtn.style.display = 'none';
  
  const suggestions = getSuggestions(date);
  const workSettings = getWorkSettings();
  
  populateRoleSelect();
  
  // 過去のシフト履歴から候補を表示
  renderShiftSuggestions(date);
  
  // デフォルト時間をセレクトボックスに設定
  if (workSettings.defaultStartTime) {
    setTimeSelects(workSettings.defaultStartTime, true);
  } else if (suggestions.start) {
    setTimeSelects(suggestions.start, true);
  }
  
  if (workSettings.defaultEndTime) {
    setTimeSelects(workSettings.defaultEndTime, false);
  } else if (suggestions.end) {
    setTimeSelects(suggestions.end, false);
  }
  
  if (workSettings.defaultWage && dom.modalShiftRate) {
    dom.modalShiftRate.value = workSettings.defaultWage;
  } else if (suggestions.rate && dom.modalShiftRate) {
    dom.modalShiftRate.value = suggestions.rate;
  }
  
  if (workSettings.workLocation && dom.modalShiftRole) {
    dom.modalShiftRole.value = workSettings.workLocation;
  } else if (suggestions.role && dom.modalShiftRole) {
    dom.modalShiftRole.value = suggestions.role;
  }
  
  dom.shiftModal.classList.add('active');
  
  setTimeout(() => {
    if (dom.modalShiftStart) {
      dom.modalShiftStart.focus();
      dom.modalShiftStart.click();
    }
  }, 150);
}

function closeShiftModal() {
  if (!dom.shiftModal) return;
  dom.shiftModal.classList.remove('active');
  if (dom.calendarShiftForm) {
    // 時間セレクトボックスもリセット
    if (dom.modalShiftStartHour) dom.modalShiftStartHour.value = '';
    if (dom.modalShiftStartMinute) dom.modalShiftStartMinute.value = '';
    if (dom.modalShiftEndHour) dom.modalShiftEndHour.value = '';
    if (dom.modalShiftEndMinute) dom.modalShiftEndMinute.value = '';
    if (dom.modalShiftStart) dom.modalShiftStart.value = '';
    if (dom.modalShiftEnd) dom.modalShiftEnd.value = '';
    dom.calendarShiftForm.reset();
    if (dom.calendarShiftForm.dataset.editId) delete dom.calendarShiftForm.dataset.editId;
  }
  if (dom.modalDeleteBtn) dom.modalDeleteBtn.style.display = 'none';
}

function getShiftHistoryCandidates(date) {
  const dt = DateTime.fromISO(date);
  
  // すべての過去のシフトを取得（最近60日以内）
  const sixtyDaysAgo = dt.minus({ days: 60 });
  const allShifts = Object.values(appState.shifts || {}).filter(s => {
    if (!s.date || !s.start || !s.end || !s.role) return false;
    const shiftDate = DateTime.fromISO(s.date);
    return shiftDate < dt && shiftDate >= sixtyDaysAgo;
  });
  
  if (allShifts.length === 0) return [];
  
  // 時間帯と職場の組み合わせでグループ化
  const combinations = {};
  allShifts.forEach(shift => {
    const key = `${shift.start}-${shift.end}-${shift.role}`;
    if (!combinations[key]) {
      combinations[key] = {
        start: shift.start,
        end: shift.end,
        role: shift.role,
        rate: shift.rate || 0,
        count: 0,
        lastUsed: shift.date
      };
    }
    combinations[key].count++;
    if (shift.date > combinations[key].lastUsed) {
      combinations[key].lastUsed = shift.date;
    }
  });
  
  // 使用回数と最終使用日の順でソート
  const candidates = Object.values(combinations)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastUsed.localeCompare(a.lastUsed);
    })
    .slice(0, 10); // 最大10つまで表示
  
  return candidates;
}

function renderShiftSuggestions(date) {
  const suggestionsContainer = document.getElementById('shift-suggestions');
  const suggestionsList = document.getElementById('suggestions-list');
  
  if (!suggestionsContainer || !suggestionsList) return;
  
  const candidates = getShiftHistoryCandidates(date);
  
  if (candidates.length === 0) {
    suggestionsContainer.style.display = 'none';
    return;
  }
  
  suggestionsContainer.style.display = 'block';
  suggestionsList.innerHTML = candidates.map((candidate, index) => {
    const duration = candidate.end && candidate.start ? 
      (() => {
        const start = DateTime.fromISO(`2000-01-01T${candidate.start}`);
        const end = DateTime.fromISO(`2000-01-01T${candidate.end}`);
        const hours = end.diff(start, 'hours').hours;
        return hours.toFixed(1);
      })() : '';
    
    return `
      <button type="button" class="suggestion-item" data-index="${index}">
        <div class="suggestion-time">${candidate.start} - ${candidate.end}</div>
        <div class="suggestion-info">
          <span class="suggestion-role">${candidate.role}</span>
          ${duration ? `<span class="suggestion-duration">${duration}時間</span>` : ''}
          ${candidate.count > 1 ? `<span class="suggestion-count">${candidate.count}回</span>` : ''}
        </div>
      </button>
    `;
  }).join('');
  
  // 候補をクリックしたときのイベント
  suggestionsList.querySelectorAll('.suggestion-item').forEach((button, index) => {
    button.addEventListener('click', () => {
      const candidate = candidates[index];
      setTimeSelects(candidate.start || '', true);
      setTimeSelects(candidate.end || '', false);
      if (dom.modalShiftRole) dom.modalShiftRole.value = candidate.role;
      if (dom.modalShiftRate && candidate.rate) dom.modalShiftRate.value = candidate.rate;
    });
  });
}

function getSuggestions(date) {
  const dt = DateTime.fromISO(date);
  const weekday = dt.weekday % 7;
  const suggestions = {};
  const workSettings = getWorkSettings();
  
  if (workSettings.defaultWage && !suggestions.rate) suggestions.rate = workSettings.defaultWage;
  if (workSettings.defaultStartTime && !suggestions.start) suggestions.start = workSettings.defaultStartTime;
  if (workSettings.defaultEndTime && !suggestions.end) suggestions.end = workSettings.defaultEndTime;
  if (workSettings.workLocation && !suggestions.role) suggestions.role = workSettings.workLocation;
  
  const weekdayShifts = Object.values(appState.shifts || {}).filter(s => {
    if (!s.date) return false;
    const shiftDate = DateTime.fromISO(s.date);
    return shiftDate.weekday % 7 === weekday && shiftDate < dt;
  });
  
  if (weekdayShifts.length > 0) {
    const startTimes = weekdayShifts.map(s => s.start).filter(Boolean);
    if (startTimes.length > 0) {
      const timeCounts = {};
      startTimes.forEach(t => timeCounts[t] = (timeCounts[t] || 0) + 1);
      const mostCommonStart = Object.entries(timeCounts).sort((a, b) => b[1] - a[1])[0][0];
      if (!suggestions.start) suggestions.start = mostCommonStart;
      
      const durations = weekdayShifts
        .filter(s => s.start === mostCommonStart && s.durationHours)
        .map(s => s.durationHours);
      if (durations.length > 0 && !suggestions.end) {
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        const [h, m] = mostCommonStart.split(':').map(Number);
        const endTime = DateTime.fromObject({ hour: h, minute: m }).plus({ hours: avgDuration });
        suggestions.end = endTime.toFormat('HH:mm');
      }
    }
    
    const rates = weekdayShifts.map(s => Number(s.rate)).filter(r => r > 0);
    if (rates.length > 0 && !suggestions.rate) {
      const rateCounts = {};
      rates.forEach(r => rateCounts[r] = (rateCounts[r] || 0) + 1);
      const mostCommonRate = Object.entries(rateCounts).sort((a, b) => b[1] - a[1])[0][0];
      suggestions.rate = mostCommonRate;
    }
    
    const roles = weekdayShifts.map(s => s.role).filter(Boolean);
    if (roles.length > 0 && !suggestions.role) {
      const roleCounts = {};
      roles.forEach(r => roleCounts[r] = (roleCounts[r] || 0) + 1);
      const mostCommonRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0][0];
      suggestions.role = mostCommonRole;
    }
  }
  
  const templates = Object.values(appState.recurring || {}).filter(t => Number(t.weekday) === weekday);
  if (templates.length > 0) {
    const template = templates[0];
    if (template.start && !suggestions.start) suggestions.start = template.start;
    if (template.rate && !suggestions.rate) suggestions.rate = template.rate;
    if (template.duration && !suggestions.end && template.start) {
      const [h, m] = template.start.split(':').map(Number);
      const endTime = DateTime.fromObject({ hour: h, minute: m }).plus({ hours: template.duration });
      suggestions.end = endTime.toFormat('HH:mm');
    }
  }
  
  return suggestions;
}

// Cache Management
function hydrateFromCache() {
  if (typeof localStorage === 'undefined') return;
  const cached = localStorage.getItem(STORAGE_KEYS.cache);
  if (!cached) return;
  try {
    const snapshot = JSON.parse(cached);
    isHydrating = true;
    appState.shifts = snapshot.shifts || {};
    appState.recurring = snapshot.recurring || {};
    appState.income = snapshot.income || {};
    appState.expenses = snapshot.expenses || {};
    appState.reminders = snapshot.reminders || {};
    refreshUI();
  } catch (error) {
    console.warn('Failed to parse cache', error);
  } finally {
    isHydrating = false;
  }
}

function persistToCacheSoon() {
  if (isHydrating || typeof localStorage === 'undefined') return;
  clearTimeout(cacheSaveTimeout);
  cacheSaveTimeout = setTimeout(() => {
    try {
      const snapshot = {
        shifts: appState.shifts,
        recurring: appState.recurring,
        income: appState.income,
        expenses: appState.expenses,
        reminders: appState.reminders,
      };
      localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(snapshot));
    } catch (error) {
      console.warn('Failed to save cache', error);
    }
  }, 300);
}

// Start app
init();
