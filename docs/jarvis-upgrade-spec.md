# طرح فنی ارتقاء Jarvis — همهٔ ۹ مورد

_تاریخ: ۲۰۲۶-۰۸-۰۶ · مبنا: کامیت `4e24ef3` · وضعیت: **در انتظار تأیید مالک، بدون کد**_

سند تصمیم: [`jarvis-upgrade-proposals.md`](./jarvis-upgrade-proposals.md).
این سند **امضای دقیق توابع، رویدادها، فایل‌های لمس‌شده و تست‌ها** را مشخص می‌کند.
هیچ چیز در آن حدس نیست؛ همهٔ امضاها از کد فعلی استخراج شده‌اند.

## قواعد حاکم بر کل این طرح

۱. **هیچ سرویس مستقر جدیدی اضافه نمی‌شود.** همان اصل ضد-پراکندگی CIN.
۲. **هیچ رفتار موجودی حذف نمی‌شود.** هر مسیر جدید یک fallback به مسیر فعلی دارد.
۳. **هیچ ابزاری از کنار `evaluateToolRequest` رد نمی‌شود.** شامل ابزارهای MCP.
۴. **baselineهای منجمد دست‌نخورده‌اند** (`gargantua3d-v3.ts` و خانواده‌اش).
۵. هر مورد یک ورودی در `docs/decision-log.md` و به‌روزرسانی `docs/current-state.md` دارد.

---

# مورد ۳ — نسل مدل و prompt caching

**چرا اول:** ارزان‌ترین برد، و پایهٔ اندازه‌گیری برای بقیه.

## ۳.۱ وضعیت فعلی

`shared/src/llm/toolcalling.ts` یک جدول قیمت ثابت دارد:

```ts
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5':  [1, 5],
  'gpt-4.1':           [2, 8],
  'gpt-4.1-mini':      [0.4, 1.6],
};
```

و `.env` روی `LLM_OPENAI_MODEL=gpt-4.1` است. نکتهٔ خوب: `estimateCost` از قبل
`LLM_PRICE_OVERRIDES_JSON` را می‌خواند، پس **افزودن مدل جدید نیازی به تغییر کد ندارد**.

## ۳.۲ تغییرات

| فایل | تغییر |
|------|-------|
| `.env` / `.env.example` | `LLM_OPENAI_MODEL`، `LLM_OPENAI_MODEL_FAST` به نسل جاری؛ `LLM_PRICE_OVERRIDES_JSON` با قیمت واقعی |
| `shared/src/llm/toolcalling.ts` | افزودن `cache_control` به بلوک system در `toAnthropicMessages` مسیر Anthropic؛ برای OpenAI کش خودکار است و فقط باید **ترتیب پیام‌ها پایدار بماند** |
| `shared/src/jarvis/turn-runner.ts` | جداسازی prompt ثابت از context متغیر (پایین) |

## ۳.۳ نکتهٔ کلیدی prompt caching — ترتیب

کش فقط روی **پیشوند ثابت** کار می‌کند. الان `startAgentLoop` این را می‌سازد:

```ts
messages: [{ role: 'user', content: `${opts.contextText}\n\nGOAL:\n${opts.goal}` }]
```

`contextText` شامل `nowContext()` است که **هر ثانیه عوض می‌شود** — و چون در ابتدا
می‌آید، کل پیشوند را باطل می‌کند. اصلاح: ترتیب به

```
[systemPrompt ثابت و نسخه‌دار]  ← کش‌پذیر
[حافظه و ابزارها]              ← کش‌پذیر تا وقتی حافظه عوض نشده
[nowContext + GOAL]            ← متغیر، آخر
```

این تنها تغییر معناداری است که کش را از ~۰٪ به ~۷۰٪ می‌برد.

## ۳.۴ اثبات

`scripts/model-evaluation-gate.mjs` که از قبل دارید: یک بار قبل، یک بار بعد.
معیار پذیرش: نرخ موفقیت tool-calling کاهش نیابد و `tokensCached` در
`llm_cost_records` بزرگ‌تر از صفر شود (فیلد از قبل در `ChatResult` هست).

**هزینه:** نیم روز · **ریسک:** کم · **برگشت‌پذیری:** تغییر env

---

# مورد ۱ — استریم واقعی توکن‌به‌توکن

