-- Evidence-based family tree: Source -> Claim -> Person / Relationship.
-- Plain Postgres (runs unchanged on PGlite in dev and on Postgres in production).

create table users (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table trees (
  id uuid primary key,
  owner_id uuid not null references users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trees_owner_idx on trees (owner_id);

-- Uploaded files. The bytes live in object storage under storage_key.
create table documents (
  id uuid primary key,
  tree_id uuid not null references trees (id) on delete cascade,
  storage_key text not null,
  file_name text not null,
  media_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  created_at timestamptz not null default now()
);
create index documents_tree_idx on documents (tree_id);

create table sources (
  id uuid primary key,
  tree_id uuid not null references trees (id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('original', 'derivative', 'authored')),
  origin text not null check (origin in ('upload', 'gedcom', 'manual')),
  -- archive, collection, book, folio, entry, url
  citation jsonb not null default '{}',
  record_date text,
  record_year integer,
  language text,
  transcription text,
  document_id uuid references documents (id) on delete set null,
  created_at timestamptz not null default now()
);
create index sources_tree_idx on sources (tree_id);

create table persons (
  id uuid primary key,
  tree_id uuid not null references trees (id) on delete cascade,
  given_name text not null default '',
  surname text not null default '',
  sex text check (sex in ('M', 'F', 'U')),
  -- LifeEvent JSON: { date, year, place, lat, lon }
  birth jsonb,
  baptism jsonb,
  death jsonb,
  burial jsonb,
  occupation text,
  origin text not null check (origin in ('gedcom', 'manual', 'ai')),
  origin_source_id uuid references sources (id) on delete set null,
  origin_ref text,
  merged_into uuid references persons (id) on delete set null,
  privacy_override text check (privacy_override in ('private', 'public')),
  created_at timestamptz not null default now()
);
create index persons_tree_idx on persons (tree_id);

create table relationships (
  id uuid primary key,
  tree_id uuid not null references trees (id) on delete cascade,
  kind text not null check (kind in ('parent', 'spouse')),
  -- parent: from_person is the parent, to_person the child
  from_person uuid not null references persons (id) on delete cascade,
  to_person uuid not null references persons (id) on delete cascade,
  origin text not null check (origin in ('gedcom', 'manual', 'ai')),
  origin_source_id uuid references sources (id) on delete set null,
  -- cache of computeConfidence() over the linked claims
  confidence text not null default 'unsupported'
    check (confidence in ('proven', 'probable', 'possible', 'conflict', 'unsupported')),
  argument text,
  confidence_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index relationships_tree_idx on relationships (tree_id);
create index relationships_from_idx on relationships (from_person);
create index relationships_to_idx on relationships (to_person);

create table claims (
  id uuid primary key,
  tree_id uuid not null references trees (id) on delete cascade,
  source_id uuid not null references sources (id) on delete cascade,
  kind text not null,
  statement text not null,
  event_date text,
  event_year integer,
  event_place text,
  information text not null check (information in ('primary', 'secondary', 'undetermined')),
  reading text not null check (reading in ('clear', 'likely', 'uncertain')),
  extracted_by_kind text not null check (extracted_by_kind in ('person', 'ai')),
  extracted_by_name text not null,
  review text not null check (review in ('proposed', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);
create index claims_tree_idx on claims (tree_id);
create index claims_source_idx on claims (source_id);

create table claim_persons (
  claim_id uuid not null references claims (id) on delete cascade,
  person_id uuid not null references persons (id) on delete cascade,
  role text not null,
  primary key (claim_id, person_id, role)
);
create index claim_persons_person_idx on claim_persons (person_id);

create table claim_relationships (
  claim_id uuid not null references claims (id) on delete cascade,
  relationship_id uuid not null references relationships (id) on delete cascade,
  stance text not null check (stance in ('supports', 'contradicts')),
  evidence text not null check (evidence in ('direct', 'indirect')),
  note text,
  primary key (claim_id, relationship_id)
);
create index claim_relationships_rel_idx on claim_relationships (relationship_id);
