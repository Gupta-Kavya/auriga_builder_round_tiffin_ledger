# LunchLedger

A small MERN app for a home-style tiffin owner. Owners register, subscribe customers, record delivery pauses, search by name or phone, and view prorated monthly bills.

## Setup

Requirements: Node.js 20+, npm, and MongoDB (local or Atlas). From the project root:

1. Copy `backend/.env.example` to `backend/.env`. Set `MONGODB_URI` and a long random `JWT_SECRET`.
2. Run `npm run install:all`.
3. Run `npm run dev`.
4. Open `http://localhost:5173` and create an owner account. API runs at `http://localhost:4000`.

For GitHub Codespaces, forward ports 5173 and 4000. Open the forwarded 5173 URL. Vite proxies `/api` to port 4000. If the backend cannot connect, verify MongoDB is reachable from Codespaces (an Atlas connection string works).

## Billing rule

The monthly price is divided by the number of Monday–Friday dates in that calendar month, then multiplied by eligible delivered weekdays. Eligible days begin on the subscription start date and exclude all inclusive pause dates. The current month is provisional through today; future days are not billed. Amounts round to two decimals. The app assumes a subscribed, unpaused weekday was delivered; actual driver delivery confirmation is a future feature.

## API endpoints

All customer routes require `Authorization: Bearer <token>` and return only the logged-in owner's data.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| POST | `/api/auth/register` | Register owner (`name`, `email`, `password`) |
| POST | `/api/auth/login` | Log in (`email`, `password`) |
| GET | `/api/customers?q=&page=1&limit=10&sort=name&order=asc` | Search, paginate, sort customers |
| POST | `/api/customers` | Subscribe customer (`name`, `phone`, `address`, `monthlyPrice`, `startDate`) |
| GET | `/api/customers/:id` | Get customer and pause history |
| POST | `/api/customers/:id/pause` | Pause (`startDate`, optional `endDate`) |
| POST | `/api/customers/:id/resume` | End open pause before `resumeDate` (defaults to today) |
| GET | `/api/customers/:id/bill?month=YYYY-MM` | Get prorated bill |
| POST | `/api/customers/:id/transfer` | Transfer plan (`name`, `phone`, `address`, `effectiveDate`) |
| POST | `/api/customers/import` | Import `{ "csv": "..." }` or `{ "rows": [...] }` |
| POST | `/clock` (also `/api/clock`) | Queue today's due deliveries; optional `{ "date": "YYYY-MM-DD" }` |
| GET | `/outbox?date=YYYY-MM-DD` (also `/api/outbox`) | Inspect notification messages |

Dates use `YYYY-MM-DD`; billing month uses `YYYY-MM`. Search matches name or phone. Sort fields are name, phone, startDate, monthlyPrice and createdAt. Phone numbers are unique per owner. Pauses cannot overlap.

## Round 2 twists

- **Morning notifications:** `POST /clock` checks each subscription on the specified date (default today). It stores one notification per due customer and date in MongoDB. `GET /outbox` reads the persisted Notification Service outbox; retrying the same clock date does not duplicate messages. Only active, unpaused weekdays are due. The outbox is a local assessment service, not an SMS provider; these two routes are intentionally open so the assessment can call them.
- **Transfer:** `POST /api/customers/:id/transfer` changes the recipient on the effective date (up to today). The same plan price, original start date, and pause history remain. Bills contain `splits` with delivered days and charge for each historical holder. The old recipient ends the day before transfer; the new one begins on the effective date.
- **Messy import:** Paste CSV in the dashboard or call the import API. Headers accept `name,phone,address,monthlyPrice,startDate` and common variants. Dates accept ISO, `DD/MM/YYYY`, `DD-MM-YYYY`, year-first slashes, and unambiguous US month-first dates. Ambiguous slash dates use day-first. Phones normalize to ten digits, including `+91`. Blank or invalid rows are rejected; duplicate phones already in the database or in the same list are deduped. The response is `{ imported, deduped, rejected, errors }`. Limit: 500 rows per request.

## Debug and test

Run `npm test` for billing tests and `npm run build --prefix frontend` to verify the UI build. Check the backend terminal for database connection failures. A 401 response means the owner should log in again; a 409 response usually means a duplicate phone or overlapping pause.

## Stack

React + Vite frontend; Node.js + Express REST API; MongoDB + Mongoose; bcrypt password hashes and JWT login.
