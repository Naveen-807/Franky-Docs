# FrankyDocs (DocWallet) — Full Project Analysis

## 1. Project Identity and Purpose

### 1.1 Public and Internal Naming

#### 1.1.1 Public Name: FrankyDocs

The **public-facing brand "FrankyDocs"** positions the project as an approachable, user-friendly entry point into decentralized finance. The name deliberately evokes familiarity and accessibility—qualities often absent in DeFi products—while signaling the core innovation of document-based financial management. This branding choice targets judges, potential users, and investors who may lack deep technical expertise but understand the value of simplifying complex workflows.

#### 1.1.2 Internal Name: DocWallet

The **internal name "DocWallet"** permeates every layer of the technical infrastructure, establishing consistent semantic anchors across:

| Usage Pattern | Example |
|-------------|---------|
| Environment variables | `DOCWALLET_MASTER_KEY`, `DOCWALLET_DOC_ID`, `DOCWALLET_DISCOVER_ALL` |
| Database tables | `doc_settings`, `doc_config`, `yellow_session_keys` |
| Template anchors | `DOCWALLET_CONFIG_ANCHOR`, `DOCWALLET_COMMANDS_ANCHOR` |
| Policy files | `docwallet.policy` (ENS text record standard) |

This systematic naming convention reduces cognitive load for developers navigating the codebase and ensures that configuration, persistence, and interface elements maintain coherent relationships. The distinction between public and internal naming also creates strategic flexibility: the "FrankyDocs" brand can evolve or white-label for enterprise deployments while "DocWallet" remains the stable technical foundation.

#### 1.1.3 npm Package Name: docwallet

The **npm package name `docwallet`** in `package.json` reinforces internal naming consistency. The **version 0.1.0** with **private visibility** indicates pre-release status appropriate for hackathon development, preventing accidental publication to the public registry and protecting work-in-progress from premature distribution.

### 1.2 Event and Competition Context

#### 1.2.1 Event: HackMoney 2026 (ETHGlobal)

**HackMoney 2026** represents one of ETHGlobal's premier DeFi-focused hackathons, with substantial prize pools and significant visibility within the Ethereum ecosystem. The event attracts both established protocols seeking innovative integrations and emerging teams building novel financial infrastructure.

#### 1.2.2 Tracks: Yellow · Arc · Sui DeepBook · ENS

FrankyDocs strategically targets **four sponsor tracks** with combined direct prizes of **$40,000**, plus substantial finalist perks:

| Track | Prize Pool | Core Technology | FrankyDocs Integration |
|-------|-----------|-----------------|------------------------|
| **Yellow Network** | $15,000 | Nitrolite state channels, gasless transactions | Complete session lifecycle: `SESSION_CREATE`, `YELLOW_SEND`, `submitGaslessApproval` |
| **Arc by Circle** | $10,000 | USDC-native L1, CCTP cross-chain bridge | Arc wallet client, Circle developer-controlled wallets, CCTP bridging |
| **Sui DeepBook** | $10,000 | High-performance order book DEX | DeepBook v3 limit/market orders, BalanceManager, conditional orders |
| **ENS** | $5,000 | Decentralized naming, text records | `docwallet.policy` text record resolution, policy-as-code |

The **HackMoney 2026 Finalist Pack** adds substantial value beyond track prizes: **$828 off ETHGlobal Plus membership**, **1,000 USDC per team member**, **$500 flight reimbursement for 2026 hackathons**, **exclusive finalist hoodies**, and **$10,000 in AWS credits**. This structure incentivizes teams to pursue finalist status aggressively, as cumulative perks can exceed individual track winnings.

#### 1.2.3 One-Line Pitch

> **"Turn any Google Doc into a multi-chain DeFi treasury. Proposers don't need a wallet; approvers sign once (e.g., via Yellow delegated keys, gasless). An agent monitors prices, stop-losses, yield sweeps, and rebalances across Arc and Sui."**

This pitch encapsulates three transformative innovations: **walletless proposal creation** through familiar document editing; **single-signature gasless approval** via Yellow's state channel infrastructure; and **autonomous treasury management** with cross-chain execution. Each element addresses critical friction points in DeFi adoption while building on the others to create a cohesive user experience.

### 1.3 Core Value Proposition

#### 1.3.1 Proposers Don't Need a Wallet

FrankyDocs **inverts traditional DeFi onboarding** by decoupling proposal creation from cryptographic identity. Users with document access can initiate financial operations—trades, payouts, rebalancing—through natural language or structured commands in Google Docs tables. This architectural decision dramatically expands the addressable user base to include:

- **Corporate treasurers** familiar with spreadsheet workflows but lacking blockchain expertise
- **DAO contributors** who participate in governance without maintaining personal wallets
- **Non-technical stakeholders** who need visibility and input into financial decisions

The security model maintains integrity by reserving cryptographic operations for approvers, creating a clean separation between **initiation** (low barrier, high participation) and **authorization** (high security, controlled access).

#### 1.3.2 Approvers Sign Once (Gasless via Yellow Delegated Keys)

