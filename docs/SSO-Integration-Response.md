# L&D Portal — SSO Integration Response

Response to **"SSO Integration Requirements"** (NESR IT, Identity Provider: Microsoft Entra ID).

| | |
|---|---|
| **Application** | NESR Learning & Development Portal |
| **Application owner** | Sakina Bagalkot — sbagalkot@nesr.com |
| **Technical support contact** | Sakina Bagalkot — sbagalkot@nesr.com |
| **Hosting** | Vercel (HTTPS only): https://learning-development-red.vercel.app |
| **Protocol chosen** | **OpenID Connect (OIDC) / OAuth 2.0** — the "Secondary Protocol" in the IT requirements |
| **Auth library** | Auth.js (NextAuth v5), Microsoft Entra ID provider |

> Why OIDC rather than SAML: the portal is a modern web app on Vercel, and Auth.js supports Entra ID natively over OIDC. OIDC also lets the app read the signed-in user's manager from Microsoft Graph. The app needs this to route training approvals to the right line manager. MFA, Conditional Access and Intune device compliance are all enforced by Entra ID before the token is issued, so they apply as they do for SAML.

---

## 1. OIDC application configuration (section 2B)

| Field | Value |
|---|---|
| **Application type** | **Web** (confidential client — server-side code exchange with a client secret) |
| **Supported account types** | Accounts in this organizational directory only (NESR single tenant) |
| **Redirect URI (production)** | `https://learning-development-red.vercel.app/api/auth/callback/microsoft-entra-id` |
| **Redirect URI (local development)** | `http://localhost:3000/api/auth/callback/microsoft-entra-id` |
| **Post-logout redirect URI** | `https://learning-development-red.vercel.app/login` |
| **Front-channel logout URL** | Not required |
| **ID tokens / Access tokens (implicit)** | **Not required** — leave both unchecked |

Production domain: **`learning-development-red.vercel.app`** (live on Vercel). If a custom domain such as `learning.nesr.com` is assigned later, its redirect URIs will be added too.

### OAuth flow

| Flow | Used |
|---|---|
| **Authorization Code Flow** | **Yes** (with PKCE and `state`) |
| Implicit Flow | No |
| Hybrid Flow | No |

### Scopes / API permissions

| Scope | Type | Required | Purpose |
|---|---|---|---|
| `openid` | OIDC | Yes | Sign-in |
| `profile` | OIDC | Yes | Name claims |
| `email` | OIDC | Yes | Email claim |
| `User.Read` (Microsoft Graph) | Delegated | Yes | Read the signed-in user's own profile (job title, department, employee ID, country) **and their manager** (`/me/manager`) for the approval chain |
| `offline_access` | OIDC | No | Not needed — the app does not keep refresh tokens |

`User.Read` is a low-privilege delegated permission. It normally needs no admin consent, but IT may grant tenant-wide consent so users don't see a consent prompt.

### Credentials needed from IT

| Item | Goes into app setting |
|---|---|
| Directory (tenant) ID | `AZURE_AD_TENANT_ID` (or `LD_AZURE_AD_TENANT_ID`) |
| Application (client) ID | `AZURE_AD_CLIENT_ID` (or `LD_AZURE_AD_CLIENT_ID`) |
| Client secret **value** (and its expiry date) | `AZURE_AD_CLIENT_SECRET` (or `LD_AZURE_AD_CLIENT_SECRET`) |

**Existing Digital-NESR registration or a new one:** the Digital-NESR apps on Vercel already share one Entra app registration (`AZURE_AD_*`). IT can choose either option:
- **Reuse it:** add the L&D redirect URIs below and the `LD.Admin` App Role to the existing registration. No new credentials are needed.
- **Create a dedicated "NESR L&D Portal" registration:** the portal then reads it from the `LD_AZURE_AD_*` variables, which take priority over the shared ones.

The secret is stored only as an encrypted Vercel environment variable. It is never committed to the code repository. Please share it through a secure channel, not email.

---

## 2. Attribute / claim mapping

| App field | Source | Claim / Graph property | Required |
|---|---|---|---|
| Unique user ID | ID token | `oid` | Yes |
| Email (login key) | Graph `/me` → ID token fallback | `mail` → `userPrincipalName` / `email` / `preferred_username` | Yes |
| Display name | Graph `/me` → ID token | `displayName` / `name` | Yes |
| First name | Graph `/me` → ID token | `givenName` / `given_name` | Yes |
| Last name | Graph `/me` | `surname` | Yes |
| Job title | Graph `/me` | `jobTitle` | No |
| Department | Graph `/me` | `department` | No |
| NESR employee ID | Graph `/me` | `employeeId` | No |
| Country / location | Graph `/me` | `country`, `officeLocation`, `city` | No |
| **Line manager** | Graph `/me/manager` | `mail`, `displayName`, `jobTitle` | No (strongly recommended) |
| L&D admin role | ID token | `roles` (App Role, see below) | No |

The profile is refreshed every time the user signs in. If `/me/manager` is empty, the employee can type their approver's email on the registration form.

---

## 3. Role / access mapping (section 2C)

**Role assignment method:** OIDC claims — Entra ID **App Roles**, delivered in the `roles` claim of the ID token.

### Application roles list

Create one App Role on the app registration:

| Display name | Value | Allowed member types | Description |
|---|---|---|---|
| L&D Team | `LD.Admin` | Users/Groups | Manage the training calendar, enroll participants, mark attendance, manage notification templates, see all requests |

### Mapping format

| Portal workspace | How it is granted |
|---|---|
| **Employee** (default access) | Any NESR user who can sign in. No role needed. |
| **Manager** | Automatic: a user who has direct reports in Entra ID (or who is the named approver on a request). No role needed. |
| **L&D Team** | Entra App Role value `LD.Admin` in the `roles` claim. We suggest assigning it to an L&D security group. |

### Enterprise application settings requested

- **Assignment required?** — **No** (all NESR staff may request training). If IT prefers **Yes**, assign the "All NESR employees" group to the default access role.
- **Visible to users?** — Yes (shows in My Apps).
- Conditional Access / MFA — apply the standard NESR policy for internal web apps.

---

## 4. Deliverables checklist (section 3)

| Deliverable | Status |
|---|---|
| OIDC configuration details | This document, section 1 |
| Attribute mapping documentation | This document, section 2 |
| Role mapping documentation | This document, section 3 |
| SSO configuration guide | This document + `README.md` → "Single Sign-On" |
| Technical support contact | Sakina Bagalkot — sbagalkot@nesr.com |

## 5. Steps for IT (summary)

1. Entra admin center → **App registrations** → **New registration** → name "NESR L&D Portal", single tenant, Web redirect URI as above.
2. **Authentication**: add the localhost redirect URI, and add the post-logout URL as another Web redirect URI. Leave implicit grant off.
3. **Certificates & secrets** → new client secret → send the value securely.
4. **API permissions** → confirm Microsoft Graph `User.Read` (delegated); optionally grant admin consent.
5. **App roles** → create `LD.Admin` as above.
6. **Enterprise applications** → NESR L&D Portal → **Users and groups** → assign the L&D team (group) to the `L&D Team` role.
7. Send back: tenant ID, client ID, client secret (and expiry).
