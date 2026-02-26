# FrankyDocs — BCH-1 Submission (Applications Track)

## Track Selection
- Primary track: **Applications**
- Positioning: **BCH-first Google Docs treasury UX** with CashTokens support

## One-Line Value Proposition
FrankyDocs turns a shared Google Doc into a Bitcoin Cash treasury where teams can send BCH, issue CashTokens, and manage execution workflows without browser-wallet complexity.

## What We Ship in This Submission
- BCH wallet provisioning in `DW SETUP` with doc config keys:
  - `BCH_ADDRESS`
  - `BCH_NETWORK`
- **Core BCH command execution:**
  - `DW BCH_PRICE`
  - `DW BCH_SEND <cashaddr> <amountSats>`
  - `DW BCH_TOKEN_ISSUE <ticker> <name> <supply>`
  - `DW BCH_TOKEN_BALANCE`
  - `DW BCH_TOKEN_SEND <cashaddr> <tokenCategory|ticker> <amount>`
- **NFT Commands (CashTokens CHIP-2022-02):**
  - `DW NFT_MINT <ticker> "<name>" <amount>` — Mint fungible CashTokens NFTs
  - `DW NFT_SEND <to> <tokenCategory> <amount>` — Transfer NFTs
  - `DW NFT_BALANCE` — View NFT holdings
  - `DW NFT_MARKET_LIST <tokenId> <priceBch>` — List NFT for sale
  - `DW NFT_MARKET_BUY <listingId>` — Purchase listed NFT
- **Multisig Wallets (Real secp256k1 P2SH + BIP-143):**
  - `DW BCH_MULTISIG_CREATE <M>-of-<N> <pubkey1> <pubkey2>...` — Create M-of-N P2SH wallet
  - `DW BCH_MULTISIG_BALANCE` — Check multisig wallet balances
  - `DW BCH_MULTISIG_SEND <to> <amountSats>` — Spend from multisig
- **Time-Locked Vaults (OP_CLTV with BIP-143):**
  - `DW CASH_VAULT_CREATE <sats> <unlockTime>` — Deploy CLTV time-locked vault
  - `DW CASH_VAULT_CLAIM <vaultAddress>` — Claim vault after timelock
  - `DW CASH_VAULT_RECLAIM <vaultAddress>` — Reclaim vault before timelock
  - `DW CASH_VAULT_STATUS <vaultAddress>` — Check vault on-chain status
- **Payment Requests:**
  - `DW PAYMENT_REQUEST <amountBch> "<description>"` — Generate BCH payment URI
  - `DW PAYMENT_CHECK <requestId>` — Check payment confirmation status
  - `DW PAYMENT_QR <requestId>` — Generate payment QR code
- **CashTokens persistence and visibility:**
  - Issued token metadata stored in `bch_tokens`, `bch_nft_listings`
  - Grouped token balances in runtime output
  - Multisig wallets stored in `bch_multisig_wallets`
  - Vaults tracked in `bch_vaults` with status updates
  - Payment requests in `bch_payment_requests`
- **Conditional protection for BCH:**
  - BCH stop-loss / take-profit trigger logic routes into BCH command queue
  - Works even when DeepBook is disabled

## 2-Minute Demo Script (Local Run + Video)
1. **Start app** (`npm run dev`) with BCH enabled (`BCH_ENABLED=1`, `BCH_CASHTOKENS_ENABLED=1`, `BCH_NFT_ENABLED=1`, `BCH_MULTISIG_ENABLED=1`, `CASH_ENABLED=1`, `BCH_PAYMENTS_ENABLED=1`).
2. **Open dashboard** and select a tracked doc.
3. **Run:** `DW SETUP` — verify config rows show BCH address/network.
4. **Run:** `DW BCH_PRICE` — show returned BCH/USD value.
5. **Run:** `DW BCH_SEND <cashaddr> <amountSats>` — show tx/result row.
6. **Run:** `DW BCH_TOKEN_ISSUE FRANKY FrankyDAO 1000000` — show token category + tx.
7. **Run:** `DW BCH_TOKEN_BALANCE` — show BCH + token balances.
8. **Run:** `DW NFT_MINT FNFT "Franky NFT" 10` — show NFT token category + tx.
9. **Run:** `DW NFT_BALANCE` — show NFT holdings.
10. **Run:** `DW BCH_MULTISIG_CREATE 2-of-3 <pubkey1> <pubkey2> <pubkey3>` — show P2SH address.
11. **Run:** `DW BCH_MULTISIG_BALANCE` — show multisig wallet balance.
12. **Run:** `DW CASH_VAULT_CREATE 50000 <unlockTime>` — show vault contract address + fund tx.
13. **Run:** `DW CASH_VAULT_STATUS <vaultAddress>` — show timelock countdown.
14. **Run:** `DW PAYMENT_REQUEST 0.01 "Test Payment"` — show payment URI + QR.
15. **Run:** `DW PAYMENT_CHECK <requestId>` — show pending/paid status.
16. **Run:** `npm test` — show test suite results.
17. **Run:** `npx tsc --noEmit -p tsconfig.build.json` — verify zero compile errors.

## Business Development Plan (Post-Sprint)
### 30 Days
- Onboard 3-5 BCH builder teams to private pilot docs.
- Collect feedback on command UX, approval workflow, and treasury reporting.
- Publish quickstart + video and open issue templates for integrator requests.

### 60 Days
- Release production-grade BCH templates for common workflows:
  - payroll payouts
  - recurring treasury disbursements
  - token community distributions
- Add partner integrations for BCH explorer/analytics links and reporting exports.

### 90 Days
- Expand to ecosystem-facing deployments with mentor/partner intros.
- Package a hosted operator mode for teams that do not want to self-host.
- Define paid offering around team seats, policy controls, and compliance exports.

## Licensing and Code Availability Disclosure
- Project licensing model for this submission: **open-source (MIT)**.
- Core source code is available in this repository.
- Any external APIs or network services used by integrations remain subject to their own terms.

## Evidence Checklist (Local + Recorded)
- [x] Terminal shows app startup with BCH integration active.
- [x] `DW SETUP` result row with BCH address/network populated.
- [x] `DW BCH_PRICE` result row.
- [x] `DW BCH_SEND` result row with tx reference.
- [x] `DW BCH_TOKEN_ISSUE` result row with token category + tx.
- [x] `DW BCH_TOKEN_BALANCE` result row.
- [x] NFT mint command (`DW NFT_MINT`) with token category + tx.
- [x] NFT send command (`DW NFT_SEND`) with tx reference.
- [x] NFT balance command (`DW NFT_BALANCE`) showing holdings.
- [x] Multisig wallet creation (`DW BCH_MULTISIG_CREATE`) with P2SH address.
- [x] Multisig balance check (`DW BCH_MULTISIG_BALANCE`).
- [x] Multisig send (`DW BCH_MULTISIG_SEND`) with tx reference.
- [x] Vault creation (`DW CASH_VAULT_CREATE`) with CLTV contract address + fund tx.
- [x] Vault status (`DW CASH_VAULT_STATUS`) showing timelock details.
- [x] Payment request creation (`DW PAYMENT_REQUEST`) with BCH URI.
- [x] Payment check (`DW PAYMENT_CHECK`) showing pending/paid status.
- [x] Final `npm test` output.
- [x] Final `npx tsc --noEmit -p tsconfig.build.json` output.

## Risk and Mitigation Notes
- Demo operates on BCH testnet/Chipnet paths to reduce operational risk.
- BCH-first story is intentionally scoped to maximize reliability under hackathon time constraints.
- Non-BCH integrations remain in repo but are not required for primary demo success.
