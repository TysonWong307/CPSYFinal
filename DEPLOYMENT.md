# WAIT Website — Azure Deployment Guide

## Project Structure

```
wait-website/
├── server.js          ← Express backend (API + static serving)
├── db.js              ← Azure SQL connection + table setup
├── package.json
├── web.config         ← Azure App Service / IIS configuration
├── .env.example       ← Environment variable template
├── .gitignore
└── public/
    └── index.html     ← Full frontend (multi-page SPA)
```

---

## Step 1 — Local Setup

```bash
cd wait-website
npm install
cp .env.example .env
# Fill in your Azure SQL credentials in .env
node server.js
# Open http://localhost:3000
```

---

## Step 2 — Configure Azure SQL

1. In the Azure Portal, open your **Azure SQL Database**
2. Go to **Query editor** and verify connectivity
3. The app auto-creates two tables on startup:
   - `students` — stores registered student accounts
   - `contact_submissions` — stores contact form submissions
4. In **Networking → Firewall rules**, add:
   - Your dev IP (for testing)
   - Azure App Service outbound IPs (for production)
5. Copy your connection string details into `.env`

---

## Step 3 — Create Azure App Service

```bash
# Install Azure CLI if not already installed
az login

# Create resource group (skip if you have one)
az group create --name wait-rg --location canadacentral

# Create App Service plan (free tier)
az appservice plan create \
  --name wait-plan \
  --resource-group wait-rg \
  --sku B1 \
  --is-linux false

# Create the web app (Windows + Node 18)
az webapp create \
  --resource-group wait-rg \
  --plan wait-plan \
  --name wait-website \
  --runtime "NODE:18LTS"
```

---

## Step 4 — Set Environment Variables on Azure

In the Azure Portal → App Service → **Configuration → Application settings**, add:

| Name              | Value                                  |
|-------------------|----------------------------------------|
| `DB_SERVER`       | your-server.database.windows.net       |
| `DB_NAME`         | your-database-name                     |
| `DB_USER`         | your-db-username                       |
| `DB_PASSWORD`     | your-db-password                       |
| `DB_PORT`         | 1433                                   |
| `SESSION_SECRET`  | (generate a 32+ char random string)    |
| `NODE_ENV`        | production                             |
| `WEBSITE_NODE_DEFAULT_VERSION` | ~18                      |

Or via CLI:
```bash
az webapp config appsettings set \
  --resource-group wait-rg \
  --name wait-website \
  --settings \
    DB_SERVER="your-server.database.windows.net" \
    DB_NAME="yourdb" \
    DB_USER="youruser" \
    DB_PASSWORD="yourpassword" \
    SESSION_SECRET="your-long-random-secret" \
    NODE_ENV="production"
```

---

## Step 5 — Deploy via GitHub Actions (Recommended)

1. Push your code to a GitHub repository
2. In Azure Portal → App Service → **Deployment Center**
3. Select **GitHub** as source
4. Authorize and select your repo + branch (e.g. `main`)
5. Azure auto-generates a GitHub Actions workflow

Or deploy via ZIP:
```bash
zip -r deploy.zip . --exclude "node_modules/*" --exclude ".git/*" --exclude ".env"

az webapp deploy \
  --resource-group wait-rg \
  --name wait-website \
  --src-path deploy.zip \
  --type zip
```

---

## Step 6 — Enable HTTPS + Custom Domain (Optional)

```bash
# Add a custom domain
az webapp config hostname add \
  --webapp-name wait-website \
  --resource-group wait-rg \
  --hostname www.wait.ab.ca

# Azure provides free managed SSL certificates
# Portal → App Service → TLS/SSL settings → Managed Certificate
```

---

## API Reference

| Method | Endpoint        | Description              | Auth Required |
|--------|----------------|--------------------------|---------------|
| POST   | /api/register  | Create student account   | No            |
| POST   | /api/login     | Log in                   | No            |
| POST   | /api/logout    | Log out                  | No            |
| GET    | /api/me        | Get current student info | Yes (session) |
| POST   | /api/contact   | Submit contact form      | No            |

---

## Security Features Included

- ✅ Passwords hashed with bcrypt (12 rounds)
- ✅ SQL injection prevention (parameterized queries via `mssql`)
- ✅ Rate limiting on auth endpoints (20 req / 15 min)
- ✅ Rate limiting on contact form (10 req / hour)
- ✅ HTTP security headers via `helmet`
- ✅ Input validation via `joi`
- ✅ Secure session cookies (httpOnly, secure in production)
- ✅ Azure SQL encrypted connection (TLS required)

---

## Troubleshooting

**Cannot connect to Azure SQL:**
- Ensure firewall rules allow App Service IPs
- Verify `encrypt: true` is set (required for Azure)
- Check credentials in App Service Configuration

**App crashes on startup:**
- Check App Service logs: Portal → Log stream
- Ensure `NODE_ENV=production` is set
- Verify all env vars are configured

**Sessions not persisting:**
- Set a strong `SESSION_SECRET`
- For multi-instance deployments, use Azure Redis Cache for session storage
