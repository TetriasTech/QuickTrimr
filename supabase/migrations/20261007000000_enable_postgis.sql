-- P0-T09 infrastructure prerequisite (ADR-008). No application tables or seed data.
-- A reset re-enables the extension without a dashboard edit.
create extension if not exists postgis with schema extensions;
