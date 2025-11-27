/*
 * Part-Time Tracker front-end logic
 * Firebase integration and rich features filled in upcoming tasks.
 */
const { DateTime } = luxon;

const dom = {
  shiftForm: document.getElementById('shift-form'),
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
  firebaseConfigInput: document.getElementById('firebase-config'),
  firebaseConnectBtn: document.getElementById('connect-firebase'),
  notificationBtn: document.getElementById('enable-notifications'),
  connectionStatus: document.getElementById('connection-status'),
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
  config: 'part-time-tracker-config',
};

const appState = {
  firebase: { app: null, db: null },
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
let notificationsEnabled =
  typeof Notification !== 'undefined' && Notification.permission === 'granted';
let isHydrating = false;
let cacheSaveTimeout = null;

function init() {
  attachEventListeners();
  syncNotificationButton();
  setConnectionStatus('idle', 'Not connected');
  renderPlaceholders();
  hydrateFromCache();
  loadSavedConfig();
  renderCalendar();
}

function attachEventListeners() {
  dom.shiftForm?.addEventListener('submit', handleShiftSubmit);
  dom.recurringForm?.addEventListener('submit', handleRecurringSubmit);
  dom.incomeForm?.addEventListener('submit', (event) =>
    handleFinanceSubmit(event, 'income')
  );
  dom.expenseForm?.addEventListener('submit', (event) =>
    handleFinanceSubmit(event, 'expenses')
  );
  dom.reminderForm?.addEventListener('submit', handleReminderSubmit);

  document.body.addEventListener('click', handleListAction);

  dom.calendarPrev?.addEventListener('click', () => {
    appState.calendarCursor = appState.calendarCursor.minus({ months: 1 });
    renderCalendar();
  });

  dom.calendarNext?.addEventListener('click', () => {
    appState.calendarCursor = appState.calendarCursor.plus({ months: 1 });
    renderCalendar();
  });

  dom.firebaseConnectBtn?.addEventListener('click', () => {
    connectFirebase();
  });

  dom.notificationBtn?.addEventListener('click', requestNotificationPermission);

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      const tabName = button.dataset.tab;
      switchTab(tabName);
    });
  });
}

function renderPlaceholders() {
  dom.shiftList.innerHTML = `<div class="placeholder">No shifts yet.</div>`;
  dom.recurringList.innerHTML = `<div class="placeholder">No templates yet.</div>`;
  dom.financeList.innerHTML = `<div class="placeholder">No income or expenses yet.</div>`;
  dom.reminderList.innerHTML = `<div class="placeholder">No reminders yet.</div>`;
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-button').forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const isActive = panel.dataset.tab === tabName;
    panel.classList.toggle('active', isActive);
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
  dom.notificationBtn.textContent = notificationsEnabled
    ? 'Alerts enabled'
    : 'Enable Alerts';
}

function setConnectionStatus(state, message) {
  if (!dom.connectionStatus) return;
  dom.connectionStatus.textContent = message;
  dom.connectionStatus.className = `status-chip ${state || ''}`.trim();
}

async function handleShiftSubmit(event) {
  event.preventDefault();
  if (!ensureDb()) return;
  const data = Object.fromEntries(new FormData(dom.shiftForm));
  const start = DateTime.fromISO(`${data.date}T${data.start}`);
  const end = DateTime.fromISO(`${data.date}T${data.end}`);
  if (!start.isValid || !end.isValid || end <= start) {
    alert('Please enter a valid time range.');
    return;
  }
  const durationHours = end.diff(start, 'hours').hours;
  const rate = Number(data.rate) || 0;
  const payload = {
    date: data.date,
    start: data.start,
    end: data.end,
    role: data.role || '',
    notes: data.notes || '',
    rate,
    durationHours,
    totalPay: +(durationHours * rate).toFixed(2),
    updatedAt: Date.now(),
    createdAt: Number(dom.shiftForm.dataset.editId ? appState.shifts[dom.shiftForm.dataset.editId]?.createdAt : Date.now()),
  };

  const id = dom.shiftForm.dataset.editId;
  await saveEntity('shifts', payload, id);
  dom.shiftForm.reset();
  dom.shiftForm.dataset.editId && delete dom.shiftForm.dataset.editId;
}

