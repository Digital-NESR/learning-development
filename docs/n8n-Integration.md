# L&D Portal — n8n integration

The portal sends no email itself. It hands emails to an **n8n webhook**, the same pattern the other Digital-NESR apps use. It also exposes a **nameplate PDF** endpoint that n8n can call.

## 1. Training emails (portal → n8n)

An L&D admin opens **Notifications → Send Training Email**, picks a training and an audience, writes or loads a template, and clicks **Send**. The portal then:

1. Works out the recipients on the server. The browser only ever sees a count.
2. Fills the placeholders separately for each person.
3. Sends **one POST** to `LD_N8N_EMAIL_WEBHOOK_URL` containing every message.

### Vercel settings

| Variable | Example | Notes |
|---|---|---|
| `LD_MAIL_FROM` | `sbagalkot@nesr.com` (testing) · `training@nesr.com` (production) | Sender address passed to n8n |
| `LD_N8N_EMAIL_WEBHOOK_URL` | `https://<n8n-host>/webhook/ld-portal-email` | Production URL of the n8n Webhook node |
| `LD_N8N_EMAIL_WEBHOOK_SECRET` | random string | Optional. Sent as the `x-webhook-secret` header so n8n can reject anything else |

The Send button stays disabled until both `LD_MAIL_FROM` and `LD_N8N_EMAIL_WEBHOOK_URL` are set.

### Request the webhook receives

`POST` · `Content-Type: application/json` · header `x-webhook-secret: <LD_N8N_EMAIL_WEBHOOK_SECRET>` (if set)

```json
{
  "from": "sbagalkot@nesr.com",
  "training": {
    "id": "3736cdaa-…",
    "training_title": "Presentation Skills Masterclass",
    "session_code": "SFT-02",
    "dates": "7–8 Sep 2026",
    "location": "Virtual Classroom"
  },
  "audience": "registered",
  "count": 2,
  "messages": [
    {
      "to": "mohammed.alharbi@nesr.com",
      "name": "Mohammed Al-Harbi",
      "subject": "You are enrolled: Presentation Skills Masterclass",
      "text": "Your seat is confirmed for SFT-02 on 7–8 Sep 2026 …",
      "html": "Your seat is confirmed for SFT-02 on 7–8 Sep 2026 …"
    }
  ]
}
```

- `audience` is `registered` (everyone except declined requests), `enrolled` (enrolled or completed) or `participants` (marked attended).
- `html` is the same text with HTML special characters escaped and line breaks turned into `<br>`.
- n8n must reply with **2xx**. Any other response, or no response, makes the portal tell the admin that **nothing was sent**.

### Suggested n8n workflow

1. **Webhook** node: method POST, path e.g. `ld-portal-email`, respond "Immediately". Optionally add an **IF** node that checks `{{$json.headers["x-webhook-secret"]}}` equals the secret.
2. **Split Out** node on `body.messages`.
3. **Microsoft Outlook → Send a message** node (or Send Email via SMTP):
   - To: `{{$json.to}}`
   - Subject: `{{$json.subject}}`
   - Body (HTML): `{{$json.html}}`
   - From / send as: `{{$('Webhook').item.json.body.from}}`. The connected Microsoft account needs **Send As** (or Send on behalf) rights on that mailbox, e.g. `training@nesr.com`.

### Placeholders

Each is filled per recipient, in both the subject and the message:

| Placeholder | Value |
|---|---|
| `{{first_name}}` | Recipient's first name |
| `{{employee_name}}` | Recipient's full name |
| `{{manager_name}}` | Recipient's line manager (or "your manager") |
| `{{training_title}}` | Training title |
| `{{session_code}}` | e.g. `SFT-02` |
| `{{dates}}` | e.g. `7–8 Sep 2026` |
| `{{location}}` | Training location |

## 2. Nameplate PDFs (n8n → portal)

The admin page **Notifications → Nameplate Generator** downloads these directly. For automation, n8n can request one with an **HTTP Request** node:

`POST https://<portal-domain>/api/hooks/nameplate`
Headers: `x-api-key: <LD_NAMEPLATE_API_KEY>`, `Content-Type: application/json`

```json
{ "name": "Mohammed Al-Harbi", "course": "Presentation Skills Masterclass", "date": "7–8 Sep 2026" }
```

or, for several people in one PDF (up to 200, one page each):

```json
{ "plates": [ { "name": "…", "course": "…", "date": "…" }, { "name": "…", "course": "…", "date": "…" } ] }
```

The response is `application/pdf`: an A4 landscape page per person, folded along the dashed line into a desk nameplate. Set the HTTP Request node's response format to **File**, then e.g. attach it to an email or save it to SharePoint.

| Vercel setting | Notes |
|---|---|
| `LD_NAMEPLATE_API_KEY` | Long random string. Without it, the endpoint refuses every request (401). It doesn't need the site password or a sign-in, because the key is the protection |

Names use the standard PDF font, so non-Latin characters (e.g. Arabic) are dropped. If that's needed, the generator would need an embedded font file.
