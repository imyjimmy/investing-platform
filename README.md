# IBKR Options Visualization Dashboard

This repo now includes a local-first trader dashboard for **Van Aken Investments LLC** that connects to the **Interactive Brokers socket API through IB Gateway or TWS**, using `ib_insync` on the backend.

The original options-scanner pipeline is still present under `src/options_scanner/`, but the new MVP is built around a FastAPI service plus a React workstation UI for:

- account summary and liquidity
- short puts and covered calls
- open order capital commitments
- NVDA-first chain exploration
- expiry stack and ticker concentration
- simple assignment-risk and collateral heuristics
- offline fake-data mode for UI work

## Stack

- Backend: Python + FastAPI + `ib_insync`
- Frontend: React + TypeScript + Tailwind CSS
- Charts: Recharts
- Data mode: `mock` or `ibkr`

## What the MVP does

- Connects to local IB Gateway on `127.0.0.1`
- Defaults to the IB Gateway paper port `4002` when running live mode
- Pulls account summary, portfolio positions, and open orders
- Normalizes option positions into short-put / covered-call views
- Estimates collateral usage and free option-selling capacity
- Fetches option chains for selected symbols, including **NVDA**
- Shows exposure by ticker and expiry
- Runs a simple portfolio shock scenario

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
OPTIONS_DASHBOARD_IB_HOST=127.0.0.1
OPTIONS_DASHBOARD_IB_PORT=4002
OPTIONS_DASHBOARD_IB_CLIENT_ID=17
OPTIONS_DASHBOARD_IB_MARKET_DATA_TYPE=1
```

If you use paper **TWS** instead of **IB Gateway**, the paper socket port is commonly `7497` instead of `4002`.

5. Install frontend dependencies:

```bash
cd frontend
npm install
cd ..
```

6. Start both apps:

```bash
./scripts/dev_dashboard.sh
```

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Run pieces separately

Backend only:

```bash
./scripts/start_backend.sh
```

Frontend only:

```bash
./scripts/start_frontend.sh
```

## API surface

The FastAPI service exposes the requested MVP endpoints:

- `GET /api/health`
- `GET /api/connection-status`
- `POST /api/connect`
- `POST /api/reconnect`
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

## Notes on live data

- The app uses the **socket API**, not the Client Portal REST gateway.
- If market data permissions are missing, some quotes and Greeks may be delayed, partial, or unavailable.
- Collateral, assignment risk, and scenario outputs are deliberately labeled as heuristics where appropriate.
- When the gateway is unavailable, the backend returns readable connection errors and will fall back to stale cached snapshots when it has them.

## Repo layout

```text
options-platform/
  frontend/
  scripts/
  src/
    options_dashboard/
    options_scanner/
  .env.example
  requirements.txt
```
