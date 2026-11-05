# Josh Brett Studio — Creative Board (v2)

A **minimal, styled Kanban board**, built to sit on top of an existing **Notion task database**. Four statuses; project filters; task details; Notion comments; drag-and-drop status; create/edit tasks. No AI dashboards, no duplicate project management system.

The design takes inspiration from punchy editorial / sticker-style portfolios, adapted for Josh Brett's documentary studio. Everything in the `public/` folder is static. The Notion bridge is a **server-side Netlify function** so your Notion API token never gets exposed in your webpage.

## Quick start — replace your current GitHub files

1. **Back up the old app first** (download the current repository ZIP if you have saved data only in the old app's browser localStorage). The new local demo uses a different storage key and **does not import your old local-only tasks**.
2. Extract `Josh_Brett_Studio_Board_v2_BUILD_FIX_GitHub.zip`. This ZIP has **no enclosing project folder**, so all extracted files are already at the correct level.
3. Open your existing GitHub repository. Delete the **old app files** in the repository (keep the repo itself, `.git` history and Netlify connection).
4. Upload **the contents of this folder** into the **repository root**. You should see `netlify.toml`, `README.md`, `public/`, and `netlify/` directly in the repo root — **no extra enclosing folder**.
5. Commit. If your Netlify project is linked to GitHub, it should redeploy automatically. Under **Netlify → Project configuration → Build & deploy**, make sure **Base directory is empty**, **Publish directory is `public`**, and **Functions directory is `netlify/functions`**. This version sets an explicit safe build command in the root `netlify.toml`; no compiler or npm install is required.
6. Visit your existing `*.netlify.app` URL. The board should display in **Local demo** mode immediately. Browser changes in local demo mode do **not** sync with Notion.

**Do not upload a ZIP file as a single file inside GitHub.** Unzip and upload the folder *contents*.

If you prefer to drag a folder into Netlify manually, use the separate `Josh_Brett_Studio_Board_v2_Static_Preview.zip` containing `index.html`, `styles.css`, and `app.js` at its root. That gives you a working **local-demo-only** version. The full Notion bridge requires a Git-based Netlify deploy (or equivalent server deployment) with the `netlify/functions/` folder.

## Connect your existing Notion board (one-time setup)

The app does **not** currently know your private Notion database or login details. Until the following is configured, it is a demo and **no changes reach Notion**.

### A. Notion integration

1. Go to [Notion integrations](https://www.notion.so/profile/integrations) and create an internal integration/connection (or use an existing one).
2. Grant **read content, insert content, update content, read comments and insert comments** capabilities. Comments permissions must be explicitly enabled or they will fail even if status updates work.
3. In Notion open the **task database** and give the integration access via the page's **Connections** menu. Use **only the intended task database**, not the entire workspace.
4. Copy its **database ID** from the database's URL. It is typically a 32-character hex string. You may instead use `NOTION_DATA_SOURCE_ID` if you already have the newer data source ID.

The Notion task database must contain **one title property** (usually `Name`) and **one `Status` property** (type Status or Select). Recommended status options: `To do`, `In progress`, `Waiting`, `Done`. The board can also map `Not started`, `Doing`, `Blocked`, `Completed` automatically. If your Notion board lacks a `Waiting`/`Blocked` option, add it to support all four columns.

Recommended *optional* properties:

| Property | Notion type | Why |
|---|---|---|
| `Project` | Select | Project pills and filters |
| `Priority` | Select | Suggested options `Normal`, `High`, `Urgent` |
| `Due` | Date | Due-date badges |
| `Description` | Text / rich text | Editable description in drawer |

The app tries to detect common alternative names (`Task`, `Title`, `Due date`, `Notes`, etc.). If no optional property is present, the associated information will **not** be written to Notion. It won't invent properties automatically or override your existing schema. There is no one-to-one mapping of every custom Notion database: check your properties first.

### B. Configure Netlify (securely)

Go to **Netlify → conditioningteam → Project configuration → Environment variables**, and add:

- `NOTION_TOKEN` → secret token from your Notion integration (**never commit it to GitHub**).
- `NOTION_DATABASE_ID` → ID of your Notion task database.
- `BOARD_ACCESS_CODE` → create a long, random access code (for example using a password manager). This is **not** the Notion token.

Optional: `NOTION_DATA_SOURCE_ID` can be set instead of `NOTION_DATABASE_ID` for a specific data source. The backend uses Notion API version `2025-09-03` and resolves a database's first data source by default.

**Redeploy after setting environment variables.** Netlify functions read values during deployment. In the app, click `Sample data` (top right) and enter **only your `BOARD_ACCESS_CODE`**. You'll see `Connected` when it can list your real tasks. The device remembers the code from then on (see *Overview, links and remembered devices* below).

**Access note:** The Notion API is protected by the code, but the HTML app itself may remain publicly accessible until you configure proper visitor restrictions on Netlify. An access code shared with Daisy is **shared-password access**, not identity-based account authentication: anyone who learns the code could access/change those Notion tasks. For access truly restricted to specific individual accounts, set up Netlify visitor authentication or add a real user login. Avoid private personal/client records and health information in this simple version.

### C. Test syncing with Daisy

1. In Notion, create a harmless task. Refresh the app and confirm it appears.
2. Move that task to `In progress` in the app. Confirm the status changes in Notion.
3. Open the task and post a short comment. Confirm the comment appears in Notion. **The API-authored comment may appear as the integration/bot, not Daisy's Notion identity.**
4. Have Daisy open the app on a separate computer, connect with the access code, and refresh. She should see the same board.

The app updates when you press **Refresh** or reconnect. It does **not** provide real-time push notifications.

## Known v1 constraints / what we intentionally didn't build

- No project-management sprawl: no built-in AI scraping, sponsor CRM, finance view, weekly reviews or automations. Those remain tasks/tags in your Notion board.
- No automatic imports from the previous single-file app. Back up its local data before replacing files.
- Notion status mappings work for conventional options; custom options may require editing the database in Notion.
- Optional fields absent from the database won't persist on Notion updates; the app doesn't auto-create properties.
- Notion page comments appear under the integration identity when sent via an integration token.
- Shared-code gate is *not* per-person authentication; Notion token stays server-side. The code is remembered per device until someone presses *Forget this device*.
- The static-only preview shows sample data only and saves nothing.
- No drag-and-drop order sorting inside each column; drag task cards between columns or change status in task details.
- No client health or sensitive info should be placed in the public demo data.

## File layout

```
netlify.toml
README.md
public/
  index.html
  styles.css
  app.js
netlify/
  functions/
    notion.mjs
    production.mjs
    calendar.mjs
    sponsorships.mjs   # Sponsorships tab bridge + Zoho actions
    zoho-sync.mjs      # hourly scheduled Zoho Mail sync
  lib/
    zoho-sync.mjs      # shared Zoho Mail logic
google-apps-script/
  Code.gs              # ONE file: content calendar + sponsorship tracker + studioSelfTest()
```

The browser scripts load in this order: `studio.js` (remembered code, tab switching and links), `app.js` (task boards), `weekly.js`, `production.js`, `calendar.js`, `sponsorships.js`, `today.js`.


## Overview, links and remembered devices

**Overview** is the first tab and the page the site opens on. It reads what the other tabs already load and shows, on one screen:

- **Due this week**: active Notion tasks due before next Monday, for Josh and Daisy (unassigned tasks sit with Daisy, as on her board), overdue first.
- **Replies waiting on you**: sponsorship rows flagged in Zoho or with the status *Awaiting Josh's reply*, plus flagged emails from new senders, longest wait first; and the open Action list count.
- **Production needs**: videos that are blocked, past their next due date, not updated for 7 days, or due within a week.
- **Publishing**: entries past their date that aren't on YouTube yet (last 30 days), and the next 8 weeks of uploads, marking the ones without a sponsor.
- **Sponsor money**: sponsored videos that are live but still *In progress* (invoice them), and *Invoiced* ones waiting to be paid with how long the video has been live (45+ days says *Chase*). It goes by each entry's sponsor status in the calendar, so set it to *Paid* when the money lands.

Every row opens the real item in its drawer, right there on the Overview. **Refresh all** reloads everything (and fresh YouTube numbers); otherwise the Overview reuses the server's 10-minute YouTube cache and refreshes itself when you come back to a tab left open for 15 minutes or more. If one source fails (the Google approval lapsing, say), that card shows the error and the rest still work.

**Links.** The address bar follows the tab and the open item, and every drawer has **⧉ Copy link**. Links look like `#overview` (older `#today` links still work), `#daisy`, `#josh`, `#archive`, `#production`, `#production/video/<id>`, `#production/blocked`, `#production/needs-update`, `#calendar/2026-11-12`, `#sponsorships/brands/<id>`, `#sponsorships/agencies/<id>`, `#sponsorships/waiting-on-you`, `#sponsorships/actions` and `#josh/task/<id>`. Browser Back moves between tabs. A link to something that has since moved or been deleted says so instead of failing silently.

**Remembered devices.** Connecting stores the workspace code on that device (browser `localStorage`), so it opens connected every time. Untick *Remember this device* on a shared or borrowed computer and it is forgotten when the browser closes. The top-right button → **Forget this device** removes it. Anyone already connected under the old version is carried over automatically. If the code is changed in Netlify, devices with the old one are asked for the new one; any other error (Notion having a moment, say) keeps the code and shows the problem instead.

**Sample data is look-only.** Without the code the site shows sample data and won't save task, comment or weekly-plan edits (it opens the connect box instead), so nothing can end up stored in one browser by mistake. Tasks saved that way under the old version still show in that browser's sample data.

No `npm install` required, no third-party UI frameworks or asset CDNs. JavaScript and CSS are plain, easy to maintain, and Netlify functions run with Node's built-in `fetch`.


## Production tab (Video Projects)

The **Weekly board** remains the original Notion-powered Kanban. The new **Production** tab is a simple overview of active documentaries and quick handoffs; it does not replace your existing Video Projects database.

The production view uses your existing Notion database **🎥 Video Projects** under **YouTube System 2.0**. It reads the original `Status`, `Video Title`, `Research Doc`, and `Script Doc` fields and adds:

- `Currently With` — Josh, Tristan, Daisy, Rachit, Thumbnail designer, Unassigned
- `Next Deliverable` — plain-text handoff
- `Next Due` — target date
- `Blocker` — optional note
- `Thumbnail Status` — Not started, Concepts, Revising, Approved
- `Last Confirmed` — date the project status was last saved from the app

**One-time connection setup:**

1. In Notion, open **Video Projects** as a full page (not just a linked view).
2. Select **••• → Connections / Add connections** and grant the existing **Josh Brett Studio Board** integration access to this database. Your existing LiftKeeper access remains untouched.
3. In Netlify, ensure `NOTION_TOKEN` and `BOARD_ACCESS_CODE` are configured as before; **no additional variable is required** for this specific database. The server function already knows which database to request. (An optional `NOTION_VIDEO_DATABASE_ID` setting can override it if needed.)
4. Redeploy after merging the pull request, open your studio site, connect Notion if not already connected, then select **Production**.

**Daily use:** Daisy checks stage, owner, next step, due date and blockers for each active documentary; saving sets `Last Confirmed` to today. A video with no confirmation, or one not confirmed in the past seven days, shows **Needs update**. A filled blocker shows **Blocked**. Published videos are hidden, not deleted.

**Important:** The existing Video Projects database contains some historical entries with stale status; check and correct them in Notion before treating the dashboard as a live production plan. The app does not fabricate handoff owners or deadlines.

**Security:** Notion credentials remain inside server-side Netlify environment variables. The existing shared workspace code is lightweight access protection, not separate user authentication. Protect the deployed site if only Josh and Daisy should see internal planning. Do not give untrusted people the workspace code.


## Weekly Josh & Daisy workspace (new)

The weekly board now has **Daisy**, **Josh**, **Archives**, and the original **Production** tabs.

- Each personal view includes three editable weekly goals and a bullet-note area. Choose a week with the arrow controls, then click **Save this week's plan**. These notes are saved in the **existing Notion task database** as specially named rows beginning `[STUDIO WEEKLY PLAN]`; the app excludes them from the Kanban board. There is no separate database or extra environment variable. Your Notion task database **must have a rich-text property named `Description`, `Notes`, or `Details`**. Without one, the app tells you that shared weekly planning cannot save.
- Tasks are filtered to each person's assignment and to the selected week's due dates (undated tasks are visible). **Show all active tasks** lets you find overdue or future work. New tasks default to the selected week's Monday; change the due date in task details if required.
- The personal views rely on an optional Notion **Select** property called **`Owner`** (choices `Josh`, `Daisy`) for reliable cross-device assignment. The app can read an existing People property of this name, but editing a People assignment in the app is not currently supported. If `Owner` is missing, Josh's personal task list will remain empty and unassigned tasks will appear in Daisy's view; create the Select property in Notion to enable correct assignment.
- The archive has **On hold** and **Background** categories; add these choices to the existing Notion **Status** field (alternatively `Parked`/`Paused` and `Someday` are recognised). Switching a task into either category through the task drawer removes it from weekly columns but keeps it in Notion. Move it back to `To do` to restore it. The app will show a clear error if the Notion status options don't exist yet.
- Kanban columns show up to six active tasks and three Done cards initially; click **Browse more** when needed. Each column has independent scrolling, so the page stays manageable.

No production database or existing Notion credentials need changing. The server-side bridge still uses the current `NOTION_TOKEN`, `NOTION_DATABASE_ID`, and `BOARD_ACCESS_CODE` Netlify variables.


## 2026 publishing calendar: Google Sheet stays the source of truth

The app now includes a **Content calendar** tab displaying three months at a time (October–December initially). It reads the existing Google Sheet [2026-content-plan](https://docs.google.com/spreadsheets/d/1zvaFJCApnz6YFzJCXUtC9BSLW40pR58vyPM7pgSWfB4/edit), tab **2026 Content Plan** (month columns B–M, day rows 2–32). Click an entry to edit it, or drag the entry to an empty day to reschedule. Moving clears the original date cell. Clicking an empty day plans a new video. Existing populated target dates are protected from accidental overwrite.

**Planning ahead (2027 and beyond):** press **Later →** to keep going past December — the calendar runs from January 2026 to December 2030, one quarter at a time, and **Back to this quarter** jumps home. Each year lives in its own tab of the same spreadsheet: the first time a video is saved into a new year, the bridge copies the **2026 Content Plan** layout into a fresh **2027 Content Plan** tab (entries cleared, the year label updated). Videos can be dragged or re-dated across years. Saving into 2027+ needs bridge version 3 or newer — the calendar says so if the deployed `Code.gs` is older.

**One-time setup:**

1. Open the Google Sheet. Select **Extensions → Apps Script**. In the editor, replace the starter script with the contents of [google-apps-script/Code.gs](google-apps-script/Code.gs) in this repository. Save the project.
2. In **Apps Script → Project Settings → Script properties**, add `STUDIO_CALENDAR_SECRET` with a long, random secret that you make. Never commit it to GitHub or send it through chat.
3. Select **Deploy → New deployment → Web app**. Use **Execute as: Me** and **Who has access: Anyone**. Authorise the script, copy the **Web app URL** ending in `/exec`. Anyone can call the web app URL, but the script refuses all requests without the secret. Keep both the URL and secret private. Do **not** share the full credential publicly or in the browser code.
4. In your **Netlify site → Project configuration → Environment variables**, add:
   - `STUDIO_CALENDAR_SCRIPT_URL` = Web app URL from step 3.
   - `STUDIO_CALENDAR_SCRIPT_SECRET` = exactly the Script property from step 2.
   Both should be set for **production functions**, with the secret marked sensitive. Keep your existing `BOARD_ACCESS_CODE`, `NOTION_TOKEN`, and `NOTION_DATABASE_ID` unchanged.
5. Redeploy Netlify and open **Content calendar**. You must already have connected using your normal board access code in the upper-right Notion connection box. Click **Refresh**. Your scheduled entries should appear. Try moving a test entry to a free day and verify the **Google Sheet** reflects the new position. If you modify the Apps Script later, deploy a **new version** for the existing deployment.

**Metrics:** Views at 7 days, click-through rate, and average view duration are stored in a second tab automatically created in the *same spreadsheet* called **Studio Metrics**. This does not change the 2026 Content Plan grid. Moving a video moves its metrics as well. The original cell contents and spreadsheet remain authoritative.

**Limitations:** The existing sheet holds one text value per date. The app treats that cell as one scheduled entry and won't merge two occupied days. For multiple planned uploads on one day, edit the source sheet text manually or extend the schema later. No calendar data is copied into Notion. If the Google bridge is not configured, the app shows an error and cannot edit or reschedule entries. Dates are limited to 2026.

**Logo:** The header loads your actual uploaded channel logo from `public/assets/josh-logo-original.webp`, converted losslessly from the original PNG; shape and transparency are preserved. The earlier hand-drawn SVG is no longer used.


## Sponsorships tab: brand deals with a live email log from Zoho Mail

The **Sponsorships** tab is the brand-deal tracker as a live spreadsheet: every brand and agency, its status, next step, rate and history, plus an **Email log** that fills itself from Zoho Mail. The Google Sheet **Brand Sponsorship Tracker** stays the source of truth — the app reads and writes it through the same Apps Script bridge as the content calendar, so there are **no new Netlify variables for the sheet part**.

What you get:

- **Summary tiles** — deals signed (and agreed value), waiting on you, waiting on them, cold pitches with no reply, emails this week. Click a tile to filter.
- **Zoho flags = Waiting on you** — flag an email in Zoho (any flag colour) and it counts as waiting on your reply until you reply to that thread or sender, or clear the flag. A tracked brand or agency with a flagged email shows **⚑ Reply needed** (its sheet status stays underneath, unchanged). A flagged email from someone not in the tracker gets its own **New sender** row with **＋ Add as brand**, **＋ Agency** or **Assign to…**; adding fills the drawer from the email and files the thread under the new row.
- **Brands / Agencies** — sortable, searchable grids (click a column heading to sort; "most attention needed first" by default). Status pills are colour-coded: red = they're waiting on you. Each row shows who wrote last and how long ago, from the email log.
- **Row drawer** — edit any field (Status is a dropdown of every status, including **Ignored**), add a dated note or log an email by hand, and see every matched email for that brand. Saves go straight to the sheet; a status the sheet's own dropdown doesn't know yet is added to it automatically.
- **Action list** — the open items from the sheet's Action list tab, with a "Mark done" tick that writes back.
- **Email log** — every email to or from a sponsorship contact, newest first. Anything the sync couldn't match (a new agency pitching, say) is highlighted with an **Assign to…** picker; assigning also saves that address as a contact so the next email matches on its own.

### A. The Google Sheet (done)

The script points at the Google Sheet **[Sponsorship outreach 2026](https://docs.google.com/spreadsheets/d/1yvBS7TYPy7v-kQldwYSJAvq4dMuGF1ZUkLP_SKPy_Is/edit)** (the tracker saved as a Google Sheet). Nothing to do unless you move to a different sheet: then set the script property `STUDIO_SPONSORSHIP_SHEET_ID` (step B4) to the new sheet's ID. The script deliberately uses spreadsheet access only — a Drive lookup would need full Drive access, which Google blocks for unverified scripts on personal accounts ("This app is blocked").

Keep the tabs **Brands**, **Agencies** and **Action list** as they are: the column headings in **row 4** of Brands and Agencies (and the `Priority…` heading row of Action list) are what the app reads. You can add columns, change statuses and sort rows freely; the first time the app runs it appends an **ID** column to Brands and Agencies and creates two tabs, **Email log** and a hidden **Studio meta**. Leave those alone.

### B. Update the Apps Script (one-time)

The whole bridge is **one file**, [google-apps-script/Code.gs](google-apps-script/Code.gs): the content calendar at the top, the sponsorship tracker below it, and a `studioSelfTest()` function at the end.

1. Open the Apps Script project that runs the calendar (the one whose web app URL is in Netlify as `STUDIO_CALENDAR_SCRIPT_URL`; currently the standalone project **Studio bridge** at script.google.com).
2. Click **Code.gs** → select all → delete → paste in the repository's Code.gs → save. If the project has any other `.gs` file (an old `Sponsorships.gs` / `Subscriptions.gs`), remove it: hover it → ⋮ → **Remove**. One file only.
3. In the toolbar pick **studioSelfTest** and press **Run**; the Execution log should print *Secret set*, *Calendar OK*, *Sponsorships OK*. If it stops on a red line, that line is the problem.
4. Optional: **Project Settings → Script properties** → add `STUDIO_SPONSORSHIP_SHEET_ID` = the ID from a sheet's URL, only if you ever want a different sheet than *Sponsorship outreach 2026*.
5. **Deploy → Manage deployments → ✎ → Version: New version → Deploy.** Google may ask you to re-authorise (the script can now open a second sheet). On the "Google hasn't verified this app" screen choose Advanced → Go to … (unsafe) → Allow; that is normal for your own script. The web app URL does not change, so Netlify needs nothing new.

If there is **no existing deployment** (the dialog says "Please select a deployment type"), create one: ⚙ → **Web app**, Execute as **Me**, Who has access **Anyone** → Deploy → copy the **Web app URL**. Then add the script property `STUDIO_CALENDAR_SECRET` (any long random string) under Project Settings, and in Netlify set `STUDIO_CALENDAR_SCRIPT_URL` to that URL and `STUDIO_CALENDAR_SCRIPT_SECRET` to the same string. One deployment serves both the calendar and the sponsorships.
6. Open the studio site, connect with your workspace code as usual, and choose **Sponsorships**. Press **Refresh** if it was already open.

### C. Connect Zoho Mail (one-time, about five minutes)

The sync runs on the server (`netlify/functions/zoho-sync.mjs`, hourly) and on demand (**Sync emails**). Your Zoho password is never involved; the app uses a long-lived OAuth token that lives only in Netlify.

1. Go to the Zoho API console for your data centre — **https://api-console.zoho.eu** if your mailbox is at `mail.zoho.eu`, **https://api-console.zoho.com** if it is at `mail.zoho.com` — and sign in with the Zoho account that holds the business mailbox.
2. **Add Client → Self Client → Create.** Open the **Client Secret** tab and copy the **Client ID** and **Client Secret**.
3. In **Netlify → conditioningteam → Project configuration → Environment variables**, add:
   - `ZOHO_CLIENT_ID` = the Client ID
   - `ZOHO_CLIENT_SECRET` = the Client Secret (mark it sensitive)
   - `ZOHO_REGION` = `eu` for mail.zoho.eu, `com` for mail.zoho.com (also accepted: `in`, `com.au`, `jp`, `ca`, `sa`, `com.cn`, `ae`)
   Redeploy.
4. Back in the API console, open the Self Client → **Generate Code** tab. Scope: `ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ`. Time duration: 10 minutes. Description: anything. **Create**, then copy the code.
5. In the studio site, **Sponsorships → ✉ Zoho Mail**, paste the code and press **Exchange for a token**. Copy the refresh token it shows (this is the only time it is displayed; it is not stored anywhere by the app).
6. In Netlify, add `ZOHO_REFRESH_TOKEN` = that token (mark it sensitive). Redeploy.
7. Press **⇣ Sync emails**. The first runs walk back through your Inbox and Sent folders to **1 July 2026** (change with `ZOHO_BACKFILL_FROM`, format `YYYY-MM-DD`), a few hundred emails per run, so press it a few times or let the hourly schedule finish. After that each run only looks at new mail.

Optional: `ZOHO_OWN_ADDRESSES` = comma-separated extra addresses that count as "you" (aliases or a second mailbox name), if sent mail is being logged as received.

### How emails are matched

Every message in Inbox and Sent is compared with the email addresses in the **Contact** column of Brands and Agencies:

1. exact address match → that brand or agency;
2. same company domain (not gmail/outlook and the like) → that brand or agency;
3. same thread as an already-matched email → inherits;
4. otherwise it is kept only when the subject or first line reads like a sponsorship (sponsor, partnership, collab, brand deal, media kit, rate, campaign, influencer, "x Josh Brett", "Josh x Brand", …) and it isn't an automated sender or a newsletter → **Unmatched**, for you to assign or ignore;
5. **flagged** emails are always kept (except automated senders and Zoho's own account notices), along with later emails in the same thread and your replies to that sender — that is how the app knows a flagged email has been answered.

Every run also reads the list of flagged emails in the Zoho Inbox (back to the backfill date) and stores it in the sheet's hidden **Studio meta** tab, replacing the previous list, so a cleared flag disappears on the next sync. The first run after flags were added also looks back three weeks through Sent so replies you had already sent count.

Matched emails bump that row's **Last activity** (the sheet's "Days since" formula follows). The **Status** column in the sheet is never changed by the sync — that stays a human decision. What the app shows as waiting on you is the sheet status *plus* your Zoho flags; the "who wrote last" chip tells you when a status is stale.

### Daily use

- Triage in Zoho: flag what needs a reply. Red pills and the **Waiting on you** tile then match your flags (after the next hourly sync, or press **Sync emails**). Reply in Zoho and it drops off on the next sync; update the status or tick the action as usual.
- Log calls, decisions and anything that didn't happen over email from the drawer ("Log an email or note"); it goes to the top of the history.
- The source sheet is always one click away (**↗ Source sheet**) for bulk edits; press **Refresh** afterwards.

### Limitations and security

- The sync keeps the message date, sender, recipients, subject and the first ~300 characters of each matched email in the sheet — not full bodies or attachments. Open the thread in Zoho for the rest.
- Zoho's list is paged 200 at a time, so a single run is capped at a few pages; the hourly schedule catches up on anything missed.
- The access code is still shared-password access (see the Notion section). The Zoho token grants **read-only** mailbox access and lives only in Netlify; rotate it by deleting the Self Client in the API console.
- Row IDs are stored in the ID column: don't clear it, and sort or move rows as you like.
- Scheduled runs are only visible in the Netlify function logs; the **Zoho Mail** dialog in the app shows the last run, what it added, and the last error if any.
- A deployment is a snapshot: after any change to Code.gs, **Deploy → Manage deployments → ✎ → New version → Deploy**, or the site keeps talking to the old code.


## YouTube on the calendar: published status, stats and sponsors

The **Content calendar** colours every entry by where it stands:

- **Yellow — Upcoming**: the date hasn't passed yet.
- **Orange — Not live yet**: the date has passed and no matching video is on the channel.
- **Green — Published**: a long-form video (over 3 minutes, so Shorts are ignored) is matched to the entry, in this order: a saved **YouTube link**; a video published that day; a video on the **same topic** (the plan title and the YouTube title share a key word of 5+ letters, two shorter words, or a capitalised name — e.g. "Steroids age you" ↔ "Why Steroid Users Age So Fast", "Dr Mike video" ↔ "The Rise And Fall Of Dr Mike") published up to **14 days either side**; otherwise the nearest upload within 3 days. When the video went out on a different day, the green card moves to that day and says "planned 23 Oct"; the drawer offers **Move this entry to … in the sheet** to make it permanent. When the titles share nothing, an orange entry's drawer lists uploads from within 14 days with a **This is it** button, and a dashed (unplanned) card offers **Link it** to a planned entry — either saves the YouTube link on the entry. The card shows views; the drawer shows the thumbnail, views, likes, comments, days live and views per day.
- **Dashed card — Live, not in plan**: a long-form upload in 2026 that matches no calendar entry. Click it to add it to the plan.

Each entry also has a **Sponsor** (pick from the brands in the Sponsorship tracker, or type one) and a **Sponsor status**: *In progress*, *Invoiced* or *Paid*. The sponsor shows on its own card under the video, coloured by status; click it to change the status. A sponsor named in brackets at the end of the title, e.g. "Crossfit (Shokz)", shows as a dashed *suggested* card until you confirm it. Sponsor, status and YouTube link are saved in the **Studio Metrics** tab of the content-plan sheet (one row per date, alongside the optional 7-day views / CTR / AVD you type in from YouTube Studio).

### One-time setup

1. **Apps Script** — paste the repository's [Code.gs](google-apps-script/Code.gs) into **Studio bridge** (Cmd+A, paste, save), run **studioSelfTest**, then **Deploy → Manage deployments → ✎ → New version → Deploy**. Until then the calendar shows a notice and sponsor details won't save.
2. **YouTube API key** (public data only, free):
   1. [Google Cloud console](https://console.cloud.google.com/) → the project linked to Studio bridge → **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.
   2. **APIs & Services → Credentials → + Create credentials → API key**. Open the new key → **API restrictions → Restrict key → YouTube Data API v3** → **Save**. Copy the key.
   3. Netlify → Environment variables: `YOUTUBE_API_KEY` = the key (mark secret). Optional: `YOUTUBE_CHANNEL_HANDLE` if the channel isn't `@brettjosh`. Redeploy.
3. Open **Content calendar** and press **Refresh**.

Stats are fetched on each Refresh (cached for 10 minutes) and cost a handful of the 10,000 free daily quota units.

**Not included:** CTR, impressions, retention and watch time come from the private YouTube *Analytics* API, which needs the channel owner to sign in. Keep typing those into the drawer from YouTube Studio for now.

### If the sheet tabs suddenly say "Google Sheets returned a page instead of data"

Studio bridge is linked to a Google Cloud project whose consent screen is in **Testing**. Google can make that approval lapse after about 7 days. To fix it: open Studio bridge in Apps Script, choose **studioSelfTest**, press **Run**, approve, then press **Refresh** on the site. Switching the consent screen to **In production** (Google Auth Platform → Audience → Publish app) stops this, at the cost of the "unverified app" warning when approving.