async function handleRecurringSubmit(event) {
  event.preventDefault();
  if (!ensureDb()) return;
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
    duration: Number(data.duration) || 0,
    rate: Number(data.rate) || 0,
    updatedAt: Date.now(),
    createdAt: Number(dom.recurringForm.dataset.editId ? appState.recurring[dom.recurringForm.dataset.editId]?.createdAt : Date.now()),
  };
  const id = dom.recurringForm.dataset.editId;
  await saveEntity('recurring', payload, id);
  dom.recurringForm.reset();
  dom.recurringForm.dataset.editId && delete dom.recurringForm.dataset.editId;
}

async function handleFinanceSubmit(event, collectionKey) {
  event.preventDefault();
  if (!ensureDb()) return;
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
    createdAt: Number(form.dataset.editId ? appState[collectionKey][form.dataset.editId]?.createdAt : Date.now()),
  };
  const id = form.dataset.editId;
  await saveEntity(collectionKey, payload, id);
  form.reset();
  form.dataset.editId && delete form.dataset.editId;
}

async function handleReminderSubmit(event) {
  event.preventDefault();
  if (!ensureDb()) return;
  const data = Object.fromEntries(new FormData(dom.reminderForm));
  const leadMins = Number(data.lead) || 0;
  const schedule = DateTime.fromISO(`${data.date}T${data.time || '09:00'}`);
  if (!schedule.isValid) {
    alert('Please choose a valid reminder date/time.');
    return;
  }
  const payload = {
    date: data.date,
    time: data.time || '09:00',
    message: data.message,
    lead: leadMins,
    updatedAt: Date.now(),
    createdAt: Number(dom.reminderForm.dataset.editId ? appState.reminders[dom.reminderForm.dataset.editId]?.createdAt : Date.now()),
  };
  const id = dom.reminderForm.dataset.editId;
  await saveEntity('reminders', payload, id);
  dom.reminderForm.reset();
  dom.reminderForm.time.value = '09:00';
  dom.reminderForm.dataset.editId && delete dom.reminderForm.dataset.editId;
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

async function saveEntity(collectionKey, payload, id) {
  try {
    const ref = appState.firebase.db.ref(firebasePaths[collectionKey]);
    if (id) {
      await ref.child(id).set(payload);
    } else {
      await ref.push({ ...payload, createdAt: payload.createdAt || Date.now() });
    }
  } catch (error) {
    console.error(error);
    alert(`Failed to save ${collectionKey.slice(0, -1)}.`);
  }
}

async function deleteEntity(collectionKey, id) {
  if (!ensureDb()) return;
  const confirmed = confirm('Delete this entry?');
  if (!confirmed) return;
  try {
    await appState.firebase.db
      .ref(`${firebasePaths[collectionKey]}/${id}`)
      .remove();
  } catch (error) {
    console.error(error);
    alert('Failed to delete entry.');
  }
}

function startEdit(collectionKey, id) {
  const data = appState[collectionKey]?.[id];
  if (!data) return;
  switch (collectionKey) {
    case 'shifts':
      dom.shiftForm.date.value = data.date;
      dom.shiftForm.start.value = data.start;
      dom.shiftForm.end.value = data.end;
      dom.shiftForm.rate.value = data.rate;
      dom.shiftForm.role.value = data.role || '';
      dom.shiftForm.notes.value = data.notes || '';
      dom.shiftForm.dataset.editId = id;
      break;
    case 'recurring':
      dom.recurringForm.weekday.value = data.weekday;
      dom.recurringForm.start.value = data.start;
      dom.recurringForm.duration.value = data.duration;
      dom.recurringForm.rate.value = data.rate;
      dom.recurringForm.dataset.editId = id;
      break;
    case 'income':
    case 'expenses':
      const form = collectionKey === 'income' ? dom.incomeForm : dom.expenseForm;
      form.date.value = data.date;
      form.amount.value = data.amount;
      form.category.value = data.category || '';
      form.dataset.editId = id;
      break;
    case 'reminders':
      dom.reminderForm.date.value = data.date;
      dom.reminderForm.time.value = data.time || '09:00';
      dom.reminderForm.message.value = data.message || '';
      dom.reminderForm.lead.value = data.lead ?? 30;
      dom.reminderForm.dataset.editId = id;
      break;
    default:
      break;
  }
}

function ensureDb() {
  if (!appState.firebase.db) {
    alert('Connect Firebase first.');
    return false;
  }
  return true;
}

async function connectFirebase() {
  const raw = dom.firebaseConfigInput.value.trim();
  if (!raw) {
    alert('Paste your Firebase config JSON first.');
    return;
  }

  try {
    const config = JSON.parse(raw);
    if (!config.databaseURL) {
      throw new Error('Config must include databaseURL for Realtime Database.');
    }
    rememberFirebaseConfig(raw);
    dom.firebaseConnectBtn.disabled = true;
    dom.firebaseConnectBtn.textContent = 'Connecting...';
    setConnectionStatus('loading', 'Connecting…');
    await resetFirebaseApp();
    const name = `part-time-tracker-${Date.now()}`;
    const app = firebase.initializeApp(config, name);
    const db = firebase.database(app);
    appState.firebase = { app, db };
    attachRealtimeListeners();
    dom.firebaseConnectBtn.textContent = 'Connected';
    setConnectionStatus('success', 'Connected');
    setTimeout(() => {
      dom.firebaseConnectBtn.textContent = 'Reconnect';
      dom.firebaseConnectBtn.disabled = false;
    }, 1200);
  } catch (error) {
    console.error(error);
    alert(`Firebase error: ${error.message}`);
    dom.firebaseConnectBtn.disabled = false;
    dom.firebaseConnectBtn.textContent = 'Connect';
    setConnectionStatus('error', 'Connection failed');
  }
}

async function resetFirebaseApp() {
  detachRealtimeListeners();
  if (appState.firebase.app) {
    try {
      await appState.firebase.app.delete();
    } catch (error) {
      console.warn('Failed to delete existing Firebase app', error);
    }
  }
  appState.firebase = { app: null, db: null };
}

function attachRealtimeListeners() {
  if (!appState.firebase.db) return;
  Object.entries(firebasePaths).forEach(([key, path]) => {
    const ref = appState.firebase.db.ref(path);
    const handler = (snapshot) => {
      appState[key] = snapshot.val() || {};
      refreshUI();
      persistToCacheSoon();
    };
    ref.on('value', handler);
    appState.listeners[key] = { ref, handler };
  });
}

function detachRealtimeListeners() {
  Object.values(appState.listeners).forEach((entry) => {
    if (!entry) return;
    entry.ref.off('value', entry.handler);
  });
  appState.listeners = {};
}

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
  const bucket =
    map.get(key) ||
    {
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
  dom.summaryHours.textContent = aggregates.totalHours.toFixed(1);
  dom.summaryIncome.textContent = `$${aggregates.totalIncome.toFixed(2)}`;
  dom.summaryExpenses.textContent = `$${aggregates.totalExpenses.toFixed(2)}`;

  const topExpense = [...aggregates.expenseCategories.entries()].sort(
    (a, b) => b[1] - a[1]
  )[0];
  const weeklyHours = aggregates.weekBuckets.size
    ? (
        aggregates.totalHours /
        Math.max(aggregates.weekBuckets.size, 1)
      ).toFixed(1)
    : '0.0';
  dom.summaryDetails.innerHTML = `
    <span>Net Income: <strong>$${aggregates.net.toFixed(2)}</strong></span>
    <span>Avg Weekly Hours: <strong>${weeklyHours} hrs</strong></span>
    <span>Top Expense Category: <strong>${
      topExpense ? `${topExpense[0]} ($${topExpense[1].toFixed(2)})` : 'n/a'
    }</strong></span>
  `;
}

function updateCharts(aggregates) {
  const weekData = [...aggregates.weekBuckets.values()].sort(
    (a, b) => a.order - b.order
  );
  const incomeExpenseCtx = document
    .getElementById('income-expense-chart')
    ?.getContext('2d');
  const hoursCtx = document.getElementById('hours-chart')?.getContext('2d');

  if (incomeExpenseCtx) {
    const labels = weekData.map((bucket) => bucket.label);
    const incomeData = weekData.map((bucket) =>
      Number(bucket.income.toFixed(2))
    );
    const expenseData = weekData.map((bucket) =>
      Number(bucket.expense.toFixed(2))
    );
    if (!charts.incomeExpense) {
      charts.incomeExpense = new Chart(incomeExpenseCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Income',
              data: incomeData,
              backgroundColor: 'rgba(78, 107, 255, 0.8)',
            },
            {
              label: 'Expenses',
              data: expenseData,
              backgroundColor: 'rgba(255, 99, 132, 0.7)',
            },
          ],
        },
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
    const hoursData = aggregates.weekdayHours.map((value) =>
      Number(value.toFixed(2))
    );
    if (!charts.hours) {
      charts.hours = new Chart(hoursCtx, {
        type: 'line',
        data: {
          labels: weekdayLabels,
          datasets: [
            {
              label: 'Hours by Weekday',
              data: hoursData,
              tension: 0.3,
              borderColor: 'rgba(78, 107, 255, 1)',
              backgroundColor: 'rgba(78, 107, 255, 0.2)',
              fill: true,
            },
          ],
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

function formatRelativeMinutes(minutes) {
  if (!isFinite(minutes)) return '?';
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return `${hours.toFixed(1)} hr`;
  }
  const days = hours / 24;
  return `${days.toFixed(1)} day`;
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
    const eventTime = DateTime.fromISO(
      `${reminder.date}T${reminder.time || '09:00'}`
    );
    if (!eventTime.isValid) return;
    const notifyAt = eventTime.minus({ minutes: Number(reminder.lead) || 0 });
    const diffMs = notifyAt.diff(now).milliseconds;
    if (diffMs <= 0 || diffMs > 1000 * 60 * 60 * 24) return; // schedule only within 24h
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

function renderShiftList() {
  const entries = Object.entries(appState.shifts || {});
  if (!entries.length) {
    dom.shiftList.innerHTML = `<div class="placeholder">No shifts yet.</div>`;
    return;
  }
  const markup = entries
    .sort(([, a], [, b]) => (a.date > b.date ? -1 : 1))
    .map(([id, shift]) => {
      const payValue = Number(shift.totalPay || 0);
      const pay = `$${payValue.toFixed(2)}`;
      const hoursValue = Number(shift.durationHours || 0).toFixed(2);
      return `
        <article class="list-item">
          <header>
            <span>${shift.date} · ${shift.start}–${shift.end}</span>
            <span>${pay}</span>
          </header>
          <p>${shift.role || 'Shift'} (${hoursValue} hrs)</p>
          ${
            shift.notes
              ? `<p class="muted">${shift.notes}</p>`
              : ''
          }
          <footer>
            <button data-action="edit" data-collection="shifts" data-id="${id}">Edit</button>
            <button data-action="delete" data-collection="shifts" data-id="${id}" class="danger">Delete</button>
          </footer>
        </article>
      `;
    })
    .join('');
  dom.shiftList.innerHTML = markup;
}

function renderRecurringList() {
  const entries = Object.entries(appState.recurring || {});
  if (!entries.length) {
    dom.recurringList.innerHTML = `<div class="placeholder">No templates yet.</div>`;
    return;
  }
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dom.recurringList.innerHTML = entries
    .map(([id, template]) => {
      return `
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
      `;
    })
    .join('');
}

function renderFinanceList() {
  const incomes = Object.entries(appState.income || {}).map(([id, entry]) => ({
    id,
    collection: 'income',
    ...entry,
  }));
  const expenses = Object.entries(appState.expenses || {}).map(([id, entry]) => ({
    id,
    collection: 'expenses',
    ...entry,
  }));
  const combined = [...incomes, ...expenses];
  if (!combined.length) {
    dom.financeList.innerHTML = `<div class="placeholder">No income or expenses yet.</div>`;
    return;
  }
  combined.sort((a, b) => (a.date > b.date ? -1 : 1));
  dom.financeList.innerHTML = combined
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
  if (!entries.length) {
    dom.reminderList.innerHTML = `<div class="placeholder">No reminders yet.</div>`;
    clearReminderTimers();
    return;
  }
  const now = DateTime.now();
  const markup = entries
    .map(([id, reminder]) => {
      const schedule = DateTime.fromISO(
        `${reminder.date}T${reminder.time || '09:00'}`
      );
      return { id, schedule, ...reminder };
    })
    .filter((entry) => entry.schedule.isValid)
    .sort((a, b) => a.schedule.toMillis() - b.schedule.toMillis())
    .map((entry) => {
      const notifyAt = entry.schedule.minus({ minutes: Number(entry.lead) || 0 });
      const diffMinutes = notifyAt.diff(now, 'minutes').minutes;
      const upcoming = diffMinutes >= 0;
      const relative = upcoming
        ? formatRelativeMinutes(diffMinutes)
        : 'Past due';
      return `
        <article class="list-item">
          <header>
            <span>${entry.schedule.toFormat('LLL d, t')}</span>
            <span class="badge ${upcoming ? 'upcoming' : 'past'}">${
        upcoming ? `In ${relative}` : relative
      }</span>
          </header>
          <p>${entry.message}</p>
          <p class="muted">Notify ${entry.lead || 0} mins before (${notifyAt.toFormat(
        'LLL d, t'
      )})</p>
          <footer>
            <button data-action="edit" data-collection="reminders" data-id="${
              entry.id
            }">Edit</button>
            <button data-action="delete" data-collection="reminders" data-id="${
              entry.id
            }" class="danger">Delete</button>
          </footer>
        </article>
      `;
    })
    .join('');
  dom.reminderList.innerHTML = markup;
  scheduleReminders();
}

function renderCalendar() {
  const month = appState.calendarCursor;
  dom.calendarMonth.textContent = month.toFormat('LLLL yyyy');

  const startOfMonth = month.startOf('month');
  const startOfGrid = startOfMonth.startOf('week');
  const endOfMonth = month.endOf('month');
  const endOfGrid = endOfMonth.endOf('week');
  const shiftsByDate = Object.entries(appState.shifts || {}).reduce(
    (acc, [id, shift]) => {
      if (!shift.date) return acc;
      if (!acc[shift.date]) acc[shift.date] = [];
      acc[shift.date].push({ id, ...shift });
      return acc;
    },
    {}
  );
  const recurringTemplates = Object.entries(appState.recurring || {}).map(
    ([id, template]) => ({ id, ...template })
  );

  const cells = [];
  let cursor = startOfGrid;
  while (cursor <= endOfGrid) {
    const dayId = cursor.toISODate();
    const weekdayIndex = cursor.weekday % 7;
    const shifts = shiftsByDate[dayId] || [];
    const shiftMarkup = shifts
      .map(
        (shift) => `
        <span
          class="shift-chip"
          title="${shift.role || 'Shift'} ${shift.start}-${shift.end} @ $${Number(
          shift.rate || 0
        ).toFixed(2)}"
        >
          ${shift.role || 'Shift'}
        </span>`
      )
      .join('');
    const recurringMarkup = recurringTemplates
      .filter((template) => template.weekday === weekdayIndex)
      .map(
        (template) => `
        <span
          class="shift-chip recurring"
          title="Recurring · ${template.start} · ${template.duration} hrs"
        >
          R · ${template.start}
        </span>`
      )
      .join('');

    cells.push(`
      <div class="calendar-cell ${
        cursor.month !== month.month ? 'muted-cell' : ''
      }">
        <span class="cell-date">${cursor.day}</span>
        ${
          shiftMarkup || recurringMarkup
            ? `${shiftMarkup}${recurringMarkup}`
            : '<span class="muted">No shifts</span>'
        }
      </div>
    `);
    cursor = cursor.plus({ days: 1 });
  }

  dom.calendarGrid.innerHTML = cells.join('');
}

function rememberFirebaseConfig(raw) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.config, raw);
  } catch (error) {
    console.warn('Failed to store config', error);
  }
}

function loadSavedConfig() {
  if (typeof localStorage === 'undefined' || !dom.firebaseConfigInput) return;
  const saved = localStorage.getItem(STORAGE_KEYS.config);
  if (saved) {
    dom.firebaseConfigInput.value = saved;
  }
}

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

init();