The **approval experience** leverages Yellow Network's Nitrolite protocol to eliminate the friction of traditional multi-signature workflows. Rather than requiring each approver to execute individual on-chain transactions—with associated gas costs, confirmation delays, and wallet management overhead—FrankyDocs implements:

| Traditional Multi-Sig | FrankyDocs with Yellow |
|----------------------|------------------------|
| N separate on-chain transactions | One-time session establishment |
| Gas fees per approval | Gasless off-chain signatures |
| Block confirmation delays | Instant state channel updates |
| Complex coordination | Automated quorum aggregation |

The **delegated key architecture** enables approvers to establish session keys with predefined spending allowances and policy constraints. Subsequent approvals use EIP-712 typed data signatures that are aggregated off-chain and submitted as batched state updates, achieving **Web2-speed responsiveness with Web3-security guarantees**.

#### 1.3.3 Agent Monitors, Executes, and Rebalances

The **autonomous agent layer** transforms static treasuries into dynamic, self-managing financial instruments. Continuous operation enables strategies that would be impractical with manual intervention:

| Agent Function | Trigger Condition | Execution |
|--------------|-------------------|-----------|
| **Price monitoring** | DeepBook mid-price updates | Cache to `price_cache`, evaluate conditional orders |
| **Stop-loss execution** | Price ≤ trigger threshold | Create `MARKET_SELL` command, auto-approve, execute |
| **Take-profit realization** | Price ≥ trigger threshold | Same flow for gain capture |
| **Yield sweeping** | Detected APR differential > threshold | `SWEEP_YIELD` command creation |
| **Cross-chain rebalancing** | Allocation drift beyond target band | `REBALANCE` with Arc/Sui coordination |

This automation operates within **policy-enforced boundaries**—ENS-resolved or document-configured constraints on notional limits, daily spending, allowed chains, and prohibited operations—ensuring that autonomy does not compromise security.

## 2. Technical Architecture and Implementation

### 2.1 Runtime and Tooling

#### 2.1.1 Runtime: Node.js 20+, ESM

FrankyDocs targets **Node.js 20+** for its mature ESM support, performance improvements, and long-term stability guarantees. The explicit **`"type": "module"`** declaration commits to ECMAScript Modules, enabling:

- **Tree-shaking** for optimized bundle sizes
- **Top-level await** for cleaner asynchronous initialization
- **Static import analysis** for dependency auditing and security review

This modern module system aligns with contemporary blockchain library development, ensuring compatibility with `viem`, `@mysten/sui`, and other ESM-native dependencies.

#### 2.1.2 Language: TypeScript (Strict, ES2022, Bundler Resolution)

The **TypeScript configuration** enforces maximum compile-time safety:

| Setting | Purpose |
|---------|---------|
| `strict: true` | Enables all strict type-checking options |
| `target: ES2022` | Access to modern language features (`at()`, `Object.hasOwn()`, `Error.cause`) |
| `moduleResolution: "Bundler"` | Optimized for Vite, esbuild, webpack tooling |

This aggressive type safety is particularly valuable for financial software, where undefined behavior can have direct monetary consequences. The "Bundler" resolution strategy ensures compatibility with modern build tools while maintaining clean dependency graphs.

#### 2.1.3 Build: tsc Compilation to dist/

The **build pipeline** uses `tsc -p tsconfig.build.json` to emit compiled JavaScript to **`dist/`**, with **tests explicitly excluded** from production artifacts. This separation ensures:

- **Deployment reproducibility**: Pre-compiled, version-locked output
- **Reduced attack surface**: No test utilities or development dependencies in production
- **Faster cold starts**: No runtime transpilation overhead

The dual-path execution model—`tsx` for development, compiled output for production—balances iteration speed with operational reliability.

#### 2.1.4 Tests: Vitest, Node Environment

**Vitest** provides modern test execution with:

- **Native ESM support**: No transpilation configuration required
- **Instant test discovery**: Dependency graph-based file watching
- **Compatible API**: Jest-like assertions with improved performance

Test files follow the **`test/**/*.test.ts`** pattern, with focused suites for commands, policy, repository operations, and state machine validation.

### 2.2 Scripts and Commands

| Script | Command | Purpose |
|--------|---------|---------|
| `npm run dev` | `tsx src/index.ts` | Rapid development with hot-reload TypeScript execution |
| `npm run build` | `tsc -p tsconfig.build.json` | Production compilation to `dist/` |
| `npm start` | `node dist/index.js` | Production server execution |
| `npm run doctor` | `tsx src/tools/doctor.ts` | **Comprehensive environment and integration validation** |
| `npm test` | `vitest` | Single test run |
| `npm run test:watch` | `vitest --watch` | Continuous test execution |

The **`npm run doctor`** command is a **hackathon-optimized operational tool**. This diagnostic utility performs:

- Environment variable validation against Zod schemas
- Google API authentication and permission verification
- Blockchain RPC endpoint connectivity and chain ID validation
- Circle API credential testing with sandbox transactions
- Yellow NitroRPC endpoint health checks
- WalletConnect relay availability verification

### 2.3 Directory Structure

#### 2.3.1 Source: src/

