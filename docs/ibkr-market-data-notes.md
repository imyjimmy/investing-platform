# IBKR Market Data Notes

## Snapshot Market Data

Recorded from IBKR materials on 2026-04-12 for future dashboard and gateway setup work.

- All clients have access to delayed market data by default.
- Real-time quotes can be requested on demand through snapshot market data without a monthly streaming subscription.
- Snapshot quotes are charged per request.
- The first USD 1.00 of snapshot usage each month is waived.

### Snapshot Pricing

- Free: delayed market data
- USD 0.01: per US equity snapshot
- USD 0.03: all other product snapshots

## Complimentary Real-Time Services

Recorded from the account subscription page on 2026-04-12.

### Automatically Included

- IDEALPRO FX (IDEAL PRO)
- US Real-Time Non Consolidated Streaming Quotes (IBKR-PRO)
- US and EU Bond Quotes (L1)
- US Mutual Funds (P,L1)
- PAXOS Cryptocurrency US
- CME Event Contracts

### Available To Subscribe At No Charge

- IDEAL FX (IDEAL)

### Why This Matters For Us

- A paper or underfunded account may still show delayed data even when live streaming subscriptions are missing.
- Snapshot access is not the same thing as full streaming market data or options Greeks availability through the API.
- The complimentary real-time services listed above do not include a US listed options feed such as OPRA.
- When debugging missing Greeks or option model data, we should distinguish:
  - delayed default data
  - paid snapshot access
  - streaming market data subscriptions
  - API market data acknowledgement / certification
