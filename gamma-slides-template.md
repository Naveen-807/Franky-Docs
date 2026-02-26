# FrankyDocs - BCH-1 Hackcelerator Pitch
## Gamma.app Slide Templates

---

## SLIDE 1: Title Slide

**Title:** FrankyDocs
**Subtitle:** Your Google Doc is Now a Bitcoin Cash Treasury
**Tagline:** No wallets. No keys. Just type.

**Visual:** 
- Google Docs logo + Bitcoin Cash logo merged
- Clean, minimal design with BCH green (#0AC18E)

**Footer:** BCH-1 Hackcelerator 2026 | Applications Track

---

## SLIDE 2: The Problem

**Headline:** Web3 Treasury Management is Broken

**3 Pain Points (with icons):**

📱 **Wallet Complexity**
"Install MetaMask, save 12 words, approve every transaction..."
→ 3 billion Google Docs users won't do this

💸 **Payment Friction**
"Pay 10 contractors = 10 separate transactions = $50 in fees"
→ Traditional payroll is one click

🔐 **Multi-sig Hell**
"Set up Gnosis Safe, coordinate 5 signers, wait 3 days..."
→ DAOs need treasury control without PhD

**Bottom text:** *We keep asking normal people to become blockchain developers just to move money.*

---

## SLIDE 3: The Solution

**Headline:** FrankyDocs = Google Docs + Bitcoin Cash

**Visual:** Split screen comparison

**LEFT SIDE - Traditional Crypto:**
```
1. Install wallet extension
2. Save seed phrase
3. Buy crypto on exchange
4. Transfer to wallet
5. Connect to dApp
6. Approve transaction
7. Pay gas fees
8. Wait for confirmation
```

**RIGHT SIDE - FrankyDocs:**
```
1. Open Google Doc
2. Type: "pay alice 100 USD"
3. Done ✓
```

**Tagline:** *The interface is a document. The blockchain is invisible.*

---

## SLIDE 4: Introduction - What is FrankyDocs?

**Headline:** A Headless Bitcoin Cash Treasury Inside Google Docs

**3 Core Concepts (visual cards):**

🤖 **Autonomous Agent**
Polls your Google Doc every 15 seconds
Parses natural language commands
Executes BCH transactions automatically

📊 **Living Spreadsheet**
Commands in → Results out
Real-time balance updates
Full audit trail in the doc

⛓️ **BCH-Native**
CashTokens for tokens & NFTs
Multi-sig with Bitcoin Script
CashScript smart contracts
Live on Chipnet testnet

**Bottom:** *3 billion people already know how to use Google Docs. Now they can use Bitcoin Cash.*

---

## SLIDE 5: How It Works - Architecture

**Headline:** Under the Hood: 9 Concurrent Loops

**Visual:** Circular diagram with Google Doc in center

**CENTER:** Google Doc (Command Table)

**SURROUNDING LOOPS (clockwise):**
1. 🔍 **Discovery** - Find new docs to track
2. 📖 **Poll** - Read commands from docs
3. ⚡ **Execute** - Run BCH transactions
4. 💰 **Balances** - Update wallet balances
5. 📅 **Scheduler** - Run recurring payments
6. 💵 **Price** - Fetch BCH/USD rates
7. 🤖 **Agent** - AI decision making
8. 💸 **Payouts** - Enforce spending limits
9. 💬 **Chat** - Process user messages

**Bottom:** *Node.js engine + SQLite + Google Docs API + BCH Chipnet*

---

## SLIDE 6: How It Works - Command Flow

**Headline:** From Text to Transaction in 5 Seconds

**Visual:** Horizontal flow diagram with 5 steps

**STEP 1: User Types**
```
DW BCH_PAYROLL 5000 USD TO
alice:30%, bob:40%, charlie:30%
```
📝 In Google Doc command table

**STEP 2: Engine Polls**
🔄 Every 15 seconds
Detects new command
Status: PENDING

**STEP 3: Parser Validates**
✅ Command type: BCH_PAYROLL
✅ Amount: 5000 USD
✅ Recipients: 3 addresses
✅ Percentages: 100% total

**STEP 4: BCH Execution**
⛓️ Fetch BCH/USD price ($450)
⛓️ Calculate: 11.11 BCH total
⛓️ Split: 3.33, 4.44, 3.33 BCH
⛓️ Build multi-output transaction
⛓️ Sign with wallet key
⛓️ Broadcast to Chipnet

**STEP 5: Result Updates**
✅ Status: COMPLETED
✅ TX: chipnet.chaingraph.cash/tx/abc123...
✅ Audit trail in doc
✅ Balance updated

**Bottom:** *Total time: 3-5 seconds from command to confirmation*

---

## SLIDE 7: How It Works - Tech Stack

**Headline:** Built on Bitcoin Cash Primitives

**4 Columns (BCH features):**

**Column 1: CashTokens**
🪙 Native fungible tokens
🎨 Native NFTs (no smart contracts)
📦 Batch 100 recipients in one TX
💰 Pennies in fees vs $50 on Ethereum

**Column 2: Multi-sig**
🔐 M-of-N approval (2-of-3, 3-of-5)
📜 Pure Bitcoin Script (P2SH)
✍️ Threshold signatures
🏦 DAO treasury control

**Column 3: CashScript**
⚡ Smart contracts on Bitcoin Cash
🔒 Escrow (client ↔ freelancer)
⏰ Time-locked vaults (CLTV)
🤝 Arbiter logic

**Column 4: Payments**
📱 BIP-21 payment URIs
📷 QR codes for mobile wallets
🧾 Invoice generation
💵 Live BCH/USD conversion

**Bottom:** *Everything runs on Chipnet testnet - ready for mainnet*

---

## SLIDE 8: How It Works - Security Model

**Headline:** Enterprise-Grade Security Without Complexity

**3 Security Layers (visual pyramid):**

**LAYER 1 (Base): Encrypted Storage**
🔐 AES-256 encryption for private keys
🔑 Master key from environment variable
💾 SQLite with WAL mode
🚫 Keys never exposed in logs/API

**LAYER 2 (Middle): Multi-sig Approval**
✍️ M-of-N threshold signatures
👥 Multiple signers must approve
⏱️ Pending transaction queue
📋 Approval audit trail

**LAYER 3 (Top): Policy Enforcement**
💸 Spending limits per command
⏰ Rate limiting (max TX per hour)
🚨 Anomaly detection
📊 Real-time monitoring

**Bottom:** *Security model designed for DAOs managing $1M+ treasuries*

---

## SLIDE 9: Demo Commands

**Headline:** 10 Commands That Replace 10 DeFi Apps

**2 Columns of commands:**

**LEFT COLUMN:**

**1. Setup**
```
DW SETUP
```
→ Generates BCH wallet

**2. Send BCH**
```
DW BCH_SEND bitcoincash:qp... 10000
```
→ Transfer 10k satoshis

**3. Payroll**
```
DW BCH_PAYROLL 5000 USD TO
alice:30%, bob:40%, charlie:30%
```
→ Split payment to team

**4. Issue Token**
```
DW BCH_TOKEN_ISSUE MYTOKEN "My Token" 1000000
```
→ Create CashToken

**5. Airdrop**
```
DW TOKEN_AIRDROP MYTOKEN 100 TO addresses.csv
```
→ Batch send to 100 wallets

**RIGHT COLUMN:**

**6. Subscribe**
```
DW BCH_SUBSCRIBE 0.01 BCH TO merchant EVERY 30 DAYS
```
→ Recurring payment

**7. Invoice**
```
DW INVOICE CREATE 0.05 BCH FOR "Website Design"
```
→ Payment request + QR code

**8. Escrow**
```
DW ESCROW_CREATE 1 BCH BETWEEN client AND freelancer
```
→ CashScript contract

**9. Multi-sig**
```
DW BCH_MULTISIG_CREATE 2-of-3 [pubkey1,pubkey2,pubkey3]
```
→ DAO treasury

**10. NFT Mint**
```
DW NFT_MINT "CoolArt #1" ipfs://...
```
→ CashTokens NFT

**Bottom:** *Natural language → Blockchain transactions*

---

## SLIDE 10: Use Cases

**Headline:** 5 Real-World Problems We Solve Today

**5 Cards (icon + title + description):**

**1. 🏢 DAO Treasuries**
Multi-sig approval for all payments
No Gnosis Safe complexity
Full audit trail in Google Doc
*"Manage $500K treasury with 5 signers"*

**2. 💼 International Payroll**
Pay contractors in 50 countries
USD → BCH conversion automatic
Single transaction = entire team paid
*"Replace Wise/PayPal, save 3-5% fees"*

**3. 🪂 Token Airdrops**
Distribute to 1000+ addresses
Batch optimization (save 90% fees)
Progress tracking in real-time
*"Launch your CashToken in 5 minutes"*

**4. 🤝 Freelance Escrow**
Client deposits → Freelancer delivers → Release
CashScript arbiter for disputes
Zero platform fees
*"Trustless Upwork on Bitcoin Cash"*

**5. 🏪 Merchant Payments**
Generate invoices with QR codes
Auto-detect payment on-chain
No Stripe/PayPal 2.9% fees
*"Accept BCH like accepting cash"*

---

## SLIDE 11: Why Bitcoin Cash?

**Headline:** BCH is Built for Real-World Payments

**Comparison Table:**

| Feature | Bitcoin Cash | Ethereum | Solana |
|---------|-------------|----------|--------|
| **TX Fee** | $0.001 | $5-50 | $0.01 |
| **Confirmation** | 10 min | 15 sec | 0.4 sec |
| **Native Tokens** | ✅ CashTokens | ❌ ERC-20 | ❌ SPL |
| **Native NFTs** | ✅ CashTokens | ❌ ERC-721 | ❌ Metaplex |
| **Smart Contracts** | ✅ CashScript | ✅ Solidity | ✅ Rust |
| **Multi-sig** | ✅ Native P2SH | ⚠️ Gnosis | ⚠️ Squads |
| **Merchant Adoption** | ✅ High | ❌ Low | ❌ Low |

**Bottom callout:**
*BCH = Bitcoin's original vision: peer-to-peer electronic cash*
*Low fees + fast confirms + native tokens = perfect for treasury management*

---

## SLIDE 12: Live Demo

**Headline:** See It In Action (Chipnet Testnet)

**Visual:** Screenshot of Google Doc with command table

**Command Table Example:**
```
| Command | Status | Result |
|---------|--------|--------|
| DW SETUP | ✅ COMPLETED | Wallet: bitcoincash:qp... |
| DW BCH_PAYROLL 5000 USD TO alice:30%,bob:40%,charlie:30% | ✅ COMPLETED | TX: abc123... |
| DW TOKEN_AIRDROP MYTOKEN 100 TO addresses.csv | ⏳ PROCESSING | 47/100 sent |
| DW INVOICE CREATE 0.05 BCH FOR "Consulting" | ✅ COMPLETED | QR: [image] |
```

**Bottom:**
🔗 **Live Demo Doc:** docs.google.com/document/d/...
🔗 **Chipnet Explorer:** chipnet.chaingraph.cash
🔗 **GitHub:** github.com/yourrepo/frankydocs

---

## BONUS SLIDE: Roadmap (Optional)

**Headline:** What's Next After Hackathon

**3 Phases:**

**Phase 1: Mainnet Launch (Q2 2026)**
- Production deployment
- Security audit
- Mainnet BCH support
- 100+ beta users

**Phase 2: Enterprise Features (Q3 2026)**
- Slack/Discord bot integration
- Mobile app (iOS/Android)
- Advanced analytics dashboard
- White-label solution

**Phase 3: Ecosystem Growth (Q4 2026)**
- Merchant onboarding program
- DAO treasury partnerships
- Integration marketplace
- Multi-language support

---

## DESIGN NOTES FOR GAMMA:

**Color Palette:**
- Primary: BCH Green (#0AC18E)
- Secondary: Dark Gray (#1A1A1A)
- Accent: White (#FFFFFF)
- Highlight: Light Green (#E8F9F4)

**Typography:**
- Headlines: Bold, 48-60pt
- Body: Regular, 18-24pt
- Code blocks: Monospace, 16pt

**Visual Style:**
- Minimal, clean design
- Lots of white space
- Icons for every concept
- Code blocks with syntax highlighting
- Screenshots of actual Google Doc

**Animations (Gamma supports):**
- Fade in for bullet points
- Slide in for diagrams
- Highlight for key numbers

**Key Metrics to Emphasize:**
- 3 billion Google Docs users
- $0.001 BCH transaction fees
- 5 seconds command → transaction
- 100+ addresses in one airdrop
- 0 wallet installations required

---

## GAMMA PROMPT (Copy-Paste This):

"Create a pitch deck for FrankyDocs, a Bitcoin Cash treasury management system that runs inside Google Docs. Use BCH green (#0AC18E) as primary color with dark gray and white. Style should be minimal and modern with lots of white space. Include icons for every concept. Use the slide content provided. Add smooth animations. Make it look professional for a blockchain hackathon pitch."
