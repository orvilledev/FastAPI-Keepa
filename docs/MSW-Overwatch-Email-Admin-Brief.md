# MSW Overwatch — Outbound Email Failure

**For Microsoft 365 / Entra ID administrators**

| | |
|---|---|
| **Date** | September 3, 2026 |
| **Application** | MSW Overwatch (FastAPI backend on Render) |
| **Sender mailbox** | `overwatch@metroshoewarehouse.com` |
| **Display name** | MSW Overwatch |

---

## 1. Executive summary

MSW Overwatch sends automated **daily MAP pricing exception reports** to vendor contacts after scheduled batch jobs complete. On **September 3, 2026**, multiple daily runs **completed successfully** in the application, but **no report emails were delivered**.

Investigation confirmed:

- Recipients **are configured correctly** per vendor in the application.
- Report files **generate successfully**.
- Email delivery **fails at Microsoft 365 authentication** with:

```
535 5.7.139 Authentication unsuccessful, user is locked by your
organization's security defaults policy. Contact your administrator.
```

This indicates the tenant is **blocking legacy SMTP authentication** (username + password over SMTP) for the `overwatch@metroshoewarehouse.com` mailbox—likely due to **Security Defaults** or a similar policy.

**Recommended fix:** Configure **Microsoft Graph API** mail sending (application permission `Mail.Send`) instead of SMTP password authentication.

---

## 2. What the application does

| Item | Detail |
|------|--------|
| **Purpose** | Send CSV/Excel MAP exception reports after daily vendor runs (DNK, OBZ, SFF, etc.) |
| **Current method (failing)** | SMTP to `smtp.office365.com:587` with mailbox username + password |
| **Sender** | `overwatch@metroshoewarehouse.com` |
| **Hosting** | Backend API on Render (`metro-api` service) |
| **When it runs** | Automatically after each completed daily batch job |

**Email flow (simplified):**

```
Daily job completes → Report generated → App connects to smtp.office365.com
→ Login as overwatch@... with password → BLOCKED by Security Defaults
→ Email never sent
```

Jobs still show as **completed** in the dashboard; only the **email step** fails.

---

## 3. Error explanation

| Component | Meaning |
|-----------|---------|
| **535** | SMTP authentication failed |
| **5.7.139** | Blocked by **Security Defaults** (or equivalent tenant policy) |
| **Security Defaults** | Tenant baseline that often disables legacy/basic authentication, including SMTP username/password logins that cannot use MFA |

**Important:** This is **not** caused by wrong recipients, application bugs, or missing reports. Microsoft is rejecting the **sign-in method** before any message is sent.

Emails sent successfully on **September 2, 2026** suggest a **recent policy change** or enforcement on the mailbox/tenant.

---

## 4. How to verify (admin checks)

### 4.1 Security Defaults

