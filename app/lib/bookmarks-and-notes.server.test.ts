import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./bookmarks-and-notes.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.fake.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const LATER = new Date(2026, 9, 7, 9, 30, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let studentId: number;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  studentId = base.user.id;

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  [lessonId, otherLessonId] = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get().id;
}

describe("toggling a Bookmark", () => {
  it("bookmarks a Lesson with no Bookmark, and un-bookmarks it on the next toggle", () => {
    expect(isBookmarked(db, { studentId, lessonId })).toBe(false);

    expect(toggleBookmark(db, { studentId, lessonId, now: NOW })).toEqual({
      bookmarked: true,
    });
    expect(isBookmarked(db, { studentId, lessonId })).toBe(true);

    expect(toggleBookmark(db, { studentId, lessonId, now: LATER })).toEqual({
      bookmarked: false,
    });
    expect(isBookmarked(db, { studentId, lessonId })).toBe(false);
  });

  it("never leaves a Student with two Bookmarks on one Lesson", () => {
    toggleBookmark(db, { studentId, lessonId, now: NOW });
    expect(() =>
      db.insert(schema.bookmarks).values({ userId: studentId, lessonId }).run()
    ).toThrow();

    expect(listBookmarks(db, { studentId })).toHaveLength(1);
  });
});

describe("saving a Note", () => {
  it("creates a Note on a Lesson with none, trimmed", () => {
    expect(getNote(db, { studentId, lessonId })).toBeNull();

    const result = saveNote(db, {
      studentId,
      lessonId,
      body: "  # Not a heading  ",
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      note: { body: "# Not a heading", updatedAt: NOW.toISOString() },
    });
    expect(getNote(db, { studentId, lessonId })).toEqual({
      body: "# Not a heading",
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, { studentId, lessonId, body: "First thought", now: NOW });
    saveNote(db, { studentId, lessonId, body: "Second thought", now: LATER });

    expect(getNote(db, { studentId, lessonId })).toEqual({
      body: "Second thought",
      updatedAt: LATER.toISOString(),
    });
    expect(listNotes(db, { studentId })).toHaveLength(1);
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    const body = "a".repeat(2000);
    expect(saveNote(db, { studentId, lessonId, body, now: NOW })).toMatchObject(
      { ok: true }
    );
  });

  it("refuses a Note over 2,000 characters rather than truncating it", () => {
    const body = "a".repeat(2001);
    expect(saveNote(db, { studentId, lessonId, body, now: NOW })).toEqual({
      ok: false,
      error: "A note can be at most 2,000 characters.",
    });
    expect(getNote(db, { studentId, lessonId })).toBeNull();
  });

  it("refuses an empty Note", () => {
    expect(
      saveNote(db, { studentId, lessonId, body: "   ", now: NOW })
    ).toMatchObject({
      ok: false,
    });
  });
});

describe("the Saved lists", () => {
  it("hold only the Student's own rows, newest first, each with its Lesson and Course", () => {
    const otherStudentId = addStudent("Olive");
    toggleBookmark(db, { studentId, lessonId, now: NOW });
    toggleBookmark(db, { studentId, lessonId: otherLessonId, now: LATER });
    toggleBookmark(db, { studentId: otherStudentId, lessonId, now: LATER });
    saveNote(db, {
      studentId,
      lessonId: otherLessonId,
      body: "Older",
      now: NOW,
    });
    saveNote(db, { studentId, lessonId, body: "Newer", now: LATER });
    saveNote(db, {
      studentId: otherStudentId,
      lessonId,
      body: "Not mine",
      now: LATER,
    });

    expect(listBookmarks(db, { studentId })).toMatchObject([
      {
        lessonTitle: "Lesson 2",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
      {
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
    ]);
    expect(listNotes(db, { studentId })).toMatchObject([
      { body: "Newer", lessonTitle: "Lesson 1", courseTitle: "Test Course" },
      { body: "Older", lessonTitle: "Lesson 2", courseTitle: "Test Course" },
    ]);
  });
});

describe("approving a Refund", () => {
  it("keeps the Student's Bookmarks and Notes", async () => {
    const notifications = fakeNotifications();
    const platformAdmin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: studentId,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: new Date(2026, 9, 3).toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: studentId, courseId: base.course.id })
      .run();

    toggleBookmark(db, { studentId, lessonId, now: NOW });
    saveNote(db, { studentId, lessonId, body: "Keep me", now: NOW });

    const raised = await raiseRefundRequest(
      db,
      purchase.id,
      studentId,
      "It was not what I expected.",
      NOW,
      notifications
    );
    if (!raised.ok) throw new Error(raised.error);
    const approved = await approveRefundRequest(
      db,
      raised.refundRequestId,
      platformAdmin.id,
      null,
      NOW,
      notifications
    );
    expect(approved.ok).toBe(true);

    expect(isBookmarked(db, { studentId, lessonId })).toBe(true);
    expect(getNote(db, { studentId, lessonId })).toMatchObject({
      body: "Keep me",
    });
  });
});
