// PROTOTYPE — throwaway Knock spike for "Does Knock hold up against Cadence?" (#47).
// Lives on the prototype/knock-spike branch only. Never merge.
// Run: `npm run dev`, pick a user in the DevUI panel, open /prototype/knock.
import { useCallback, useEffect, useState } from "react";
import { data, Form, useActionData } from "react-router";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Route } from "./+types/prototype.knock";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import {
  getPreferencesForUser,
  knockPublicConfig,
  signTokenForUser,
  triggerDiscussionReply,
  triggerNewEnrollment,
} from "~/lib/knock-prototype.server";

const KNOCK_API = "https://api.knock.app/v1";

const getUser = (opts: { id: number }) =>
  db.select().from(users).where(eq(users.id, opts.id)).get();

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }
  const user = getUser({ id: userId });
  if (!user) throw data("Unknown user", { status: 404 });

  const userToken = await signTokenForUser({ user });
  const serverPreferences = await getPreferencesForUser({ userId }).catch(
    (e: Error) => ({ error: e.message })
  );

  // Real Discussion Questions the current user could "reply" to.
  const questions = db
    .select({
      id: comments.id,
      body: comments.body,
      authorName: users.name,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(
      and(
        isNull(comments.parentId),
        isNull(comments.deletedAt),
        ne(comments.userId, userId)
      )
    )
    .limit(8)
    .all();

  const courseList = db
    .select({
      id: courses.id,
      title: courses.title,
      instructorName: users.name,
    })
    .from(courses)
    .innerJoin(users, eq(users.id, courses.instructorId))
    .limit(8)
    .all();

  return {
    user: { id: user.id, name: user.name, role: user.role },
    userToken,
    ...knockPublicConfig(),
    serverPreferences,
    questions,
    courseList,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) throw data("Select a user", { status: 401 });
  const actor = getUser({ id: userId })!;
  const form = await request.formData();
  const intent = form.get("intent");

  try {
    if (intent === "discussion-reply") {
      const question = db
        .select({
          id: comments.id,
          authorId: comments.userId,
          lessonTitle: lessons.title,
          courseTitle: courses.title,
        })
        .from(comments)
        .innerJoin(lessons, eq(lessons.id, comments.lessonId))
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .innerJoin(courses, eq(courses.id, modules.courseId))
        .where(eq(comments.id, Number(form.get("questionId"))))
        .get()!;
      const author = getUser({ id: question.authorId })!;
      const result = await triggerDiscussionReply({
        replier: actor,
        questionAuthor: author,
        questionId: question.id,
        lessonTitle: question.lessonTitle,
        courseTitle: question.courseTitle,
      });
      return {
        ok: true,
        message: `discussion-reply → ${author.name} (Knock user ${author.id})`,
        result,
      };
    }
    if (intent === "new-enrollment") {
      const course = db
        .select()
        .from(courses)
        .where(eq(courses.id, Number(form.get("courseId"))))
        .get()!;
      const instructor = getUser({ id: course.instructorId })!;
      const result = await triggerNewEnrollment({
        student: actor,
        instructor,
        courseTitle: course.title,
      });
      return {
        ok: true,
        message: `new-enrollment → ${instructor.name} (Knock user ${instructor.id})`,
        result,
      };
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message, result: null };
  }
  return { ok: false, message: "Unknown intent", result: null };
}

type FeedResponse = {
  entries: Array<{
    id: string;
    inserted_at: string;
    read_at: string | null;
    seen_at: string | null;
    source: { key: string; categories: string[] };
    blocks: Array<{ name: string; rendered?: string; content?: string }>;
    actors: Array<{ id: string; name?: string }>;
    data: Record<string, unknown>;
  }>;
  meta: { unread_count: number; unseen_count: number; total_count: number };
};

// Everything below runs in the browser against Knock's client API, authenticated
// only by the public key + our signed user token: the same path a real Feed would use.
function useKnockClient(opts: {
  publicApiKey: string;
  userToken: string;
}) {
  return useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`${KNOCK_API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${opts.publicApiKey}`,
          "X-Knock-User-Token": opts.userToken,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    },
    [opts.publicApiKey, opts.userToken]
  );
}

