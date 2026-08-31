CREATE TABLE IF NOT EXISTS steam_profile_cache (
    steam_id TEXT PRIMARY KEY,
    profile_name TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    profile_url TEXT NOT NULL DEFAULT '',
    persona_state INTEGER NOT NULL DEFAULT 0,
    status_label TEXT NOT NULL DEFAULT '离线',
    game_count INTEGER NOT NULL DEFAULT 0,
    played_game_count INTEGER NOT NULL DEFAULT 0,
    total_playtime_minutes INTEGER NOT NULL DEFAULT 0,
    games_json TEXT NOT NULL DEFAULT '[]',
    queried_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_query_limits (
    client_key TEXT PRIMARY KEY,
    window_started_at TEXT NOT NULL,
    query_count INTEGER NOT NULL DEFAULT 0
);
