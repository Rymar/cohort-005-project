// PROTOTYPE — throwaway Knock spike for "Does Knock hold up against Cadence?" (#47).
// Lives on the prototype/knock-spike branch only. Never merge.
import Knock, { signUserToken } from "@knocklabs/node";

// The SDK reads KNOCK_API_KEY (the secret key) by default.
let client: Knock | undefined;
function knock() {
  client ??= new Knock();
  return client;
}

type KnockUser = { id: number; name: string; email: string };

// Prototype choice: the Knock user id is the Cadence user id as a string.
const toRecipient = (user: KnockUser) => ({
  id: String(user.id),
  name: user.name,
  email: user.email,
});

export const knockPublicConfig = () => ({
  publicApiKey: process.env.KNOCK_PUBLIC_API_KEY!,
  feedChannelId: process.env.KNOCK_FEED_CHANNEL_ID!,
});

// Check 1: our server signs an RS256 user token for the DevUI user.
export const signTokenForUser = async (opts: { user: KnockUser }) => {
  // Make sure the user exists in Knock before the client reads their feed.
  await knock().users.update(String(opts.user.id), {
    name: opts.user.name,
    email: opts.user.email,
  });
  return signUserToken(String(opts.user.id), { expiresInSeconds: 3600 });
};

// Check 2: trigger a real catalogue Notification from the Node SDK.
export const triggerDiscussionReply = async (opts: {
  replier: KnockUser;
  questionAuthor: KnockUser;
  questionId: number;
  lessonTitle: string;
  courseTitle: string;
}) =>
  knock().workflows.trigger("discussion-reply", {
    actor: toRecipient(opts.replier),
    recipients: [toRecipient(opts.questionAuthor)],
    data: {
      question_id: opts.questionId,
      lesson_title: opts.lessonTitle,
      course_title: opts.courseTitle,
    },
  });

// Check 4: new Enrollment → Instructor, off by default and opt-in.
export const triggerNewEnrollment = async (opts: {
  student: KnockUser;
  instructor: KnockUser;
  courseTitle: string;
}) =>
  knock().workflows.trigger("new-enrollment", {
    actor: toRecipient(opts.student),
    recipients: [toRecipient(opts.instructor)],
    data: { course_title: opts.courseTitle },
  });

// Server-side view of what Knock holds for a user's preferences, for display.
export const getPreferencesForUser = async (opts: { userId: number }) =>
  knock().users.getPreferences(String(opts.userId), "default");
