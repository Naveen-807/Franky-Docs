import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

export type DocRow = {
  doc_id: string;
  name: string | null;
  status: string;
  evm_address: string | null;
  sui_address: string | null;
  ens_name: string | null;
  policy_source: string | null;
  last_user_hash: string | null;
  created_at: number;
  updated_at: number;
};

export type CommandRow = {
  cmd_id: string;
  doc_id: string;
  raw_command: string;
  parsed_json: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  yellow_intent_id: string | null;
  sui_tx_digest: string | null;
  arc_tx_hash: string | null;
  result_text: string | null;
  error_text: string | null;
};

export type DocSettingsRow = {
  doc_id: string;
  quorum: number;
  created_at: number;
  updated_at: number;
};

export type SignerRow = {
  doc_id: string;
  address: string;
  weight: number;
  created_at: number;
  updated_at: number;
};

export type CommandApprovalRow = {
  doc_id: string;
  cmd_id: string;
  signer_address: string;
  decision: string;
  created_at: number;
};

export type YellowSessionRow = {
  doc_id: string;
  app_session_id: string;
  definition_json: string;
  version: number;
  status: string;
  allocations_json: string;
  created_at: number;
  updated_at: number;
};

export type YellowSessionKeyRow = {
  doc_id: string;
  signer_address: string;
  session_key_address: string;
  encrypted_session_key_private: string;
  expires_at: number;
  allowances_json: string | null;
  jwt_token: string | null;
  created_at: number;
  updated_at: number;
};

export type CircleWalletRow = {
  doc_id: string;
  wallet_set_id: string | null;
  wallet_id: string;
  wallet_address: string;
  created_at: number;
  updated_at: number;
};

export type WalletConnectSessionRow = {
  topic: string;
  doc_id: string;
  peer_name: string | null;
  peer_url: string | null;
  peer_icons: string | null;
  chains: string | null;
  status: string;
  created_at: number;
  updated_at: number;
};

export type WalletConnectRequestRow = {
  topic: string;
  request_id: number;
  doc_id: string;
  cmd_id: string;
  method: string;
  params_json: string;
  status: string;
  created_at: number;
  updated_at: number;
};

export type ScheduleRow = {
  schedule_id: string;
  doc_id: string;
  interval_hours: number;
  inner_command: string;
  next_run_at: number;
  status: string;
  total_runs: number;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
};

export type DocConfigRow = {
  doc_id: string;
  key: string;
  value: string;
  created_at: number;
  updated_at: number;
};

export type AgentActivityRow = {
  id: number;
  doc_id: string;
  type: string;
  details: string;
  created_at: number;
};

export type TradeRow = {
  trade_id: string;
  doc_id: string;
  cmd_id: string;
  side: string;
  base: string;
  quote: string;
  qty: number;
  price: number;
  notional_usdc: number;
  fee_usdc: number;
  tx_digest: string | null;
  created_at: number;
};

export type PriceCacheRow = {
  pair: string;
  mid_price: number;
  bid: number;
  ask: number;
  source: string;
  updated_at: number;
};

export type ConditionalOrderRow = {
  order_id: string;
  doc_id: string;
  type: string;
  base: string;
  quote: string;
  trigger_price: number;
  qty: number;
  status: string;
  triggered_cmd_id: string | null;
  created_at: number;
  updated_at: number;
};

export type BchTokenRow = {
  id: number;
  doc_id: string;
  token_category: string;
  ticker: string;
  name: string;
  supply: string;
  genesis_txid: string;
  created_at: number;
};

export type BchVaultRow = {
  vault_id: string;
  doc_id: string;
  contract_address: string;
  beneficiary: string;
  unlock_time: number;
  amount_sats: number;
  redeem_script: string;
  fund_txid: string;
  status: string;
  claim_txid: string | null;
  created_at: number;
};

export type BchMultisigWalletRow = {
  wallet_id: string;
  doc_id: string;
  script_address: string;
  redeem_script: string;
  threshold: number;
  pubkeys_json: string;
  created_at: number;
};

export type BchPaymentRequestRow = {
  request_id: string;
  doc_id: string;
  address: string;
  amount_sats: number;
  description: string;
  status: string;
  expires_at: number;
  paid_txid: string | null;
  created_at: number;
};

export type BchNftListingRow = {
  listing_id: string;
  doc_id: string;
  token_category: string;
  token_name: string;
  price_sats: number;
  seller_address: string;
  status: string;
  buyer_doc_id: string | null;
  buy_txid: string | null;
  created_at: number;
};

export class Repo {
  private db: Database.Database;

  constructor(dbFile: string) {
    const dir = path.dirname(dbFile);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbFile);
    this.db.exec(SCHEMA_SQL);