function FeedPanel(props: {
  userId: number;
  publicApiKey: string;
  userToken: string;
  feedChannelId: string;
}) {
  const call = useKnockClient(props);
  const [feed, setFeed] = useState<{ status: number; body: FeedResponse }>();
  const [lastCall, setLastCall] = useState<unknown>();

  const load = useCallback(async () => {
    const r = await call(
      `/users/${props.userId}/feeds/${props.feedChannelId}?page_size=20`
    );
    setFeed(r);
  }, [call, props.userId, props.feedChannelId]);

  useEffect(() => {
    load();
  }, [load]);

  const mark = async (status: "seen" | "read" | "unread", ids: string[]) => {
    const r = await call(`/messages/batch/${status}`, {
      method: "POST",
      body: JSON.stringify({ message_ids: ids }),
    });
    setLastCall({ request: `POST /messages/batch/${status}`, ...r });
    await load();
  };

  // Negative control: a token for user A must not read user B's feed.
  const tryOtherUser = async () => {
    const otherId = props.userId === 1 ? 2 : 1;
    const r = await call(`/users/${otherId}/feeds/${props.feedChannelId}`);
    setLastCall({ request: `GET feed of user ${otherId} with my token`, ...r });
  };

  const entries = feed?.body?.entries ?? [];
  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">
        Checks 1 + 3: feed for Knock user {props.userId} (headless, client-side)
      </h2>
      <div className="flex flex-wrap gap-2 text-sm">
        <button className="rounded border px-2 py-1" onClick={load}>
          Reload feed
        </button>
        <button
          className="rounded border px-2 py-1"
          onClick={() => mark("seen", entries.map((e) => e.id))}
          disabled={!entries.length}
        >
          Mark all seen
        </button>
        <button className="rounded border px-2 py-1" onClick={tryOtherUser}>
          Try reading another user's feed
        </button>
      </div>
      <p className="text-sm">
        HTTP {feed?.status ?? "…"} · unread{" "}
        <b>{feed?.body?.meta?.unread_count ?? "?"}</b> · unseen{" "}
        <b>{feed?.body?.meta?.unseen_count ?? "?"}</b> · total{" "}
        {feed?.body?.meta?.total_count ?? "?"}
      </p>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.id} className="rounded border p-2 text-sm">
            <div className="font-mono text-xs">
              {e.source.key} [{e.source.categories.join(", ")}] · {e.inserted_at}
              {" · "}
              {e.seen_at ? "seen" : "UNSEEN"} · {e.read_at ? "read" : "UNREAD"}
            </div>
            <div>
              actor: {e.actors.map((a) => a.name ?? a.id).join(", ")} · data:{" "}
              <code>{JSON.stringify(e.data)}</code>
            </div>
            {e.blocks.map((b) => (
              <div
                key={b.name}
                dangerouslySetInnerHTML={{ __html: b.rendered ?? b.content ?? "" }}
              />
            ))}
            <div className="mt-1 flex gap-2">
              <button
                className="rounded border px-2"
                onClick={() => mark(e.read_at ? "unread" : "read", [e.id])}
              >
                Mark {e.read_at ? "unread" : "read"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <StateDump label="Last client call" value={lastCall} />
      <StateDump label="Raw feed response" value={feed} />
    </section>
  );
}

function PreferencesPanel(props: {
  userId: number;
  publicApiKey: string;
  userToken: string;
}) {
  const call = useKnockClient(props);
  const [prefs, setPrefs] = useState<unknown>();

  const load = useCallback(async () => {
    setPrefs(await call(`/users/${props.userId}/preferences/default`));
  }, [call, props.userId]);

  useEffect(() => {
    load();
  }, [load]);

  const setOptIn = async (on: boolean) => {
    const r = await call(`/users/${props.userId}/preferences/default`, {
      method: "PUT",
      body: JSON.stringify({
        // PUT replaces the whole set by default; merge so opting in to one
        // category doesn't wipe the user's other preferences.
        __persistence_strategy__: "merge",
        categories: {
          "new-enrollment": { channel_types: { in_app_feed: on } },
        },
      }),
    });
    setPrefs(r);
  };

  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">
        Check 4: preferences (client-side, as this user)
      </h2>
      <div className="flex gap-2 text-sm">
        <button className="rounded border px-2 py-1" onClick={load}>
          Reload
        </button>
        <button className="rounded border px-2 py-1" onClick={() => setOptIn(true)}>
          Opt in to new-enrollment (in-app)
        </button>
        <button className="rounded border px-2 py-1" onClick={() => setOptIn(false)}>
          Opt out
        </button>
      </div>
      <StateDump label="Preference set" value={prefs} open />
    </section>
  );
}

function StateDump(props: { label: string; value: unknown; open?: boolean }) {
  return (
    <details open={props.open} className="text-xs">
      <summary className="cursor-pointer">{props.label}</summary>
      <pre className="max-h-80 overflow-auto bg-muted p-2">
        {JSON.stringify(props.value, null, 2)}
      </pre>
    </details>
  );
}

export default function KnockPrototype({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const { user, userToken, publicApiKey, feedChannelId } = loaderData;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="rounded bg-yellow-100 p-2 text-sm text-yellow-900">
        PROTOTYPE: throwaway Knock spike (#47). Not production code.
      </div>
      <h1 className="text-xl font-bold">
        Knock spike as {user.name} (#{user.id}, {user.role})
      </h1>
      <StateDump
        label="Signed user token (RS256, from our server)"
        value={{ userToken, header: decodeJwtPart(userToken, 0), payload: decodeJwtPart(userToken, 1) }}
      />

      <section className="space-y-3 rounded border p-4">
        <h2 className="font-semibold">Check 2: trigger as {user.name}</h2>
        <Form method="post" className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="intent" value="discussion-reply" />
          <select name="questionId" className="max-w-md rounded border p-1">
            {loaderData.questions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.authorName}: “{q.body.slice(0, 50)}” ({q.courseTitle})
              </option>
            ))}
          </select>
          <button className="rounded border px-2 py-1">
            Reply → notify question author
          </button>
        </Form>
        <Form method="post" className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="intent" value="new-enrollment" />
          <select name="courseId" className="max-w-md rounded border p-1">
            {loaderData.courseList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} (instructor {c.instructorName})
              </option>
            ))}
          </select>
          <button className="rounded border px-2 py-1">
            Enroll → notify Instructor
          </button>
        </Form>
        {actionData && (
          <p className={actionData.ok ? "text-green-700" : "text-red-700"}>
            {actionData.message}
          </p>
        )}
        <StateDump label="Trigger response" value={actionData?.result} />
      </section>

      <FeedPanel
        key={`feed-${user.id}`}
        userId={user.id}
        publicApiKey={publicApiKey}
        userToken={userToken}
        feedChannelId={feedChannelId}
      />
      <PreferencesPanel
        key={`prefs-${user.id}`}
        userId={user.id}
        publicApiKey={publicApiKey}
        userToken={userToken}
      />
      <StateDump
        label="Server-side preferences (secret key)"
        value={loaderData.serverPreferences}
      />
    </div>
  );
}

const decodeJwtPart = (token: string, index: number) => {
  try {
    return JSON.parse(atob(token.split(".")[index].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
};
