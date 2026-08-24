#!/usr/bin/env node
/**
 * Sets up UptimeRobot v3 monitors + a public status page (PSP) for the
 * ShippersEdge services currently monitored by Upptime.
 *
 * Auth: reads the API key from UPTIMEROBOT_API_KEY (bearer token, not v2-style basic auth).
 *
 * Usage:
 *   export UPTIMEROBOT_API_KEY="ur_xxx..."
 *   node scripts/uptimerobot-setup.mjs
 */

const API_BASE = "https://api.uptimerobot.com/v3";
const API_KEY = process.env.UPTIMEROBOT_API_KEY;

if (!API_KEY) {
  console.error("Missing UPTIMEROBOT_API_KEY environment variable.");
  console.error('Set it first: export UPTIMEROBOT_API_KEY="your-key-here"');
  process.exit(1);
}

// Same set of sites as .upptimerc.yml
const SITES = [
  { name: "ShippersEdge TMS", url: "https://app.shippersedge.com/health.cfm" },
  { name: "ShippersEdge Carrier Portal", url: "https://carriers.shippersedge.com" },
  { name: "ShippersEdge Supplier Portal", url: "https://routing.shippersedge.com" },
  { name: "ShippersEdge Customer Portal", url: "https://customers.shippersedge.com" },
  { name: "ShippersEdge Dock Scheduler", url: "https://schedule.shippersedge.com" },
];

const STATUS_PAGE_NAME = "ShippersEdge Service Status";

async function api(path, { method = "GET", body, isMultipart = false } = {}) {
  const headers = { Authorization: `Bearer ${API_KEY}` };
  let payload = body;

  if (body && !isMultipart) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function findExistingMonitor(url) {
  const result = await api(`/monitors?url=${encodeURIComponent(url)}&limit=1`);
  return result?.data?.[0] ?? null;
}

async function createMonitor(site) {
  const existing = await findExistingMonitor(site.url);
  if (existing) {
    console.log(`  ↳ already exists (id ${existing.id}), skipping create`);
    return existing;
  }

  const monitor = await api("/monitors", {
    method: "POST",
    body: {
      friendlyName: site.name,
      type: "HTTP",
      url: site.url,
      interval: 60, // seconds
      timeout: 30, // seconds
    },
  });
  console.log(`  ↳ created monitor id ${monitor.id}`);
  return monitor;
}

async function findExistingStatusPage(name) {
  // Paginate through PSPs looking for a name match (list endpoint has no name filter).
  let cursor;
  do {
    const qs = cursor ? `?cursor=${cursor}` : "";
    const page = await api(`/psps${qs}`);
    const match = page?.data?.find((p) => p.friendlyName === name);
    if (match) return match;
    cursor = page?.pagination?.nextCursor;
  } while (cursor);
  return null;
}

async function createStatusPage(monitorIds) {
  const existing = await findExistingStatusPage(STATUS_PAGE_NAME);
  if (existing) {
    console.log(`Status page "${STATUS_PAGE_NAME}" already exists (id ${existing.id}).`);
    return existing;
  }

  const form = new FormData();
  form.append("friendlyName", STATUS_PAGE_NAME);
  form.append("status", "ENABLED");
  form.append("sort", "FriendlyNameAsc");
  monitorIds.forEach((id) => form.append("monitorIds[]", String(id)));

  const psp = await api("/psps", { method: "POST", body: form, isMultipart: true });
  console.log(`Created status page id ${psp.id}`);
  console.log(`Public URL: ${psp.url ?? "(check dashboard — url not echoed by API)"}`);
  return psp;
}

async function main() {
  console.log(`Creating/verifying ${SITES.length} monitors...`);
  const monitorIds = [];
  for (const site of SITES) {
    console.log(`- ${site.name} (${site.url})`);
    const monitor = await createMonitor(site);
    monitorIds.push(monitor.id);
  }

  console.log("\nCreating/verifying status page...");
  const psp = await createStatusPage(monitorIds);

  console.log("\nDone.");
  console.log(`Monitor IDs: ${monitorIds.join(", ")}`);
  console.log(`PSP ID: ${psp.id}`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
