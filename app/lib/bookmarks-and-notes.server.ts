import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

// ─── Bookmarks and Notes ───
// What a Student attaches to a Lesson for themselves. See GLOSSARY.md.
//
// A Note is private to the Student who wrote it: every read here is scoped to
// one Student, and nothing in this module lists Notes across Students.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. The one-per-Student-per-Lesson rule is held by unique indexes, so the
// writes below are upserts rather than check-then-insert.

export type Db = BetterSQLite3Database<typeof schema>;

export type StudentLesson = { studentId: number; lessonId: number };

function forStudentLesson(
  table: typeof bookmarks | typeof notes,
  { studentId, lessonId }: StudentLesson
) {
  return and(eq(table.userId, studentId), eq(table.lessonId, lessonId));
}

// ─── Bookmarks ───

export function isBookmarked(db: Db, opts: StudentLesson): boolean {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(forStudentLesson(bookmarks, opts))
    .get();
}

/** Adds the Bookmark if there is none, removes it if there is one. */
export function toggleBookmark(
  db: Db,
  opts: StudentLesson & { now: Date }
): { bookmarked: boolean } {
  const removed = db
    .delete(bookmarks)
    .where(forStudentLesson(bookmarks, opts))
    .returning({ id: bookmarks.id })
    .all();
  if (removed.length > 0) return { bookmarked: false };

  db.insert(bookmarks)
    .values({
      userId: opts.studentId,
      lessonId: opts.lessonId,
      createdAt: opts.now.toISOString(),
    })
    .onConflictDoNothing()
    .run();
  return { bookmarked: true };
}

// ─── Notes ───

export type Note = { body: string; updatedAt: string };

export function getNote(db: Db, opts: StudentLesson): Note | null {
  return (
    db
      .select({ body: notes.body, updatedAt: notes.updatedAt })
      .from(notes)
      .where(forStudentLesson(notes, opts))
      .get() ?? null
  );
}

export type SaveNoteResult =
  { ok: true; note: Note } | { ok: false; error: string };

/**
 * Creates the Student's Note on the Lesson, or replaces its body and moves
 * "last edited" on. The body is trimmed and refused, never truncated, when it
 * is empty or over the cap.
 */
export function saveNote(
  db: Db,
  opts: StudentLesson & { body: string; now: Date }
): SaveNoteResult {
  const body = opts.body.trim();
  if (body.length === 0) {
    return { ok: false, error: "Write something before saving your note." };
  }
  if (body.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `A note can be at most ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters.`,
    };
  }

  const now = opts.now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId: opts.studentId,
      lessonId: opts.lessonId,
      body,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body, updatedAt: now },
    })
    .returning({ body: notes.body, updatedAt: notes.updatedAt })
    .get();
  return { ok: true, note };
}

// ─── The Saved page ───

export type SavedLesson = {
  lessonId: number;
  lessonTitle: string;
  courseTitle: string;
  courseSlug: string;
};

const savedLessonColumns = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** The Student's Bookmarks, newest first. */
export function listBookmarks(
  db: Db,
  opts: { studentId: number }
): (SavedLesson & { id: number; createdAt: string })[] {
  return db
    .select({
      id: bookmarks.id,
      createdAt: bookmarks.createdAt,
      ...savedLessonColumns,
    })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, opts.studentId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}

/** The Student's Notes, most recently edited first. */
export function listNotes(
  db: Db,
  opts: { studentId: number }
): (SavedLesson & Note & { id: number })[] {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...savedLessonColumns,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, opts.studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
