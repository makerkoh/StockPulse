# StockPulse — Intelligence Platform

A production-quality stock and IPO intelligence platform with quantile forecasting, transparent scoring, and premium dark UI.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env
# Edit .env: set SESSION_SECRET (run: openssl rand -hex 32)

# Start PostgreSQL
docker compose up -d db

# Set up database
npx prisma generate
npx prisma db push
npm run db:seed    # Optional: seed default data

# Start dev server
npm run dev        # http://localhost:3000
```

**Default dev password:** `stockpulse`

## Custom Password

```bash
npm run hash-password your-secure-password
# Copy the hash into .env as APP_PASSWORD_HASH
```

## Data Modes

- **Demo mode** (default): Runs with realistic simulated data, no API keys needed
- **Live mode**: Set `FINNHUB_API_KEY` in `.env` for real market data

## Architecture

```
src/
├── app/                    # Next.js 14 App Router
│   ├── (app)/              # Auth-protected routes
│   │   ├── stock/          # Dashboard + [ticker] detail
│   │   ├── backtest/       # Walk-forward backtest
│   │   └── settings/       # Configuration
│   ├── api/                # API routes (auth, predict, stocks, backtest, settings)
│   └── login/              # Login page
├── components/
│   ├── ui/                 # Primitives (Button, Card, Badge, Select, Spinner, etc.)
│   ├── dashboard/          # DashboardShell, ForecastTable
│   └── ipo/                # IpoSection
├── lib/
│   ├── auth/               # iron-session auth
│   ├── providers/          # Data providers (Finnhub, Demo)
│   └── services/           # Features, Scoring, Pipeline
└── types/                  # Shared TypeScript types
```

## Features

- **Auth system**: Password-protected with iron-session, middleware route protection
- **5 ranking modes**: Expected Return, Sharpe, Risk-Adjusted, Momentum, Value
- **5 time horizons**: 1D, 1W, 1M, 3M, 6M
- **25+ engineered features**: Technical indicators, fundamentals, momentum signals
- **Quantile forecasts**: P10/P50/P90 price targets with confidence scores
- **IPO tracker**: Upcoming IPOs with sentiment and risk analysis
- **Stock detail pages**: Charts, fundamentals, news, individual forecasts
- **Backtest engine**: Walk-forward simulation with equity curve visualization
- **Premium dark UI**: Custom design system with DM Sans + Instrument Serif

## Tech Stack

Next.js 14, TypeScript, Tailwind CSS, Prisma, PostgreSQL, Recharts, iron-session, bcryptjs

## Docker (Full Stack)

```bash
docker compose up
# App at http://localhost:3000
```

## Production

```bash
npm run build
npm start
```
