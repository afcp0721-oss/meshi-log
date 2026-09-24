-- Independent security counter; existing activity_records and image retention are unchanged.
CREATE TABLE IF NOT EXISTS ai_daily_usage (
 day TEXT NOT NULL,
 user_id TEXT NOT NULL,
 requests INTEGER NOT NULL CHECK(requests BETWEEN 1 AND 5),
 units INTEGER NOT NULL CHECK(units >= 1),
 PRIMARY KEY(day, user_id)
);
