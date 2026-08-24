#!/usr/bin/env node
/**
 * Creates an UptimeRobot maintenance window so planned/expected downtime
 * doesn't count against uptime %. Supports a one-off event or a recurring
 * (weekly) window.
 *
 * Monitoring still runs as normal outside the window, so genuine unexpected
 * outages remain visible on the status page — only the scheduled window
 * itself is excluded from the stats.
 *
 * Timezone: --date/--time are interpreted using the account's Timezone setting
 * (Dashboard -> My Settings -> Timezone). Currently set to Central Time (US &
 * Canada), which is GMT-5 during daylight time (CDT) and GMT-6 during standard
 * time (CST) -- pass local wall-clock time, not a manually-converted offset.
 *
 * Auth: reads UPTIMEROBOT_API_KEY (must be the full-access key, not read-only).
 *
 * Usage:
 *   export UPTIMEROBOT_API_KEY="..."
 *
 *   # One-off event (default --interval once):
 *   node scripts/uptimerobot-maintenance.mjs \
 *     --name "Deploy window" \
 *     --date 2026-08-29 \
 *     --time 23:00:00 \
 *     --duration 120 \
 *     --monitors all
 *
 *   # Or target specific services by (partial, case-insensitive) name:
 *   node scripts/uptimerobot-maintenance.mjs \
 *     --name "TMS DB migration" \
 *     --date 2026-08-29 \
 *     --time 22:30:00 \
 *     --duration 90 \
 *     --monitors "TMS,Dock Scheduler"
 *
 *   # Recurring weekly window (e.g. every Friday 2am, 10-minute buffer):
 *   node scripts/uptimerobot-maintenance.mjs \
 *     --name "Weekly Friday maintenance" \
 *     --interval weekly \
 *     --days friday \
 *     --date 2026-08-29 \
 *     --time 02:00:00 \
 *     --duration 10 \
 *     --monitors all
 *
 * --days accepts day names (comma-separated, case-insensitive: sunday..saturday)
 * or the raw numbers UptimeRobot uses (monday=1 .. sunday=7). Only used for
 * --interval weekly/monthly. --date is still required even for a recurring
 * window — it's the start date the recurrence begins from.
 */

const API_BASE = "https://api.uptimerobot.com/v3";
const API_KEY = process.env.UPTIMEROBOT_API_KEY;

const DAY_NAME_TO_NUM = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    args[key] = argv[i + 1];
  }
  return args;
}

function parseDays(daysArg) {
  if (!daysArg) return undefined;
  return daysArg.split(",").map((raw) => {
    const s = raw.trim().toLowerCase();
    if (DAY_NAME_TO_NUM[s]) return DAY_NAME_TO_NUM[s];
    const n = Number(s);
    if (!Number.isInteger(n)) throw new Error(`Invalid day "${raw}" — use a day name (e.g. friday) or 1-7 (monday=1..sunday=7).`);
    return n;
  });
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { Authorization: `Bearer ${API_KEY}` };
  let payload = body;
  if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function resolveMonitorIds(namesArg) {
  if (!namesArg || namesArg.toLowerCase() === "all") return { autoAddMonitors: true, monitorIds: [] };

  const wanted = namesArg.split(",").map((s) => s.trim().toLowerCase());
  const all = await api("/monitors?limit=200");
  const monitors = all?.data ?? [];

  const ids = [];
  for (const w of wanted) {
    const match = monitors.find((m) => m.friendlyName.toLowerCase().includes(w));
    if (!match) {
      throw new Error(`No monitor found matching "${w}". Available: ${monitors.map((m) => m.friendlyName).join(", ")}`);
    }
    ids.push(match.id);
  }
  return { autoAddMonitors: false, monitorIds: ids };
}

async function main() {
  if (!API_KEY) {
    console.error("Missing UPTIMEROBOT_API_KEY environment variable (needs full-access, not read-only).");
    process.exit(1);
  }

  const { name, date, time, duration, monitors, interval = "once", days: daysArg } = parseArgs(process.argv.slice(2));
  const requiredKeys = interval === "once" ? ["name", "date", "time", "duration"] : ["name", "time", "duration"];
  const values = { name, date, time, duration };
  const missing = requiredKeys.filter((k) => !values[k]);
  if (missing.length) {
    console.error(`Missing required args: ${missing.join(", ")}`);
    console.error(
      'Usage: --name "..." --date YYYY-MM-DD --time HH:mm:ss --duration <minutes> --monitors "all|Name1,Name2" [--interval once|weekly|monthly] [--days friday,...]'
    );
    process.exit(1);
  }
  if (!["once", "daily", "weekly", "monthly"].includes(interval)) {
    console.error(`Invalid --interval "${interval}" — must be once, daily, weekly, or monthly.`);
    process.exit(1);
  }
  const days = parseDays(daysArg);
  if (["weekly", "monthly"].includes(interval) && !days) {
    console.error(`--interval ${interval} requires --days (e.g. --days friday).`);
    process.exit(1);
  }
  if (interval !== "once" && date) {
    console.log(`Note: --date is ignored by the API for "${interval}" — the window recurs indefinitely, not from a specific start date.`);
  }

  const { autoAddMonitors, monitorIds } = await resolveMonitorIds(monitors);

  const window = await api("/maintenance-windows", {
    method: "POST",
    body: {
      name,
      interval,
      time,
      duration: Number(duration),
      autoAddMonitors,
      ...(interval === "once" ? { date } : {}),
      ...(days ? { days } : {}),
      ...(autoAddMonitors ? {} : { monitorIds }),
    },
  });

  console.log(`Created maintenance window id ${window.id}: "${name}"`);
  console.log(
    `  ${interval}${days ? ` (days: ${days.join(", ")})` : ""}${interval === "once" ? ` on ${date}` : ""} at ${time}, ${duration} minutes`
  );
  console.log(`  Monitors: ${autoAddMonitors ? "all (auto-add)" : monitorIds.join(", ")}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
