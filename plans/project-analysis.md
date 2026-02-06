# DocWallet Project Analysis

## Executive Summary

**DocWallet** is a sophisticated local agent that transforms Google Docs into a wallet and trading terminal. It provides a unique interface where users can execute blockchain commands through a Google Doc table, with multi-signature approval workflows and integration with multiple blockchain ecosystems.

---

## Architecture Overview

```mermaid
flowchart TB
    subgraph GoogleDocs[Google Docs Interface]
        ConfigTable[Config Table]
        CommandsTable[Commands Table]
        ChatTable[Chat Table]
        BalancesTable[Balances Table]
        AuditTable[Audit Table]
    end

    subgraph Engine[Core Engine]
        Discovery[Discovery Tick]
        Poll[Poll Tick]
        Executor[Executor Tick]
        Chat[Chat Tick]
        Balances[Balances Tick]
        Scheduler[Scheduler Tick]
    end

    subgraph WebServer[HTTP Server]
        JoinAPI[/join - Signer Registration]
        CmdAPI[/cmd - Command Approval]
        ActivityAPI[/activity - Live Feed]
        SessionsAPI[/sessions - WC Sessions]
    end

    subgraph Integrations[Blockchain Integrations]
        DeepBook[DeepBook V3 - Sui DEX]
        Yellow[Yellow NitroRPC]
        Arc[Arc Network - EVM]
        Circle[Circle Dev Wallets]
        WalletConnect[WalletConnect Bridge]
    end

    subgraph Storage[Data Layer]
        SQLite[(SQLite DB)]
        Secrets[Encrypted Secrets]
    end

    GoogleDocs --> Engine
    Engine --> Integrations
    Engine --> Storage
    WebServer --> Storage
    WebServer --> GoogleDocs
```

---

## Project Structure

```
FrankyDocs/
├── src/
│   ├── index.ts          # Application entry point
│   ├── config.ts         # Environment configuration with Zod validation
│   ├── engine.ts         # Core polling and execution engine
│   ├── server.ts         # HTTP server for approvals and UI
│   ├── core/
│   │   ├── commands.ts   # Command parsing with Zod schemas
│   │   ├── policy.ts     # ENS-based policy evaluation
│   │   └── state.ts      # Command state machine
│   ├── db/
│   │   ├── repo.ts       # SQLite repository layer
│   │   └── schema.ts     # Database schema definitions
│   ├── google/
│   │   ├── auth.ts       # Google service account auth
│   │   ├── clients.ts    # Google API client factories
│   │   ├── docs.ts       # Google Docs API helpers
│   │   ├── docwallet.ts  # DocWallet table operations
│   │   ├── drive.ts      # Google Drive discovery
│   │   └── template.ts   # Doc template management
│   ├── integrations/
│   │   ├── arc.ts        # Arc Network EVM client
│   │   ├── circle.ts     # Circle Dev-Controlled Wallets
│   │   ├── deepbook.ts   # Sui DeepBook V3 DEX
│   │   ├── ens.ts        # ENS policy resolution
│   │   ├── walletconnect.ts # WalletConnect bridge
│   │   └── yellow.ts     # Yellow NitroRPC client
│   ├── wallet/
│   │   ├── crypto.ts     # AES-256-GCM encryption
│   │   ├── evm.ts        # EVM wallet generation
│   │   ├── store.ts      # Encrypted wallet storage
│   │   └── sui.ts        # Sui wallet generation
│   ├── tools/
│   │   └── doctor.ts     # Diagnostic tool
│   ├── types/
│   │   ├── better-sqlite3.d.ts
│   │   └── websocket.d.ts
│   └── util/
│       ├── hash.ts       # SHA-256 hashing
│       └── sleep.ts      # Async sleep utility
├── test/
│   ├── commands.test.ts  # Command parsing tests
│   ├── policy.test.ts    # Policy evaluation tests
│   └── crypto.test.ts    # Encryption tests
└── demo/
    └── SCRIPT.md         # Demo script
```

---

## Core Components Analysis

### 1. Configuration System ([`src/config.ts`](src/config.ts))

**Strengths:**
- Comprehensive Zod schema validation
- Boolean and number string transformers
- Cross-field validation with `superRefine`
- Clear error messages for missing dependencies