**بزرگ‌ترین تغییر در حس کاربر.**

## ۱.۱ ریشهٔ دقیق مشکل

`services/gateway-api/src/routes/jarvis.ts:179-188`:

```ts
while (!finished && Date.now() - startedAt < 180000) {
  await new Promise((r) => setTimeout(r, 400));
  const t = await turnPromise.catch(() => null);
  if (t) break;
  void lastStepCount;          // ← placeholder خالی
}
const result = await turnPromise;
const steps = await listAgentLoopSteps(result.runId);
for (const s of steps.slice(lastStepCount)) send('loop.step', …);  // ← بعد از پایان
```

`runId` فقط در پایان در دسترس است، پس حلقه چیزی برای poll کردن ندارد. این طراحی
از ابتدا نمی‌توانسته استریم بدهد.

## ۱.۲ راه‌حل: کانال رویداد به‌جای poll

`AgentLoopOptions` از قبل یک `publish` دارد. یک callback هم‌خانواده اضافه می‌شود که
**درون فرآیند** است و تأخیر صفر دارد:

```ts
// shared/src/agentcore/loop.ts
export type LoopDelta =
  | { kind: 'text';       text: string }                              // توکن متن
  | { kind: 'tool.start'; toolName: string; callId: string }
  | { kind: 'tool.end';   toolName: string; callId: string; ok: boolean; summary: string }
  | { kind: 'run.started'; runId: string };                           // runId زودهنگام

export interface AgentLoopOptions {
  // … فیلدهای فعلی بدون تغییر …
  /** Fire-and-forget؛ خطا در آن هرگز حلقه را متوقف نمی‌کند. */
  onDelta?: (d: LoopDelta) => void;
}
```

`run.started` بلافاصله بعد از `persistRun(run)` در `startAgentLoop` صادر می‌شود —
همان چیزی که امروز نبودش استریم را غیرممکن کرده بود.

## ۱.۳ لایهٔ provider

```ts
// shared/src/llm/toolcalling.ts
export interface ToolCallingProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResult>;
  /** اختیاری. نبودنش یعنی provider استریم ندارد. */
  chatStream?(req: ChatRequest, onDelta: (d: LoopDelta) => void): Promise<ChatResult>;
}
```

**اختیاری بودن، عمدی است:** `MockProvider` و هر provider محلی بدون استریم،
بدون تغییر کار می‌کنند. در `continueLoop`:

```ts
const res = opts.onDelta && opts.provider.chatStream
  ? await opts.provider.chatStream(chatReq, opts.onDelta)
  : await opts.provider.chat(chatReq);
```

پیاده‌سازی:
- **OpenAI‑compatible:** `stream: true` + `stream_options: { include_usage: true }`؛
  دلتاها در `choices[0].delta.content` و tool call‌ها به‌صورت تکه‌ای در
  `delta.tool_calls[].function.arguments` می‌آیند و باید بر اساس `index` **الحاق**
  شوند (نه جایگزین) — این پرتکرارترین باگ این مسیر است.
- **Anthropic:** رویدادهای `content_block_delta` با `delta.type === 'text_delta'`؛
  ورودی ابزار در `input_json_delta` می‌آید. `usage` در `message_delta` نهایی.

**نکتهٔ مهم:** خروجی `chatStream` دقیقاً همان `ChatResult` است. یعنی همهٔ حسابداری
هزینه، `llm_cost_records`، budget check و منطق approval **بدون یک خط تغییر** کار
می‌کنند. استریم یک کانال مشاهده است، نه مسیر اجرای دوم.

## ۱.۴ لایهٔ gateway

`routes/jarvis.ts` — حلقهٔ poll حذف و جایش صف در حافظه:

```ts
const outbox: Array<[string, unknown]> = [];
let flush: (() => void) | null = null;
const onDelta = (d: LoopDelta) => { outbox.push([`loop.${d.kind}`, d]); flush?.(); };

const turnPromise = runJarvisTurn(actor, req.params.id, text, { ...turnDeps(), onDelta }, …);
// مصرف‌کننده: تا وقتی turn تمام نشده، هرچه در outbox هست را می‌فرستد
```

`JarvisTurnDeps` یک فیلد `onDelta?: (d: LoopDelta) => void` می‌گیرد که مستقیم به
`startAgentLoop` پاس می‌شود.

