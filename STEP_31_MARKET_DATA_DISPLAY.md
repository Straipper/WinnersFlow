# STEP 31 — End-to-End Market Data Display Contract

## Required frontend behavior

### Top ticker / moving prices
- Subscribe to the authenticated `/ws/market` feed.
- During regular US equity hours (09:30–16:00 America/New_York), show the regular live price and label it `LIVE`.
- During 04:00–09:30, show the extended/pre-market price when supplied and label `PRE-MARKET`.
- During 16:00–20:00, show the extended/after-hours price when supplied and label `AFTER HOURS`.
- Outside those windows, show the last price and label `MARKET CLOSED`.
- Never show an after-hours badge during regular hours.

### Homepage + terminal
The same session state must be used in the homepage ticker, terminal ticker, chart header, scanner cards and selected-symbol quote header. Do not calculate different states in different components.

### Flow
DT FLOW Flow is a quote-volume proxy unless a separate genuine trade/print provider is configured. The UI must display `1 DAY DELAYED` when using a delayed flow feed. It must not relabel live proxy data as delayed historical flow.

### Dark Pool Prints
The homepage and terminal may display a `DARK POOL PRINTS · 1 DAY DELAYED` module. It must be populated only from an actual configured dark-pool/print data provider. No synthetic prints or invented notional values are allowed.

If no print provider is configured, show `DARK POOL PRINTS · 1 DAY DELAYED` and `DATA UNAVAILABLE` rather than fake records.

## Backend endpoints/events
- `GET /api/market/session` returns the shared market-session state.
- `GET /api/market/quotes/:symbol` now includes `marketSession`, `marketSessionLabel`, `isRegularHours`, `isExtendedHours`, `extendedPrice`, `displayPrice`, and `priceType`.
- WebSocket `quote` events include a `market` object with the same session state.

## Important limitation
The current market-data package can expose a provider's extended price when the provider supplies it. A genuine Dark Pool Prints feed requires a provider that actually supplies those prints; Twelve Data quote-volume proxy data is not dark-pool data and must not be presented as such.
