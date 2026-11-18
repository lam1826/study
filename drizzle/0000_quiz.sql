CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE subjects (id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE);
--> statement-breakpoint
CREATE TABLE chapters (id TEXT PRIMARY KEY, subject TEXT NOT NULL REFERENCES subjects(id), title TEXT NOT NULL, UNIQUE(subject,title));
--> statement-breakpoint
CREATE TABLE documents (id TEXT PRIMARY KEY, chapter TEXT NOT NULL REFERENCES chapters(id), title TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE);
--> statement-breakpoint
CREATE TABLE questions (id TEXT PRIMARY KEY, chapter TEXT NOT NULL REFERENCES chapters(id), kind TEXT NOT NULL CHECK(kind IN ('quiz','essay')), tier TEXT NOT NULL CHECK(tier IN ('main','extra')), prompt TEXT NOT NULL, normalized TEXT NOT NULL, explanation TEXT NOT NULL, options TEXT NOT NULL, correct TEXT, sources TEXT NOT NULL, UNIQUE(chapter,kind,normalized));
--> statement-breakpoint
CREATE TABLE attempts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, chapter TEXT NOT NULL REFERENCES chapters(id), created INTEGER NOT NULL, deadline INTEGER, config TEXT NOT NULL, items TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '{}', flags TEXT NOT NULL DEFAULT '[]', finished INTEGER, result TEXT);
--> statement-breakpoint
CREATE INDEX attempts_owner ON attempts(owner,created DESC);
--> statement-breakpoint
CREATE TABLE essays (owner TEXT NOT NULL, question TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE, draft TEXT NOT NULL, learned INTEGER NOT NULL, PRIMARY KEY(owner,question));