### قرارداد رویدادهای SSE (نهایی)

| رویداد | زمان | payload |
|--------|------|---------|
| `turn.accepted` | فوری | `{ sessionId }` |
| `loop.run.started` | < ۱۰۰ms | `{ runId }` ← **برای لغو لازم است** |
| `loop.text` | حین تولید | `{ text }` — قطعه، نه کل |
| `loop.tool.start` | شروع ابزار | `{ toolName, callId }` |
| `loop.tool.end` | پایان ابزار | `{ toolName, callId, ok, summary }` |
| `loop.step` | **حفظ می‌شود** | برای سازگاری عقب‌رو |
| `turn.final` | پایان | بدون تغییر — `replyText` کامل |
| `turn.error` | خطا | بدون تغییر |

`turn.final` عمداً هنوز متن کامل را می‌فرستد: کلاینتی که وسط کار وصل شده یا
دلتایی را از دست داده، حقیقت را از آن می‌گیرد. **دلتاها بهینه‌سازی‌اند، منبع حقیقت نیستند.**

## ۱.۵ لایهٔ کلاینت

`lib/jarvisEngine.ts` — یک پیام «در حال ساخت» که با دلتاها رشد می‌کند:

```ts
export interface EngineSnapshot {
  // … فیلدهای فعلی …
  /** متن در حال تولید. خالی یعنی چیزی در جریان نیست. */
  streamingText: string;
  /** runId فعال — ورودی دکمهٔ توقف (مورد ۷). */
  activeRunId: string | null;
}
```

در `runTurn`، هندلر `loop.text` مقدار را **الحاق** می‌کند و `turn.final` آن را با
متن معتبر سرور **جایگزین** می‌کند و `streamingText` را صفر می‌کند.

`JarvisConversation.tsx` بلوک `{busy && …}` را طوری تغییر می‌دهد که اگر
`streamingText` غیرخالی بود، به‌جای سه نقطه، `<RichText>` آن را نشان دهد.

## ۱.۶ تست‌ها

| تست | فایل | ادعا |
|-----|------|------|
| دلتاها به `ChatResult` یکسان جمع می‌شوند | `shared/test/llm-stream.contract.test.ts` | `chatStream` و `chat` روی یک پاسخ ساختگی، `text` و `toolCalls` یکسان بدهند |
| الحاق آرگومان ابزار | همان | آرگومان تکه‌تکه‌شدهٔ JSON درست بازسازی شود |
| provider بدون استریم | `shared/test/agentcore.contract.test.ts` | نبود `chatStream` → مسیر `chat` بدون خطا |
| ترتیب رویدادها | `services/gateway-api/test/jarvis-stream.test.ts` | `run.started` قبل از اولین `loop.text` |
| رشد و جایگزینی | `services/dashboard-web/test/jarvisEngine.test.ts` | `turn.final` متن استریم را جایگزین کند نه اینکه دو برابر شود |

## ۱.۷ معیار پذیرش

زمان تا اولین کاراکتر روی `simorx.com` **زیر ۱ ثانیه**، اندازه‌گیری‌شده روی یک
turn واقعی با مدل ابری.

**هزینه:** ۲ روز · **ریسک:** کم (fallback: نبود `onDelta` = رفتار امروز)

---

# مورد ۷ — لغو و قطع کردن

## ۷.۱ آنچه از قبل هست

`cancelAgentLoop(runId)` در `loop.ts:497` وجود دارد و `continueLoop` **بین هر دو
گام** پرچم را از دیتابیس می‌خواند:

```ts
const fresh = await runs().findOne({ runId: run.runId });
if (fresh?.cancelRequested) return finish('cancelled', 'cancelled', run.finalText);
```

یعنی موتور لغو کامل است. **فقط به رابط کاربری وصل نیست** — چون `runId` تا پایان
turn به کلاینت نمی‌رسید. مورد ۱ با `loop.run.started` دقیقاً همین را حل می‌کند؛
به همین دلیل ۷ بعد از ۱ می‌آید.

## ۷.۲ تغییرات

