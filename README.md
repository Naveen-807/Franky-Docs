# FrankyDocs

FrankyDocs turns a Google Doc into a production-grade Bitcoin Cash treasury — send BCH, issue CashTokens/NFTs, create multisig wallets, deploy time-locked vaults, and generate payment requests, all from a shared Google Doc.

## Features

- **BCH Wallets** — auto-provisioned per document, master-key encrypted
- **CashTokens** — fungible token issuance and transfer (CHIP-2022-02)
- **NFTs** — mint, send, balance, and peer-to-peer marketplace listing
- **Multisig Wallets** — real M-of-N P2SH with BIP-143 spending
- **Time-Locked Vaults** — OP_CLTV P2SH with claim/reclaim support
- **Payment Requests** — BCH URI + QR code generation and monitoring
- **Conditional Orders** — stop-loss and take-profit on BCH price triggers
- **Scheduler** — recurring commands via `DW SCHEDULE`
- **Dashboard UI** — HTTP dashboard with command history and approval flow

## Commands

### Core
| Command | Description |
|---|---|
| `DW SETUP` | Provision BCH wallet for this document |
| `DW STATUS` | Runtime status |
| `DW TREASURY` | All wallet balances |

### BCH Transactions
| Command | Description |
|---|---|
| `DW BCH_PRICE` | Fetch BCH/USD price |
| `DW BCH_SEND <addr> <sats>` | Send BCH |
| `DW BCH_TOKEN_ISSUE <ticker> <name> <supply>` | Issue CashToken |
| `DW BCH_TOKEN_SEND <addr> <category> <amount>` | Send CashToken |
| `DW BCH_TOKEN_BALANCE` | View BCH + token balances |
| `DW BCH_STOP_LOSS <qty> @ <price>` | Create stop-loss order |
| `DW BCH_TAKE_PROFIT <qty> @ <price>` | Create take-profit order |

### NFTs
| Command | Description |
|---|---|
| `DW NFT_MINT <ticker> "<name>" <qty>` | Mint NFT collection |
| `DW NFT_SEND <to> <category> <amount>` | Transfer NFTs |
| `DW NFT_BALANCE` | View NFT holdings |
| `DW NFT_MARKET_LIST <tokenId> <priceBch>` | List NFT for sale |
| `DW NFT_MARKET_BUY <listingId>` | Buy listed NFT |

### Multisig Wallets
| Command | Description |
|---|---|
| `DW BCH_MULTISIG_CREATE <M>-of-<N> <pubkey...>` | Create M-of-N P2SH wallet |
| `DW BCH_MULTISIG_BALANCE` | View multisig balances |
| `DW BCH_MULTISIG_SEND <to> <sats>` | Spend from multisig |

### Time-Locked Vaults
| Command | Description |
|---|---|
| `DW CASH_VAULT_CREATE <sats> <unlockTime>` | Deploy CLTV vault |
| `DW CASH_VAULT_CLAIM <address>` | Claim after timelock |
| `DW CASH_VAULT_RECLAIM <address>` | Reclaim before timelock |
| `DW CASH_VAULT_STATUS <address>` | Check vault status |

### Payment Requests
| Command | Description |
|---|---|
| `DW PAYMENT_REQUEST <bch> "<description>"` | Create payment URI |
| `DW PAYMENT_CHECK <requestId>` | Check payment status |
| `DW PAYMENT_QR <requestId>` | Get payment QR URI |

### Scheduling
| Command | Description |
|---|---|
| `DW SCHEDULE EVERY <n>h: <command>` | Schedule recurring command |
| `DW CANCEL_SCHEDULE <scheduleId>` | Cancel schedule |

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your Google service account and master key
npm run dev
```

Dashboard: `http://localhost:8787`
API status: `http://localhost:8787/api/status`

## Validate

```bash
npx tsc --noEmit -p tsconfig.build.json
npm test
```

## Environment

```env
GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/service-account.json
DOCWALLET_MASTER_KEY=<64-char hex>
BCH_ENABLED=1
BCH_NETWORK=chipnet
BCH_REST_URL=https://chipnet.fullstack.cash/v5/
HTTP_PORT=8787
```

See `.env.example` for all options.

## Network

Operates on BCH **Chipnet** (testnet) by default. Set `BCH_NETWORK=mainnet` and update `BCH_REST_URL` for production.

## License

MIT
