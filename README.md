# FrankyDocs — Google Docs Wallet & BCH Command Engine

**FrankyDocs** turns any Google Doc into a programmable Bitcoin Cash wallet. Type commands directly into your document, and FrankyDocs detects, parses and executes them — sending BCH, issuing CashTokens, deploying time-locked vaults, creating multisig wallets, and more.

> **Demo Address (Chipnet):**
> `bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6`

---

## Architecture

```
Google Doc ──▶ FrankyDocs Engine ──▶ Fulcrum ElectrumX (WSS)
   ▲               │                       │
   │               ▼                       ▼
   └── Results ◀── SQLite DB          BCH Chipnet
```

- **Google Docs API** — reads/writes command tables via a service account
- **Fulcrum ElectrumX WebSocket** — real-time balance, UTXO, broadcast, and history queries (`wss://chipnet.bch.ninja:50004`)
- **BIP-143 Signing** — all transactions are built and signed locally using `@noble/curves/secp256k1`
- **AES-256-GCM** — wallet private keys are encrypted at rest in SQLite
- **CashTokens (CHIP-2022-02)** — native fungible token issuance and transfer

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/Naveen-807/Franky-Docs.git
cd Franky-Docs
npm install
```

### 2. Configure

Create a `.env` file:

```env
GOOGLE_SERVICE_ACCOUNT_JSON='{ ... }'   # Google Cloud service account key JSON
DOCWALLET_MASTER_KEY=your-secret-key     # AES master key for wallet encryption
HTTP_PORT=8787
BCH_ENABLED=1
BCH_NETWORK=chipnet
BCH_REST_URL=https://chipnet.fullstack.cash/v5/
DOCWALLET_DISCOVER_ALL=1
```

### 3. Share Your Google Doc

Share your Google Doc with the service account email as **Editor**:
```
frankydocs@frankydocs.iam.gserviceaccount.com
```

### 4. Run

```bash
npm run dev
```

The engine starts on `http://localhost:8787`. It auto-discovers shared docs, creates command/config/audit tables, and begins polling for commands.

### 5. Check Status

```bash
curl http://localhost:8787/api/status
```

---

## Commands Reference

Type any command in your Google Doc's command table. Prefix with `DW` (DocWallet).

### Core

| Command | Description | Example |
|---------|-------------|---------|
| `DW SETUP` | Provision BCH + EVM wallet for this document | `DW SETUP` |
| `DW STATUS` | Show runtime status and wallet addresses | `DW STATUS` |
| `DW TREASURY` | All wallet balances (BCH + tokens + USD value) | `DW TREASURY` |

#### Example: Setup

```
DW SETUP
```
**Result:**
```
EVM=0x... BCH=bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6
```

#### Example: Treasury

```
DW TREASURY
```
**Result:**
```
TREASURY | BCH=0.00100000 | BCH/USD=$385.20 | USD=$0.39
```

---

### BCH Transactions

| Command | Description | Example |
|---------|-------------|---------|
| `DW BCH_PRICE` | Fetch live BCH/USD price from CoinGecko | `DW BCH_PRICE` |
| `DW BCH_SEND <addr> <sats>` | Send BCH (in satoshis) | `DW BCH_SEND bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 10000` |
| `DW BCH_TOKEN_ISSUE <ticker> <name> <supply>` | Issue a new CashToken | `DW BCH_TOKEN_ISSUE FRANKY FrankyToken 1000000` |
| `DW BCH_TOKEN_SEND <addr> <category\|ticker> <amount>` | Send CashTokens | `DW BCH_TOKEN_SEND bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 FRANKY 500` |
| `DW BCH_TOKEN_BALANCE` | View BCH + all token balances | `DW BCH_TOKEN_BALANCE` |
| `DW BCH_STOP_LOSS <qty> @ <price>` | Create stop-loss order | `DW BCH_STOP_LOSS 0.5 @ 300` |
| `DW BCH_TAKE_PROFIT <qty> @ <price>` | Create take-profit order | `DW BCH_TAKE_PROFIT 1.0 @ 500` |

