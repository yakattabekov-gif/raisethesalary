-- Enable pg_net extension for HTTP requests from cron
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;