**Configuration Categories:**
| Category | Variables | Purpose |
|----------|-----------|---------|
| Google | `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account credentials |
| Security | `DOCWALLET_MASTER_KEY` | 32-byte encryption key |
| Server | `HTTP_PORT`, `PUBLIC_BASE_URL` | Web server config |
| Discovery | `DOCWALLET_DOC_ID`, `DOCWALLET_NAME_PREFIX` | Doc discovery |
| Sui/DeepBook | `SUI_RPC_URL`, `DEEPBOOK_ENABLED` | Sui integration |
| Arc | `ARC_RPC_URL`, `ARC_ENABLED`, `ARC_USDC_ADDRESS` | Arc Network |
| Circle | `CIRCLE_*` | Circle wallet integration |
| Yellow | `YELLOW_*` | Yellow NitroRPC |
| WalletConnect | `WALLETCONNECT_*` | dApp bridge |

### 2. Engine ([`src/engine.ts`](src/engine.ts))

The engine implements a multi-tick architecture with concurrent-safe execution:

| Tick | Interval | Purpose |
|------|----------|---------|
| `discoveryTick` | 60s | Discover new Google Docs |
| `pollTick` | 5s | Parse commands from Docs |
| `executorTick` | 1.5s | Execute approved commands |
| `chatTick` | 5s | Process chat suggestions |
| `balancesTick` | 60s | Update portfolio balances |
| `schedulerTick` | 30s | Run scheduled commands |

**Key Features:**
- Mutex flags prevent concurrent tick execution
- Command state machine: `PENDING_APPROVAL` → `APPROVED` → `EXECUTING` → `EXECUTED`
- ENS policy evaluation before command acceptance
- Automatic approval URL generation

### 3. Command System ([`src/core/commands.ts`](src/core/commands.ts))

**Supported Commands:**

| Command | Syntax | Purpose |
|---------|--------|---------|
| `SETUP` | `DW /setup` | Initialize wallet |
| `STATUS` | `DW STATUS` | Check status |
| `SESSION_CREATE` | `DW SESSION_CREATE` | Create Yellow session |
| `SIGNER_ADD` | `DW SIGNER_ADD <addr> WEIGHT <n>` | Add signer |
| `QUORUM` | `DW QUORUM <n>` | Set quorum |
| `CONNECT` | `DW CONNECT <wc_uri>` | WalletConnect pair |
| `LIMIT_BUY` | `DW LIMIT_BUY SUI <qty> USDC @ <price>` | Place buy order |
| `LIMIT_SELL` | `DW LIMIT_SELL SUI <qty> USDC @ <price>` | Place sell order |
| `CANCEL` | `DW CANCEL <order_id>` | Cancel order |
| `SETTLE` | `DW SETTLE` | Settle trades |
| `PAYOUT` | `DW PAYOUT <amt> USDC TO <addr>` | Single payout |
| `PAYOUT_SPLIT` | `DW PAYOUT_SPLIT <amt> USDC TO <addr:pct,...>` | Split payout |
| `SCHEDULE` | `DW SCHEDULE EVERY <n>h: <cmd>` | DCA/recurring |
| `CANCEL_SCHEDULE` | `DW CANCEL_SCHEDULE <id>` | Cancel schedule |
| `BRIDGE` | `DW BRIDGE <amt> USDC FROM <chain> TO <chain>` | Cross-chain |

### 4. Policy System ([`src/core/policy.ts`](src/core/policy.ts))

ENS-based policy enforcement with:

| Policy Field | Type | Purpose |
|--------------|------|---------|
| `requireApproval` | boolean | Force approval workflow |
| `maxNotionalUsdc` | number | Max trade size |
| `allowedPairs` | string[] | Allowed trading pairs |
| `payoutAllowlist` | address[] | Allowed payout recipients |
| `denyCommands` | string[] | Blocked command types |
| `dailyLimitUsdc` | number | Daily spending limit |
| `maxSingleTxUsdc` | number | Per-transaction limit |
| `allowedChains` | string[] | Allowed bridge chains |
| `schedulingAllowed` | boolean | Enable/disable DCA |
| `bridgeAllowed` | boolean | Enable/disable bridging |

### 5. Database Schema ([`src/db/schema.ts`](src/db/schema.ts))

**Tables:**

| Table | Purpose |
|-------|---------|
| `docs` | Tracked Google Docs |
| `secrets` | Encrypted wallet material |
| `commands` | Command history and state |
| `doc_settings` | Per-doc quorum settings |
| `signers` | Registered signers with weights |
| `command_approvals` | Approval votes |
| `yellow_sessions` | Yellow app sessions |
| `yellow_session_keys` | Encrypted session keys |
| `circle_wallets` | Circle wallet mappings |
| `walletconnect_sessions` | WC session state |
| `walletconnect_requests` | Pending WC requests |
| `schedules` | Scheduled commands |

### 6. Integrations

#### DeepBook V3 ([`src/integrations/deepbook.ts`](src/integrations/deepbook.ts))
- Sui DEX integration for limit orders
- BalanceManager-first flow
- Auto-creates shared balance manager
- Supports: `LIMIT_BUY`, `LIMIT_SELL`, `CANCEL`, `SETTLE`

#### Yellow NitroRPC ([`src/integrations/yellow.ts`](src/integrations/yellow.ts))
- NitroRPC 0.4 protocol implementation
- Multi-party signature support
- WebSocket and HTTP transport
- Session key delegation

#### Arc Network ([`src/integrations/arc.ts`](src/integrations/arc.ts))
- EVM-compatible chain client
- USDC transfers via ERC-20
- Transaction signing and sending
- Balance queries

#### Circle ([`src/integrations/circle.ts`](src/integrations/circle.ts))
- Developer-controlled wallets
- CCTP cross-chain bridging
- Wallet set management
- Transaction polling

### 7. Security

#### Wallet Encryption ([`src/wallet/crypto.ts`](src/wallet/crypto.ts))
- AES-256-GCM encryption
- 12-byte IV, 16-byte auth tag
- Versioned blob format: `v1:<base64>`
- Master key: 32 bytes (hex or base64)

#### Key Generation
- EVM: secp256k1 via viem
- Sui: Ed25519 via @mysten/sui

---

## Test Coverage Analysis

| Test File | Coverage |
|-----------|----------|
| [`commands.test.ts`](test/commands.test.ts) | 16 test cases covering all command types |
| [`policy.test.ts`](test/policy.test.ts) | 11 test cases for policy evaluation |
| [`crypto.test.ts`](test/crypto.test.ts) | 1 test case for encryption roundtrip |

**Coverage Gaps:**
- No integration tests for Google Docs API
- No tests for engine tick functions
- No tests for HTTP server endpoints
- No tests for blockchain integrations
- Limited crypto test coverage

---

## Identified Issues and Recommendations

### Critical Issues

1. **Missing Error Handling in Engine Ticks**
   - Location: [`src/engine.ts`](src/engine.ts:86-91)
   - Issue: Errors in ticks are caught but only logged
   - Recommendation: Implement retry logic and alerting

2. **No Rate Limiting on HTTP Endpoints**
   - Location: [`src/server.ts`](src/server.ts)
   - Issue: Vulnerable to DoS attacks
   - Recommendation: Add rate limiting middleware

3. **Session Token Security**
   - Location: [`src/server.ts`](src/server.ts:229-231)
   - Issue: Session tokens stored in memory, lost on restart
   - Recommendation: Persist sessions to database

### Medium Priority

4. **Incomplete TypeScript Strict Mode**
   - Some `any` types in integration clients
   - Recommendation: Add proper type definitions

5. **Missing Input Sanitization**
   - Chat responses could contain malicious content
   - Recommendation: Sanitize all user inputs

6. **No Graceful Shutdown**
   - Only SIGINT handled, no cleanup for pending operations
   - Recommendation: Implement graceful shutdown with timeout

### Low Priority

7. **Hardcoded Magic Numbers**
   - Various timeouts and intervals hardcoded
   - Recommendation: Move to configuration

8. **Missing Logging Framework**
   - Uses `console.log/error` directly
   - Recommendation: Implement structured logging

9. **No Health Check Endpoint**
   - Recommendation: Add `/health` endpoint for monitoring

---

## Recommendations for Improvement

### Short-term

1. **Add Integration Tests**
   - Mock Google Docs API
   - Test engine tick functions
   - Test HTTP endpoints

2. **Implement Structured Logging**
   - Use pino or winston
   - Add request IDs
   - Log levels per environment

3. **Add Rate Limiting**
   - Per-IP rate limits
   - Per-doc rate limits

### Medium-term

4. **Implement Retry Logic**
   - Exponential backoff for API calls
   - Dead letter queue for failed commands

5. **Add Monitoring**
   - Prometheus metrics
   - Health check endpoint
   - Alerting integration

6. **Improve Security**
   - Persist sessions to database
   - Add CSRF protection
   - Implement request signing

### Long-term

7. **Add WebSocket Support**
   - Real-time command updates
   - Live balance streaming

8. **Multi-tenant Support**
   - Separate databases per tenant
   - Resource isolation

9. **Plugin Architecture**
   - Extensible command system
   - Custom integration support

---

## Conclusion

DocWallet is a well-architected project with a clear separation of concerns and comprehensive feature set. The codebase demonstrates good TypeScript practices with Zod validation and proper type definitions. The main areas for improvement are:

1. **Testing**: Expand test coverage beyond unit tests
2. **Security**: Add rate limiting and session persistence
3. **Observability**: Implement structured logging and monitoring
4. **Reliability**: Add retry logic and graceful shutdown

The project is production-ready for MVP use cases but would benefit from the recommended improvements before scaling to production workloads.