#### Example: Send BCH

```
DW BCH_SEND bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 10000
```
**Result:**
```
BCH_Tx=a1b2c3d4e5... (10000 sats → bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6)
```

#### Example: Issue CashToken

```
DW BCH_TOKEN_ISSUE FRANKY FrankyToken 1000000
```
**Result:**
```
TOKEN_ISSUED=FRANKY SUPPLY=1000000 CATEGORY=a1b2c3d4e5f6... TX=deadbeef...
```

#### Example: Token Balance

```
DW BCH_TOKEN_BALANCE
```
**Result:**
```
BCH: 0.00100000 (100000 sats) | TOKEN FRANKY: 1000000
```

---

### NFTs (CashTokens)

| Command | Description | Example |
|---------|-------------|---------|
| `DW NFT_MINT <ticker> <name> <uri> <to> <qty>` | Mint NFT collection | `DW NFT_MINT PUNK CryptoPunk https://example.com/meta bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 10` |
| `DW NFT_SEND <to> <category> <amount>` | Transfer NFTs | `DW NFT_SEND bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 a1b2c3d4... 1` |
| `DW NFT_BALANCE` | View NFT holdings | `DW NFT_BALANCE` |
| `DW NFT_MARKET_LIST <tokenId> <priceBch>` | List NFT for sale | `DW NFT_MARKET_LIST a1b2c3d4... 0.5` |
| `DW NFT_MARKET_BUY <listingId>` | Buy listed NFT | `DW NFT_MARKET_BUY nft_list_a1b2c3d4_50000000_1700000000` |

#### Example: Mint NFT

```
DW NFT_MINT PUNK CryptoPunk https://example.com/meta bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 10
```
**Result:**
```
NFT_MINT name="CryptoPunk" ticker=PUNK category=a1b2c3d4e5f6... txid=deadbeef...
```

#### Example: NFT Balance

```
DW NFT_BALANCE
```
**Result:**
```
NFT Holdings:
  CryptoPunk (PUNK): 10 units
```

---

### Multisig Wallets

| Command | Description | Example |
|---------|-------------|---------|
| `DW BCH_MULTISIG_CREATE <M> <pubkey1> <pubkey2> ...` | Create M-of-N P2SH multisig wallet | `DW BCH_MULTISIG_CREATE 2 02a1b2...pub1 03c4d5...pub2 02e6f7...pub3` |
| `DW BCH_MULTISIG_BALANCE` | View multisig balances | `DW BCH_MULTISIG_BALANCE` |
| `DW BCH_MULTISIG_SEND <to> <sats>` | Spend from multisig | `DW BCH_MULTISIG_SEND bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 5000` |

#### Example: Create 2-of-3 Multisig

```
DW BCH_MULTISIG_CREATE 2 02a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 03c4d5e6f7a8b9c4d5e6f7a8b9c4d5e6f7a8b9c4d5e6f7a8b9c4d5e6f7a8b9c4d5 02e6f7a8b9c0d1e6f7a8b9c0d1e6f7a8b9c0d1e6f7a8b9c0d1e6f7a8b9c0d1e6f7
```
**Result:**
```
BCH_MULTISIG_CREATE walletId=ms_1700000000_abc12345 address=bchtest:p... threshold=2/3
```

---

### Time-Locked Vaults (CLTV)

| Command | Description | Example |
|---------|-------------|---------|
| `DW CASH_VAULT_CREATE <beneficiary> <unlockTimestamp> <sats>` | Deploy CLTV time-locked vault | `DW CASH_VAULT_CREATE bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 1777000000 50000` |
| `DW CASH_VAULT_CLAIM <address>` | Claim after timelock expires | `DW CASH_VAULT_CLAIM bchtest:p...` |
| `DW CASH_VAULT_RECLAIM <address>` | Reclaim before timelock (testnet) | `DW CASH_VAULT_RECLAIM bchtest:p...` |
| `DW CASH_VAULT_STATUS <address>` | Check vault status | `DW CASH_VAULT_STATUS bchtest:p...` |

