# DocWallet (Track-Winner Scaffold)

Local agent that turns a Google Doc into a wallet + trading terminal:
- Drive auto-discovers Docs shared with the “agent email”
- A Google Doc table is the command UI and audit trail (WalletSheets-style)
- Approvals are link-based via a local web UI (`/join` + `/cmd`) with quorum/weights
- Execution integrates (flag-gated, **no mock IDs**): Yellow NitroRPC App Sessions, Sui DeepBook v3, Arc USDC payouts (Circle-first)
- Optional WalletConnect dApp bridge (commands + approvals via Doc)
- Chat table suggests DW commands from natural language

## Prereqs
- Node 20+
- A Google Cloud project with **Docs API** + **Drive API** enabled
- A **service account JSON key**
- A Google Doc shared with the service account email as **Editor**

## Setup
```bash
npm install
cp .env.example .env
```

Set `GOOGLE_SERVICE_ACCOUNT_JSON` to either:
- a path to the service account json file, or
- the raw JSON (stringified)

Generate a master key (example):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Put it in `DOCWALLET_MASTER_KEY`.

## Run
```bash
npm run dev
```

Recommended for first run:
- Set `DOCWALLET_DOC_ID` to a single doc id (most reliable), or
- Rename your Doc to include `[DocWallet]` (discovery filter), or
- Set `DOCWALLET_DISCOVER_ALL=1` to disable the filter.

Troubleshooting helper:
```bash
npm run doctor
```

## Plans
- Track-winner roadmap: `plans/roadmap.md`

## Using the Doc
1. Let the agent discover the Doc (or set `DOCWALLET_DOC_ID`)
2. In the Commands table, type: `DW /setup` (auto-approves)
3. Open the local web UI:
   - `http://localhost:8787/` (or set `PUBLIC_BASE_URL`)
   - Use `/join/<docId>` to register signers (weights) for quorum approvals
   - Use `/activity/<docId>` for a live activity feed
4. (Optional) Configure governance in-doc:
   - `DW QUORUM 2`
   - `DW SESSION_CREATE` (Yellow App Session; requires `YELLOW_ENABLED=1`)
5. Add commands like:
   - `DW LIMIT_BUY SUI 5 USDC @ 1.02`
   - `DW CANCEL <order_id>`
   - `DW SETTLE`
   - `DW PAYOUT 1 USDC TO 0x...`
   - `DW CONNECT <walletconnect_uri>` (bridge dApp txs into approvals)
6. Approve via the `APPROVAL_URL` link written into the Commands table.
7. Chat: add a message in the Chat table; the agent responds with a suggested DW command.

## Notes
- Yellow NitroRPC: `YELLOW_ENABLED=1` requires a real NitroRPC endpoint (`YELLOW_RPC_URL`). When disabled, no Yellow session/version data is written.
- DeepBook: `DEEPBOOK_ENABLED=1` runs a BalanceManager-first flow; you must fund the Sui address and have testnet coins.
- Arc payouts:
  - If `CIRCLE_ENABLED=1` + Circle credentials set, payouts use Circle Dev-Controlled Wallets (Arc story).
  - Otherwise, payouts fall back to direct onchain ERC-20 transfers via `viem` (`ARC_ENABLED=1`).
- WalletConnect:
  - Set `WALLETCONNECT_ENABLED=1` and `WALLETCONNECT_PROJECT_ID`.
  - Only `eth_sendTransaction` and `personal_sign` are supported; unsupported methods are rejected.