| لایه | تغییر |
|------|-------|
| gateway | `POST /v1/jarvis/runs/:runId/cancel` → `cancelAgentLoop` (مسیر `GET /v1/jarvis/runs/:runId` با همان بررسی مالکیت از قبل هست، الگو کپی می‌شود) |
| dashboard | `app/jarvis/actions.ts` → `cancelRunAction(runId)` |
| engine | `export function cancelActive(): void` — `activeRunId` را لغو و صف را خالی می‌کند |
| UI | دکمهٔ `◼` که در حالت `busy` جای دکمهٔ ارسال می‌نشیند |
| صدا | در `useAmbientVoice`، شروع گفتار کاربر → `cancelActive()` (barge-in) |

## ۷.۳ نکتهٔ ظریف

`cancelActive` باید **هم صف را خالی کند و هم run را لغو کند**. لغو فقط run،
دستور بعدی صف را بلافاصله اجرا می‌کند و از دید کاربر یعنی «دکمهٔ توقف کار نکرد».

## ۷.۴ تست

- لغو وسط گام → `stopReason: 'cancelled'`، بدون رکورد هزینهٔ اضافه (تست موجود لغو گسترش می‌یابد)
- `cancelActive` → `queued === 0` و `busy === false`

**هزینه:** نیم روز · **ریسک:** بسیار کم

---

# مورد ۲ — صدای واقعی: Realtime روی WebRTC

## ۲.۱ چرا مسیر فعلی قابل نجات نیست

`lib/speech.ts:26-30` عمداً:

```ts
const sameLang = voices.filter((v) => v.lang…startsWith(base));
if (sameLang.length === 0) return null;   // سکوت، نه صدای انگلیسی روی متن فارسی
```

این تصمیم **درست** است — ولی نتیجه‌اش این است که روی اکثر ویندوزها و همهٔ
مرورگرهای غیر‑Chrome، جارویس ساکت است. مشکل در کد نیست، در API است.

## ۲.۲ معماری

```
مرورگر ──WebRTC (SDP + DataChannel)──▶ OpenAI Realtime
   │                                        │
   │  ephemeral token (۶۰ ثانیه اعتبار)     │ function_call
   ▼                                        ▼
gateway  POST /v1/jarvis/realtime/session   gateway اجرا از طریق registry حاکمیتی
```

**کلید اصلی هرگز به مرورگر نمی‌رود.** gateway توکن کوتاه‌عمر صادر می‌کند.

## ۲.۳ نقاط تماس

### الف) صدور توکن — `services/gateway-api/src/routes/jarvis.ts`

```
POST /v1/jarvis/realtime/session
→ { clientSecret, expiresAt, model, voice, instructions, tools }
```

`instructions` = همان `jarvisSystemPrompt(language, degradedNote)` موجود.
`tools` = `registry.grantsFor(grants)` تبدیل‌شده با همان `chatToolDefsFor`.
**یعنی جارویس صوتی و جارویس متنی دقیقاً یک شخصیت و یک مجموعه ابزار دارند.**

### ب) اجرای ابزار — نقطهٔ حساس امنیتی

مدل realtime `function_call` می‌فرستد. این‌ها **نباید** در مرورگر اجرا شوند.
مسیر: DataChannel → کلاینت → `POST /v1/jarvis/realtime/tool` → gateway →
`evaluateToolRequest` → executor → نتیجه برمی‌گردد → کلاینت آن را به
`conversation.item.create` می‌دهد.

ابزارهای `requiresApproval` در همان مسیر متوقف می‌شوند و checkpoint می‌سازند؛
جارویس با صدا می‌گوید منتظر تأیید است. **هیچ استثنای امنیتی برای صدا وجود ندارد.**

### ج) کلاینت — `lib/useRealtimeVoice.ts` (فایل جدید)

```ts
export interface UseRealtimeVoice {
  supported: boolean;          // RTCPeerConnection + getUserMedia
  status: 'off' | 'connecting' | 'live' | 'error';
  start(): Promise<void>;
  stop(): void;
  muted: boolean;
  toggleMute(): void;
  /** رونوشت زنده برای نمایش — منبع حقیقت نیست. */
  transcript: string;
}
```

## ۲.۴ مرزها — آنچه عمداً نگه داشته می‌شود

