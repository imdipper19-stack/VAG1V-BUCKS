# Bag1V-Bucks

Automated V-Bucks fulfillment service with real-time tracking.

## Tech Stack

- **Backend**: NestJS + PostgreSQL + Redis + BullMQ
- **Frontend**: Next.js 14 + Tailwind CSS + React Query
- **Automation**: Playwright (Node.js)

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis

### Installation

```bash
# Install dependencies
npm install

# Backend setup
cd backend
npm install
cp .env.example .env
# Configure your .env with database credentials

# Frontend setup
cd ../frontend
npm install
```

### Database Setup

```bash
# Create PostgreSQL database
psql -U postgres -c "CREATE DATABASE bag1vbucks;"
```

### Running

```bash
# Run both frontend and backend
npm run dev

# Or separately:
npm run dev:backend  # http://localhost:3001
npm run dev:frontend # http://localhost:3000
```

## Project Structure

```
bag1vbucks/
├── backend/           # NestJS API Server
│   └── src/
│       ├── orders/    # Orders module
│       ├── auth/      # Epic Games Auth
│       ├── webhooks/  # Webhook notifications
│       └── queue/     # BullMQ workers
├── frontend/         # Next.js App
│   └── src/
│       ├── app/      # Pages
│       │   ├── buyer/
│       │   ├── order/[orderId]/
│       │   └── admin/
│       └── components/
└── Desing/           # Design templates
```

## API Endpoints

### Orders
- `POST /api/orders` - Create new order
- `GET /api/orders/by-slug/:slug` - Get order by short URL slug
- `GET /api/orders/:orderId/status` - Get order status

### Auth
- `POST /api/auth/initiate` - Initiate Epic Games device auth
- `POST /api/auth/poll` - Poll for auth completion

### Webhooks
- `POST /api/webhooks/test` - Test webhook URL
- `POST /api/webhooks/trigger` - Trigger order webhook

## Environment Variables

See `.env.example` files for required variables.
