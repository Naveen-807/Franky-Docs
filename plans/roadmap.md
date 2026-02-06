# DocWallet Roadmap (Track-Winner Plan)

## Goal
Ship a Google Docs–native treasury terminal that wins Yellow + Sui DeepBook + Arc/Circle by using each sponsor primitive as the core execution path (no mocks).

## Scope (MVP + Track-Winner)
- Google Docs as UI and audit log (anchored tables + batchUpdate).
- Quorum approvals via web UI, recorded in Yellow NitroRPC app sessions.
- DeepBook v3 limit/cancel/settle on Sui testnet.
- Arc USDC settlement via Circle Dev‑Controlled Wallets (fallback: direct RPC ERC‑20).
- WalletConnect bridge so dApp requests become Doc commands with quorum approvals.
- Optional ENS policy enforcement.

## Milestones
### M1 — Docs UX + Agent Core (Done)
- Doc template: Config, Commands, Chat, Dashboard, Sessions, Audit.
- Discovery + polling + command ingestion.
- Append-only audit log and activity feed.

### M2 — Governance + Yellow (Done)
- Signer onboarding (/join) + quorum approvals.
- Yellow NitroRPC: `auth_request`, `auth_verify`, `create_app_session`, `submit_app_state`.
- Session keys delegated once, approvals recorded on Yellow.

### M3 — DeepBook Trading (Done)
- BalanceManager create/share.
- Limit buy/sell, cancel, settle.
- Sui tx digest + order ID written to Doc.

### M4 — Arc/Circle Settlement (Done)
- Circle Dev‑Controlled Wallets: wallet set + per‑doc wallet.
- Payout + split payout with tx polling.
- Writes Circle tx id + Arc tx hash to Doc.

### M5 — WalletConnect Bridge (Done)
- `DW CONNECT <wc_uri>` pairs sessions.
- dApp `eth_sendTransaction` and `personal_sign` become Doc commands.
- Approval flow feeds back to WalletConnect response.

### M6 — Demo Polish (Done)
- Live activity feed page.
- Clean join + approve UI.
- Demo script in `demo/SCRIPT.md`.

## Acceptance Criteria
- `DW /setup` creates wallets and fills Config.
- Commands -> `PENDING_APPROVAL` -> `APPROVED` -> `EXECUTED` with audit trail.
- Yellow session/version recorded on approvals when enabled.
- DeepBook limit order returns tx digest + order ID.
- Arc/Circle payout returns Circle tx id + Arc tx hash.
- WalletConnect dApp tx requests appear as Doc commands and resolve to real tx hashes.

## Demo Checklist
1. Share doc with service account as Editor.
2. Run `npm run dev` and confirm discovery.
3. `DW /setup` -> addresses populate.
4. Join two signers via `/join/<docId>`.
5. `DW SESSION_CREATE` -> Yellow session id.
6. `DW LIMIT_BUY SUI 5 USDC @ 1.02` -> approve -> DeepBook tx.
7. `DW PAYOUT 1 USDC TO 0x...` -> approve -> Circle/Arc tx.
8. Optional: WalletConnect dApp request -> approval -> tx hash.

## No‑Mock Policy
All chain outputs (Yellow IDs/versions, Sui tx digests, Arc/Circle tx hashes) must be real. If any integration is disabled or unfunded, the command must fail with a clear error in the Doc.