| Module | Responsibility |
|--------|--------------|
| `config/` | Zod-validated environment configuration |
| `index.ts` | Application entry point, integration client instantiation |
| `engine.ts` | Core orchestration: discovery, poll, executor, agent loops |
| `server.ts` | HTTP API and web interface |
| `core/` | Domain logic: commands, policy, state machine |
| `db/` | SQLite persistence with repository pattern |
| `google/` | Google Workspace integration (auth, clients, docs, drive, template, docwallet) |
| `integrations/` | Blockchain clients: Arc, Circle, DeepBook, ENS, Yellow, WalletConnect |
| `wallet/` | Cryptographic operations: encryption, key generation, secret storage |
| `util/`, `tools/`, `types/` | Shared utilities, CLI tools, TypeScript definitions |

#### 2.3.2 Tests: test/

| Test File | Coverage |
|-----------|----------|
| `commands.test.ts` | Core command parsing |
| `commands-full.test.ts` | Extended parsing scenarios and edge cases (153 tests) |
| `policy.test.ts` | Policy evaluation: allow/deny decisions, constraint enforcement |
| `repo-metrics.test.ts` | Database query patterns and performance |
| `state.test.ts` | Command state machine transition correctness |

## 3. Dependencies and Configuration

### 3.1 Production Dependencies

| Category | Package | Purpose |
|----------|---------|---------|
| **Google** | `googleapis` | Docs/Drive API access |
| **Database** | `better-sqlite3` | SQLite with native bindings (synchronous API) |
| **Circle** | `@circle-fin/developer-controlled-wallets` | Custodial wallet infrastructure |
| **Sui/DeepBook** | `@mysten/deepbook-v3`, `@mysten/sui` | Native Sui development |
| **EVM** | `viem` | Modern Ethereum client |
| **Crypto** | `@noble/curves` | ECDSA secp256k1 for Yellow NitroRPC signing |
| **WalletConnect** | `@walletconnect/core`, `@walletconnect/utils`, `@walletconnect/web3wallet` | dApp connection protocol |
| **Crypto** | `node-forge` | Additional cryptographic primitives |
| **Validation** | `zod` | Runtime schema validation |
| **Environment** | `dotenv` | Configuration loading |

### 3.2 Environment Configuration

See `.env.example` for all available variables with defaults and descriptions.

The **Zod-based configuration validation** implements **conditional requirement logic** that adapts validation based on enabled features:

| Integration | Enable Flag | Required When Enabled |
|-------------|-------------|----------------------|
| Sui/DeepBook | `DEEPBOOK_ENABLED=1` | `SUI_RPC_URL` |
| Arc | `ARC_ENABLED=1` | `ARC_RPC_URL`, `ARC_USDC_ADDRESS` |
| Circle | `CIRCLE_ENABLED=1` | `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` |
| Yellow | `YELLOW_ENABLED=1` | `YELLOW_RPC_URL` |
| WalletConnect | `WALLETCONNECT_ENABLED=1` | `WALLETCONNECT_PROJECT_ID` |

## 4. Sponsor Track Strategy

### 4.1 Yellow Network ($15,000)

**Winning angle**: Position as **"policy-enforced treasury governance via state channels"**—not merely Yellow SDK integration, but elevation of Nitrolite to institutional multi-sig use cases with document-native UX.

### 4.2 Arc by Circle ($10,000)

**Three bounties**: Chain Abstracted USDC Apps ($5,000), Global Payouts and Treasury Systems ($2,500), Agentic Commerce App ($2,500).

**Winning angle**: **"Multi-chain treasury with Circle-grade compliance"**—developer-controlled wallets for institutional custody, CCTP for unified liquidity, agent automation for 24/7 operations.

### 4.3 Sui DeepBook ($10,000)

**Winning angle**: **"Cross-chain order book aggregation with agent-driven execution"**—sophisticated trading infrastructure accessible through Google Docs.

### 4.4 ENS ($5,000)

**Winning angle**: **`docwallet.policy` text records as policy-as-code infrastructure**—decentralized, updatable, auditable treasury constraints with human-readable naming.

### 4.5 Patterns from Previous Winners

| Pattern | FrankyDocs Implementation |
|---------|---------------------------|
| Multi-sponsor integration (3+ APIs) | Yellow + Arc + Sui + ENS in unified architecture |
| Clear problem-solution narrative | Web2 familiarity (Google Docs) → Web3 power (multi-chain DeFi) |
| Demonstrable live transactions | Real testnet execution with explorer links |
| Agentic autonomy | Continuous monitoring, conditional execution, autonomous rebalancing |
| Sponsor-specific demo videos | Modular 2–3 minute segments per track |

## 5. Security and Trust Model

| Layer | Mechanism |
|-------|-----------|
| Master key | 32-byte AES-256-GCM root, environment-provisioned |
| Secret storage | Per-document encrypted blobs, decrypted only when needed |
| Approvals | Web (`personal_sign`) or Yellow (EIP-712 + NitroRPC) |
| Policy enforcement | ENS-resolved or document-configured constraints |
| Quorum | N-of-M weighted signers per document |

---

*Analysis prepared for HackMoney 2026 submission strategy.*