#### Example: Create Vault (locks for ~6 months)

```
DW CASH_VAULT_CREATE bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 1777000000 50000
```
**Result:**
```
CASH_VAULT_CREATE vaultId=v_abc12345def address=bchtest:p... fundTxid=a1b2c3d4... unlocks=2026-04-20T...
```

#### Example: Check Vault Status

```
DW CASH_VAULT_STATUS bchtest:pxyz789...
```
**Result:**
```
Vault: bchtest:pxyz789...
Status: LOCKED
Timelock: 2026-04-20T00:00:00Z (5184000s remaining)
Deposited: 50000 sats
On-chain balance: 50000 sats
Fund txid: a1b2c3d4...
```

---

### Payment Requests

| Command | Description | Example |
|---------|-------------|---------|
| `DW PAYMENT_REQUEST <amountBch> <description>` | Create payment request with URI | `DW PAYMENT_REQUEST 0.001 Coffee Order #42` |
| `DW PAYMENT_CHECK <requestId>` | Check if payment received | `DW PAYMENT_CHECK pay_1700000000_abc123` |
| `DW PAYMENT_QR <requestId>` | Get payment QR URI | `DW PAYMENT_QR pay_1700000000_abc123` |

#### Example: Create Payment Request

```
DW PAYMENT_REQUEST 0.001 Coffee Order #42
```
**Result:**
```
PAYMENT_REQUEST requestId=pay_1700000000_abc123 amount=0.001 BCH address=bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6
URI: bitcoincash:bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6?amount=0.001&message=Coffee%20Order%20%2342
```

---

### Scheduling

| Command | Description | Example |
|---------|-------------|---------|
| `DW SCHEDULE EVERY <n>h: <command>` | Schedule recurring command | `DW SCHEDULE EVERY 24h: BCH_PRICE` |
| `DW CANCEL_SCHEDULE <scheduleId>` | Cancel a schedule | `DW CANCEL_SCHEDULE sched_1700000000_abc123` |

#### Example: Auto-Check Price Every Hour

```
DW SCHEDULE EVERY 1h: BCH_PRICE
```
**Result:**
```
SCHEDULE_CREATED=sched_1700000000_abc123 EVERY 1h
```

---

### Trading Orders

| Command | Description | Example |
|---------|-------------|---------|
| `DW BCH_STOP_LOSS <qty> @ <price>` | Trigger sell if price drops | `DW BCH_STOP_LOSS 0.5 @ 300` |
| `DW BCH_TAKE_PROFIT <qty> @ <price>` | Trigger sell if price rises | `DW BCH_TAKE_PROFIT 1.0 @ 500` |
| `DW CANCEL_ORDER <orderId>` | Cancel conditional order | `DW CANCEL_ORDER bch_sl_1700000000_abc123` |

---

### Natural Language Shortcuts

FrankyDocs also understands natural language — no `DW` prefix needed:

| What You Type | Mapped To |
|--------------|-----------|
| `setup` | `DW SETUP` |
| `status` or `help` or `?` | `DW STATUS` |
| `treasury` or `check balance` or `my balance` | `DW TREASURY` |
| `bch price` or `bch/usd` | `DW BCH_PRICE` |
| `bch balance` or `my tokens` | `DW BCH_TOKEN_BALANCE` |
| `send 10000 sats to bchtest:q...` | `DW BCH_SEND bchtest:q... 10000` |
| `send 0.001 BCH to bchtest:q...` | `DW BCH_SEND bchtest:q... 100000` |
| `issue token FRANKY FrankyToken 1000000` | `DW BCH_TOKEN_ISSUE FRANKY FrankyToken 1000000` |
| `stop loss 0.5 @ 300` | `DW BCH_STOP_LOSS 0.5 @ 300` |
| `take profit 1.0 @ 500` | `DW BCH_TAKE_PROFIT 1.0 @ 500` |

