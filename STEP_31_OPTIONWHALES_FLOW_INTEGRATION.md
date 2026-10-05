# DT FLOW — OptionWhales Flow Integration

This patch connects the existing FLOW selector to a server-side OptionWhales Pro API adapter.

## UI contract

The terminal FLOW selector exposes exactly three views:
- Normal Stock Flow
- Options Flow
- Dark Pool Prints

The product-facing status badge is `LIVE` for all three views, meaning the panel is a continuously connected/updated live feed. The backend still preserves `asOf` and `delaySeconds` metadata so data freshness is auditable.

OptionWhales currently documents current-session options flow as 60 seconds on watchlist symbols and 15 minutes off-watchlist, while dark-pool/off-exchange prints are about 15 minutes delayed by source licence. The frontend should not expose those raw delay values in the premium terminal unless desired; the backend keeps them for observability.

## API

Authenticated product endpoint:
`GET /api/flow-data/:symbol?type=stocks|options|dark`

The OptionWhales key is server-side only in `OPTIONWHALES_API_KEY`.

## Important

Do not place `OPTIONWHALES_API_KEY` in HTML, JavaScript shipped to browsers, CodePen, or the frontend bundle.
