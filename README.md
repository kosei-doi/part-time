# Part-Time Tracker

Client-side HTML/CSS/JS dashboard for logging part-time shifts, recurring templates, income, expenses, reminders, analytics, and a calendar synced with Firebase Realtime Database.

## Setup
1. Create a Firebase project and enable the Realtime Database (in test mode if this is a personal tool).
2. From **Project Settings → General → SDK setup**, copy the Firebase config JSON snippet.
3. Open `index.html` in a modern browser (or serve via `npx serve .`).
4. Paste the config JSON into the textarea at the top of the page and click **Connect**.
5. After connecting, data will stay synced with Firebase and cached locally for offline viewing.

## Firebase Data Shape
```
/shifts/{id}      → { date, start, end, role, notes, rate, durationHours, totalPay }
/recurring/{id}   → { weekday, start, duration, rate }
/income/{id}      → { date, amount, category, type: 'income' }
/expenses/{id}    → { date, amount, category, type: 'expense' }
/reminders/{id}   → { date, time, lead, message }
```

## Manual Test Checklist
- **Firebase connection**: invalid JSON shows error, valid config connects and status chip turns green.
- **Shift CRUD**: create, edit, delete shifts; see calendar chips, summary, and charts update.
- **Recurring templates**: add weekday templates, ensure they appear on every matching calendar day.
- **Income/expenses**: add positive amounts, verify finance list and summary totals change, net income recalculates.
- **Analytics**: confirm charts reflect weekly income vs expenses and hours by weekday.
- **Reminders**: add reminder with lead minutes, upcoming badge displays, notification prompt works if enabled.
- **Local cache**: reload page before reconnecting—cached data should appear immediately; Firebase config textarea prefilled.
- **Validation**: entering zero/negative durations or amounts shows inline alerts and prevents submission.

## Notes
- Notifications require HTTPS context; desktop browsers may block alerts when the tab is unfocused.
- All data is stored in Firebase; delete nodes in the console to reset the app.
