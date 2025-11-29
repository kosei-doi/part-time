# How to Use Part-Time Tracker

## Quick Start

1. **Open the App**
   - Simply open `index.html` in your web browser
   - Or serve it locally: `npx serve .` (then open http://localhost:3000)
   - The app is already configured with Firebase, so it should work immediately

2. **First Time Setup**
   - Go to the **Settings** tab
   - Fill in your **Work Details**:
     - Work Location (e.g., "Coffee Shop Downtown")
     - Default Hourly Wage
     - Default Start Time
     - Default End Time
     - Tax Rate (%)
   - Click **Save Settings**

---

## Calendar Tab (Main View)

### Viewing Your Schedule
- The calendar shows the current month by default
- Use **◀** and **▶** buttons to navigate between months
- Today's date is highlighted with a blue circle
- Shifts appear as blue chips on the calendar days

### Adding a Shift
1. **Click on any empty day** in the calendar
2. A modal will open with:
   - Date (pre-filled)
   - Start Time (suggested from your settings or past history)
   - End Time (suggested)
   - Hourly Rate (suggested)
   - Location/Role (suggested)
   - Notes (optional)
3. Fill in the details and click **Save Shift**
4. The shift will appear on the calendar immediately

### Editing a Shift
1. **Click on an existing shift chip** (blue box) on the calendar
2. The modal opens with all the shift details pre-filled
3. Make your changes
4. Click **Save Shift** to update, or **Delete** to remove it

### Recurring Templates
- Go to **Settings** tab → **Recurring Templates**
- Create templates for shifts that repeat weekly (e.g., "Every Monday 9am-5pm")
- These appear as orange chips on the calendar

---

## Finance Tab

### Viewing Summary
At the top, you'll see:
- **Total Hours**: Sum of all shift hours
- **Income**: Total from shifts + manual income entries
- **Expenses**: Total expenses
- **Net Income**: Income minus expenses
- **Avg Weekly Hours**: Average hours per week
- **Top Expense Category**: Your biggest expense category

### Adding Income
1. Scroll to **Add Entry** → **Income** section
2. Fill in:
   - **Date**: When you received the income
   - **Amount**: Dollar amount
   - **Category**: Optional (e.g., "Salary", "Bonus")
3. Click **Add Income**

### Adding Expenses
1. Scroll to **Add Entry** → **Expense** section
2. Fill in:
   - **Date**: When the expense occurred
   - **Amount**: Dollar amount
   - **Category**: Optional (e.g., "Transport", "Food")
3. Click **Add Expense**

### Viewing Finance History
- All income and expenses appear in the list below the forms
- Sorted by date (newest first)
- Click **Edit** to modify or **Delete** to remove entries

---

## Settings Tab

### Work Details
Configure your default work settings:
- **Work Location**: Your job location/role name
- **Default Hourly Wage**: Your standard pay rate
- **Default Start Time**: Typical shift start time
- **Default End Time**: Typical shift end time
- **Tax Rate**: Percentage for tax calculations

These settings are used as suggestions when adding new shifts.

### Shifts List
- View all your shifts in a list format
- Click **Edit** to modify a shift (opens the calendar modal)
- Click **Delete** to remove a shift

### Recurring Templates
Create templates for weekly recurring shifts:
1. Select **Weekday** (Sunday-Saturday)
2. Enter **Start Time**
3. Enter **Duration** (in hours)
4. Enter **Hourly Rate**
5. Click **Save Template**

Templates appear on the calendar as orange chips on matching weekdays.

### Reminders
Set reminders for important dates:
1. Enter **Date** and **Time**
2. Enter **Message** (what you need to remember)
3. Set **Notify (mins before)**: How many minutes before to get notified
4. Click **Add Reminder**

**Enable Notifications:**
- Click **Enable Alerts** button
- Allow browser notifications when prompted
- You'll receive notifications for reminders

---

## Tips & Tricks

### Smart Suggestions
When adding a shift, the app suggests:
- **Times**: Based on past shifts on the same weekday
- **Rate**: Based on your most common hourly rate
- **Location**: Based on your work settings or past shifts
- **End Time**: Calculated from average duration of similar shifts

### Keyboard Shortcuts
- Click calendar days to quickly add shifts
- Click shift chips to quickly edit

### Mobile Friendly
- The app works great on smartphones
- Tabs scroll horizontally on small screens
- Calendar adapts to screen size
- All forms are touch-friendly

### Offline Support
- Data is cached locally
- You can view your data even without internet
- Changes sync to Firebase when connection is restored

### Data Persistence
- All data is saved to Firebase Realtime Database
- Changes sync across devices in real-time
- Data is also cached in browser localStorage

---

## Troubleshooting

### Shifts Not Appearing
- Check if Firebase is connected (should work automatically)
- Refresh the page
- Check browser console for errors

### Can't Input Data
- Make sure you're clicking directly on input fields
- Try refreshing the page
- Disable browser extensions if they interfere

### Notifications Not Working
- Notifications require HTTPS (or localhost)
- Make sure you clicked "Enable Alerts" and allowed permissions
- Check browser notification settings

### Data Not Syncing
- Check your internet connection
- Firebase should connect automatically
- Data is cached locally, so you can still view it offline

---

## Data Structure

Your data is stored in Firebase under these paths:
- `/shifts/{id}` - Individual shift records
- `/recurring/{id}` - Recurring shift templates
- `/income/{id}` - Manual income entries
- `/expenses/{id}` - Expense entries
- `/reminders/{id}` - Reminder entries

All data includes timestamps (`createdAt`, `updatedAt`) for tracking.

---

## Need Help?

- Check the browser console (F12) for any error messages
- Make sure you're using a modern browser (Chrome, Firefox, Safari, Edge)
- The app requires JavaScript to be enabled


