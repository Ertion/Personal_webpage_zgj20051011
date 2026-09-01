PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS guestbook_comments (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES guestbook_comments(id) ON DELETE CASCADE,
    visitor_id TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '匿名访客',
    role TEXT NOT NULL DEFAULT 'guest' CHECK (role IN ('guest', 'owner')),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guestbook_created
ON guestbook_comments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guestbook_parent
ON guestbook_comments(parent_id, created_at);

CREATE TABLE IF NOT EXISTS guestbook_rate_limits (
    client_key TEXT PRIMARY KEY,
    window_started_at TEXT NOT NULL,
    post_count INTEGER NOT NULL DEFAULT 0
);

PRAGMA optimize;
