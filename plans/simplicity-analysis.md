# DocWallet: Simple by Default, Powerful When Needed

## Your Project IS Simple

Looking at your codebase, DocWallet is already designed with simplicity in mind:

### Minimal Setup (Same as WalletSheets)

```bash
# 1. Install
npm install

# 2. Configure (just 2 required vars)
GOOGLE_SERVICE_ACCOUNT_JSON=./credentials.json
DOCWALLET_MASTER_KEY=<32-byte-hex>

# 3. Run
npm run dev
```

That's it! Everything else is **optional**.

### Feature Flags = Simplicity

Your config already uses feature flags - all advanced features are **OFF by default**:

| Feature | Default | Env Var |
|---------|---------|---------|
| DeepBook Trading | OFF | `DEEPBOOK_ENABLED=0` |
| Yellow NitroRPC | OFF | `YELLOW_ENABLED=0` |
| Circle Wallets | OFF | `CIRCLE_ENABLED=0` |
| WalletConnect | OFF | `WALLETCONNECT_ENABLED=0` |
| Multi-doc Discovery | OFF | `DOCWALLET_DISCOVER_ALL=0` |

**In simple mode, DocWallet is just:**
- Google Doc as wallet interface
- Basic EVM wallet (Arc)
- Single-signer approvals
- Simple payouts

### Simple User Journey

1. Share a Google Doc with the service account
2. Type `DW /setup` in the Commands table
3. Done! You have a wallet.

For basic use:
```
DW PAYOUT 10 USDC TO 0x...
```

No quorum, no trading, no Yellow sessions - just a simple wallet.

---

## Comparison: Simple Mode

| Feature | DocWallet (Simple Mode) | WalletSheets |
|---------|------------------------|--------------|
| Setup Steps | 3 | 4 |
| Required Config | 2 vars | 4 vars |
| Database | SQLite (auto-created) | None |
| Commands | Natural language | Cell edits |
| Wallet Type | Random (secure) | Deterministic |

**DocWallet is actually simpler** because:
1. Fewer required environment variables
2. Natural language commands vs cell manipulation
3. Auto-creates doc template

---

## The Power is Optional

Your architecture is **progressive complexity**:

```
Level 1: Basic Wallet
├── DW /setup
├── DW PAYOUT
└── DW STATUS

Level 2: Add Governance (optional)
├── DW SIGNER_ADD
├── DW QUORUM
└── Multi-sig approvals

Level 3: Add Trading (optional)
├── DEEPBOOK_ENABLED=1
├── DW LIMIT_BUY/SELL
└── DW SCHEDULE (DCA)

Level 4: Add Enterprise (optional)
├── YELLOW_ENABLED=1
├── CIRCLE_ENABLED=1
└── ENS policies
```

---

## Marketing Angle

**WalletSheets says:** "Google Sheet as a wallet"

**DocWallet can say:** "Google Doc as a wallet - simple to start, scales to enterprise"

Or even simpler: **"Type commands in a Google Doc. That's your wallet."**

---

## Simplification Opportunities

If you want to make DocWallet even simpler, consider:

### 1. Single-Command Setup
Instead of requiring `DW /setup`, auto-setup on first command:
```typescript
// In pollTick, if no secrets exist and command is valid:
if (!secrets && parsed.ok) {
  await createAndStoreDocSecrets({ repo, masterKey, docId });
}
```

### 2. Default Single-Signer Mode
Already works! Quorum defaults to 1, so single-signer is automatic.

### 3. Simplified Config
Create a `simple.env.example`:
```env
GOOGLE_SERVICE_ACCOUNT_JSON=./credentials.json
DOCWALLET_MASTER_KEY=your-32-byte-key
DOCWALLET_DOC_ID=your-doc-id
```

### 4. One-Line Docker
```bash
docker run -e GOOGLE_SERVICE_ACCOUNT_JSON=... -e DOCWALLET_MASTER_KEY=... docwallet
```

---

## Conclusion

**DocWallet is NOT more complex than WalletSheets** - it just has more optional features.

In simple mode:
- Same setup effort
- Simpler command interface (natural language vs cell edits)
- More secure (random keys vs deterministic)
- Better audit trail (Google Docs formatting)

The difference is: **DocWallet scales up, WalletSheets doesn't.**

Your project is: **"Simple wallet that grows with you"**
