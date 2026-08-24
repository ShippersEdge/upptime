# ShippersEdge Status Page

**Live status:** [stats.uptimerobot.com/izWZ1eyv3N](https://stats.uptimerobot.com/izWZ1eyv3N)

Uptime monitoring and the public status page for ShippersEdge services now run on [UptimeRobot](https://uptimerobot.com), managed through their v3 API. This repo holds the scripts used to manage that setup, plus the historical [Upptime](https://upptime.js.org)-era data.

## Why this changed

This repo originally ran [Upptime](https://upptime.js.org) — a GitHub Actions-powered uptime monitor and status page. Its scheduled workflows (`Uptime CI`, `Summary CI`, `Static Site CI`, etc.) stopped running silently after **December 2, 2024**: GitHub auto-disables a repo's scheduled workflows after 60 days without commit activity, and since the bot's own commits were what kept the repo "active," the outage was self-reinforcing — no commits meant no re-activation, forever. The status page kept showing stale "all operational" data instead of reflecting reality.

Those workflows have been removed. Monitoring and the public status page are now hosted entirely on UptimeRobot's infrastructure, so there's no CI schedule to silently fail and nothing to build/deploy here — the status page updates live, independent of this repo.

The `history/`, `api/`, and `graphs/` directories are kept as a historical record of the Upptime era; they are no longer updated.

## Monitored services

| Service | URL |
| --- | --- |
| ShippersEdge TMS | [app.shippersedge.com/health.cfm](https://app.shippersedge.com/health.cfm) |
| ShippersEdge Carrier Portal | [carriers.shippersedge.com](https://carriers.shippersedge.com) |
| ShippersEdge Supplier Portal | [routing.shippersedge.com](https://routing.shippersedge.com) |
| ShippersEdge Customer Portal | [customers.shippersedge.com](https://customers.shippersedge.com) |
| ShippersEdge Dock Scheduler | [schedule.shippersedge.com](https://schedule.shippersedge.com) |

## Scripts

All scripts use Node's built-in `fetch`/`FormData` (Node 18+, no dependencies) and talk to `https://api.uptimerobot.com/v3`.

### `scripts/uptimerobot-setup.mjs`

One-time/idempotent setup: creates an HTTP monitor for each service above (skipping ones that already exist, matched by URL) and creates the public status page with all of them attached. Safe to re-run.

```bash
export UPTIMEROBOT_API_KEY="your-full-access-key"
node scripts/uptimerobot-setup.mjs
```

Requires the **full-access** API key (Dashboard → Integrations). The read-only key can list monitors but cannot create them.

### `scripts/uptimerobot-maintenance.mjs`

Adds a maintenance window so planned/expected downtime doesn't count against uptime %. Monitoring keeps running as normal outside the window — a real outage at any other time still shows up on the status page — only the scheduled window itself is excluded from the stats. Supports both a one-off event and a recurring weekly window.

```bash
export UPTIMEROBOT_API_KEY="your-full-access-key"

# One-off event, all monitored services (default --interval once)
node scripts/uptimerobot-maintenance.mjs \
  --name "Deploy window" \
  --date 2026-08-29 \
  --time 23:00:00 \
  --duration 120 \
  --monitors all

# One-off event, specific services matched by partial name
node scripts/uptimerobot-maintenance.mjs \
  --name "TMS DB migration" \
  --date 2026-08-29 \
  --time 22:30:00 \
  --duration 90 \
  --monitors "TMS,Dock Scheduler"

# Recurring weekly window (e.g. standing Friday 2am maintenance, 10-min buffer)
node scripts/uptimerobot-maintenance.mjs \
  --name "Weekly Friday maintenance" \
  --interval weekly \
  --days friday \
  --time 02:00:00 \
  --duration 10 \
  --monitors all
```

Flags:

| Flag | Description |
| --- | --- |
| `--name` | Label for the maintenance window (shown in the UptimeRobot dashboard) |
| `--interval` | `once` (default), `daily`, `weekly`, or `monthly` |
| `--date` | `YYYY-MM-DD` — **required for `once` only**; the API rejects it for recurring intervals |
| `--time` | `HH:mm:ss`, **local wall-clock time** — see Timezone note below |
| `--duration` | Length in minutes |
| `--days` | Required for `weekly`/`monthly`. Day name(s), comma-separated (e.g. `friday` or `tuesday,thursday`), or raw numbers (Monday=1..Sunday=7) |
| `--monitors` | `all` to include every monitor, or a comma-separated list of (partial, case-insensitive) monitor names |

**Timezone:** `--time` (and `--date` for one-off windows) is interpreted using the UptimeRobot account's Timezone setting (Dashboard → My Settings → Timezone), currently **Central Time (US & Canada)**. That's GMT-5 during daylight time (CDT, roughly March–November) and GMT-6 during standard time (CST). Always pass your actual local wall-clock time — don't manually convert to a fixed offset, since the account setting already accounts for DST.

A `once` window covers a single event — run the script again for each new maintenance event. A `weekly`/`monthly` window is created once and then recurs indefinitely from that point on; there's no `--date` start point since the API doesn't expose one for recurring windows.

**Standing exclusions currently configured:**

| Name | Schedule | Duration |
| --- | --- | --- |
| Weekly Friday maintenance | Every Friday, 2:00 AM Central | 10 minutes |

### `scripts/uptimerobot-set-domain.mjs`

Sets (or clears) the custom domain on the status page. This only updates the UptimeRobot-side setting — it does not touch DNS.

```bash
export UPTIMEROBOT_API_KEY="your-full-access-key"
node scripts/uptimerobot-set-domain.mjs uptime.shippersedge.com

# To remove it later:
node scripts/uptimerobot-set-domain.mjs --clear
```

**Custom domain DNS setup** (one-time, done outside this repo, at your DNS provider):

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `uptime` (i.e. `uptime.shippersedge.com`) | `stats.uptimerobot.com` |

(Not `status` — that subdomain is already in use for something unrelated on this domain.)

- No TXT verification record needed.
- If this DNS zone is on Cloudflare, keep the record **DNS-only (grey cloud)** — Cloudflare's proxy causes redirect/certificate errors.
- If the domain has CAA records restricting certificate authorities, add `0 issue "letsencrypt.org"` — SSL is auto-issued via Let's Encrypt and will fail without it.
- Custom domains require UptimeRobot's Solo plan or higher; a lapsed/failed payment silently 404s the domain even with correct DNS.
- Propagation is usually minutes, occasionally up to 24–48 hours; SSL provisions automatically once DNS is detected.

Source: [UptimeRobot — Setting Up a Custom Domain for Your Status Page](https://help.uptimerobot.com/en/articles/15433336-setting-up-a-custom-domain-for-your-status-page)

## Running via GitHub Actions

All three scripts are also wired up as `workflow_dispatch` workflows, so they can be run from the Actions tab instead of a local terminal:

- **UptimeRobot Setup** (`.github/workflows/uptimerobot-setup.yml`) — runs `uptimerobot-setup.mjs` with no inputs.
- **UptimeRobot Maintenance Window** (`.github/workflows/uptimerobot-maintenance.yml`) — exposes the maintenance script's flags as workflow inputs (`interval`, `date`, `time`, `duration`, `days`, `monitors`). Leave `date` blank for `weekly`/`monthly` — the API rejects it for recurring intervals.
- **UptimeRobot Set Custom Domain** (`.github/workflows/uptimerobot-set-domain.yml`) — takes a `domain` input; leave blank to clear the current custom domain.

All three read the API key from the `UPTIMEROBOT_API_KEY` repository secret (Settings → Secrets and variables → Actions) — it needs to be the **full-access** key, matching what the scripts require locally.

## API keys

- `UPTIMEROBOT_API_KEY` — full access (read/write). Needed for all three scripts, whether run locally (as an exported env var) or via the GitHub Actions workflows above (as the `UPTIMEROBOT_API_KEY` repo secret).
- `UPTIMEROBOT_API_KEY_READONLY` — read-only, for anything that only needs to check status. Kept locally only; nothing in this repo currently uses it via CI.

Don't commit key values to this repo or paste them into chat/tickets — export locally or store as a GitHub Actions secret only.

## Uptime API Docs (v3)
- [UptimeRobot - API Documentation](https://uptimerobot.com/api/v3/)

## 📄 License

- Historical Upptime data (`history/`, `api/`): [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/)
- Code: [MIT](./LICENSE)
