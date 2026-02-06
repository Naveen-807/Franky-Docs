# FrankyDocs Demo Script (2 to 3 minutes)

## Pre-demo setup (before recording)
1. Configure `.env` using `.env.example`.
2. Run `npm run dev`.
3. Create a Google Doc named `[DocWallet] Company Treasury` and share it with the service account.
4. Open the Doc and keep the Approval Server open at `http://localhost:8787`.

---

## Recording flow (suggested timing)

### 0:00 - 0:20 Intro
Show the Doc with the template inserted. Explain: "This Doc is the wallet UI."

### 0:20 - 0:50 Setup
In the Commands table:
```
DW /setup
```
Point out the EVM and Sui addresses in the Config table.

### 0:50 - 1:10 Signers + Quorum
Open the Join URL in Config, register two signers, then:
```
DW QUORUM 2
```

### 1:10 - 1:40 Policy-gated payout split (Arc / Circle)
If you have an ENS policy set, apply it first:
```
DW POLICY ENS frankydocs.eth
```
Then run a split payout:
```
DW PAYOUT_SPLIT 10 USDC TO 0x0000000000000000000000000000000000000001:50,0x0000000000000000000000000000000000000002:50
```
Open the Approval URL, approve with two signers, then show the action summary, quorum progress, and gasless metrics.
Point to the Config rows `APPROVALS_TOTAL` and `EST_APPROVAL_TX_AVOIDED` updating.
Then show the result and Audit Log entry.
If the policy blocks a command, show the `REJECTED_POLICY` status and the reason in the Commands table.

### 1:40 - 2:10 Sui DeepBook trade
```
DW LIMIT_BUY SUI 5 USDC @ 1.02
```
Approve, then show the order in the Open Orders table.

### 2:10 - 2:30 Audit log and activity
Scroll to Audit Log and Recent Activity to show the recorded decisions and execution trail.

---

## Optional add-ons (if time)
- Yellow session: `DW SESSION_CREATE` then show session info.
- Chat suggestion: type "send 1 usdc to 0x..." in Chat and show the suggested command.
- Auto insert: type `!execute send 1 usdc to 0x...` and show it inserted into Commands.
- Auto-proposal: set `AGENT_AUTOPROPOSE=1` and show the agent inserting `DW SESSION_CREATE` or `DW POLICY ENS <name>`.
