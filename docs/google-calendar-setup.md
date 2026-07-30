# Google Calendar & Tasks — setup (D-192)

Everything the kernel needs from Google, in order. Takes about 15 minutes.
Nothing here is guesswork: it follows the current Google Workspace developer
documentation as of **2026‑07‑30**.

---

## 0. What this connects, and what it does not

| Thing | Status |
| --- | --- |
| Google Calendar events | Google Calendar API v3 — read + write |
| Google Tasks | Google Tasks API v1 — read + write |
| **Google Reminders** | **No API exists.** Reminders were merged into Tasks (Calendar & Assistant in 2023, Keep in 2025). A "reminder" here is a Task with a due date — which is exactly what Google itself now shows on the calendar grid. |

---

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/projectcreate>
2. Name it something you will recognise later, e.g. `aos-kernel`.
3. Create, then make sure it is the **selected** project in the top bar.

## 2. Enable the two APIs

In the same project:

1. <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com> → **Enable**
2. <https://console.cloud.google.com/apis/library/tasks.googleapis.com> → **Enable**

## 3. Configure the OAuth consent screen

<https://console.cloud.google.com/auth/overview>

- **User type:** *External* (unless you have Workspace and want *Internal*).
- **App name:** `AOS Kernel` · **User support email:** your address.
- **Developer contact:** your address.
- **Audience → Test users:** add **your own Google account**.

> **This step is the one that blocks people.** While the app is in *Testing*,
> Google refuses consent for ANY account that is not in the Test users list —
> including the account that owns the Cloud project. The error looks like:
>
> ```
> Access blocked: AOS-kernel has not completed the Google verification process
> Error 403: access_denied
> ```
>
> Add the **exact address you sign in with**. And note that a test user's
> authorization expires **7 days** after consent, so you would reconnect
> weekly — see step 3b to stop that.

## 3b. Publish, so you stop reconnecting every 7 days

<https://console.cloud.google.com/auth/audience> → **Publish app**

Publishing does not require a Google review for your own use. With sensitive
scopes and no verification, Google shows a "Google hasn't verified this app"
interstitial once — choose **Advanced → Go to AOS Kernel (unsafe)** — and the
grant then behaves normally, with no 7-day expiry. Unverified published apps
are capped at 100 users, which is not a constraint for a personal system.

Verification is only needed if you later distribute this to other people.

## 4. Create the OAuth client

<https://console.cloud.google.com/auth/clients> → **Create client**

- **Application type:** *Web application*
- **Name:** `AOS Kernel Web`
- **Authorised redirect URIs** — add both, exactly:

```
http://localhost:4100/api/calendar/callback
https://<your-dashboard-domain>/api/calendar/callback
```

> These point at the **dashboard**, not the gateway. Sending the browser to the
> API server on another port is what made consent hang without returning: the
> browser was asked to navigate cross-origin to something that is not a web
> app. The dashboard receives the code and exchanges it server-side, so the
> trip home is an ordinary in-app redirect.

Copy the **Client ID** and **Client secret**.

## 5. Generate the token-encryption key

The refresh token is a long-lived key to your calendar, so it is encrypted at
rest with AES‑256‑GCM. Generate a 32-byte key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Losing this key does not lose your calendar — it only means the stored grant
> can no longer be decrypted and you reconnect once. **Rotating it requires
> reconnecting.** Keep it out of git; it lives only in the environment.

## 6. Environment variables

Add to `.env` and `services/gateway-api/.env`:

```env
GOOGLE_CLIENT_ID=<from step 4>
GOOGLE_CLIENT_SECRET=<from step 4>
GOOGLE_REDIRECT_URI=http://localhost:4100/api/calendar/callback
GOOGLE_TOKEN_ENC_KEY=<64 hex chars from step 5>
```

For production, set `GOOGLE_REDIRECT_URI` to the `https://` dashboard variant
you registered — it must match **byte for byte**, or Google returns
`redirect_uri_mismatch`. Google also warns that client changes can take
**5 minutes to a few hours** to take effect.

## 7. Connect

Open `/calendar` in the dashboard and press **connect**. You will be sent to
Google, approve the scopes, and land back on the callback.

### Scopes requested, and why each one

| Scope | Why |
| --- | --- |
| `calendar.events` | Read and write events. Deliberately **not** the full `calendar` scope, which also grants calendar sharing and deletion. |
| `calendar.calendarlist.readonly` | List your calendars without the power to change their sharing. |
| `calendar.calendars` | Create the dedicated **AOS · Autonomous OS** calendar. |
| `tasks` | Tasks — i.e. reminders. |
| `openid`, `email` | Show you *which* Google account is connected. |

---

## 8. How writing is governed

Your choice (recorded in the decision log): **Jarvis writes freely into the
dedicated AOS calendar; anything else pauses for your approval.**

| Action | Behaviour |
| --- | --- |
| Read anything | Free |
| Create/update in **AOS · Autonomous OS** | Free |
| Create/update in **your** calendars | Pauses for approval |
| **Delete** anything | Pauses for approval — irreversible from here |
| **Invite guests** | Pauses for approval — real mail, sent in your name |

The practical benefit of the separate calendar: everything the system ever
created can be hidden or deleted with one toggle in Google Calendar. That is an
undo no amount of careful coding on our side can match.

---

## 9. How sync works (and why it is built this way)

- **Full sync once, then incremental with `syncToken` forever.** Every list
  call passes the stored token and stores the new `nextSyncToken`.
- **Deletions arrive as results**, not as absences — cancelled events come back
  with `status: cancelled` precisely so clients can remove them. The mirror
  deletes them; skipping that is how a cancelled meeting stays on your screen.
- **Query parameters are identical across every request in a series** and live
  in one constant. Google rejects a sync token combined with `timeMin`, `q`,
  `orderBy` or `updatedMin`, and mismatched parameters make sync fail quietly.
- **`410 GONE` wipes that calendar's mirror and re-runs a full sync**, rather
  than merging stale rows into fresh data.
- **`nextSyncToken` only appears on the last page**, so it is stored only after
  pagination completes.
- **Backoff** is exponential with jitter for `429`, `403 rateLimitExceeded`,
  `404` and `5xx`; `400/401/403-permission/409/412` never retry blindly.

The mirror lives in Atlas, which is why the calendar page and the expiry
warnings keep working when Google is slow, rate-limiting or unreachable.

---

## Sources

- [Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync)
- [Handle API errors](https://developers.google.com/workspace/calendar/api/guides/errors)
- [Calendar API release notes](https://developers.google.com/workspace/calendar/release-notes)
- [Choose scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Switch from Reminders to Google Tasks](https://support.google.com/tasks/answer/12572073)
