-- Constraints that catch values which are wrong but look right.
--
-- Applied after schema.sql, schema-people.sql and schema-people-growth.sql.
--
-- This file exists because of one incident. gh_login was set to a full GitHub
-- profile URL instead of a username. Nothing rejected it. The header rendered
-- "@https://github.com/name" and read as merely ugly, while underneath it every
-- system that matches on a username had quietly stopped matching: PR mentions
-- addressed nobody, commit attribution found no user, and CODEOWNERS — which
-- matches usernames and only usernames — never fired, so the approval rule that
-- the whole merge path depends on silently did not apply.
--
-- gh_login is the attribution key. A wrong one is worse than a missing one: a
-- missing one is refused at the door by the checks in /api/agents/run, and a
-- wrong one is accepted everywhere and works nowhere.

-- ---------------------------------------------------------------------------
-- Normalise first. The constraint cannot be added while a row violates it, and
-- adding it would fail with a message about the constraint rather than about
-- the data — so fix the data in the same file, immediately above.
-- ---------------------------------------------------------------------------

-- https://github.com/name  ·  http://github.com/name/  ·  github.com/name
-- All become: name
update app_user
   set gh_login = regexp_replace(gh_login, '^(https?://)?(www\.)?github\.com/', '', 'i')
 where gh_login ~* '^(https?://)?(www\.)?github\.com/';

-- @name -> name, and strip any trailing slash or surrounding whitespace left
-- over from a copy and paste.
update app_user
   set gh_login = trim(both '/' from trim(both from ltrim(gh_login, '@')))
 where gh_login is not null
   and (gh_login <> trim(both from gh_login) or gh_login like '@%' or gh_login like '%/');

-- Anything still unusable is set to null rather than guessed at. Null is an
-- honest "not linked", which the platform already handles: such an account can
-- read and book leave but cannot start a task or run an agent. A guess would
-- restore the original failure quietly.
update app_user
   set gh_login = null
 where gh_login is not null
   and gh_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$';

-- ---------------------------------------------------------------------------
-- The constraint
-- ---------------------------------------------------------------------------
-- GitHub's own rule: alphanumerics and single hyphens, 1-39 characters, cannot
-- begin or end with a hyphen. That pattern already excludes '/' and ':', but
-- they are named separately below so a violation says which mistake was made —
-- a URL and a malformed name are different errors and deserve different
-- messages.

alter table app_user drop constraint if exists gh_login_is_a_username;

alter table app_user add constraint gh_login_is_a_username check (
  gh_login is null
  or (
    position('/' in gh_login) = 0
    and position(':' in gh_login) = 0
    and gh_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$'
  )
);

comment on constraint gh_login_is_a_username on app_user is
  'A GitHub username, not a URL and not an @handle. Alphanumerics and single '
  'hyphens, 1-39 characters. CODEOWNERS, PR mentions and commit attribution all '
  'match on this exact string.';
