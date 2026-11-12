// PROTOTYPE — headless runner for the four checks in "Does Knock hold up against Cadence?" (#47).
// Lives on the prototype/knock-spike branch only. Never merge.
// Run: npx tsx --env-file=.env scripts/prototype-knock-checks.ts
import Knock, { signUserToken } from "@knocklabs/node";

const knock = new Knock();
const API = "https://api.knock.app/v1";
const FEED = process.env.KNOCK_FEED_CHANNEL_ID!;
const PUB = process.env.KNOCK_PUBLIC_API_KEY!;

// Seed users: Emma (student) asks, Sarah (instructor) replies / teaches.
const emma = { id: "5", name: "Emma Wilson", email: "emma@example.com" };
const sarah = { id: "2", name: "Sarah Chen", email: "sarah@example.com" };
const james = { id: "6", name: "James Park", email: "james@example.com" };

const client = async (opts: { token: string; path: string; init?: RequestInit }) => {
  const res = await fetch(`${API}${opts.path}`, {
    ...opts.init,
    headers: {
      Authorization: `Bearer ${PUB}`,
      "X-Knock-User-Token": opts.token,
      "Content-Type": "application/json",
    },
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};
const log = (label: string, v: unknown) => console.log(`\n### ${label}\n`, JSON.stringify(v, null, 2));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const header = (t: string) => JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString());

for (const u of [emma, sarah, james]) await knock.users.update(u.id, { name: u.name, email: u.email });

// ---- Check 1: signed user tokens
const emmaToken = await signUserToken(emma.id, { expiresInSeconds: 3600 });
const sarahToken = await signUserToken(sarah.id, { expiresInSeconds: 3600 });
log("1a token header", header(emmaToken));
const own = await client({ token: emmaToken, path: `/users/${emma.id}/feeds/${FEED}` });
const cross = await client({ token: emmaToken, path: `/users/${sarah.id}/feeds/${FEED}` });
const noToken = await fetch(`${API}/users/${emma.id}/feeds/${FEED}`, { headers: { Authorization: `Bearer ${PUB}` } });
log("1b own feed / other's feed / no token", { own: own.status, cross: cross.status, crossBody: cross.body, noToken: noToken.status });

// ---- Check 2: trigger Discussion Reply → question author
const before = own.body?.meta?.total_count ?? 0;
try {
  const r = await knock.workflows.trigger("discussion-reply", {
    actor: sarah,
    recipients: [emma],
    data: { question_id: 1, lesson_title: "Prototype lesson", course_title: "Prototype course" },
  });
  log("2a trigger discussion-reply", r);
} catch (e) {
  log("2a trigger discussion-reply FAILED", (e as Error).message);
}
await sleep(4000);
const after = await client({ token: emmaToken, path: `/users/${emma.id}/feeds/${FEED}?page_size=5` });
log("2b Emma feed after trigger", {
  status: after.status,
  meta: after.body?.meta,
  before,
  newest: after.body?.entries?.[0] && {
    id: after.body.entries[0].id,
    source: after.body.entries[0].source,
    actors: after.body.entries[0].actors?.map((a: any) => a.name),
    blocks: after.body.entries[0].blocks,
    data: after.body.entries[0].data,
  },
});

// ---- Check 3: headless feed API — list, counts, mark seen/read/unread
const id = after.body?.entries?.[0]?.id;
if (id) {
  const meta = async () => (await client({ token: emmaToken, path: `/users/${emma.id}/feeds/${FEED}` })).body.meta;
  log("3a meta before", await meta());
  for (const s of ["seen", "read"] as const) {
    const r = await client({ token: emmaToken, path: `/messages/batch/${s}`, init: { method: "POST", body: JSON.stringify({ message_ids: [id] }) } });
    log(`3b mark ${s}`, { status: r.status, body: Array.isArray(r.body) ? r.body.map((m: any) => ({ seen_at: m.seen_at, read_at: m.read_at })) : r.body });
  }
  log("3c meta after seen+read", await meta());
  const u = await client({ token: emmaToken, path: `/messages/batch/unread`, init: { method: "POST", body: JSON.stringify({ message_ids: [id] }) } });
  log("3d mark unread", { status: u.status });
  log("3e meta after unread", await meta());
  const xs = await client({ token: sarahToken, path: `/messages/batch/read`, init: { method: "POST", body: JSON.stringify({ message_ids: [id] }) } });
  log("3f Sarah marks Emma's message read (should fail)", { status: xs.status, body: xs.body });
}

// ---- Check 4: preferences — new-enrollment off by default, opt-in.
// Keyed by workflow, not category: the dashboard category was hard to set during the spike.
const prefPath = `/users/${sarah.id}/preferences/default`;
const put = (on: boolean | undefined) =>
  client({ token: sarahToken, path: prefPath, init: { method: "PUT", body: JSON.stringify({ __persistence_strategy__: "merge", workflows: { "new-enrollment": on === undefined ? {} : { channel_types: { in_app_feed: on } } } }) } });

// Reset Sarah to "no explicit choice" to see the environment default.
await client({ token: sarahToken, path: prefPath, init: { method: "PUT", body: JSON.stringify({ categories: {}, workflows: {} }) } });
log("4a Sarah prefs, no explicit choice", (await client({ token: sarahToken, path: prefPath })).body);

const sarahFeedCount = async () => (await client({ token: sarahToken, path: `/users/${sarah.id}/feeds/${FEED}` })).body?.meta?.total_count;
const enroll = async () => {
  try {
    return await knock.workflows.trigger("new-enrollment", { actor: james, recipients: [sarah], data: { course_title: "Prototype course" } });
  } catch (e) {
    return { error: (e as Error).message };
  }
};
let c0 = await sarahFeedCount();
log("4b enroll with default prefs", await enroll());
await sleep(4000);
log("4c Sarah feed count default (expect unchanged)", { before: c0, after: await sarahFeedCount() });

log("4d opt in", (await put(true)).body);
c0 = await sarahFeedCount();
log("4e enroll after opt-in", await enroll());
await sleep(4000);
log("4f Sarah feed count opted-in (expect +1)", { before: c0, after: await sarahFeedCount() });

log("4g opt out", (await put(false)).body);
c0 = await sarahFeedCount();
await enroll();
await sleep(4000);
log("4h Sarah feed count opted-out (expect unchanged)", { before: c0, after: await sarahFeedCount() });
