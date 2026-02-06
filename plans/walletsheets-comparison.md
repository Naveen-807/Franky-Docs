# DocWallet vs WalletSheets Comparison

## Executive Summary

Both projects share the same core concept: **using Google productivity tools as a wallet interface**. However, they differ significantly in implementation, scope, and target use cases.

| Aspect | **DocWallet (Your Project)** | **WalletSheets (GSAW)** |
|--------|------------------------------|-------------------------|
| **Interface** | Google Docs | Google Sheets |
| **Language** | TypeScript (100%) | JavaScript (74%) + Python (13%) + TypeScript (12%) |
| **Blockchain Focus** | Multi-chain (Sui, Arc, EVM) | Ethereum-focused |
| **Key Innovation** | Multi-sig quorum approvals + Trading terminal | Deterministic wallet from Sheet ID |
| **Maturity** | More comprehensive | Simpler/MVP |

---

## Detailed Comparison

### 1. Document Interface

| Feature | DocWallet | WalletSheets |
|---------|-----------|--------------|
| **Platform** | Google Docs | Google Sheets |
| **Table Structure** | 8 tables (Config, Commands, Chat, Balances, Open Orders, Recent Activity, Sessions, Audit) | 4 sheets (Settings, Wallet Explorer, ActiveSessions, Pending Transactions, Logs) |
| **Command Input** | Natural language commands in table cells (e.g., `DW LIMIT_BUY SUI 50 USDC @ 1.02`) | Cell-based status changes (Pending → Approved) |
| **Template Management** | Auto-creates template with anchors | Auto-creates sheets if missing |

**Your Advantage:** Google Docs provides richer formatting and better audit trail visibility. The command-based interface is more expressive.

### 2. Wallet Generation

| Feature | DocWallet | WalletSheets |
|---------|-----------|--------------|
| **Method** | Random key generation (secure) | Deterministic from Sheet ID + owner email + salt |
| **Storage** | AES-256-GCM encrypted in SQLite | Derived on-demand (no storage) |
| **Multi-chain** | EVM + Sui wallets per doc | Single EVM wallet |
| **Security Model** | Master key encryption | Salt-based derivation |

**Your Advantage:** More secure random key generation. Multi-chain support. Encrypted storage.

**WalletSheets Advantage:** Simpler - no database needed, wallet is deterministic.

### 3. Approval Workflow

| Feature | DocWallet | WalletSheets |
|---------|-----------|--------------|
| **Multi-sig** | ✅ Full quorum-based approvals | ❌ Single owner |
| **Signer Weights** | ✅ Configurable weights | ❌ N/A |
| **Approval UI** | Web-based `/cmd/<docId>/<cmdId>` | Sheet cell status change |
| **Yellow Integration** | ✅ NitroRPC session keys | ❌ None |

**Your Advantage:** Enterprise-grade multi-signature support with weighted quorum. This is a major differentiator.

### 4. Blockchain Integrations

| Integration | DocWallet | WalletSheets |
|-------------|-----------|--------------|
| **Ethereum/EVM** | ✅ Arc Network | ✅ Goerli testnet |
| **Sui** | ✅ DeepBook V3 DEX | ❌ None |
| **WalletConnect** | ✅ Full bridge | ✅ Basic support |
| **Circle** | ✅ Dev-controlled wallets | ❌ None |
| **Yellow NitroRPC** | ✅ App sessions | ❌ None |
| **ENS** | ✅ Policy resolution | ❌ None |
| **Cross-chain Bridge** | ✅ CCTP via Circle | ❌ None |

**Your Advantage:** Significantly more blockchain integrations. Trading capabilities via DeepBook.

### 5. Trading Features

| Feature | DocWallet | WalletSheets |
|---------|-----------|--------------|
| **Limit Orders** | ✅ `LIMIT_BUY`, `LIMIT_SELL` | ❌ None |
| **Order Management** | ✅ `CANCEL`, `SETTLE` | ❌ None |
| **DCA/Scheduling** | ✅ `SCHEDULE EVERY Nh:` | ❌ None |
| **Portfolio Dashboard** | ✅ Live balances table | ❌ None |
| **Open Orders View** | ✅ Real-time updates | ❌ None |

**Your Advantage:** Full trading terminal capabilities. WalletSheets is wallet-only.

### 6. Policy & Governance

