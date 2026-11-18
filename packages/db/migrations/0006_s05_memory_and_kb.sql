-- 0006_s05_memory_and_kb.sql
-- PRD §5.4 / M.6 / N.2.10 / N.2.11 + DOC-Q-008 + ADR-0009 (S0.5 Memory & Knowledge/RAG v0)

-- 1. Agent persistent memory items (untyped vector column + partial expression HNSW index per DOC-Q-008)
CREATE TABLE memory_items (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid REFERENCES projects(id),
  scope text NOT NULL CHECK (scope IN ('run','session','user','agent','project','org')),
  scope_id text,
  subject_id text,
  kind text NOT NULL CHECK (kind IN ('episodic','semantic','procedural')),
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding_dim int NOT NULL DEFAULT 1536 CHECK (embedding_dim >= 64 AND embedding_dim <= 3072),
  embedding vector,
  metadata jsonb NOT NULL DEFAULT '{}',
  sensitivity text NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public','internal','confidential','restricted','pii')),
  provenance jsonb NOT NULL DEFAULT '{}',
  importance real NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  contradicts_id uuid REFERENCES memory_items(id),
  ttl_at timestamptz,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX memory_scope_idx
  ON memory_items (org_id, workspace_id, scope, scope_id)
  WHERE deleted_at IS NULL;

CREATE INDEX memory_subject_idx
  ON memory_items (org_id, subject_id)
  WHERE subject_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX memory_embedding_1536_hnsw
  ON memory_items
  USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding_dim = 1536 AND deleted_at IS NULL;

SELECT enable_tenant_rls('memory_items');

-- 2. Conversation / chat sessions with rolling summaries & preserved identifiers (E0.5-1)
CREATE TABLE sessions_conversation (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid REFERENCES projects(id),
  agent_id uuid,
  subject_id text,
  title text,
  messages jsonb NOT NULL DEFAULT '[]',
  rolling_summary text NOT NULL DEFAULT '',
  preserved_identifiers jsonb NOT NULL DEFAULT '[]',
  token_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

SELECT enable_tenant_rls('sessions_conversation');

-- 3. Knowledge bases (configurable embedding dimensions + N.2.11 chunking settings)
CREATE TABLE knowledge_bases (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  description text,
  embedding_model text NOT NULL DEFAULT 'mock/text-embedding-3-small',
  embedding_dim int NOT NULL DEFAULT 1536 CHECK (embedding_dim >= 64 AND embedding_dim <= 3072),
  chunk_target_tokens int NOT NULL DEFAULT 400,
  chunk_max_tokens int NOT NULL DEFAULT 800,
  chunk_overlap_tokens int NOT NULL DEFAULT 60,
  sensitivity text NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public','internal','confidential','restricted','pii')),
  created_by uuid NOT NULL REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (project_id, name)
);

SELECT enable_tenant_rls('knowledge_bases');

-- 4. Knowledge base ingestion sources (files, URLs, manual)
CREATE TABLE kb_sources (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kb_id uuid NOT NULL REFERENCES knowledge_bases(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('file','url','manual')),
  uri text,
  mime_type text NOT NULL DEFAULT 'text/markdown',
  sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','syncing','synced','failed')),
  access_principals jsonb NOT NULL DEFAULT '[]',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

SELECT enable_tenant_rls('kb_sources');

-- 5. Knowledge base documents with content hash for change detection
CREATE TABLE kb_documents (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kb_id uuid NOT NULL REFERENCES knowledge_bases(id),
  source_id uuid NOT NULL REFERENCES kb_sources(id),
  external_key text NOT NULL,
  title text NOT NULL,
  mime_type text NOT NULL DEFAULT 'text/markdown',
  content_hash text NOT NULL,
  byte_size int NOT NULL DEFAULT 0,
  chunk_count int NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (source_id, external_key)
);

SELECT enable_tenant_rls('kb_documents');

-- 6. Knowledge base chunks with section path, char range, hash, and partial HNSW index
CREATE TABLE kb_chunks (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kb_id uuid NOT NULL REFERENCES knowledge_bases(id),
  source_id uuid NOT NULL REFERENCES kb_sources(id),
  doc_id uuid NOT NULL REFERENCES kb_documents(id),
  chunk_index int NOT NULL,
  section_path jsonb NOT NULL DEFAULT '[]',
  page int,
  char_start int NOT NULL,
  char_end int NOT NULL,
  token_count int NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding_dim int NOT NULL DEFAULT 1536 CHECK (embedding_dim >= 64 AND embedding_dim <= 3072),
  embedding vector,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX kb_chunks_doc_idx
  ON kb_chunks (doc_id, chunk_index)
  WHERE deleted_at IS NULL;

CREATE INDEX kb_chunks_hash_idx
  ON kb_chunks (kb_id, content_hash)
  WHERE deleted_at IS NULL;

CREATE INDEX kb_chunks_embedding_1536_hnsw
  ON kb_chunks
  USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding_dim = 1536 AND deleted_at IS NULL;

SELECT enable_tenant_rls('kb_chunks');

-- Grants for least-privilege app role
GRANT SELECT, INSERT, UPDATE, DELETE ON
  memory_items, sessions_conversation, knowledge_bases, kb_sources, kb_documents, kb_chunks
  TO platform_app;