| قطعه | سرنوشت | چرا |
|------|--------|-----|
| `useVoice` (push-to-talk) | **می‌ماند** | fallback وقتی realtime قطع/خاموش است |
| `speech.ts` | **می‌ماند** | هنوز برای هشدارهای رویداد تقویمی استفاده می‌شود |
| `useAmbientVoice` | **می‌ماند** | wake word؛ realtime جایگزین آن نیست |
| `attention.ts` | **بدون تغییر** | دروازه، بالادست transport است |

درس D-184 («دقیقاً یک دستیار») رعایت می‌شود: realtime یک **transport** برای همان
موتور است، نه دستیار دوم. اگر خاموش باشد، متن دقیقاً مثل امروز کار می‌کند.

## ۲.۵ کنترل هزینه

صوت گران‌تر از متن است. یک سقف روزانه در `owner_preferences` و بستن خودکار
اتصال بعد از ۹۰ ثانیه سکوت. رکوردها به همان `llm_cost_records` می‌روند با
`taskType: 'realtime_voice'` تا در `/llm/costs` دیده شوند.

## ۲.۶ تست

- صدور توکن بدون احراز هویت → ۴۰۱
- `function_call` روی ابزار `requiresApproval` → checkpoint، نه اجرا
- نبود `OPENAI_API_KEY` → `supported: false` و رابط، دکمه را نشان نمی‌دهد (همان
  الگوی «گزارش صادقانهٔ توانمندی» در `useVoice`)

**هزینه:** ۳ روز · **ریسک:** متوسط

---

# مورد ۵ — PWA و اعلان Push

## ۵.۱ آنچه هست و آنچه نیست

`shared/src/presence/attention.ts` از قبل تصمیم می‌گیرد چه چیزی ارزش مزاحمت دارد
(`speak_now` / `card_only` / `hold_for_briefing`). `briefing-moments.ts` لحظهٔ
تحویل را می‌داند. **کانال تحویل وجود ندارد** — `public/` هیچ manifest ندارد.

## ۵.۲ تغییرات

| فایل | نقش |
|------|-----|
| `public/manifest.webmanifest` | نام، آیکون‌ها، `display: standalone`، `dir: rtl`، `lang: fa` |
| `public/sw.js` | فقط `push` و `notificationclick` — **بدون کش دارایی‌ها** |
| `lib/usePushSubscription.ts` | ثبت SW، درخواست اجازه، ارسال subscription |
| gateway `POST /v1/push/subscribe` \| `DELETE /v1/push/subscription` | ذخیره در collection جدید `push_subscriptions` |
| `shared/src/presence/push.ts` | `deliverPush(actor, decision)` — با `web-push` و کلیدهای VAPID |
| `shared/src/heartbeat/` | جایی که حکم `speak_now` است، `deliverPush` هم صدا زده شود |

## ۵.۳ دو قید که بعداً گران تمام می‌شوند

**۱. service worker نباید کش کند.** یک SW با کش، نسخهٔ قدیمی داشبورد را
نگه می‌دارد و اشکال‌زدایی را کابوس می‌کند. فقط push.

**۲. تحویل باید idempotent باشد.** pulse هر ۵ دقیقه اجرا می‌شود. الگوی موجود
`deliverBriefingIfDue` (ثبت لحظه قبل از علامت‌زدن اقلام) عیناً تکرار می‌شود.
`attention_decisions` یک فیلد `pushedAt` می‌گیرد.

## ۵.۴ env جدید

```env
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:...
```

نبودشان = `deliverPush` بی‌صدا no-op و `/readiness` یک شکاف با «یک نتیجه و یک
اقدام» گزارش می‌کند (همان قرارداد `readiness.ts`).

## ۵.۵ تست

- حکم `card_only` → هیچ push نمی‌رود
- دو pulse پشت سر هم → یک push
- نبود VAPID → no-op، بدون خطا، شکاف در readiness

**هزینه:** ۲ روز · **ریسک:** کم

---

# مورد ۴ — کلاینت MCP

## ۴.۱ اصل طراحی

MCP **یک منبع تعریف ابزار** است، نه یک مسیر اجرای موازی. هر ابزار MCP از همان
`AgentToolRegistry.register` عبور می‌کند، پس خودبه‌خود:

- در `evaluateToolRequest` سیاست می‌خورد
- در `tool_invocations` ثبت می‌شود
- در `happenings` به‌عنوان کارت ظاهر می‌شود
- اگر `requiresApproval` باشد، checkpoint می‌سازد

