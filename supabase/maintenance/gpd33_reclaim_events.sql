-- Run as an isolated command using a direct/session PostgreSQL connection.
-- VACUUM FULL rewrites the table, requires temporary disk space and blocks access.
-- Use only after the cleanup and a confirmed maintenance window and disk budget.
vacuum (full, analyze) public.api_events;
