# Daisy — Creative Operations Dashboard

A lightweight, single-file, offline-capable management dashboard for the Josh Brett documentary and product team.

## Open immediately

1. Download/unzip this project.
2. Double-click `index.html` on Windows, or right-click → Open with Chrome/Edge.
3. Use the sidebar to manage tasks, weekly reviews, AI experiments, creative packs and sponsorship opportunities.
4. **Go to Settings → Export JSON backup regularly.** This app stores your updates in your current browser profile, not on GitHub or in a cloud database.

There is no account setup, subscription, build process or external dependency.

## What's included

- Four-week sprint, 19 October–15 November 2026, with seeded tasks and deadlines.
- Dashboard and editable weekly task board.
- Four workstreams: Skinny Fat Escape, AI systems, documentary creative packs, sponsors.
- AI experiments with estimated time before/after and source verification criteria.
- Creative pre-production briefs with moodboard links and filmable ideas.
- Sponsor pipeline with Rich Piana urgent opportunity and existing MacroFactor deal.
- Weekly reviews, browser persistence, JSON import/export, CSV task export.

**What this doesn't do yet:** It does not execute Apify, scrape video content, run Claude Code or sync multiple users. These require additional integrations/backend design. Do not put Apify tokens, Claude API keys or customer details into the frontend code.

## Put it on GitHub

Create a **private repository** on GitHub (e.g. `daisy-creative-ops`). Then open PowerShell or Git Bash in this project folder:

```bash
git init
git add .
git commit -m "Build creative operations dashboard v1"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/daisy-creative-ops.git
git push -u origin main
```

If Git asks for authentication, follow GitHub's recommended sign-in via Git Credential Manager or the GitHub CLI. Don't put personal access tokens into committed files.

## Host it on Netlify (optional)

Import the GitHub repository into Netlify. Since it's a static site, use the repository root as the publish directory and leave the build command empty. Note: unless you configure proper access protection, visitors with the Netlify URL can open the app interface. While the code includes sample planning data, your locally entered task changes are not transferred to visitors through the website.

## Collaboration limitation

Git/GitHub version-controls the *app code*. `localStorage` tracks task changes only inside the user's browser. Daisy editing a task on her laptop will **not** update Josh's dashboard. Export/import JSON for manual transfers; for real-time collaboration, upgrade to a hosted database (e.g. Supabase), authentication and appropriate permissions. If customer coaching or client records are ever introduced, design privacy/security requirements before storing any personal information.

## Development

Everything is in `index.html` (HTML, CSS, vanilla JavaScript). Edit in VS Code and refresh the browser. No Node or dependency installation needed.
