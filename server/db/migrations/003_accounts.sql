-- Accounts: passwordless sign-in by e-mail (magic links) and browser sessions.
-- Only hashes (SHA-256) of the link tokens and session ids are stored: a copy of the database
-- can't be used to sign in.

-- One e-mail, one account, whatever the capitals ("Ana@x.com" and "ana@x.com"). Addresses are
-- stored lower-cased by the server; this index makes sure of it.
create unique index users_email_lower_idx on users (lower(email));
alter table users add column last_login_at timestamptz;

-- Sign-in links sent by e-mail. Single use (used_at), short-lived (expires_at).
create table login_tokens (
  token_hash text primary key,
  email text not null,
  -- Where to go after signing in: a same-site relative path, checked when stored and when used.
  next_path text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index login_tokens_expires_idx on login_tokens (expires_at);

-- Browser sessions (the cookie holds the id; the table holds its hash).
create table sessions (
  id_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expires_idx on sessions (expires_at);
