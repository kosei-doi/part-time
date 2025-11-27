# Part-Time Tracker

Client-side HTML/CSS/JS dashboard for logging part-time shifts, recurring templates, income, expenses, reminders, analytics, and a calendar synced with Firebase Realtime Database.

## Setup
1. Open `index.html` in a modern browser (or serve via `npx serve .`).
2. Firebase is already configured and will connect automatically.
3. Start using the app immediately - all data syncs to Firebase in real-time.
4. Data is also cached locally for offline viewing.

**Note:** The app uses Firebase Realtime Database. If you want to use your own Firebase project, update the `firebaseConfig` object in `index.html`.

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

## Usage Guide
See [USAGE.md](USAGE.md) for detailed instructions on how to use all features of the app.

## Notes
- Notifications require HTTPS context; desktop browsers may block alerts when the tab is unfocused.
- All data is stored in Firebase; delete nodes in the console to reset the app.
- The app works offline - data is cached locally and syncs when connection is restored.
