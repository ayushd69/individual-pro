# ServiceDesk Pro API

## Setup

1. Install Node.js 20.19+ (or 22.12+) and start MongoDB locally, or create a MongoDB Atlas database.
2. From `backend`, install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and set `MONGODB_URI`, a random `JWT_SECRET` of at least 32 characters, and an `ADMIN_PASSWORD` of at least 10 characters. Use a unique, stronger password for any non-local deployment.
4. Start the API with `npm run dev`.
5. In a second terminal, run `npm install` and `npm run dev` from `frontend`.

The server listens on `http://localhost:4000`. `GET /api/health` reports API and database status. The first configured boot creates a single system administrator. Further system administrator accounts cannot be created through the API. The administrator can provision the other four roles with `POST /api/users`.

Vite proxies `/api` requests to the backend. There are no built-in demo credentials: sign in with the administrator name, email, and password configured in `backend/.env`. The admin dashboard can provision users for the other roles.

## API

- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET/POST /api/users` (system admin only)
- `GET/POST/PATCH /api/tickets`
- `GET/POST/PATCH /api/assets` (asset writes restricted to asset managers and system admins)
- `GET /api/dashboard`
- `GET /api/audit` (system admin only)

Authenticated requests use `Authorization: Bearer <token>`. Role checks and ownership checks are enforced by the API, not by the frontend.
