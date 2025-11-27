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
  incomeForm: document.getElementById('income-form'),
  expenseForm: document.getElementById('expense-form'),
  financeList: document.getElementById('finance-list'),
  reminderForm: document.getElementById('reminder-form'),
  reminderList: document.getElementById('reminder-list'),
  summaryHours: document.getElementById('summary-hours'),
  summaryIncome: document.getElementById('summary-income'),
  summaryExpenses: document.getElementById('summary-expenses'),
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
  modalShiftEnd: document.getElementById('modal-shift-end'),
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
  calendarCursor: DateTime.now().startOf('month'),
};

const charts = {
  incomeExpense: null,
  hours: null,
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
  const allInputs = document.querySelectorAll('input, select, textarea');
  allInputs.forEach(input => {
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('data-form-type', 'other');
  });
  
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
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = button.dataset.tab;
      if (tabName) switchTab(tabName);
    });
  });

  // Forms
  dom.recurringForm?.addEventListener('submit', handleRecurringSubmit);
  dom.incomeForm?.addEventListener('submit', (e) => handleFinanceSubmit(e, 'income'));
  dom.expenseForm?.addEventListener('submit', (e) => handleFinanceSubmit(e, 'expenses'));
  dom.reminderForm?.addEventListener('submit', handleReminderSubmit);
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
    if (e.target === dom.shiftModal) closeShiftModal();
  });
  dom.modalDeleteBtn?.addEventListener('click', async () => {
    const shiftId = dom.calendarShiftForm?.dataset.editId;
    if (shiftId && confirm('Delete this shift?')) {
      await deleteEntity('shifts', shiftId);
      closeShiftModal();
    }
  });
  dom.calendarShiftForm?.addEventListener('submit', handleCalendarShiftSubmit);
}

