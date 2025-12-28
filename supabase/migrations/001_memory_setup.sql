-- Enable vector extension for embeddings
create extension if not exists vector;

-- Chat Sessions Table: Stores conversation metadata
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  created_at timestamp with time zone default now(),
  metadata jsonb default '{}'::jsonb
);

-- Chat Messages Table: Stores individual messages in a session
-- Enum for role to ensure consistency
do $$ begin
    create type chat_role as enum ('system', 'user', 'assistant', 'tool');
exception
    when duplicate_object then null;
end $$;

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade,
  role chat_role not null,
  content text not null,
  created_at timestamp with time zone default now()
);

-- Client Profiles Table (Entity Memory): Stores user preferences and summary
create table if not exists client_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text unique not null,
  preferences jsonb default '{}'::jsonb,
  summary text,
  last_interaction timestamp with time zone default now()
);

-- Property Memory Table (Semantic Memory): Stores property info with embeddings for RAG
create table if not exists property_memory (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1536), -- Dimension for standard OpenAI embeddings
  metadata jsonb default '{}'::jsonb
);

-- Indexes for performance
create index if not exists idx_client_profiles_user_id on client_profiles(user_id);

-- Vector Search Function
create or replace function match_property_memory (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    property_memory.id,
    property_memory.content,
    property_memory.metadata,
    1 - (property_memory.embedding <=> query_embedding) as similarity
  from property_memory
  where 1 - (property_memory.embedding <=> query_embedding) > match_threshold
  order by property_memory.embedding <=> query_embedding
  limit match_count;
end;
$$;
