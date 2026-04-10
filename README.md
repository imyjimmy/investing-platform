# IBKR Options Visualization Dashboard

This repo now includes a local-first trader dashboard for **Van Aken Investments LLC** that connects to the **Interactive Brokers socket API through IB Gateway or TWS**, using `ib_insync` on the backend.

The original options-scanner pipeline is still present under `src/options_scanner/`, but the new MVP is built around a FastAPI service plus a React workstation UI for:

- account summary and liquidity
- Coinbase account balances and USD-valued crypto holdings
- short puts and covered calls
- open order capital commitments
- NVDA-first chain exploration
- expiry stack and ticker concentration
- simple assignment-risk and collateral heuristics
- SEC EDGAR metadata and filing document sync into a local research library
- offline fake-data mode for UI work

## Stack

- Backend: Python + FastAPI + `ib_insync`
- Frontend: React + TypeScript + Tailwind CSS
- Desktop shell: Tauri 2
- Charts: Recharts
- Data mode: `mock` or `ibkr`

## What the MVP does

- Connects to local IB Gateway on `127.0.0.1`
- Defaults to the IB Gateway paper port `4002` when running live mode
- Pulls account summary, portfolio positions, and open orders
- Pulls Coinbase account balances into a separate Van Aken dashboard section
- Normalizes option positions into short-put / covered-call views
- Estimates collateral usage and free option-selling capacity
- Fetches option chains for selected symbols, including **NVDA**
- Previews paper option orders with IBKR `whatIf`
- Submits paper option orders from the chain explorer with explicit account routing
- Cancels open paper orders from the desktop dashboard
- Shows exposure by ticker and expiry
- Runs a simple portfolio shock scenario
- Syncs SEC EDGAR machine state into `/stocks/[ticker]/.edgar`, filing folders into `/stocks/[ticker]/`, and generated PDFs into a user-selectable layout such as `/stocks/[ticker]/pdfs/[filing]/`

## Quick start

1. Create the Python environment and install backend dependencies:

```bash
./scripts/bootstrap.sh
```

2. Copy the env template:

```bash
cp .env.example .env
```

3. For offline development, leave `OPTIONS_DASHBOARD_DATA_MODE=mock`.

4. For a live IB Gateway session, change these values in `.env`:

```env
OPTIONS_DASHBOARD_DATA_MODE=ibkr
OPTIONS_DASHBOARD_EXECUTION_MODE=paper
OPTIONS_DASHBOARD_IB_HOST=127.0.0.1
OPTIONS_DASHBOARD_IB_PORT=4002
OPTIONS_DASHBOARD_IB_CLIENT_ID=17
OPTIONS_DASHBOARD_IB_MARKET_DATA_TYPE=1
```

For the EDGAR source, also set your research root and a descriptive SEC user agent:

```env
OPTIONS_DASHBOARD_RESEARCH_ROOT=~/Documents/Finances/research
OPTIONS_DASHBOARD_EDGAR_USER_AGENT=Your Name your_email@example.com
OPTIONS_DASHBOARD_EDGAR_MAX_REQUESTS_PER_SECOND=5
```

For Coinbase App account access, add either a bearer token or an ECDSA key name + PEM private key from the CDP portal:

```env
COINBASE_API_KEY=
COINBASE_API_KEY_NAME=organizations/{org_id}/apiKeys/{key_id}
COINBASE_API_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n"
COINBASE_API_KEY_FILE=
```

Coinbase’s current docs note that Coinbase App account APIs require an **ECDSA / ES256** key. A raw Ed25519 secret by itself is not enough to read `/v2/accounts`.

If you use paper **TWS** instead of **IB Gateway**, the paper socket port is commonly `7497` instead of `4002`.

7. In IB Gateway or TWS, open `Configure` -> `Settings` -> `API` -> `Settings`, make sure `Enable ActiveX and Socket Clients` is checked, and uncheck `Read-Only API`.

5. Install frontend dependencies:

```bash
cd frontend
npm install
cd ..
```

6. Start the browser version:

```bash
./scripts/dev_dashboard.sh
```

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Run the desktop app

To launch the same workstation UI inside a native Tauri window instead of a browser tab:

```bash
./scripts/start_tauri.sh
```

This keeps the dashboard layout the same and wraps it in a desktop shell. The launcher builds the current React UI, opens the native Tauri window, and the Tauri runtime points the UI at the local FastAPI service on `127.0.0.1:8000`.

For hot-reload desktop development instead of the one-shot launcher:

```bash
cd frontend
npm run tauri:dev
```

## Run pieces separately

Backend only:

```bash
./scripts/start_backend.sh
```

Frontend only:

```bash
./scripts/start_frontend.sh
```

Desktop app only:

```bash
./scripts/start_tauri.sh
```

## API surface

The FastAPI service exposes the requested MVP endpoints:

- `GET /api/health`
- `GET /api/connection-status`
- `POST /api/connect`
- `POST /api/reconnect`
- `GET /api/sources/coinbase/status`
- `GET /api/sources/coinbase/portfolio`
- `GET /api/account/summary`
- `GET /api/account/positions`
- `GET /api/account/options-positions`
- `GET /api/account/open-orders`
- `GET /api/account/risk-summary`
- `GET /api/market/underlying/{symbol}`
- `GET /api/market/chain/{symbol}`
- `GET /api/market/option-contract`
- `GET /api/analytics/collateral`
- `GET /api/analytics/exposure-by-ticker`
- `GET /api/analytics/exposure-by-expiry`
- `GET /api/analytics/premium-summary`
- `GET /api/analytics/scenario`
- `POST /api/execution/options/preview`
- `POST /api/execution/options/submit`
- `POST /api/execution/orders/{orderId}/cancel`
- `GET /api/sources/edgar/status`
- `POST /api/sources/edgar/download`

## Helper scripts

IB Gateway smoke test:

```bash
./scripts/venv.sh run -- python scripts/test_ib_gateway.py
```

NVDA chain fetch example:

```bash
./scripts/venv.sh run -- python scripts/fetch_nvda_chain.py
```

Positions parser:

```bash
./scripts/venv.sh run -- python scripts/parse_positions.py
```

SEC EDGAR download helper:

```bash
./scripts/sec-download --ticker AEHR --form 8-K --mode primary-document
./scripts/sec-download --ticker NVDA --start-date 2026-01-01 --mode metadata-only
```

## Notes on live data

- The app uses the **socket API**, not the Client Portal REST gateway.
- The Tauri desktop shell uses the same React dashboard UI as the browser version.
- Execution is intentionally **paper-only** right now. Live-account order routing is blocked in the backend.
- Order submission is explicit-account only. Market data remains gateway-wide, and the current connected account is used for the paper ticket.
- EDGAR downloads use checksum-based resume with machine state under `[research root]/stocks/[ticker]/.edgar/`, filing folders under `[research root]/stocks/[ticker]/`, and generated PDFs in a configurable layout such as `[research root]/stocks/[ticker]/pdfs/[filing]/`.
- Coinbase account access follows the current Coinbase App auth flow from the CDP docs: bearer token or per-request JWT signed with an ECDSA private key.
- If market data permissions are missing, some quotes and Greeks may be delayed, partial, or unavailable.
- Collateral, assignment risk, and scenario outputs are deliberately labeled as heuristics where appropriate.
- When the gateway is unavailable, the backend returns readable connection errors and will fall back to stale cached snapshots when it has them.

## Repo layout

```text
options-platform/
  frontend/
    src-tauri/
  scripts/
  src/
    options_dashboard/
    options_scanner/
  .env.example
  requirements.txt
```
