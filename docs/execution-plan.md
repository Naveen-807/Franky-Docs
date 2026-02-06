# FrankyDocs Execution Plan (accurate to current code)

## Current status
All core systems are implemented:
- Google Docs template + table sync
- Command parsing, approvals, execution
- Sui DeepBook V3 trading
- Arc payouts (Circle dev-controlled wallets preferred)
- Yellow NitroRPC sessions
- ENS policy enforcement (optional)
- WalletConnect session bridge (optional)
- Agent decision engine (alerts + thresholds)

What remains for a live demo: environment setup, testnet funding, and a short recording.

---

## Phase 1: Account setup and keys

### 1) Google Cloud service account
1. Create a Google Cloud project.
2. Enable Google Docs API and Google Drive API.
3. Create a service account and download the JSON key.
4. Share your Google Doc with the service account email as Editor.

Set in `.env`:
```ini
GOOGLE_SERVICE_ACCOUNT_JSON=/absolute/path/to/service-account.json
DOCWALLET_MASTER_KEY=change_me_to_a_long_random_string
```

### 2) Circle developer account (Arc)
1. Create a Circle developer account.
2. Generate an API key and entity secret.
3. Fund the Arc testnet wallet using the Circle faucet.

Set in `.env`:
```ini
CIRCLE_ENABLED=1
CIRCLE_API_KEY=your_circle_api_key
CIRCLE_ENTITY_SECRET=your_entity_secret
CIRCLE_BLOCKCHAIN=ARC-TESTNET
```

### 3) Sui testnet (DeepBook)
Enable Sui RPC and fund the Sui address created by `DW /setup`.

Set in `.env`:
```ini
DEEPBOOK_ENABLED=1
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
```

### 4) Yellow NitroRPC (optional)
Obtain a NitroRPC endpoint from Yellow.

Set in `.env`:
```ini
YELLOW_ENABLED=1
YELLOW_RPC_URL=wss://your-clearnode.example
YELLOW_APP_NAME=DocWallet
```

### 5) WalletConnect (optional)
Get a WalletConnect project id if you want dapp sessions.

Set in `.env`:
```ini
WALLETCONNECT_ENABLED=1
WALLETCONNECT_PROJECT_ID=your_project_id
```

---

## Phase 2: First run
Prereq: Node.js 20+
```bash
cd /Users/naveen/Documents/FrankyDocs
npm install
npm run dev
```

Optional sanity check:
```bash
npm run doctor
```

---

## Phase 3: Demo checklist
1. Create a Google Doc named `[DocWallet] Company Treasury`.
2. Share it with the service account email.
3. Wait for the template to appear.
4. Optional config tweaks:
   - Set `DOC_CELL_APPROVALS=1` if you want to approve via status cell edits.
   - Set `SIGNER_APPROVAL_GAS_PAID` (default `0.003`) to control gas-saved estimates.
5. Commands table:
   - `DW /setup`
   - Join two signers using the Join URL in Config.
   - `DW QUORUM 2`
   - Optional: `DW SESSION_CREATE`
   - `DW PAYOUT 1 USDC TO 0x0000000000000000000000000000000000000001`
   - `DW LIMIT_BUY SUI 5 USDC @ 1.02`
6. Approve using the Approval URL links.
7. Show Audit Log and Recent Activity updates.

---

## Troubleshooting
| Issue | Symptom | Fix |
| --- | --- | --- |
| Google Docs API 403 | Permission denied | Enable Docs API + Drive API |
| Doc not discovered | No updates | Set `DOCWALLET_DOC_ID` or rename doc to include `[DocWallet]` |
| Sui errors | Insufficient gas | Fund Sui address from faucet |
| Circle 401 | Unauthorized | Check API key and entity secret |
| Yellow errors | RPC rejected | Verify NitroRPC endpoint |
