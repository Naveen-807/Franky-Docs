# DocWallet Demo Script (3-4 min)

## Pre-reqs
1. Create a Google Doc named `[DocWallet] Demo Treasury`.
2. Share it with the agent service account (Editor).
3. Ensure `.env` is configured and `npm run dev` is running.

## Walkthrough

### 1. Setup
- In the Commands table, type: `DW /setup` (or just `setup` — auto-detected!)
- Expected: `EVM_ADDRESS`, `SUI_ADDRESS`, and `ARC_WALLET_ADDRESS` populate in Config.
- **Visual**: Watch the Balances table start auto-populating with live chain balances (SUI, DBUSDC, Arc native, Arc USDC, Circle USDC).

### 2. Signer Join
- Open `http://localhost:8787/` and click `Join` for the doc.
- Connect two wallets and register weights (e.g., 1 and 1).
- If Yellow is enabled, signers get delegated session keys via EIP-712.

### 3. ENS Policy (Governance Layer)
- `DW POLICY ENS yourdao.eth`
- The ENS text record at `docwallet.policy` governs:
  - `dailyLimitUsdc` -- rolling 24h spend cap
  - `maxSingleTxUsdc` -- per-transaction cap
  - `allowedChains` -- restrict bridge destinations
  - `schedulingAllowed` -- enable/disable DCA
  - `payoutAllowlist` -- restrict payout addresses
- **Emphasize**: On-chain governance via ENS, not hardcoded rules.

### 4. Place a Trade (DeepBook v3)
- `DW LIMIT_BUY SUI 5 USDC @ 1.02` (or just `buy 5 SUI at 1.02` — auto-detected!)
- Approval URL appears. Two signers approve via the link.
  - **OR** for single-signer demo: type `APPROVED` in the Status cell (WalletSheets-style!)
- Expected: `SuiTx=<digest>` and `OrderId=<id>` in Result.
- **Visual**: Open Orders table auto-updates with the new order.

### 5. Schedule DCA (Autonomous Agent)
- `DW SCHEDULE EVERY 4h: LIMIT_BUY SUI 10 USDC @ 1.5`
- Expected: `SCHEDULE_CREATED=sched_... EVERY 4h NEXT=...`
- The agent will auto-spawn a new LIMIT_BUY command every 4 hours -- no human action needed.
- View active schedules at `http://localhost:8787/sessions/<docId>`.
- Cancel with: `DW CANCEL_SCHEDULE sched_...` (or `cancel schedule sched_...`)

### 6. Cross-Chain Bridge (Arc ↔ Sui via Circle CCTP)
- `DW BRIDGE 100 USDC FROM arc TO sui` (or `bridge 100 USDC from arc to sui`)
- Uses Circle CCTP for cross-chain USDC transfer.
- Expected: `BRIDGE 100 USDC arc->sui CircleTx=...`
- **Emphasize**: Single command bridges between Arc and Sui -- ties both prize tracks together.

### 7. Payout (Circle Programmable Wallets)
- `DW PAYOUT 1 USDC TO 0x...` (or `send 1 USDC to 0x...`)
- Approve via the link, OR type `APPROVED` in the Status cell.
- Expected: `CircleTx=<id>` and `ArcTx=<hash>` in Result.

### 8. WalletConnect (External dApp Integration)
- Paste `wc:...` directly in the Commands table (auto-detected as `DW CONNECT`!)
- Pair from a dApp and trigger `eth_sendTransaction`.
- Request appears as a new command row with the same quorum approval flow.
- Manage sessions at `http://localhost:8787/sessions/<docId>`.

### 9. AI Chat + Auto-Execute
- In the Chat table, type: `buy 10 SUI at 1.5`
  - Agent auto-detects transactional intent and **submits the command directly**!
- Type: `bridge 50 USDC from arc to sui`
  - Agent auto-submits: `DW BRIDGE 50 USDC FROM arc TO sui`
- Type: `send 5 USDC to 0x0000000000000000000000000000000000000001`
  - Agent auto-submits: `DW PAYOUT 5 USDC TO 0x...`
- Type: `help` for the full command list.
- **Emphasize**: No `!execute` prefix needed for clear intents — the AI agent understands.

### 10. Watch the Dashboard
- Scroll to the **Balances** table -- auto-updates every 60s with live on-chain balances.
- **Open Orders** table shows all active DeepBook orders.
- **Recent Activity** table shows all executed commands with tx hashes.

## What to Emphasize for Judges
- **Zero-friction UX**: Type `send 50 USDC to 0x...` — no DW prefix, no syntax to memorize.
- **Cell-based approval**: Change a cell to "APPROVED" — just like WalletSheets, but with crypto quorum.
- **Approvals are cryptographic and quorum-based** for multi-sig; cell-edit for single-signer demo.
- **Yellow session** records all approvals on the NitroRPC state channel.
- **DeepBook** uses the native CLOB flow (limit, cancel, settle) on Sui testnet.
- **Arc/Circle** USDC payouts + bridges demonstrate treasury settlement.
- **ENS Policy** = on-chain governance: spend limits, allowed chains, scheduling controls.
- **Scheduled DCA** = autonomous agent behavior — the doc acts without humans.
- **Cross-Chain Bridge** = one command moves USDC between Arc and Sui via Circle CCTP.
- **AI Chat** = natural language → typed commands, auto-submission for clear intents.
- **WalletConnect URIs** auto-detected — paste `wc:...` anywhere, it just works.
- **The Doc is the UI**, the audit log, and the treasury dashboard — all in one.