---

## Full Command Flow Example

Here's a complete walkthrough using address `bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6`:

### Step 1: Setup Wallet
```
DW SETUP
→ EVM=0xABC... BCH=bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6
```

### Step 2: Fund via Chipnet Faucet
Visit https://tbch.googol.cash/ and send testnet BCH to:
```
bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6
```

### Step 3: Check Balance
```
DW TREASURY
→ TREASURY | BCH=0.01000000 | BCH/USD=$385.20 | USD=$3.85
```

### Step 4: Issue a Token
```
DW BCH_TOKEN_ISSUE FRANKY FrankyToken 1000000
→ TOKEN_ISSUED=FRANKY SUPPLY=1000000 CATEGORY=abc123... TX=def456...
```

### Step 5: Check Token Balance
```
DW BCH_TOKEN_BALANCE
→ BCH: 0.00950000 (950000 sats) | TOKEN FRANKY: 1000000
```

### Step 6: Send Tokens
```
DW BCH_TOKEN_SEND bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 FRANKY 100
→ TOKEN_SENT=100 FRANKY... → bchtest:qpap... TX=789abc...
```

### Step 7: Create a Vault
```
DW CASH_VAULT_CREATE bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 1777000000 25000
→ CASH_VAULT_CREATE vaultId=v_abc... address=bchtest:p... fundTxid=... unlocks=2026-04-20T...
```

### Step 8: Schedule Price Monitoring
```
DW SCHEDULE EVERY 1h: BCH_PRICE
→ SCHEDULE_CREATED=sched_... EVERY 1h
```

### Step 9: Set Stop-Loss
```
DW BCH_STOP_LOSS 0.005 @ 300
→ BCH_STOP_LOSS=bch_sl_... SELL 0.005 BCH WHEN ≤ $300
```

### Step 10: Mint NFTs
```
DW NFT_MINT FRANK FrankyNFT https://example.com/nft.json bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6 5
→ NFT_MINT name="FrankyNFT" ticker=FRANK category=... txid=...
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Engine status, uptime, document count |
| `/api/docs` | GET | List tracked documents |
| `/api/docs/:id/commands` | GET | Command history for a document |
| `/api/docs/:id/balance` | GET | Wallet balances for a document |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | — | Google Cloud service account key JSON |
| `DOCWALLET_MASTER_KEY` | Yes | — | AES-256-GCM master key for wallet encryption |
| `HTTP_PORT` | No | `8787` | HTTP server port |
| `BCH_ENABLED` | No | `1` | Enable BCH integration |
| `BCH_NETWORK` | No | `mainnet` | Network: `chipnet` or `mainnet` |
| `BCH_REST_URL` | No | `https://api.fullstack.cash/v5/` | REST URL (legacy, WSS used internally) |
| `BCH_CASHTOKENS_ENABLED` | No | `1` | Enable CashToken commands |
| `BCH_NFT_ENABLED` | No | `1` | Enable NFT commands |
| `BCH_MULTISIG_ENABLED` | No | `1` | Enable multisig commands |
| `CASH_ENABLED` | No | `1` | Enable CLTV vault commands |
| `BCH_PAYMENTS_ENABLED` | No | `1` | Enable payment request commands |
| `DOCWALLET_DISCOVER_ALL` | No | `1` | Auto-discover all shared documents |
| `POLL_INTERVAL_MS` | No | `15000` | How often to poll docs for commands (ms) |
| `DISCOVERY_INTERVAL_MS` | No | `60000` | How often to discover new docs (ms) |
| `DEMO_MODE` | No | `0` | Enable demo mode dashboard |

---

## Technical Details