| Feature | DocWallet | WalletSheets |
|---------|-----------|--------------|
| **ENS Policy** | ✅ On-chain policy resolution | ❌ None |
| **Spending Limits** | ✅ Daily/per-tx limits | ❌ None |
| **Allowlists** | ✅ Payout allowlist | ❌ None |
| **Command Blocking** | ✅ `denyCommands` | ❌ None |
| **Chain Restrictions** | ✅ `allowedChains` | ❌ None |

**Your Advantage:** Comprehensive policy system for enterprise governance.

### 7. Architecture

| Aspect | DocWallet | WalletSheets |
|--------|-----------|--------------|
| **Runtime** | Node.js 20+ | Node.js 16+ |
| **Database** | SQLite (better-sqlite3) | None (stateless) |
| **HTTP Server** | Built-in (port 8787) | None mentioned |
| **Polling** | Multi-tick engine (discovery, poll, executor, chat, balances, scheduler) | Single polling loop (10s) |
| **Type Safety** | Full TypeScript + Zod | Mixed JS/TS |

**Your Advantage:** More robust architecture with proper state management.

### 8. Command System

**DocWallet Commands (17 types):**
```
DW /setup              - Initialize wallet
DW STATUS              - Check status
DW SESSION_CREATE      - Yellow session
DW SIGNER_ADD          - Add signer with weight
DW QUORUM              - Set quorum
DW CONNECT             - WalletConnect pair
DW LIMIT_BUY/SELL      - Trading
DW CANCEL              - Cancel order
DW SETTLE              - Settle trades
DW PAYOUT              - Single payout
DW PAYOUT_SPLIT        - Split payout
DW SCHEDULE            - DCA/recurring
DW CANCEL_SCHEDULE     - Cancel schedule
DW BRIDGE              - Cross-chain
DW TX                  - Raw transaction
DW SIGN                - Sign message
DW POLICY ENS          - Set ENS policy
```

**WalletSheets Commands:**
- Paste WalletConnect URI → auto-connect
- Change cell status (Pending → Approved/Rejected)

**Your Advantage:** Much richer command vocabulary.

---

## Summary: Key Differentiators

### What Makes DocWallet Superior:

1. **Multi-Signature Governance** - Enterprise-grade quorum approvals with weighted signers
2. **Trading Terminal** - Full DEX integration with limit orders, DCA, and portfolio tracking
3. **Multi-Chain** - Sui + EVM support vs Ethereum-only
4. **Policy System** - ENS-based on-chain governance policies
5. **Yellow Integration** - NitroRPC app sessions for advanced use cases
6. **Circle Integration** - Developer-controlled wallets and CCTP bridging
7. **Robust Architecture** - SQLite persistence, multi-tick engine, TypeScript

### What WalletSheets Does Better:

1. **Simplicity** - Easier to understand and deploy
2. **Stateless** - No database required (deterministic wallets)
3. **Lower Barrier** - Simpler setup for basic wallet use cases

---

## Positioning Recommendation

**DocWallet** should be positioned as:

> "Enterprise-grade multi-signature wallet and trading terminal using Google Docs as the command interface"

Key differentiators to emphasize:
- **Multi-sig quorum approvals** (vs single-owner in WalletSheets)
- **Trading capabilities** (limit orders, DCA, portfolio dashboard)
- **Multi-chain support** (Sui DeepBook + EVM)
- **Policy governance** (ENS-based spending limits and allowlists)
- **Yellow NitroRPC integration** (app sessions for advanced DeFi)

WalletSheets is a simpler "wallet-as-a-sheet" concept. DocWallet is a full "trading terminal + governance layer" built on Google Docs.

---

## Feature Parity Checklist

Features WalletSheets has that DocWallet also has:
- [x] Google service account authentication
- [x] Auto-discovery of shared documents
- [x] WalletConnect integration
- [x] Transaction signing
- [x] Event logging/audit trail

Features DocWallet has that WalletSheets lacks:
- [x] Multi-signature approvals
- [x] Weighted quorum
- [x] Sui blockchain support
- [x] DEX trading (limit orders)
- [x] DCA/scheduled commands
- [x] Portfolio dashboard
- [x] ENS policy governance
- [x] Circle wallet integration
- [x] Yellow NitroRPC
- [x] Cross-chain bridging
- [x] Chat-based command suggestions