1. Sign in to [Microsoft Entra admin center](https://entra.microsoft.com)
2. **Identity** → **Overview** → **Properties** → **Manage Security defaults**
3. Note whether Security Defaults are **Enabled**

### 4.2 SMTP AUTH on the mailbox

Exchange Online PowerShell:

```powershell
Connect-ExchangeOnline
Get-CASMailbox -Identity overwatch@metroshoewarehouse.com | Format-List SmtpClientAuthenticationDisabled
```

- `SmtpClientAuthenticationDisabled : True` → SMTP login is disabled for this mailbox

### 4.3 Sign-in logs (optional)

Entra → **Monitoring** → **Sign-in logs**  
Filter failed sign-ins for `overwatch@metroshoewarehouse.com` around job completion times.

---

## 5. Fix Option A — Recommended: Microsoft Graph API

Use a registered **Entra application** with **Mail.Send (application permission)**. The app obtains an OAuth token and calls Graph to send as `overwatch@metroshoewarehouse.com`—**no mailbox password over SMTP**.

### Step 1 — App registration

1. [Entra admin center](https://entra.microsoft.com) → **Applications** → **App registrations** → **New registration**
2. Name: `MSW Overwatch Graph Mail` (or similar)
3. Supported account types: **Accounts in this organizational directory only**
4. Register and record **Application (client) ID** and **Directory (tenant) ID**

### Step 2 — API permissions

1. App → **API permissions** → **Add a permission**
2. **Microsoft Graph** → **Application permissions**
3. Add **Mail.Send**
4. **Grant admin consent** for the organization

### Step 3 — Client secret

1. **Certificates & secrets** → **New client secret**
2. Copy the secret value immediately (shown once)

### Step 4 — Restrict sending (recommended)

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

**Prerequisite:** Mailbox `overwatch@metroshoewarehouse.com` must exist and be licensed.

### Step 5 — Provide credentials to the MSW Overwatch team

| Variable | Value |
|----------|--------|
| `AZURE_TENANT_ID` | Directory (tenant) ID |
| `AZURE_CLIENT_ID` | Application (client) ID |
| `AZURE_CLIENT_SECRET` | Client secret from Step 3 |

### Step 6 — Production environment variables (Render)

```env
EMAIL_TRANSPORT=graph
EMAIL_FROM=overwatch@metroshoewarehouse.com
EMAIL_FROM_NAME=MSW Overwatch

AZURE_TENANT_ID=<directory-tenant-id>
AZURE_CLIENT_ID=<application-client-id>
AZURE_CLIENT_SECRET=<client-secret>
```

`EMAIL_PASSWORD` is **not required** when using Graph. Restart the API after changes.

---

## 6. Fix Option B — Alternative (not recommended): Re-enable SMTP AUTH

```powershell
Set-CASMailbox -Identity overwatch@metroshoewarehouse.com -SmtpClientAuthenticationDisabled $false
```

Additional tenant-wide steps may be required. Less secure; may break again when policies tighten.

---

## 7. Verification after fix

1. Restart the Render API service after env changes
2. Run test send via `POST /api/v1/reports/test-email`
3. Confirm response shows `"transport": "graph"` (Option A)
4. Confirm message from **MSW Overwatch** &lt;overwatch@metroshoewarehouse.com&gt;
5. Resend missed reports for September 3, 2026

---

## 8. Graph troubleshooting

| Error | Likely cause |
|-------|----------------|
| Graph token failed (401) | Incorrect tenant ID, client ID, or secret |
| sendMail failed (403) | Admin consent not granted, or access policy blocks mailbox |
| sendMail failed (404) | `EMAIL_FROM` mailbox does not exist |
| Still using SMTP | Azure variables missing, or `EMAIL_TRANSPORT=smtp` |

---

## 9. SMTP vs Graph comparison

| | SMTP (failing) | Graph (recommended) |
|--|----------------|---------------------|
| **Authentication** | Mailbox password | Entra app + client secret |
| **Protocol** | SMTP port 587 | HTTPS Graph API |
| **Security Defaults** | Often blocked | Supported |
| **Credentials to rotate** | Mailbox password | Client secret |

---

## 10. Affected runs (September 3, 2026)

| Vendor | Job | App status | Email sent |
|--------|-----|------------|------------|
| DNK | Daily DNK Uploaded Report - 2026-09-03 | Completed | No |
| OBZ | Daily OBZ Uploaded Report - 2026-09-03 | Completed | No |
| SFF | Daily SFF Uploaded Report - 2026-09-03 | Completed | No |

Recipients were configured for each job; failure occurred at Microsoft authentication only.

---

## 11. Request to administrator

Please implement **Option A (Microsoft Graph)** and provide `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`.

Alternatively, if Option B is chosen, confirm SMTP AUTH is enabled for `overwatch@metroshoewarehouse.com` and notify the development team to retest.

**Reference:** `docs/microsoft-graph-email-setup.md` in the MSW Overwatch repository.
