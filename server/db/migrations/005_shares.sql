-- Public share links for a family's migration map (share.html?id=…, preview at /s/:id).
-- The snapshot is the already-public subset built in the browser and checked by the server
-- (src/share/snapshot.ts): never presumed-living people. Deleting a share removes it for everyone.

create table shares (
  -- Random, unguessable (144 bits, base64url): the link is the only way to find a share.
  id text primary key check (id ~ '^[A-Za-z0-9_-]{24}$'),
  owner_id uuid not null references users (id) on delete cascade,
  family text not null,
  -- ShareSnapshot: { version, family, people: [{ id, name, sex, birthYear, place, lat, lon, gen, parents }] }
  snapshot jsonb not null,
  people_count integer not null check (people_count > 0),
  created_at timestamptz not null default now()
);
create index shares_owner_idx on shares (owner_id, created_at desc);