**هیچ کد حاکمیتی جدیدی نوشته نمی‌شود.** این کل ارزش این طراحی است.

## ۴.۲ ماژول

```
shared/src/mcp/
├── client.ts     — انتقال Streamable HTTP، initialize، tools/list، tools/call
├── registry.ts   — خواندن پیکربندی، کشف، تبدیل به AgentToolBinding
└── policy.ts     — نگاشت ابزار MCP → فیلدهای سیاست
```

```ts
export interface McpServerConfig {
  serverId: string;
  label: string;
  url: string;
  auth: { kind: 'none' | 'bearer' | 'oauth'; secretRef?: string };
  enabled: boolean;
  /** پیش‌فرض تأیید برای ابزارهای این سرور. */
  defaultRequiresApproval: boolean;
  /** فهرست سفید. خالی = همه. */
  allowTools: string[];
}

export async function buildMcpToolFamily(
  configs: McpServerConfig[],
  deps: { fetch?: typeof fetch },
): Promise<AgentToolBinding[]>;
```

collection جدید: `mcp_servers`. مسیرها: `GET|POST /v1/mcp/servers`،
`POST /v1/mcp/servers/:id/probe`.

## ۴.۳ چهار تصمیم سخت

**۱. نام‌گذاری.** ابزار MCP با نام `mcp__<serverId>__<tool>` ثبت می‌شود.
`register` روی نام تکراری **پرتاب می‌کند** (تعمدی، طبق کد فعلی)، و بدون
پیشوند، دو سرور با ابزار `search` کل رجیستری را از کار می‌اندازند.

**۲. تأیید، پیش‌فرضِ امن دارد.** هر ابزار MCP `requiresApproval: true` است مگر
مالک صریحاً در پیکربندی سرور آزادش کند. یک سرور بیرونی، کد بیرونی است.

**۳. خروجی MCP، محتوای نامعتمد است.** نتیجهٔ هر `tools/call` از
`fenceUntrusted(toolName, content)` عبور می‌کند — تابع از قبل در `loop.ts:96` هست.
بدون این، یک سرور MCP مخرب می‌تواند دستور تزریق کند.

**۴. سرور خاموش، خطا نیست.** `availabilityCheck` روی هر binding، سرور
غیرقابل‌دسترس را `available: false` با دلیل می‌کند. `grantsFor` آن را از دید مدل
حذف می‌کند. **مدل هرگز ابزاری را نمی‌بیند که نمی‌تواند اجرا کند.**

## ۴.۴ scope boundary

`shared/src/mcp/*` به `scripts/check-scope-boundary.mjs` اضافه می‌شود (طبق قاعدهٔ
مستند در حافظهٔ پروژه).

## ۴.۵ تست

- دو سرور با ابزار هم‌نام → هر دو ثبت می‌شوند، بدون تصادم
- سرور غیرقابل‌دسترس → `available: false`، مدل آن را نمی‌بیند
- خروجی MCP حاوی متن دستور‌مانند → درون حصار قرار می‌گیرد
- ابزار MCP بدون تنظیم صریح → `requiresApproval: true`

**هزینه:** ۳ روز · **ریسک:** کم

---

# مورد ۶ — حافظه: Hybrid Search بومی Atlas

## ۶.۱ یافتهٔ جدی حین ممیزی

`shared/src/memory2/index.ts:368`:

```ts
const candidates = await records().find(filter)
  .sort({ updatedAt: -1 })
  .limit(400)          // ← سقف سخت
  .toArray();
```

امتیازدهی در Node و **فقط روی ۴۰۰ رکورد اخیر** انجام می‌شود. یعنی هر خاطره‌ای
که خارج از ۴۰۰ به‌روزشدهٔ آخر باشد، **در عمل نامرئی است** — مهم نیست چقدر
مرتبط باشد. با رشد استفاده، این خاموش و بی‌صدا بدتر می‌شود.

این تنها یافتهٔ ممیزی است که کیفیت شخصیت جارویس را در بلندمدت تخریب می‌کند.

## ۶.۲ راه‌حل

