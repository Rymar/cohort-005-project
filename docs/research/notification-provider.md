# Research: Notification provider for Cadence

Sources checked on **2026-11-11**. Every claim below links to the page it came from. Where a page couldn't be fetched or didn't state a fact, that's noted as **unverified**.

## Question

Which provider should deliver real-time, in-app Notifications (inbox, unread count, live updates) for Cadence?

## Context (fixed decisions)

- Stack: React Router 8.3 (framework mode, SSR, Node server via `@react-router/serve`), Drizzle over a single SQLite file (better-sqlite3), sonner toasts. No background workers or queues, and no email sender.
- Scope: in-app only (inbox and unread count), delivered live while the app is open. No email, no browser or OS push, no preferences or opt-out. Recipients are Students, and possibly Instructors.
- Provider criteria: popular, solid, has a free tier.

## Comparison

| Option | Free tier | Next paid step | React UI | Real-time transport | SSR fit | Server trigger | Data and lock-in |
|---|---|---|---|---|---|---|---|
| **Knock** | 10,000 messages/mo, unlimited feed retention, no hard cap ([pricing](https://knock.app/pricing)) | Starter $250/mo incl. 50k, then $0.005/msg ([pricing](https://knock.app/pricing)) | `@knocklabs/react`: `NotificationIconButton` (bell with unread or unseen count), `NotificationFeedPopover`, `NotificationFeed` ([docs](https://docs.knock.app/in-app-ui/react/overview)) | Managed WebSocket ([docs](https://docs.knock.app/in-app-ui/feeds/socket-behavior)) | Not documented. Socket is browser-only, so treat as client-only (inference) | `@knocklabs/node` `client.workflows.trigger()` ([repo](https://github.com/knocklabs/knock-node)) | Hosted. Data lives at Knock. SDKs are MIT ([repo](https://github.com/knocklabs/javascript)) |
| **Novu** | 10,000 workflow runs/mo, 5 workflows, unlimited subscribers, 24h activity-feed retention, US/EU residency ([pricing](https://novu.co/pricing)) | Pro from $30/mo (30k+ runs), $1.20 per extra 1k ([pricing](https://novu.co/pricing)) | `@novu/react` `<Inbox />` with Bell, Notifications and Preferences; manages the unread count ([docs](https://docs.novu.co/platform/inbox/overview)) | WebSocket (`socketUrl`, e.g. `wss://eu.socket.novu.co`) ([docs](https://docs.novu.co/platform/inbox/prepare-for-production)) | The Next.js quickstart marks the component `'use client'` ([docs](https://docs.novu.co/platform/quickstart/nextjs)) | `@novu/api` `novu.trigger()` ([docs](https://docs.novu.co/platform/sdks/server/typescript)) | Core is MIT open source, about 40k stars ([repo](https://github.com/novuhq/novu)). Pricing page lists self-hosting under Enterprise ([pricing](https://novu.co/pricing)) |
| **MagicBell** | 1,000 deliveries/mo, counted per channel ([pricing](https://www.magicbell.com/pricing)) | Startup $249/mo incl. 50k, then $0.0025 each ([pricing](https://www.magicbell.com/pricing)) | `FloatingInbox`, `InboxButton` (bell), `Inbox`, `ToastContainer` ([docs](https://www.magicbell.com/docs/libraries/react)) | WebSockets ([inbox page](https://www.magicbell.com/inbox)) | Not documented | Unverified (REST docs page returned 404) | Hosted. Export not documented |
| **SuprSend** | 10,000 notifications/mo with SuprSend branding; not stopped on overage ([pricing](https://www.suprsend.com/pricing)) | Essentials $100/mo incl. 50k, then $2 per 1k ([pricing](https://www.suprsend.com/pricing)) | `@suprsend/react` drop-in or headless. `@suprsend/react-inbox` is end of support ([docs](https://docs.suprsend.com/docs/inbox-react)) | Socket.io per a search snippet of SuprSend docs. **Unverified**: the fetched page didn't state it | Not documented | Not checked | Hosted |
| **Courier** | 10,000 sends/mo ([pricing](https://www.courier.com/pricing)) | Pay-as-you-go $0.005/send; EU residency is on the paid tier ([pricing](https://www.courier.com/pricing)) | `@trycourier/courier-react`: `<CourierInbox />`, `<CourierInboxPopupMenu />`, unread count via `useCourier().inbox.totalUnreadCount` ([docs](https://www.courier.com/docs/sdk-libraries/courier-react-web)) | WebSocket via `inbox.listenForUpdates()` ([docs](https://www.courier.com/docs/sdk-libraries/courier-react-web)) | **Client-only render, explicitly** ([docs](https://www.courier.com/docs/sdk-libraries/courier-react-web)) | `@trycourier/courier` `client.send.message` ([docs](https://www.courier.com/docs/platform/inbox/inbox-overview)) | Hosted |
| **Baseline: SQLite + SSE** | $0, no caps | n/a | Build it (bell, popover, list) | SSE `EventSource` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)) | Native: the unread count comes from the loader, so the first SSR paint is correct | Plain function call inside the existing action or transaction | Rows in our SQLite file. No lock-in |

Engagespot was dropped. Its official pricing page returned 404 (`engagespot.co/pricing`), and only third-party aggregators reported its limits, so its free tier is **unverified**.

## Per-option notes

### Knock

- The free tier is generous for in-app use: 10k messages, unlimited feeds and feed retention, and a soft cap ("We don't hard cap your messages") ([pricing](https://knock.app/pricing)). The jump to paid, however, is $250/mo.
- **Auth:** by default, "a request with your public key can act as any user." For production you need enhanced security mode, with RS256 JWTs signed server-side (`signUserToken`, default expiry 3600s) and refreshed via `onUserTokenExpiring` ([docs](https://docs.knock.app/in-app-ui/security-and-authentication)). For Cadence, that means a signing key in env, token minting in the layout loader, and a refresh path.
- **Cross-tab:** an experimental `__experimentalCrossBrowserUpdates` option uses BroadcastChannel. An `auto_manage_socket_connection` option drops sockets in inactive tabs ([docs](https://docs.knock.app/in-app-ui/react/feed)).

### Novu

- The cheapest paid step ($30/mo) and an MIT core you could self-host later ([pricing](https://novu.co/pricing), [repo](https://github.com/novuhq/novu)). Note that self-hosting appears only under Enterprise on the pricing page. The repo's licence split puts `enterprise/` under a commercial licence ([repo](https://github.com/novuhq/novu)).
- **Auth:** production needs HMAC-SHA256 of the `subscriberId` computed server-side and passed as `subscriberHash` ([docs](https://docs.novu.co/platform/inbox/prepare-for-production)). That's simpler than Knock's JWT.
- **Free-tier limits:** 5 workflows and 24h activity-log retention ([pricing](https://novu.co/pricing)). The page doesn't say what happens to Free accounts that exceed 10k runs (**unverified**).

### MagicBell

- The smallest free tier (1,000 deliveries/mo) and a $249/mo next step ([pricing](https://www.magicbell.com/pricing)). Auth uses a server-signed user JWT ([docs](https://www.magicbell.com/docs/libraries/react)).

### SuprSend

- 10k/mo free, and the $100/mo Essentials tier removes branding ([pricing](https://www.suprsend.com/pricing)). The React SDK was recently replaced (the old package is end of support), and inbox auth moved to signed JWTs ([docs](https://docs.suprsend.com/docs/inbox-react)). Expect churn. The transport isn't confirmed on an official page I could fetch.

### Courier

- 10k sends/mo free, then pure pay-as-you-go at $0.005/send, which is the smoothest cost curve ([pricing](https://www.courier.com/pricing)). The docs explicitly say Inbox "render[s] only on the client" and needs a backend-minted JWT ([docs](https://www.courier.com/docs/sdk-libraries/courier-react-web)). The pricing page's FAQ on free-tier overage is blank (**unverified**).

### Common to every provider

- **Extra moving parts:** an API key and signing secret, server-side token or HMAC minting per user, and user sync (provider-side user or subscriber records). Some per-user data also leaves our DB.
- **SSR:** each SDK opens a browser WebSocket, and none documents React Router SSR. Courier states client-only rendering, and Novu's example is `'use client'`. In React Router, the bell has to render after hydration (for example, mount-gated), so the server-rendered HTML can't show the real unread count. That's a placeholder flash, inferred from the client-only requirement.
- **Lock-in:** notification history and read state live in the vendor's store. None of the fetched pages documents a bulk export.
- **What they offer that Cadence doesn't need yet:** multi-channel orchestration, preferences, digests or batching, and a hosted dashboard and logs. All of these are outside the decided scope (in-app only, mandatory, no preferences).

## Baseline: own `notifications` table + SSE

**Shape:**

- A Drizzle `notifications` table (`id`, `userId`, `type`, `payload`/`body`, `link`, `createdAt`, `readAt`).
- A `createNotification(opts)` helper, called inside the same action or transaction that causes the event (enrolment, quiz graded, Q&A answer). better-sqlite3 is synchronous, so the insert is atomic with the business write. No queue is needed.
- The layout loader returns `unreadCount`. The sidebar bell renders correctly during SSR with no hydration gap.
- A resource route (for example `GET /api/notifications/stream`) returns `new Response(readableStream, { headers: { "Content-Type": "text/event-stream" } })`. A route becomes a resource route when it "exports a loader or action but does not export a default component" ([React Router docs](https://reactrouter.com/how-to/resource-routes)).
- **Single-process pub/sub:** an in-memory `Map<userId, Set<controller>>`, or a Node `EventEmitter`. `createNotification` publishes after the insert, and the stream pushes `event: notification` plus the new unread count. Send `:` comment lines as keep-alives ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)). The client calls `EventSource`, updates the badge, shows a sonner toast, and calls `revalidate()` if the inbox is open.
- **Reconnects:** `EventSource` reconnects automatically. The `retry:` field tunes the delay ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)). On reconnect, the browser sends `Last-Event-ID` so the server can resume ([WHATWG](https://html.spec.whatwg.org/multipage/server-sent-events.html)). Simplest approach: on (re)connect, send the current unread count from SQLite, so missed events self-heal because the DB is the source of truth.
- **Connection limit:** without HTTP/2, browsers cap SSE at 6 connections per browser per domain across all tabs ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)). The spec suggests sharing one `EventSource` via a SharedWorker ([WHATWG](https://html.spec.whatwg.org/multipage/server-sent-events.html)). Cheaper options:
  - Use **BroadcastChannel** (same-origin tab messaging, widely available since March 2022 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel))) to sync the unread count and mark-as-read across tabs.
  - Close the stream on `visibilitychange` when a tab is hidden, and reopen it when visible.
  - Serve over HTTP/2 behind a proxy, where the limit becomes about 100 streams ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).

**Gains:** zero cost and no caps. One datastore, so notifications join directly to courses and users and can be seeded and tested. No third-party auth or user sync. Correct SSR. Stays within the no-workers stack.

**Losses:**

- Build the bell, popover and list UI yourself (a small amount of work in the existing sidebar).
- No delivery dashboard or logs.
- In-memory pub/sub works only while Cadence runs as **one Node process**. With multiple instances, a publish on instance A won't reach a stream on instance B. The fix then is a shared bus (for example Redis pub/sub) or short polling of SQLite, but that's a deployment change, not a current requirement.
- Long-lived connections hold a server slot each. That's fine at course-platform scale on Node.

## Recommendation

**Use the no-provider baseline: a SQLite `notifications` table plus an SSE resource route with in-process pub/sub and BroadcastChannel for cross-tab sync.**

Reasoning:

1. **Scope fit:** Cadence's decided scope (in-app only, mandatory, no preferences, no email or push) removes almost everything providers charge for: orchestration, channels, preferences and digests. What remains (a table, a count, and a push) is a small amount of code that fits the single-SQLite, no-workers, single-process stack exactly.
2. **Free-tier headroom:** free tiers cap at 10k notifications/mo (Knock, Novu, SuprSend, Courier) or 1k (MagicBell). Every Student receiving a few notifications per course event can approach that. The next steps cost $30 (Novu), $100 (SuprSend), $249 to $250 (MagicBell, Knock) per month, or $0.005/send (Courier) ([sources above](#comparison)).
3. **Fewer moving parts and better SSR:** a provider adds API keys, per-user token or HMAC minting, user sync, and a client-only bell that can't SSR the unread count. The baseline renders the count from the loader.
4. **Lock-in:** the baseline keeps notification data in our own DB, with no export story to depend on.

**Revisit if** Cadence adds email or push, user preferences, digests, or runs more than one server instance. In that case, **Novu** is the provider to pick: MIT core with a self-host escape hatch, the cheapest paid step at $30/mo, US/EU residency on free, and simple HMAC auth ([pricing](https://novu.co/pricing), [repo](https://github.com/novuhq/novu)). **Knock** is the runner-up for its unlimited free feed retention and soft cap, offset by the $250/mo next tier ([pricing](https://knock.app/pricing)).
