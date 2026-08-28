# Microsoft Graph email setup (MSW Overwatch)

Use this when your Microsoft 365 tenant blocks **SMTP AUTH** (`SmtpClientAuthentication is disabled`). The backend sends mail through **Microsoft Graph** with an Entra ID app registration — no mailbox password required in production.

## Overview

| Setting | Value |
|--------|--------|
| Sender mailbox | `overwatch@metroshoewarehouse.com` |
| Display name | `MSW Overwatch` |
| Graph permission | `Mail.Send` (application) |
| API used | `POST /v1.0/users/{mailbox}/sendMail` |

## 1. Entra app registration (IT / M365 admin)

1. Sign in to [Microsoft Entra admin center](https://entra.microsoft.com).
2. **Applications** → **App registrations** → **New registration**.
3. Name: e.g. `MSW Overwatch Graph Mail`.
4. Supported account types: **Accounts in this organizational directory only**.
5. Register. Note the **Application (client) ID** and **Directory (tenant) ID**.

### API permissions

1. Open the app → **API permissions** → **Add a permission**.
2. **Microsoft Graph** → **Application permissions**.
3. Add **Mail.Send**.
4. Click **Grant admin consent** for your organization.

### Client secret

1. **Certificates & secrets** → **New client secret**.
2. Copy the secret value immediately (shown once). This is `AZURE_CLIENT_SECRET`.

### (Recommended) Restrict send to `overwatch@` only

Application `Mail.Send` can send as any mailbox unless restricted. Use an **Application Access Policy** in Exchange Online PowerShell:

```powershell
Connect-ExchangeOnline

New-ServicePrincipal -AppId "<AZURE_CLIENT_ID>" -ServiceId "<object-id-from-entra-app-overview>"

New-ApplicationAccessPolicy `
  -AppId "<AZURE_CLIENT_ID>" `
  -PolicyScopeGroupId "overwatch@metroshoewarehouse.com" `
  -AccessRight RestrictAccess `
  -Description "MSW Overwatch Graph mail — overwatch mailbox only"

Test-ApplicationAccessPolicy -Identity overwatch@metroshoewarehouse.com -AppId "<AZURE_CLIENT_ID>"
```

The mailbox `overwatch@metroshoewarehouse.com` must exist and be licensed (or a shared mailbox with send-as rights configured for the app scenario).

## 2. Backend environment variables

Set on Render (Keepa API service) and/or `backend/.env` locally:

```env
EMAIL_TRANSPORT=graph
EMAIL_FROM=overwatch@metroshoewarehouse.com
EMAIL_FROM_NAME=MSW Overwatch
EMAIL_TO=recipient@example.com

AZURE_TENANT_ID=<directory-tenant-id>
AZURE_CLIENT_ID=<application-client-id>
AZURE_CLIENT_SECRET=<client-secret>
```

- `EMAIL_TRANSPORT=auto` — uses Graph when all three Azure vars are set; otherwise SMTP.
- `EMAIL_TRANSPORT=graph` — requires Azure vars; fails fast if missing.
- `EMAIL_PASSWORD` — not needed for Graph.

Restart the API after changing env vars.

## 3. Verify

1. Log into MSW Overwatch as an authenticated user.
2. Call `POST /api/v1/reports/test-email` (or use the dashboard test control if available).
3. Success response includes `"transport": "graph"`.
4. Confirm the message arrives from **MSW Overwatch** &lt;overwatch@metroshoewarehouse.com&gt;.

## Troubleshooting

| Error | Likely cause |
|-------|----------------|
| `Graph token request failed (401)` | Wrong tenant ID, client ID, or secret |
| `Graph sendMail failed (403)` | Admin consent not granted, or Application Access Policy blocks the mailbox |
| `Graph sendMail failed (404)` | `EMAIL_FROM` mailbox does not exist |
| Still using SMTP | Azure vars missing, or `EMAIL_TRANSPORT=smtp` |

## Code references

- `backend/app/services/graph_mail_service.py` — OAuth + sendMail
- `backend/app/services/email_service.py` — transport selection (`graph` vs `smtp`)
- `backend/app/config.py` — `EMAIL_TRANSPORT`, `AZURE_*` settings