`$rankFusion` بومی Atlas: بازیابی lexical و برداری در **یک کوئری**، روی **کل**
مجموعه، با ترکیب رتبه‌ای در خود دیتابیس.

```ts
export type RetrievalMode = 'in_process' | 'atlas_hybrid';
export function retrievalModeFromEnv(env = process.env): RetrievalMode;
```

`searchMemories` دو مسیر می‌گیرد و **امضایش تغییر نمی‌کند**. مسیر `in_process`
بایت‌به‌بایت همان کد امروز است.

## ۶.۳ آنچه باید حفظ شود

امتیاز فعلی فقط شباهت نیست:

```
recency × 0.35 + importance × 0.5 + confidence × 0.2 + pinned × 0.8 + statusBoost
```

اینها **قضاوت محصول‌اند، نه بازیابی**. در مسیر Atlas هم بعد از `$rankFusion` و
روی نتایج آن اعمال می‌شوند. یک خاطرهٔ pin‌شده هرگز حذف نمی‌شود.

## ۶.۴ ایندکس‌ها (کار دستی مالک در Atlas)

| ایندکس | نوع | فیلد |
|--------|-----|------|
| `memory_text` | Atlas Search | `subject`, `content` — آنالایزر چندزبانه برای فارسی |
| `memory_vector` | Vector Search | `vector` (در `memory_embeddings`) |

`scripts/` یک اسکریپت راستی‌آزمایی می‌گیرد که وجود ایندکس‌ها را بررسی می‌کند و
اگر نبودند، مسیر `in_process` را نگه می‌دارد.

## ۶.۵ تست

- دو مسیر روی یک مجموعهٔ کوچک، ترتیب هم‌ارز بدهند
- نبود ایندکس → بازگشت خودکار به `in_process`، بدون خطا
- خاطرهٔ pin‌شدهٔ قدیمی → در هر دو مسیر بازگردانده شود

**هزینه:** ۲ روز · **ریسک:** کم — بدون دیتابیس جدید

---

# مورد ۸ — انسجام محصول

## ۸.۱ وضعیت

`services/dashboard-web/src/app/` اکنون **۸۸ ورودی** دارد. این آینهٔ معماری است،
نه محصول.

## ۸.۲ راه‌حل: گروه مسیر، نه جابه‌جایی فایل

Next.js route group — `(control)` — که **هیچ URL ای را تغییر نمی‌دهد**:

```
app/
├── jarvis/           ← محصول
├── me/               ← مالک
└── (control)/        ← ۸۵ صفحهٔ باقی‌مانده، با layout مشترک
```

هیچ لینک ذخیره‌شده‌ای نمی‌شکند. `middleware.ts` و بازنویسی apex دست‌نخورده.

## ۸.۳ فرمان‌یاب ⌘K

`components/CommandPalette.tsx` — جست‌وجو روی یک فهرست ایستا از مسیرها،
به‌علاوهٔ گزینهٔ «این را از جارویس بپرس» که مستقیم `submit()` را صدا می‌زند.

## ۸.۴ ناوبری دسته‌بندی‌شده

`Sidebar.tsx` از فهرست تخت به ۶ گروه: **زندگی · هوش · حاکمیت · زیرساخت ·
شواهد · سیستم**. نگاشت کامل ۸۸ مسیر در پیوست همین سند نوشته می‌شود تا هیچ
صفحه‌ای گم نشود.

**هزینه:** ۲ روز · **ریسک:** کم

---

# مورد ۹ — توکن‌های طراحی

## ۹.۱ وضعیت

`globals.css` = **۲۲۸۵ خط** در یک فایل. هر تغییر بصری، ریسک رگرسیون در جایی
نامرتبط دارد.

## ۹.۲ راه‌حل

بدون Tailwind، بدون کتابخانهٔ جدید — فقط `@layer` بومی CSS:

```css
@layer tokens, base, components, utilities;

@layer tokens {
  :root {
    --j-accent-core: 236 168 72;   /* از STATE_COLOR در JarvisCoreHUD */
    --j-space-2: 0.5rem;
    --j-motion-fast: 140ms;
    /* … */
  }
}
```

## ۹.۳ قید سخت

