#!/usr/bin/env node
/**
 * Sets (or clears) the custom domain on the ShippersEdge public status page.
 *
 * This only updates the UptimeRobot-side setting. It does NOT touch DNS —
 * you still need a CNAME record pointing the domain at stats.uptimerobot.com
 * (see README). Do the DNS record and this PATCH in either order; SSL
 * provisions automatically once both are in place and DNS has propagated.
 *
 * Auth: reads UPTIMEROBOT_API_KEY (must be the full-access key, not read-only).
 *
 * Usage:
 *   export UPTIMEROBOT_API_KEY="..."
 *   node scripts/uptimerobot-set-domain.mjs uptime.shippersedge.com
 *
 *   # To remove a custom domain later:
 *   node scripts/uptimerobot-set-domain.mjs --clear
 */

const API_BASE = "https://api.uptimerobot.com/v3";
const API_KEY = process.env.UPTIMEROBOT_API_KEY;
const PSP_ID = 1257513; // ShippersEdge Service Status

async function api(path, { method = "GET", body, isMultipart = false } = {}) {
  const headers = { Authorization: `Bearer ${API_KEY}` };
  let payload = body;
  if (body && !isMultipart) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  if (!API_KEY) {
    console.error("Missing UPTIMEROBOT_API_KEY environment variable (needs full-access, not read-only).");
    process.exit(1);
  }

  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node scripts/uptimerobot-set-domain.mjs <domain>  |  --clear");
    process.exit(1);
  }

  const domain = arg === "--clear" ? "" : arg;

  const form = new FormData();
  form.append("customDomain", domain);

  const psp = await api(`/psps/${PSP_ID}`, { method: "PATCH", body: form, isMultipart: true });

  if (domain) {
    console.log(`Set custom domain on PSP ${PSP_ID}: ${psp.customDomain}`);
    console.log("Make sure the CNAME record exists: uptime.shippersedge.com -> stats.uptimerobot.com");
    console.log("SSL provisions automatically once DNS has propagated.");
  } else {
    console.log(`Cleared custom domain on PSP ${PSP_ID}.`);
  }
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
