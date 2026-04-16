# nikohub

Personal idea-board web app. Drop notes and images onto an infinite canvas via right-click, drag/resize them, they save automatically. Google SSO only.

## Stack

- Backend: Go + Drift, Postgres, cookie-based JWT auth.
- Frontend: Angular 21 + @m1z23r/ngx-ui.
- Logging: nikologs-go.

## Develop

```bash
# Postgres
sudo -u postgres createuser nikohub -P
sudo -u postgres createdb nikohub -O nikohub

# Backend
cd backend
cp .env.example .env  # fill in Google OAuth + JWT_SECRET
make build
./bin/nikohub

# Frontend
cd ../frontend
npm i
npm start
```

Open http://localhost:4200.

## Deploy

Matches the nikologs layout — systemd + nginx. See `backend/Makefile` (`make setup` once, `make prod` for updates) and `backend/nikohub.service`.

nginx reverse-proxies `https://nikohub.dimitrije.dev/api/v1/*` to the Go binary and serves the built SPA from `/var/www/nikohub/`.
