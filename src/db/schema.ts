export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS docs (
  doc_id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'TRACKED',
  evm_address TEXT,
  sui_address TEXT,
  ens_name TEXT,
  policy_source TEXT,
  last_user_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
  doc_id TEXT PRIMARY KEY,
  encrypted_blob TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commands (
  cmd_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  raw_command TEXT NOT NULL,
  parsed_json TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  yellow_intent_id TEXT,
  sui_tx_digest TEXT,
  arc_tx_hash TEXT,
  result_text TEXT,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_commands_doc_status_created ON commands(doc_id, status, created_at);

CREATE TABLE IF NOT EXISTS doc_settings (
  doc_id TEXT PRIMARY KEY,
  quorum INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS signers (
  doc_id TEXT NOT NULL,
  address TEXT NOT NULL,
  weight INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, address)
);

CREATE TABLE IF NOT EXISTS command_approvals (
  doc_id TEXT NOT NULL,
  cmd_id TEXT NOT NULL,
  signer_address TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, cmd_id, signer_address)
);

CREATE TABLE IF NOT EXISTS yellow_sessions (
  doc_id TEXT PRIMARY KEY,
  app_session_id TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN',
  allocations_json TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS yellow_session_keys (
  doc_id TEXT NOT NULL,
  signer_address TEXT NOT NULL,
  session_key_address TEXT NOT NULL,
  encrypted_session_key_private TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  allowances_json TEXT,
  jwt_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, signer_address)
);

CREATE TABLE IF NOT EXISTS circle_wallets (
  doc_id TEXT PRIMARY KEY,
  wallet_set_id TEXT,
  wallet_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS walletconnect_sessions (
  topic TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  peer_name TEXT,
  peer_url TEXT,
  peer_icons TEXT,
  chains TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wc_sessions_doc_updated ON walletconnect_sessions(doc_id, updated_at);

CREATE TABLE IF NOT EXISTS walletconnect_requests (
  topic TEXT NOT NULL,
  request_id INTEGER NOT NULL,
  doc_id TEXT NOT NULL,
  cmd_id TEXT NOT NULL,
  method TEXT NOT NULL,
  params_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (topic, request_id)
);

CREATE INDEX IF NOT EXISTS idx_wc_requests_doc_status ON walletconnect_requests(doc_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_wc_requests_cmd ON walletconnect_requests(cmd_id);

CREATE TABLE IF NOT EXISTS schedules (
  schedule_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  interval_hours REAL NOT NULL,
  inner_command TEXT NOT NULL,
  next_run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  total_runs INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedules_doc_status ON schedules(doc_id, status);
CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(status, next_run_at);

CREATE TABLE IF NOT EXISTS doc_config (
  doc_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, key)
);

CREATE TABLE IF NOT EXISTS agent_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  type TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_doc ON agent_activity(doc_id, created_at);

CREATE TABLE IF NOT EXISTS trades (
  trade_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  cmd_id TEXT NOT NULL,
  side TEXT NOT NULL,
  base TEXT NOT NULL DEFAULT 'SUI',
  quote TEXT NOT NULL DEFAULT 'USDC',
  qty REAL NOT NULL,
  price REAL NOT NULL,
  notional_usdc REAL NOT NULL,
  fee_usdc REAL NOT NULL DEFAULT 0,
  tx_digest TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_doc ON trades(doc_id, created_at);

CREATE TABLE IF NOT EXISTS price_cache (
  pair TEXT PRIMARY KEY,
  mid_price REAL NOT NULL,
  bid REAL NOT NULL DEFAULT 0,
  ask REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'deepbook',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conditional_orders (
  order_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  type TEXT NOT NULL,
  base TEXT NOT NULL DEFAULT 'SUI',
  quote TEXT NOT NULL DEFAULT 'USDC',
  trigger_price REAL NOT NULL,
  qty REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  triggered_cmd_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conditional_orders_doc ON conditional_orders(doc_id, status);

CREATE TABLE IF NOT EXISTS channel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  app_session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  amount REAL,
  asset TEXT,
  from_addr TEXT,
  to_addr TEXT,
  state_hash TEXT,
  settlement_tx TEXT,
  details TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channel_events_doc ON channel_events(doc_id, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_events_session ON channel_events(app_session_id, version);
`;