    // --- Migrations for existing DBs ---
    try {
      this.db.exec(`ALTER TABLE yellow_sessions ADD COLUMN allocations_json TEXT DEFAULT '[]'`);
    } catch { /* column already exists */ }
    // channel_events table (added for Yellow channel history)
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS channel_events (
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
      )`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_channel_events_doc ON channel_events(doc_id, created_at)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_channel_events_session ON channel_events(app_session_id, version)`);
    } catch { /* already exists */ }
  }

  close() {
    this.db.close();
  }

  upsertDoc(params: { docId: string; name?: string }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO docs(doc_id,name,created_at,updated_at)
         VALUES(?,?,?,?)
         ON CONFLICT(doc_id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`
      )
      .run(params.docId, params.name ?? null, now, now);
  }

  removeDoc(docId: string) {
    this.db.prepare(`DELETE FROM docs WHERE doc_id=?`).run(docId);
    this.db.prepare(`DELETE FROM commands WHERE doc_id=?`).run(docId);
  }

  listDocs(): DocRow[] {
    return this.db.prepare(`SELECT * FROM docs ORDER BY updated_at DESC`).all() as DocRow[];
  }

  getDoc(docId: string): DocRow | undefined {
    return this.db.prepare(`SELECT * FROM docs WHERE doc_id=?`).get(docId) as DocRow | undefined;
  }

  setDocLastUserHash(docId: string, hash: string) {
    const now = Date.now();
    this.db.prepare(`UPDATE docs SET last_user_hash=?, updated_at=? WHERE doc_id=?`).run(hash, now, docId);
  }

  setDocAddresses(docId: string, params: { evmAddress: string; secondaryAddress: string }) {
    const now = Date.now();
    this.db
      .prepare(`UPDATE docs SET evm_address=?, sui_address=?, updated_at=? WHERE doc_id=?`)
      .run(params.evmAddress, params.secondaryAddress, now, docId);
  }

  setDocPolicy(docId: string, params: { policySource: string; ensName?: string | null }) {
    const now = Date.now();
    this.db
      .prepare(`UPDATE docs SET policy_source=?, ens_name=?, updated_at=? WHERE doc_id=?`)
      .run(params.policySource, params.ensName ?? null, now, docId);
  }

  upsertDocSettings(docId: string, params: { quorum?: number }) {
    const now = Date.now();
    const existing = this.getDocSettings(docId);
    const quorum = params.quorum ?? existing?.quorum ?? 1;
    this.db
      .prepare(
        `INSERT INTO doc_settings(doc_id,quorum,created_at,updated_at)
         VALUES(?,?,?,?)
         ON CONFLICT(doc_id) DO UPDATE SET quorum=excluded.quorum, updated_at=excluded.updated_at`
      )
      .run(docId, quorum, now, now);
  }

  getDocSettings(docId: string): DocSettingsRow | undefined {
    return this.db.prepare(`SELECT * FROM doc_settings WHERE doc_id=?`).get(docId) as DocSettingsRow | undefined;
  }

  getDocQuorum(docId: string): number {
    return this.getDocSettings(docId)?.quorum ?? 1;
  }

  setDocQuorum(docId: string, quorum: number) {
    this.upsertDocSettings(docId, { quorum });
  }

  upsertSigner(params: { docId: string; address: string; weight: number }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO signers(doc_id,address,weight,created_at,updated_at)
         VALUES(?,?,?,?,?)
         ON CONFLICT(doc_id,address) DO UPDATE SET weight=excluded.weight, updated_at=excluded.updated_at`
      )
      .run(params.docId, params.address, params.weight, now, now);
  }

  deleteSigner(params: { docId: string; address: string }) {
    this.db.prepare(`DELETE FROM signers WHERE doc_id=? AND address=?`).run(params.docId, params.address);
  }

  listSigners(docId: string): SignerRow[] {
    return this.db.prepare(`SELECT * FROM signers WHERE doc_id=? ORDER BY weight DESC, updated_at DESC`).all(docId) as SignerRow[];
  }

  recordCommandApproval(params: { docId: string; cmdId: string; signerAddress: string; decision: "APPROVE" | "REJECT" }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO command_approvals(doc_id,cmd_id,signer_address,decision,created_at)
         VALUES(?,?,?,?,?)
         ON CONFLICT(doc_id,cmd_id,signer_address) DO UPDATE SET decision=excluded.decision, created_at=excluded.created_at`
      )
      .run(params.docId, params.cmdId, params.signerAddress, params.decision, now);
  }

  getCommandApprovalDecision(params: { docId: string; cmdId: string; signerAddress: string }): CommandApprovalRow | undefined {
    return this.db
      .prepare(`SELECT * FROM command_approvals WHERE doc_id=? AND cmd_id=? AND signer_address=?`)
      .get(params.docId, params.cmdId, params.signerAddress) as CommandApprovalRow | undefined;
  }

  listCommandApprovals(params: { docId: string; cmdId: string }): CommandApprovalRow[] {
    return this.db
      .prepare(`SELECT * FROM command_approvals WHERE doc_id=? AND cmd_id=? ORDER BY created_at ASC`)
      .all(params.docId, params.cmdId) as CommandApprovalRow[];
  }

  clearCommandApprovals(params: { docId: string; cmdId: string }) {
    this.db.prepare(`DELETE FROM command_approvals WHERE doc_id=? AND cmd_id=?`).run(params.docId, params.cmdId);
  }

  upsertYellowSession(params: { docId: string; appSessionId: string; definitionJson: string; version?: number; status?: string; allocationsJson?: string }) {
    const now = Date.now();
    const version = params.version ?? this.getYellowSession(params.docId)?.version ?? 0;
    const status = params.status ?? this.getYellowSession(params.docId)?.status ?? "OPEN";
    const allocationsJson = params.allocationsJson ?? this.getYellowSession(params.docId)?.allocations_json ?? "[]";
    this.db
      .prepare(
        `INSERT INTO yellow_sessions(doc_id,app_session_id,definition_json,version,status,allocations_json,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(doc_id) DO UPDATE SET
           app_session_id=excluded.app_session_id,
           definition_json=excluded.definition_json,
           version=excluded.version,
           status=excluded.status,
           allocations_json=excluded.allocations_json,
           updated_at=excluded.updated_at`
      )
      .run(params.docId, params.appSessionId, params.definitionJson, version, status, allocationsJson, now, now);
  }

  getYellowSession(docId: string): YellowSessionRow | undefined {
    return this.db.prepare(`SELECT * FROM yellow_sessions WHERE doc_id=?`).get(docId) as YellowSessionRow | undefined;
  }

  setYellowSessionVersion(params: { docId: string; version: number; status?: string; allocationsJson?: string }) {
    const now = Date.now();
    if (params.allocationsJson) {
      this.db
        .prepare(`UPDATE yellow_sessions SET version=?, status=COALESCE(?, status), allocations_json=?, updated_at=? WHERE doc_id=?`)
        .run(params.version, params.status ?? null, params.allocationsJson, now, params.docId);
    } else {
      this.db
        .prepare(`UPDATE yellow_sessions SET version=?, status=COALESCE(?, status), updated_at=? WHERE doc_id=?`)
        .run(params.version, params.status ?? null, now, params.docId);
    }
  }

  upsertYellowSessionKey(params: {
    docId: string;
    signerAddress: string;
    sessionKeyAddress: string;
    encryptedSessionKeyPrivate: string;
    expiresAt: number;
    allowancesJson?: string | null;
    jwtToken?: string | null;
  }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO yellow_session_keys(
          doc_id,signer_address,session_key_address,encrypted_session_key_private,expires_at,allowances_json,jwt_token,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(doc_id,signer_address) DO UPDATE SET
          session_key_address=excluded.session_key_address,
          encrypted_session_key_private=excluded.encrypted_session_key_private,
          expires_at=excluded.expires_at,
          allowances_json=excluded.allowances_json,
          jwt_token=excluded.jwt_token,
          updated_at=excluded.updated_at`
      )
      .run(
        params.docId,
        params.signerAddress,
        params.sessionKeyAddress,
        params.encryptedSessionKeyPrivate,
        params.expiresAt,
        params.allowancesJson ?? null,
        params.jwtToken ?? null,
        now,
        now
      );
  }

  getYellowSessionKey(params: { docId: string; signerAddress: string }): YellowSessionKeyRow | undefined {
    return this.db
      .prepare(`SELECT * FROM yellow_session_keys WHERE doc_id=? AND signer_address=?`)
      .get(params.docId, params.signerAddress) as YellowSessionKeyRow | undefined;
  }

  listYellowSessionKeys(docId: string): YellowSessionKeyRow[] {
    return this.db
      .prepare(`SELECT * FROM yellow_session_keys WHERE doc_id=? ORDER BY updated_at DESC`)
      .all(docId) as YellowSessionKeyRow[];
  }

  // --- Channel Events (audit trail for state transitions) ---

  insertChannelEvent(params: {
    docId: string;
    appSessionId: string;
    eventType: string;
    version: number;
    amount?: number;
    asset?: string;
    fromAddr?: string;
    toAddr?: string;
    stateHash?: string;
    settlementTx?: string;
    details?: string;
  }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO channel_events(doc_id,app_session_id,event_type,version,amount,asset,from_addr,to_addr,state_hash,settlement_tx,details,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        params.docId,
        params.appSessionId,
        params.eventType,
        params.version,
        params.amount ?? null,
        params.asset ?? null,
        params.fromAddr ?? null,
        params.toAddr ?? null,
        params.stateHash ?? null,
        params.settlementTx ?? null,
        params.details ?? "",
        now
      );
  }

  listChannelEvents(docId: string, limit = 20): Array<{
    id: number;
    doc_id: string;
    app_session_id: string;
    event_type: string;
    version: number;
    amount: number | null;
    asset: string | null;
    from_addr: string | null;
    to_addr: string | null;
    state_hash: string | null;
    settlement_tx: string | null;
    details: string;
    created_at: number;
  }> {
    return this.db
      .prepare(`SELECT * FROM channel_events WHERE doc_id=? ORDER BY created_at DESC LIMIT ?`)
      .all(docId, limit) as any[];
  }

  countChannelEvents(docId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM channel_events WHERE doc_id=?`)
      .get(docId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  upsertCircleWallet(params: { docId: string; walletSetId?: string | null; walletId: string; walletAddress: string }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO circle_wallets(doc_id,wallet_set_id,wallet_id,wallet_address,created_at,updated_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(doc_id) DO UPDATE SET
           wallet_set_id=excluded.wallet_set_id,
           wallet_id=excluded.wallet_id,
           wallet_address=excluded.wallet_address,
           updated_at=excluded.updated_at`
      )
      .run(params.docId, params.walletSetId ?? null, params.walletId, params.walletAddress, now, now);
  }

  getCircleWallet(docId: string): CircleWalletRow | undefined {
    return this.db.prepare(`SELECT * FROM circle_wallets WHERE doc_id=?`).get(docId) as CircleWalletRow | undefined;
  }

  upsertWalletConnectSession(params: {
    docId: string;
    topic: string;
    peerName?: string | null;
    peerUrl?: string | null;
    peerIcons?: string | null;
    chains?: string | null;
    status: string;
  }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO walletconnect_sessions(
          topic,doc_id,peer_name,peer_url,peer_icons,chains,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(topic) DO UPDATE SET
          doc_id=excluded.doc_id,
          peer_name=excluded.peer_name,
          peer_url=excluded.peer_url,
          peer_icons=excluded.peer_icons,
          chains=excluded.chains,
          status=excluded.status,
          updated_at=excluded.updated_at`
      )
      .run(
        params.topic,
        params.docId,
        params.peerName ?? null,
        params.peerUrl ?? null,
        params.peerIcons ?? null,
        params.chains ?? null,
        params.status,
        now,
        now
      );
  }

  setWalletConnectSessionStatus(topic: string, status: string) {
    const now = Date.now();
    this.db.prepare(`UPDATE walletconnect_sessions SET status=?, updated_at=? WHERE topic=?`).run(status, now, topic);
  }

  getWalletConnectSession(topic: string): WalletConnectSessionRow | undefined {
    return this.db.prepare(`SELECT * FROM walletconnect_sessions WHERE topic=?`).get(topic) as
      | WalletConnectSessionRow
      | undefined;
  }

  listWalletConnectSessions(docId: string): WalletConnectSessionRow[] {
    return this.db
      .prepare(`SELECT * FROM walletconnect_sessions WHERE doc_id=? ORDER BY updated_at DESC`)
      .all(docId) as WalletConnectSessionRow[];
  }

  upsertWalletConnectRequest(params: {
    docId: string;
    cmdId: string;
    topic: string;
    requestId: number;
    method: string;
    paramsJson: string;
    status: string;
  }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO walletconnect_requests(
          topic,request_id,doc_id,cmd_id,method,params_json,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(topic,request_id) DO UPDATE SET
          doc_id=excluded.doc_id,
          cmd_id=excluded.cmd_id,
          method=excluded.method,
          params_json=excluded.params_json,
          status=excluded.status,
          updated_at=excluded.updated_at`
      )
      .run(params.topic, params.requestId, params.docId, params.cmdId, params.method, params.paramsJson, params.status, now, now);
  }

  setWalletConnectRequestStatus(params: { topic: string; requestId: number; status: string }) {
    const now = Date.now();
    this.db
      .prepare(`UPDATE walletconnect_requests SET status=?, updated_at=? WHERE topic=? AND request_id=?`)
      .run(params.status, now, params.topic, params.requestId);
  }

  getWalletConnectRequestByCmdId(cmdId: string): WalletConnectRequestRow | undefined {
    return this.db
      .prepare(`SELECT * FROM walletconnect_requests WHERE cmd_id=?`)
      .get(cmdId) as WalletConnectRequestRow | undefined;
  }

  getWalletConnectRequest(topic: string, requestId: number): WalletConnectRequestRow | undefined {
    return this.db
      .prepare(`SELECT * FROM walletconnect_requests WHERE topic=? AND request_id=?`)
      .get(topic, requestId) as WalletConnectRequestRow | undefined;
  }

  upsertSecrets(docId: string, encryptedBlob: string) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO secrets(doc_id,encrypted_blob,created_at,updated_at)
         VALUES(?,?,?,?)
         ON CONFLICT(doc_id) DO UPDATE SET encrypted_blob=excluded.encrypted_blob, updated_at=excluded.updated_at`
      )
      .run(docId, encryptedBlob, now, now);
  }

  getSecrets(docId: string): { encrypted_blob: string } | undefined {
    return this.db.prepare(`SELECT encrypted_blob FROM secrets WHERE doc_id=?`).get(docId) as
      | { encrypted_blob: string }
      | undefined;
  }

  insertCommand(cmd: Omit<CommandRow, "created_at" | "updated_at">) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO commands(
          cmd_id,doc_id,raw_command,parsed_json,status,created_at,updated_at,
          yellow_intent_id,sui_tx_digest,arc_tx_hash,result_text,error_text
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        cmd.cmd_id,
        cmd.doc_id,
        cmd.raw_command,
        cmd.parsed_json,
        cmd.status,
        now,
        now,
        cmd.yellow_intent_id,
        cmd.sui_tx_digest,
        cmd.arc_tx_hash,
        cmd.result_text,
        cmd.error_text
      );
  }

  upsertCommand(cmd: Omit<CommandRow, "created_at" | "updated_at">) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO commands(
          cmd_id,doc_id,raw_command,parsed_json,status,created_at,updated_at,
          yellow_intent_id,sui_tx_digest,arc_tx_hash,result_text,error_text
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(cmd_id) DO UPDATE SET
          raw_command=excluded.raw_command,
          parsed_json=excluded.parsed_json,
          status=excluded.status,
          updated_at=excluded.updated_at,
          yellow_intent_id=COALESCE(excluded.yellow_intent_id, commands.yellow_intent_id),
          sui_tx_digest=COALESCE(excluded.sui_tx_digest, commands.sui_tx_digest),
          arc_tx_hash=COALESCE(excluded.arc_tx_hash, commands.arc_tx_hash),
          result_text=COALESCE(excluded.result_text, commands.result_text),
          error_text=COALESCE(excluded.error_text, commands.error_text)`
      )
      .run(
        cmd.cmd_id,
        cmd.doc_id,
        cmd.raw_command,
        cmd.parsed_json,
        cmd.status,
        now,
        now,
        cmd.yellow_intent_id,
        cmd.sui_tx_digest,
        cmd.arc_tx_hash,
        cmd.result_text,
        cmd.error_text
      );
  }

  getCommand(cmdId: string): CommandRow | undefined {
    return this.db.prepare(`SELECT * FROM commands WHERE cmd_id=?`).get(cmdId) as CommandRow | undefined;
  }

  getNextApprovedCommand(): CommandRow | undefined {
    return this.db
      .prepare(`SELECT * FROM commands WHERE status='APPROVED' ORDER BY created_at ASC LIMIT 1`)
      .get() as CommandRow | undefined;
  }

  /** Auto-fail APPROVED/PENDING_APPROVAL commands whose created_at is older than the given threshold (epoch ms). Returns count. */
  failStaleApprovedCommands(thresholdMs: number): number {
    const result = this.db
      .prepare(`UPDATE commands SET status='FAILED', error_text='Auto-failed: stale command (>1h)', updated_at=? WHERE status IN ('APPROVED','PENDING_APPROVAL') AND created_at < ?`)
      .run(Date.now(), thresholdMs);
    return result.changes;
  }

  listRecentCommands(docId: string, limit = 20): CommandRow[] {
    return this.db
      .prepare(`SELECT * FROM commands WHERE doc_id=? ORDER BY updated_at DESC LIMIT ?`)
      .all(docId, limit) as CommandRow[];
  }

  setCommandStatus(cmdId: string, status: string, extra?: { resultText?: string | null; errorText?: string | null }) {
    const now = Date.now();
    this.db
      .prepare(`UPDATE commands SET status=?, result_text=COALESCE(?, result_text), error_text=COALESCE(?, error_text), updated_at=? WHERE cmd_id=?`)
      .run(status, extra?.resultText ?? null, extra?.errorText ?? null, now, cmdId);
  }

  setCommandExecutionIds(cmdId: string, params: { legacyIntentId?: string; legacySecondaryTx?: string; txId?: string }) {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE commands SET
          yellow_intent_id=COALESCE(?, yellow_intent_id),
          sui_tx_digest=COALESCE(?, sui_tx_digest),
          arc_tx_hash=COALESCE(?, arc_tx_hash),
          updated_at=?
         WHERE cmd_id=?`
      )
      .run(params.legacyIntentId ?? null, params.legacySecondaryTx ?? null, params.txId ?? null, now, cmdId);
  }

  // --- Schedule CRUD ---

  insertSchedule(params: {
    scheduleId: string;
    docId: string;
    intervalHours: number;
    innerCommand: string;
    nextRunAt: number;
  }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO schedules(schedule_id,doc_id,interval_hours,inner_command,next_run_at,status,total_runs,last_run_at,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`
      )
      .run(params.scheduleId, params.docId, params.intervalHours, params.innerCommand, params.nextRunAt, "ACTIVE", 0, null, now, now);
  }

  getSchedule(scheduleId: string): ScheduleRow | undefined {
    return this.db.prepare(`SELECT * FROM schedules WHERE schedule_id=?`).get(scheduleId) as ScheduleRow | undefined;
  }

  listSchedules(docId: string): ScheduleRow[] {
    return this.db.prepare(`SELECT * FROM schedules WHERE doc_id=? ORDER BY created_at DESC`).all(docId) as ScheduleRow[];
  }

  listDueSchedules(): ScheduleRow[] {
    const now = Date.now();
    return this.db
      .prepare(`SELECT * FROM schedules WHERE status='ACTIVE' AND next_run_at <= ? ORDER BY next_run_at ASC`)
      .all(now) as ScheduleRow[];
  }

  advanceSchedule(scheduleId: string) {
    const now = Date.now();
    const schedule = this.getSchedule(scheduleId);
    if (!schedule) return;
    const nextRunAt = now + schedule.interval_hours * 3600_000;
    this.db
      .prepare(
        `UPDATE schedules SET next_run_at=?, total_runs=total_runs+1, last_run_at=?, updated_at=? WHERE schedule_id=?`
      )
      .run(nextRunAt, now, now, scheduleId);
  }

  cancelSchedule(scheduleId: string) {
    const now = Date.now();
    this.db.prepare(`UPDATE schedules SET status='CANCELLED', updated_at=? WHERE schedule_id=?`).run(now, scheduleId);
  }

  // --- Daily spend query ---

  getDailySpendUsdc(docId: string): number {
    const since = Date.now() - 86400_000;
    const result = this.db
      .prepare(
        `SELECT SUM(
           CASE
             WHEN parsed_json IS NOT NULL AND (
               json_extract(parsed_json, '$.type') = 'PAYOUT' OR
               json_extract(parsed_json, '$.type') = 'PAYOUT_SPLIT' OR
               json_extract(parsed_json, '$.type') = 'BRIDGE'
             )
             THEN COALESCE(json_extract(parsed_json, '$.amountUsdc'), 0)
             ELSE 0
           END
         ) as total
         FROM commands
         WHERE doc_id=? AND status='EXECUTED' AND updated_at >= ?`
      )
      .get(docId, since) as { total: number | null } | undefined;
    return result?.total ?? 0;
  }

  // --- Pending WC requests ---

  listPendingWalletConnectRequests(docId: string): WalletConnectRequestRow[] {
    return this.db
      .prepare(`SELECT * FROM walletconnect_requests WHERE doc_id=? AND status='PENDING' ORDER BY created_at ASC`)
      .all(docId) as WalletConnectRequestRow[];
  }

  // --- Doc Config (agent configuration) ---

  setDocConfig(docId: string, key: string, value: string) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO doc_config(doc_id, key, value, created_at, updated_at)
         VALUES(?,?,?,?,?)
         ON CONFLICT(doc_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
      )
      .run(docId, key, value, now, now);
  }

  getDocConfig(docId: string, key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM doc_config WHERE doc_id=? AND key=?`).get(docId, key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  getDocCounter(docId: string, key: string): number {
    const value = this.getDocConfig(docId, key);
    const num = value === undefined ? 0 : Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  incrementDocCounter(docId: string, key: string, delta: number = 1): number {
    const next = this.getDocCounter(docId, key) + delta;
    this.setDocConfig(docId, key, String(next));
    return next;
  }

  listDocConfig(docId: string): DocConfigRow[] {
    return this.db.prepare(`SELECT * FROM doc_config WHERE doc_id=? ORDER BY key`).all(docId) as DocConfigRow[];
  }

  // --- Pending commands for agent decision engine ---

  listPendingCommands(docId: string): CommandRow[] {
    return this.db
      .prepare(`SELECT * FROM commands WHERE doc_id=? AND status IN ('PENDING_APPROVAL','APPROVED') ORDER BY created_at ASC`)
      .all(docId) as CommandRow[];
  }

  listStaleCommands(maxAgeMs: number = 3600_000): CommandRow[] {
    const cutoff = Date.now() - maxAgeMs;
    return this.db
      .prepare(`SELECT * FROM commands WHERE status IN ('PENDING_APPROVAL','APPROVED') AND created_at < ? ORDER BY created_at ASC`)
      .all(cutoff) as CommandRow[];
  }

  // --- Agent activity log ---

  insertAgentActivity(docId: string, type: string, details: string) {
    const now = Date.now();
    this.db
      .prepare(`INSERT INTO agent_activity(doc_id, type, details, created_at) VALUES(?,?,?,?)`)
      .run(docId, type, details, now);
  }

  listAgentActivity(docId: string, limit = 50): AgentActivityRow[] {
    return this.db
      .prepare(`SELECT * FROM agent_activity WHERE doc_id=? ORDER BY created_at DESC LIMIT ?`)
      .all(docId, limit) as AgentActivityRow[];
  }

  // --- Trade P&L tracking ---

  insertTrade(params: {
    tradeId: string;
    docId: string;
    cmdId: string;
    side: string;
    base: string;
    quote: string;
    qty: number;
    price: number;
    notionalUsdc: number;
    feeUsdc?: number;
    txDigest?: string | null;
  }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO trades(trade_id,doc_id,cmd_id,side,base,quote,qty,price,notional_usdc,fee_usdc,tx_digest,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        params.tradeId, params.docId, params.cmdId, params.side,
        params.base, params.quote, params.qty, params.price,
        params.notionalUsdc, params.feeUsdc ?? 0, params.txDigest ?? null, now
      );
  }

  listTrades(docId: string, limit = 100): TradeRow[] {
    return this.db
      .prepare(`SELECT * FROM trades WHERE doc_id=? ORDER BY created_at DESC LIMIT ?`)
      .all(docId, limit) as TradeRow[];
  }

  getTradeStats(docId: string): { totalBuys: number; totalSells: number; totalBuyUsdc: number; totalSellUsdc: number; totalFees: number; netPnl: number } {
    const result = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN side='BUY' THEN qty ELSE 0 END), 0) as totalBuys,
           COALESCE(SUM(CASE WHEN side='SELL' THEN qty ELSE 0 END), 0) as totalSells,
           COALESCE(SUM(CASE WHEN side='BUY' THEN notional_usdc ELSE 0 END), 0) as totalBuyUsdc,
           COALESCE(SUM(CASE WHEN side='SELL' THEN notional_usdc ELSE 0 END), 0) as totalSellUsdc,
           COALESCE(SUM(fee_usdc), 0) as totalFees
         FROM trades WHERE doc_id=?`
      )
      .get(docId) as { totalBuys: number; totalSells: number; totalBuyUsdc: number; totalSellUsdc: number; totalFees: number };
    return {
      ...result,
      netPnl: result.totalSellUsdc - result.totalBuyUsdc - result.totalFees
    };
  }

  // --- Price oracle cache ---

  upsertPrice(pair: string, midPrice: number, bid: number, ask: number, source = "deepbook") {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO price_cache(pair,mid_price,bid,ask,source,updated_at) VALUES(?,?,?,?,?,?)
         ON CONFLICT(pair) DO UPDATE SET mid_price=excluded.mid_price, bid=excluded.bid, ask=excluded.ask, source=excluded.source, updated_at=excluded.updated_at`
      )
      .run(pair, midPrice, bid, ask, source, now);
  }

  getPrice(pair: string): PriceCacheRow | undefined {
    return this.db.prepare(`SELECT * FROM price_cache WHERE pair=?`).get(pair) as PriceCacheRow | undefined;
  }

  // --- Conditional orders (stop-loss / take-profit) ---

  insertConditionalOrder(params: {
    orderId: string;
    docId: string;
    type: string;
    base: string;
    quote: string;
    triggerPrice: number;
    qty: number;
  }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO conditional_orders(order_id,doc_id,type,base,quote,trigger_price,qty,status,triggered_cmd_id,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,'ACTIVE',NULL,?,?)`
      )
      .run(params.orderId, params.docId, params.type, params.base, params.quote, params.triggerPrice, params.qty, now, now);
  }

  listActiveConditionalOrders(docId?: string): ConditionalOrderRow[] {
    if (docId) {
      return this.db
        .prepare(`SELECT * FROM conditional_orders WHERE doc_id=? AND status='ACTIVE' ORDER BY created_at ASC`)
        .all(docId) as ConditionalOrderRow[];
    }
    return this.db
      .prepare(`SELECT * FROM conditional_orders WHERE status='ACTIVE' ORDER BY created_at ASC`)
      .all() as ConditionalOrderRow[];
  }

  triggerConditionalOrder(orderId: string, cmdId: string) {
    const now = Date.now();
    this.db
      .prepare(`UPDATE conditional_orders SET status='TRIGGERED', triggered_cmd_id=?, updated_at=? WHERE order_id=?`)
      .run(cmdId, now, orderId);
  }

  cancelConditionalOrder(orderId: string) {
    const now = Date.now();
    this.db
      .prepare(`UPDATE conditional_orders SET status='CANCELLED', updated_at=? WHERE order_id=?`)
      .run(now, orderId);
  }

  // --- BCH CashTokens ---

  insertBchToken(params: { docId: string; tokenCategory: string; ticker: string; name: string; supply: string; genesisTxid: string }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO bch_tokens(doc_id, token_category, ticker, name, supply, genesis_txid, created_at)
         VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(doc_id, token_category) DO UPDATE SET
           ticker=excluded.ticker,
           name=excluded.name,
           supply=excluded.supply,
           genesis_txid=excluded.genesis_txid`
      )
      .run(params.docId, params.tokenCategory, params.ticker, params.name, params.supply, params.genesisTxid, now);
  }

  getBchTokens(docId: string): BchTokenRow[] {
    return this.db.prepare(`SELECT * FROM bch_tokens WHERE doc_id=? ORDER BY created_at DESC`).all(docId) as BchTokenRow[];
  }

  getBchToken(docId: string, tokenCategory: string): BchTokenRow | undefined {
    return this.db.prepare(`SELECT * FROM bch_tokens WHERE doc_id=? AND token_category=?`).get(docId, tokenCategory) as BchTokenRow | undefined;
  }

  // --- BCH Vaults ---

  insertBchVault(params: { vaultId: string; docId: string; contractAddress: string; beneficiary: string; unlockTime: number; amountSats: number; redeemScript: string; fundTxid: string }) {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO bch_vaults(vault_id, doc_id, contract_address, beneficiary, unlock_time, amount_sats, redeem_script, fund_txid, status, created_at)
       VALUES(?,?,?,?,?,?,?,?,'LOCKED',?)`
    ).run(params.vaultId, params.docId, params.contractAddress, params.beneficiary, params.unlockTime, params.amountSats, params.redeemScript, params.fundTxid, now);
  }

  getBchVault(vaultId: string): BchVaultRow | undefined {
    return this.db.prepare(`SELECT * FROM bch_vaults WHERE vault_id=?`).get(vaultId) as BchVaultRow | undefined;
  }

  getBchVaultsByDoc(docId: string): BchVaultRow[] {
    return this.db.prepare(`SELECT * FROM bch_vaults WHERE doc_id=? ORDER BY created_at DESC`).all(docId) as BchVaultRow[];
  }

  updateBchVaultStatus(vaultId: string, status: string, claimTxid?: string) {
    this.db.prepare(`UPDATE bch_vaults SET status=?, claim_txid=? WHERE vault_id=?`).run(status, claimTxid ?? null, vaultId);
  }

  // --- BCH Multisig ---

  insertBchMultisig(params: { walletId: string; docId: string; scriptAddress: string; redeemScript: string; threshold: number; pubkeys: string[] }) {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO bch_multisig_wallets(wallet_id, doc_id, script_address, redeem_script, threshold, pubkeys_json, created_at)
       VALUES(?,?,?,?,?,?,?)`
    ).run(params.walletId, params.docId, params.scriptAddress, params.redeemScript, params.threshold, JSON.stringify(params.pubkeys), now);
  }

  getBchMultisig(walletId: string): BchMultisigWalletRow | undefined {
    return this.db.prepare(`SELECT * FROM bch_multisig_wallets WHERE wallet_id=?`).get(walletId) as BchMultisigWalletRow | undefined;
  }

  getBchMultisigByDoc(docId: string): BchMultisigWalletRow[] {
    return this.db.prepare(`SELECT * FROM bch_multisig_wallets WHERE doc_id=? ORDER BY created_at DESC`).all(docId) as BchMultisigWalletRow[];
  }

  // --- BCH Payment Requests ---

  insertBchPaymentRequest(params: { requestId: string; docId: string; address: string; amountSats: number; description: string; expiresAt: number }) {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO bch_payment_requests(request_id, doc_id, address, amount_sats, description, status, expires_at, created_at)
       VALUES(?,?,?,?,?,'pending',?,?)`
    ).run(params.requestId, params.docId, params.address, params.amountSats, params.description, params.expiresAt, now);
  }

  getBchPaymentRequest(requestId: string): BchPaymentRequestRow | undefined {
    return this.db.prepare(`SELECT * FROM bch_payment_requests WHERE request_id=?`).get(requestId) as BchPaymentRequestRow | undefined;
  }

  getBchPaymentRequestsByDoc(docId: string): BchPaymentRequestRow[] {
    return this.db.prepare(`SELECT * FROM bch_payment_requests WHERE doc_id=? ORDER BY created_at DESC`).all(docId) as BchPaymentRequestRow[];
  }

  updateBchPaymentRequestPaid(requestId: string, paidTxid: string) {
    this.db.prepare(`UPDATE bch_payment_requests SET status='paid', paid_txid=? WHERE request_id=?`).run(paidTxid, requestId);
  }

  // --- BCH NFT Listings ---

  insertBchNftListing(params: { listingId: string; docId: string; tokenCategory: string; tokenName: string; priceSats: number; sellerAddress: string }) {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO bch_nft_listings(listing_id, doc_id, token_category, token_name, price_sats, seller_address, status, created_at)
       VALUES(?,?,?,?,?,?,'active',?)`
    ).run(params.listingId, params.docId, params.tokenCategory, params.tokenName, params.priceSats, params.sellerAddress, now);
  }

  getBchNftListing(listingId: string): BchNftListingRow | undefined {
    return this.db.prepare(`SELECT * FROM bch_nft_listings WHERE listing_id=?`).get(listingId) as BchNftListingRow | undefined;
  }

  getActiveBchNftListings(): BchNftListingRow[] {
    return this.db.prepare(`SELECT * FROM bch_nft_listings WHERE status='active' ORDER BY created_at DESC`).all() as BchNftListingRow[];
  }

  updateBchNftListingSold(listingId: string, buyerDocId: string, buyTxid: string) {
    this.db.prepare(`UPDATE bch_nft_listings SET status='sold', buyer_doc_id=?, buy_txid=? WHERE listing_id=?`).run(buyerDocId, buyTxid, listingId);
  }

  // ── Stats / Count Methods ──────────────────────────────────────────────────

  countPendingCommands(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM commands WHERE status='PENDING'`).get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  countActiveSchedules(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM schedules WHERE active=1`).get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  countBchVaults(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM bch_vaults`).get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  countBchMultisigWallets(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM bch_multisig_wallets`).get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  countBchPaymentRequests(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM bch_payment_requests`).get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  countActiveBchNftListings(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM bch_nft_listings WHERE status='active'`).get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }
}
