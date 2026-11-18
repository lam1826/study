ALTER TABLE subjects ADD COLUMN description TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE subjects ADD COLUMN icon TEXT NOT NULL DEFAULT '▤';
--> statement-breakpoint
ALTER TABLE chapters ADD COLUMN overview TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE chapters ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE questions ADD COLUMN code TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE questions ADD COLUMN key_points TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE essays ADD COLUMN status TEXT NOT NULL DEFAULT 'unseen';
--> statement-breakpoint
ALTER TABLE essays ADD COLUMN viewed_at INTEGER;
--> statement-breakpoint
ALTER TABLE essays ADD COLUMN answered_at INTEGER;
--> statement-breakpoint
ALTER TABLE essays ADD COLUMN assessment TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE essays ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE backups (id TEXT PRIMARY KEY, created INTEGER NOT NULL, owner TEXT NOT NULL, title TEXT NOT NULL, storage_key TEXT NOT NULL, file_count INTEGER NOT NULL);