### Wallet Generation
- Private key: 32 bytes from `crypto.randomBytes()`
- Public key: compressed secp256k1 (33 bytes) via `@noble/curves`
- Address: CashAddr format with `bchtest:` prefix (chipnet) or `bitcoincash:` (mainnet)
- Encryption: AES-256-GCM with document-specific IVs

### Transaction Signing
- BIP-143 sighash algorithm (BCH-specific with `SIGHASH_FORKID` = 0x40)
- Raw transaction building with proper varint encoding
- P2PKH, P2SH, and CashTokens output scripts

### Network Communication
- **Fulcrum ElectrumX WebSocket** (primary): `wss://chipnet.bch.ninja:50004`, `wss://chipnet.imaginary.cash:50004`
- Automatic failover between endpoints
- JSON-RPC 2.0 protocol over WebSocket
- Methods used: `blockchain.scripthash.get_balance`, `blockchain.scripthash.listunspent`, `blockchain.transaction.broadcast`, `blockchain.transaction.get`, `blockchain.scripthash.get_history`

### CashTokens (CHIP-2022-02)
- Token category = reversed genesis input txid
- `OP_TOKENPREFIX` (0xEF) byte in output scripts
- Fungible tokens with CompactSize-encoded amounts
- NFT support with capability and commitment fields

### Database
- SQLite with WAL mode
- Tables: `docs`, `secrets`, `commands`, `schedules`, `bch_tokens`, `bch_vaults`, `bch_multisig_wallets`, `bch_payment_requests`, `bch_nft_listings`, `trades`, `conditional_orders`, `price_cache`

---

## Project Structure

```
src/
├── index.ts              # Entry point — initializes all clients
├── engine.ts             # Core engine — discovery, polling, command execution
├── config.ts             # Environment variable schema (Zod)
├── server.ts             # HTTP API server
├── core/
│   ├── commands.ts       # Command parser (35+ commands)
│   ├── policy.ts         # Approval policies
│   └── state.ts          # State management
├── db/
│   ├── schema.ts         # SQLite schema (12+ tables)
│   └── repo.ts           # Database repository layer
├── google/
│   ├── auth.ts           # Google service account auth
│   ├── docs.ts           # Google Docs API wrapper
│   ├── drive.ts          # Google Drive API (discovery)
│   ├── template.ts       # Doc table templates
│   └── docwallet.ts      # Doc ↔ wallet table operations
├── integrations/
│   ├── fulcrum.ts        # Shared Fulcrum ElectrumX WebSocket helpers
│   ├── bch.ts            # Core BCH client (balance, UTXO, send, tokens)
│   ├── bch-nft.ts        # CashTokens NFT client
│   ├── bch-multisig.ts   # M-of-N P2SH multisig wallets
│   ├── cashscript.ts     # CLTV time-locked vaults
│   └── bch-payments.ts   # Payment request system
├── wallet/
│   ├── bch.ts            # BCH wallet generation (secp256k1 + CashAddr)
│   ├── crypto.ts         # AES-256-GCM encryption
│   ├── evm.ts            # EVM wallet generation
│   └── store.ts          # Wallet creation + encrypted storage
└── util/
    ├── hash.ts           # SHA-256 utility
    └── sleep.ts          # Async sleep helper
```

---

## Chipnet Faucet

To get testnet BCH for testing, use the Chipnet faucet:

**Faucet URL:** https://tbch.googol.cash/

**Your Address:**
```
bchtest:qpap7hlhkwgyvm0h8v7sdsja7kdt3p6trye2t42cn6
```

> **Tip:** If the faucet says "Address is invalid or captcha is wrong", make sure you complete the CAPTCHA correctly. The address above is cryptographically valid.

---

## License

MIT — see [LICENSE](LICENSE)

---

## Links

- **GitHub:** https://github.com/Naveen-807/Franky-Docs
- **BCH Chipnet Explorer:** https://chipnet.chaingraph.cash
- **CashTokens Spec:** https://github.com/bitjson/cashtokens
