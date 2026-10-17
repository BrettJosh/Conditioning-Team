# Josh Brett Studio — Creative Board (v2)

A **minimal, styled Kanban board**, built to sit on top of an existing **Notion task database**. Four statuses; project filters; task details; Notion comments; drag-and-drop status; create/edit tasks. No AI dashboards, no duplicate project management system.

The design takes inspiration from punchy editorial / sticker-style portfolios, adapted for Josh Brett's documentary studio. Everything in the `public/` folder is static. The Notion bridge is a **server-side Netlify function** so your Notion API token never gets exposed in your webpage.

## Quick start — replace your current GitHub files

1. **Back up the old app first** (download the current repository ZIP if you have saved data only in the old app's browser localStorage). The new local demo uses a different storage key and **does not import your old local-only tasks**.
2. Extract `Josh_Brett_Studio_Board_v2_GitHub.zip`.
3. Open your existing GitHub repository. Delete the **old app files** in the repository (keep the repo itself, `.git` history and Netlify connection).
4. Upload **the contents of this folder** into the **repository root**. You should see `netlify.toml`, `README.md`, `public/`, and `netlify/` directly in the repo root — **no extra enclosing folder**.
5. Commit. If your Netlify project is linked to GitHub, it should rebuild automatically. Under **Netlify → Project configuration → Build & deploy**, ensure the published directory resolves to **`public`** and functions directory to **`netlify/functions`**, as specified in `netlify.toml`.
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

**Redeploy after setting environment variables.** Netlify functions read values during deployment. In the app, click `Local demo` (top right) and enter **only your `BOARD_ACCESS_CODE`**. You'll see `Notion connected` when it can list your real tasks.

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
- Shared-code gate is *not* per-person authentication; Notion token stays server-side.
- The static-only preview is offline/local-browser demo mode, not Notion-synced.
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
```

No `npm install` required, no third-party UI frameworks or asset CDNs. JavaScript and CSS are plain, easy to maintain, and Netlify functions run with Node's built-in `fetch`.