function renderPlaceholders() {
  if (dom.shiftList) dom.shiftList.innerHTML = '<div class="placeholder">No shifts yet.</div>';
  if (dom.recurringList) dom.recurringList.innerHTML = '<div class="placeholder">No templates yet.</div>';
  if (dom.financeList) dom.financeList.innerHTML = '<div class="placeholder">No income or expenses yet.</div>';
  if (dom.reminderList) dom.reminderList.innerHTML = '<div class="placeholder">No reminders yet.</div>';
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-button').forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.tab === tabName);
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
  
  const form = collectionKey === 'income' ? dom.incomeForm : dom.expenseForm;
  const data = Object.fromEntries(new FormData(form));
  const amount = +(Number(data.amount) || 0).toFixed(2);
  
  if (amount <= 0) {
    alert('Amount must be greater than zero.');
    return;
  }
  
  const payload = {
    date: data.date,
    amount,
    category: data.category || '',
    type: collectionKey === 'income' ? 'income' : 'expense',
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

async function handleCalendarShiftSubmit(event) {
  event.preventDefault();
  if (!isFirebaseEnabled) {
    alert('Firebase is not connected.');
    return;
  }
  
  const data = Object.fromEntries(new FormData(dom.calendarShiftForm));
  
  if (!data.start || !data.end) {
    alert('Please enter both start and end times.');
    return;
  }
  
  if (!data.role || data.role.trim() === '') {
    const workSettings = getWorkSettings();
    if (workSettings.workLocation) {
      data.role = workSettings.workLocation;
    } else {
      alert('Please enter a work location/role.');
      return;
    }
  }
  
  const start = DateTime.fromISO(`${data.date}T${data.start}`);
  const end = DateTime.fromISO(`${data.date}T${data.end}`);
  
  if (!start.isValid || !end.isValid || end <= start) {
    alert('Please enter a valid time range.');
    return;
  }
  
  const durationHours = end.diff(start, 'hours').hours;
  let rate = Number(data.rate) || 0;
  
  if (rate <= 0) {
    const workSettings = getWorkSettings();
    if (workSettings.defaultWage) {
      rate = Number(workSettings.defaultWage);
    } else {
      alert('Please enter an hourly rate.');
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
    case 'expenses':
      const form = collectionKey === 'income' ? dom.incomeForm : dom.expenseForm;
      if (form) {
        form.date.value = data.date;
        form.amount.value = data.amount;
        form.category.value = data.category || '';
        form.dataset.editId = id;
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
  renderFinanceList();
  renderReminderList();
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
    totalExpenses: 0,
    net: 0,
    expenseCategories: new Map(),
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

  Object.values(appState.expenses || {}).forEach((expense) => {
    const amount = Number(expense.amount) || 0;
    totals.totalExpenses += amount;
    bucketWeek(expense.date, 0, amount, totals.weekBuckets);
    const category = expense.category?.trim() || 'General';
    totals.expenseCategories.set(
      category,
      (totals.expenseCategories.get(category) || 0) + amount
    );
  });

  totals.totalIncome = totals.shiftIncome + totals.manualIncome;
  totals.net = totals.totalIncome - totals.totalExpenses;
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
  bucket.expense += expense;
  map.set(key, bucket);
}

function bucketWeekday(date, hours, array) {
  if (!date) return;
  const dt = DateTime.fromISO(date);
  if (!dt.isValid) return;
  array[dt.weekday % 7] += hours;
}

function renderSummary(aggregates) {
  if (dom.summaryHours) dom.summaryHours.textContent = aggregates.totalHours.toFixed(1);
  if (dom.summaryIncome) dom.summaryIncome.textContent = `$${aggregates.totalIncome.toFixed(2)}`;
  if (dom.summaryExpenses) dom.summaryExpenses.textContent = `$${aggregates.totalExpenses.toFixed(2)}`;

  const topExpense = [...aggregates.expenseCategories.entries()].sort((a, b) => b[1] - a[1])[0];
  const weeklyHours = aggregates.weekBuckets.size
    ? (aggregates.totalHours / Math.max(aggregates.weekBuckets.size, 1)).toFixed(1)
    : '0.0';
  
  if (dom.summaryDetails) {
    dom.summaryDetails.innerHTML = `
      <span>Net Income: <strong>$${aggregates.net.toFixed(2)}</strong></span>
      <span>Avg Weekly Hours: <strong>${weeklyHours} hrs</strong></span>
      <span>Top Expense Category: <strong>${
        topExpense ? `${topExpense[0]} ($${topExpense[1].toFixed(2)})` : 'n/a'
      }</strong></span>
    `;
  }
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
      const pay = `$${Number(shift.totalPay || 0).toFixed(2)}`;
      const hours = Number(shift.durationHours || 0).toFixed(2);
      return `
        <article class="list-item">
          <header>
            <span>${shift.date} · ${shift.start}–${shift.end}</span>
            <span>${pay}</span>
          </header>
          <p>${shift.role || 'Shift'} (${hours} hrs)</p>
          ${shift.notes ? `<p class="muted">${shift.notes}</p>` : ''}
          <footer>
            <button data-action="edit" data-collection="shifts" data-id="${id}">Edit</button>
            <button data-action="delete" data-collection="shifts" data-id="${id}" class="danger">Delete</button>
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
  const expenses = Object.entries(appState.expenses || {}).map(([id, entry]) => ({
    id, collection: 'expenses', ...entry,
  }));
  const combined = [...incomes, ...expenses];
  
  if (!dom.financeList) return;
  
  if (!combined.length) {
    dom.financeList.innerHTML = '<div class="placeholder">No income or expenses yet.</div>';
    return;
  }
  
  dom.financeList.innerHTML = combined
    .sort((a, b) => (a.date > b.date ? -1 : 1))
    .map((entry) => {
      const sign = entry.type === 'expense' ? '-' : '+';
      const amount = Number(entry.amount || 0).toFixed(2);
      return `
        <article class="list-item">
          <header>
            <span>${entry.date} · ${entry.category || 'General'}</span>
            <span>${sign}$${amount}</span>
          </header>
          <footer>
            <button data-action="edit" data-collection="${entry.collection}" data-id="${entry.id}">Edit</button>
            <button data-action="delete" data-collection="${entry.collection}" data-id="${entry.id}" class="danger">Delete</button>
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
  const month = appState.calendarCursor;
  if (dom.calendarMonth) dom.calendarMonth.textContent = month.toFormat('LLLL yyyy');

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
  
  const recurringTemplates = Object.entries(appState.recurring || {}).map(([id, template]) => ({ id, ...template }));

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
    
    const shiftMarkup = sortedShifts.map((shift) => {
      const startTime = shift.start || '';
      const endTime = shift.end || '';
      const role = shift.role || 'Shift';
      const duration = shift.durationHours || 0;
      return `
        <div class="shift-chip" data-shift-id="${shift.id}" title="${role} · ${startTime}-${endTime}">
          <span class="shift-time">${startTime}${endTime ? `-${endTime}` : ''}</span>
          <span class="shift-role">${role}</span>
          ${duration > 0 ? `<span class="shift-duration">${duration.toFixed(1)}h</span>` : ''}
        </div>`;
    }).join('');
    
    const recurringMarkup = recurringTemplates
      .filter((template) => Number(template.weekday) === weekdayIndex)
      .map((template) => {
        const startTime = template.start || '';
        const duration = template.duration || 0;
        return `
        <div class="shift-chip recurring" title="Recurring template · ${startTime} · ${duration} hrs">
          <span class="shift-time">${startTime}</span>
          <span class="shift-role">Template</span>
          ${duration > 0 ? `<span class="shift-duration">${duration}h</span>` : ''}
        </div>`;
      })
      .join('');

    const isToday = cursor.toISODate() === DateTime.now().toISODate();
    const isCurrentMonth = cursor.month === month.month;

    cells.push(`
      <div class="calendar-cell ${!isCurrentMonth ? 'muted-cell' : ''} ${isToday ? 'today' : ''}" data-date="${dayId}">
        <span class="cell-date ${isToday ? 'today-date' : ''}">${cursor.day}</span>
        <div class="shift-container">
          ${shiftMarkup || recurringMarkup ? `${shiftMarkup}${recurringMarkup}` : ''}
        </div>
      </div>
    `);
    cursor = cursor.plus({ days: 1 });
  }

  if (dom.calendarGrid) {
    dom.calendarGrid.innerHTML = cells.join('');
    
    dom.calendarGrid.querySelectorAll('.calendar-cell').forEach((cell) => {
      cell.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.closest('input, select, textarea')) {
          return;
        }
        
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
}

function openShiftModal(date, shiftId = null) {
  if (!dom.shiftModal || !date) return;
  
  if (dom.calendarShiftForm) {
    dom.calendarShiftForm.reset();
    if (dom.calendarShiftForm.dataset.editId) delete dom.calendarShiftForm.dataset.editId;
  }
  
  if (shiftId && appState.shifts[shiftId]) {
    const shift = appState.shifts[shiftId];
    if (dom.calendarShiftForm) dom.calendarShiftForm.dataset.editId = shiftId;
    if (dom.modalShiftDate) dom.modalShiftDate.value = shift.date || date;
    if (dom.modalShiftStart) dom.modalShiftStart.value = shift.start || '';
    if (dom.modalShiftEnd) dom.modalShiftEnd.value = shift.end || '';
    if (dom.modalShiftRate) dom.modalShiftRate.value = shift.rate || '';
    if (dom.modalShiftRole) dom.modalShiftRole.value = shift.role || '';
    if (dom.modalShiftNotes) dom.modalShiftNotes.value = shift.notes || '';
    
    const modalTitle = dom.shiftModal.querySelector('.modal-header h2');
    if (modalTitle) modalTitle.textContent = 'Edit Shift';
    if (dom.modalDeleteBtn) dom.modalDeleteBtn.style.display = 'block';
    
    if (dom.startSuggestion) dom.startSuggestion.textContent = '';
    if (dom.endSuggestion) dom.endSuggestion.textContent = '';
    if (dom.rateSuggestion) dom.rateSuggestion.textContent = '';
    if (dom.roleSuggestion) dom.roleSuggestion.textContent = '';
    
    dom.shiftModal.classList.add('active');
    return;
  }
  
  if (dom.modalShiftDate) dom.modalShiftDate.value = date;
  const modalTitle = dom.shiftModal.querySelector('.modal-header h2');
  if (modalTitle) modalTitle.textContent = 'Add Shift';
  if (dom.modalDeleteBtn) dom.modalDeleteBtn.style.display = 'none';
  
  const suggestions = getSuggestions(date);
  const workSettings = getWorkSettings();
  
  if (workSettings.workLocation && dom.modalShiftRole) {
    dom.modalShiftRole.value = workSettings.workLocation;
  } else if (suggestions.role && dom.modalShiftRole) {
    dom.modalShiftRole.value = suggestions.role;
  }
  
  if (workSettings.defaultStartTime && dom.modalShiftStart) {
    dom.modalShiftStart.value = workSettings.defaultStartTime;
  } else if (suggestions.start && dom.modalShiftStart) {
    dom.modalShiftStart.value = suggestions.start;
  }
  
  if (workSettings.defaultEndTime && dom.modalShiftEnd) {
    dom.modalShiftEnd.value = workSettings.defaultEndTime;
  } else if (suggestions.end && dom.modalShiftEnd) {
    dom.modalShiftEnd.value = suggestions.end;
  }
  
  if (workSettings.defaultWage && dom.modalShiftRate) {
    dom.modalShiftRate.value = workSettings.defaultWage;
  } else if (suggestions.rate && dom.modalShiftRate) {
    dom.modalShiftRate.value = suggestions.rate;
  }
  
  const finalStart = dom.modalShiftStart?.value || suggestions.start;
  const finalEnd = dom.modalShiftEnd?.value || suggestions.end;
  const finalRate = dom.modalShiftRate?.value || suggestions.rate;
  const finalRole = dom.modalShiftRole?.value || suggestions.role;
  
  if (dom.startSuggestion) {
    dom.startSuggestion.textContent = finalStart ? `💡 ${workSettings.defaultStartTime ? 'From settings' : 'Suggested'}: ${finalStart}` : '';
  }
  if (dom.endSuggestion) {
    dom.endSuggestion.textContent = finalEnd ? `💡 ${workSettings.defaultEndTime ? 'From settings' : 'Suggested'}: ${finalEnd}` : '';
  }
  if (dom.rateSuggestion) {
    dom.rateSuggestion.textContent = finalRate ? `💡 ${workSettings.defaultWage ? 'From settings' : 'Suggested'}: $${finalRate}` : '';
  }
  if (dom.roleSuggestion) {
    dom.roleSuggestion.textContent = finalRole ? `💡 ${workSettings.workLocation ? 'From settings' : 'Suggested'}: ${finalRole}` : '';
  }
  
  dom.shiftModal.classList.add('active');
  
  setTimeout(() => {
    if (dom.modalShiftStart) dom.modalShiftStart.focus();
  }, 100);
}

function closeShiftModal() {
  if (!dom.shiftModal) return;
  dom.shiftModal.classList.remove('active');
  if (dom.calendarShiftForm) {
    dom.calendarShiftForm.reset();
    if (dom.calendarShiftForm.dataset.editId) delete dom.calendarShiftForm.dataset.editId;
  }
  if (dom.modalDeleteBtn) dom.modalDeleteBtn.style.display = 'none';
  if (dom.startSuggestion) dom.startSuggestion.textContent = '';
  if (dom.endSuggestion) dom.endSuggestion.textContent = '';
  if (dom.rateSuggestion) dom.rateSuggestion.textContent = '';
  if (dom.roleSuggestion) dom.roleSuggestion.textContent = '';
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