`STATE_COLOR` در `JarvisCoreHUD.tsx` و baselineهای منجمد، مقادیر عددی WebGL‌اند و
**نباید به CSS منتقل شوند**. توکن‌ها آنها را *بازتاب* می‌دهند؛ منبع حقیقت رنگ
صحنه، همان TypeScript می‌ماند. یک کامنت این را در هر دو سو ثبت می‌کند.

## ۹.۴ اثبات

اسکرین‌شات قبل/بعد از `/jarvis`، `/me`، `/loop` — تفاوت باید **صفر پیکسل** باشد.
این یک بازآرایی است، نه بازطراحی. بازطراحی بعد از این، ارزان می‌شود.

**هزینه:** ۱ روز · **ریسک:** کم

---

# ترتیب اجرا و وابستگی‌ها

```
۳ (نیم روز) ──▶ ۱ (۲ روز) ──▶ ۷ (نیم روز)      « هفتهٔ ۱ »
                    │
                    └──▶ ۲ (۳ روز) ──▶ ۵ (۲ روز)  « هفتهٔ ۲ »

۴ (۳ روز)  ──▶ ۶ (۲ روز)                        « هفتهٔ ۳ »  [مستقل]
۹ (۱ روز)  ──▶ ۸ (۲ روز)                        « هفتهٔ ۴ »  [مستقل]
```

**وابستگی‌های سخت:**
- ۷ به ۱ نیاز دارد (`runId` زودهنگام از `loop.run.started`)
- ۵ به ۲ نیاز **ندارد** — می‌توان موازی برد
- ۸ بعد از ۹ ارزان‌تر است (توکن‌ها قبل از جابه‌جایی layout)

**جمع:** ۱۶ روز کاری.

---

# آنچه در هر مورد ثابت می‌ماند

هر مورد وقتی «تمام» است که:

۱. تست‌های موجود (`shared` ۵۴۴ · `gateway` ۲۵۴ · `dashboard` ۲۱۲) سبز بمانند
۲. هر سه بسته `typecheck` تمیز بدهند
۳. `pnpm check:scope-boundary` سبز باشد
۴. ورودی `docs/decision-log.md` با **دلیل**، نه فقط شرح تغییر
۵. `docs/current-state.md` به‌روز شود
۶. معیار پذیرش همان بخش، روی `simorx.com` واقعی دیده شود

**بند ۶ مهم‌ترین است:** بنر `PRODUCT_VERIFIED = 0` در `current-state.md` هنوز
سر جایش است. این طرح فرصت برداشتن آن است — هر مورد باید در مرورگر واقعی با مدل
واقعی اثبات شود، نه فقط در تست.

---

# پیوست — نگاشت فایل‌های لمس‌شده

| مورد | ایجاد | تغییر |
|------|-------|-------|
| ۳ | — | `.env`, `.env.example`, `llm/toolcalling.ts`, `jarvis/turn-runner.ts` |
| ۱ | `shared/test/llm-stream.contract.test.ts`, `gateway/test/jarvis-stream.test.ts` | `llm/toolcalling.ts`, `agentcore/loop.ts`, `jarvis/turn-runner.ts`, `routes/jarvis.ts`, `lib/jarvisEngine.ts`, `components/JarvisConversation.tsx` |
| ۷ | — | `routes/jarvis.ts`, `app/jarvis/actions.ts`, `lib/jarvisEngine.ts`, `components/JarvisConversation.tsx`, `lib/useAmbientVoice.ts` |
| ۲ | `lib/useRealtimeVoice.ts` | `routes/jarvis.ts`, `components/JarvisConversation.tsx`, `.env.example` |
| ۵ | `public/manifest.webmanifest`, `public/sw.js`, `lib/usePushSubscription.ts`, `shared/src/presence/push.ts`, `routes/push.ts` | `app/layout.tsx`, `shared/src/heartbeat/*`, `shared/src/constants/*` |
| ۴ | `shared/src/mcp/{client,registry,policy}.ts`, `routes/mcp.ts`, `app/(control)/mcp/page.tsx` | `agentcore/families.ts`, `shared/src/constants/*`, `scripts/check-scope-boundary.mjs` |
| ۶ | `scripts/verify-atlas-indexes.mjs` | `shared/src/memory2/index.ts` |
| ۸ | `components/CommandPalette.tsx` | `app/(control)/layout.tsx`, `components/Sidebar.tsx` |
| ۹ | — | `app/globals.css` |
