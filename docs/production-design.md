# Production Design — Client Payment & Scope Protection Kit

## الهدف

يعمل النظام كمتجر رقمي يستقبل طلبًا، ينشئ فاتورة USDT-SPL على شبكة Solana، يسمح للعميل بإرسال transaction signature، يتحقق الخادم من المعاملة عبر Solana JSON-RPC، ثم يسلّم الحزمة الرقمية من خلال رمز تنزيل مؤقت. تبقى كل عمليات الدفع والتسليم حتمية وقابلة للتدقيق، بينما تستخدم Gemini فقط لتحليل المحتوى العام وصياغة مسودات، ولا ترسل رسائل خارجية دون موافقة بشرية.

## دورة الطلب والدفع

| الحالة | الحدث الذي ينقل إليها | الإجراء المسموح |
|---|---|---|
| `awaiting_payment` | إنشاء الطلب والفاتورة | عرض الشبكة والعنوان والمبلغ ووقت الانتهاء |
| `payment_detected` | وصول transaction signature صالح مبدئيًا | حفظ transaction signature مرة واحدة وتشغيل فحص التحقق |
| `confirming` | المعاملة صحيحة لكن التأكيدات أقل من الحد | إعادة الفحص بفاصل متزايد، من دون اعتماد الدفع |
| `paid` | اكتمال كل شروط التحقق | إنشاء رمز تنزيل أحادي المصدر وإرسال رابط للعميل |
| `manual_review` | تعارض أو استجابة مزود غير حاسمة أو استثناء | إيقاف التسليم وإظهار الحالة للإدارة |
| `expired` | انتهاء الفاتورة قبل الدفع | رفض الدفع المتأخر أو إحالته للمراجعة اليدوية |
| `cancelled` | إلغاء إداري صريح | عدم قبول أي دفع جديد |

يجب أن تكون عملية اعتماد الدفع ذرّية داخل PostgreSQL. يُقفل الطلب والفاتورة، ويُتحقق من عدم وجود transaction signature سابق، ثم تُحفظ نتيجة الدفع ويُحدّث الطلب والفاتورة في معاملة واحدة. لا يجوز أن يصبح الطلب `paid` اعتمادًا على وجود transaction signature وحده.

إذا فشل التحقق من transaction signature مرتين بسبب عدم العثور على المعاملة أو عدم تطابقها مع الفاتورة، يزيد `payment_failed_attempts` ويظهر للعميل نموذج مساعدة. يمكنه إرسال transaction signature أو نص تفاصيل التحويل أو Screenshot صغيرة. يُحفظ الدليل في جدول خاص ولا يُعتمد تلقائيًا؛ يراجع المشرف المعاملة على Solana، ويقارن الشبكة وUSDT mint والمبلغ وfinalization والعنوان مع العنوان الحالي في Render، ثم يستخدم الاعتماد اليدوي المسجل في `audit_logs` فقط إذا تطابقت الأدلة. الـScreenshot دليل مساعد وليست إثباتًا وحيدًا.

## قواعد Solana JSON-RPC

ينشئ التطبيق `SolanaRpcProvider` server-side فقط. يستعمل `SOLANA_RPC_URL` و`SOLANA_COMMITMENT=finalized` من متغيرات البيئة، ولا يحتاج إلى private key أو صلاحية توقيع. يطلب `getTransaction` بترميز `jsonParsed`، ويقرأ `meta.err` و`preTokenBalances` و`postTokenBalances`، ثم يطابق USDT mint والمالك المستلم والفرق الموجب في رصيد SPL قبل إعادة كائن موحد إلى `UsdtVerifier`. إذا لم تظهر المعاملة بعد، يستخدم `getSignatureStatuses` ويعيد حالة `confirming` بدل الاعتماد.

الكائن الموحد المطلوب هو:

```text
{
  txid,
  network: "SOLANA_SPL",
  fromAddress,
  toAddress,
  tokenContract,
  amountUsdt,
  confirmations,
  success,
  slot,
  finalized,
  raw
}
```

لا تُقبل المعاملة إلا إذا تحقق عنوان محفظة Solana المستلم، وUSDT mint، وقيمة التحويل، ونجاح التنفيذ النهائي، و`USDT_MIN_CONFIRMATIONS`, وعدم تكرار signature، وكون الطلب غير منتهي. تُحفظ الاستجابة الخام في `payments.raw_reference` بعد تنقيتها من أي ترويسات أو مفاتيح.

## نقاط API العامة

| المسار | الغرض | الحماية |
|---|---|---|
| `POST /api/orders` | إنشاء طلب وفاتورة | تحقق صارم من المنتج والبريد ومعدل الطلب |
| `GET /api/orders/:orderNumber` | عرض حالة الفاتورة للعميل | لا يعرض بيانات حساسة؛ يحتاج رابط حالة موقّع |
| `POST /api/orders/:orderNumber/payment` | تقديم Solana transaction signature | يقبل transaction signature فقط مع رمز حالة موقّع أو سر طلب، ويطلب دليلًا بعد فشلين |
| `POST /api/orders/:orderNumber/payment-evidence` | إرسال transaction signature أو نص التحويل أو Screenshot | رمز حالة موقّع، متاح بعد فشلين، تخزين خاص ومراجعة بشرية |
| `GET /api/download/:token` | تنزيل الحزمة | رمز hashed، منتهي، والطلب `paid` فقط |
| `GET /api/health` | فحص الخدمة | عام، بلا أسرار |
| `GET /api/admin/summary` | إحصاءات الإدارة | `ADMIN_ACCESS_TOKEN` |
| `GET /api/admin/orders` | قائمة مراجعة الطلبات والمدفوعات | `ADMIN_ACCESS_TOKEN`، pagination |
| `GET /api/admin/orders/:id/evidence` | عرض آخر دليل خاص ومقارنة عنوان Render | `ADMIN_ACCESS_TOKEN` |
| `POST /api/admin/orders/:id/recheck` | إعادة فحص يدوي | `ADMIN_ACCESS_TOKEN`، idempotent |
| `POST /api/admin/orders/:id/approve` | اعتماد يدوي استثنائي | `ADMIN_ACCESS_TOKEN`، audit log إلزامي |

لا تُستخدم أرقام الطلبات أو البريد وحدها لتغيير الحالة. كل endpoint يغيّر حالة يفرض تحققًا من المدخلات، وسجل تدقيق، وقفلًا أو شرطًا ذريًا في قاعدة البيانات.

## رمز حالة العميل

بعد إنشاء الطلب، يحصل العميل على رمز حالة عشوائي طويل لا يُخزن بصورته الخام. يُستخدم الرمز لعرض الفاتورة وتقديم transaction signature، مع rate limiting وربطه بالطلب. لا تُعرض بيانات الطلب الداخلية أو نتائج التحليل أو عناوين الإدارة عبر endpoint عام.

## التسليم

بعد الاعتماد، يولّد النظام رمز تنزيل عشوائيًا، يخزن hash فقط، ويحدد مدة صلاحية قصيرة قابلة للتهيئة. لا يرسل الملف قبل حالة `paid`. يفضل في الإنتاج نقل ZIP إلى تخزين كائنات خاص، لكن النسخة الحالية تستطيع تقديم الملفات الصغيرة من مساحة التطبيق مؤقتًا. يجب تسجيل كل عملية تنزيل في `audit_logs` مع عدم تخزين الرمز الخام.

## العمال والجدولة

يُستخدم صف `jobs` مع `FOR UPDATE SKIP LOCKED`، ومحاولات محدودة، و`run_after` وdead-letter. لا تستخدم العملية `setInterval` أو polling سريعًا داخل خادم الويب. على Render، يُفصل خادم الويب عن Background Worker لمعالجة `payment_check`, `delivery`, `lead_analyze`, و`cleanup`. ويمكن إضافة Cron Job منخفض التردد لاستعادة الوظائف المتأخرة، بينما يُفحص transaction signature فقط عند تقديمه أو بفواصل متزايدة أثناء `confirming`.

## Gemini

تظل مفاتيح Gemini server-side. يستخدم التحليل structured output مع schema ثابت، ويُحفظ `raw_response` بعد حد الحجم. لا يرسل النظام بيانات خاصة غير لازمة إلى Gemini. تحليل العملاء يقتصر على مصادر عامة، ويولد `message_draft` بحالة `draft` و`needs_human_review=true`. لا ينتقل النص إلى `queued` أو `sent` تلقائيًا.

## Telegram

يعمل Telegram فقط عبر Bot رسمي، وللمستخدمين الذين بدأوا المحادثة مع البوت أو وافقوا على التواصل. لا يوجد scraping لحسابات Telegram ولا رسائل جماعية. يرسل البوت إشعارات الطلب أو رابط التنزيل فقط بعد تحقق حالة الطلب، مع secret token للتحقق من webhook وrate limiting.

## الأسرار ومتغيرات البيئة

| المتغير | النوع | الوظيفة |
|---|---|---|
| `DATABASE_URL` | سري | اتصال PostgreSQL الأساسي |
| `ADMIN_ACCESS_TOKEN` | سري | حماية الإدارة |
| `SOLANA_RPC_URL` | غير سري/تشغيلي | Solana Mainnet JSON-RPC |
| `SOLANA_COMMITMENT` | غير سري | `finalized` |
| `USDT_NETWORK` | غير سري | `SOLANA_SPL` |
| `USDT_RECEIVING_ADDRESS` | حساس تشغيليًا | عنوان الاستقبال العام |
| `SOLANA_USDT_MINT` | غير سري | mint الرسمي لـUSDT على Solana |
| `USDT_TOKEN_CONTRACT` | غير سري | اسم توافق للمَنت |
| `USDT_MIN_CONFIRMATIONS` | غير سري | `1` مع finalized |
| `GEMINI_API_KEY_1..5` | أسرار | تدوير مفاتيح Gemini ضمن الشروط |
| `GEMINI_MODEL` | غير سري | نموذج التحليل |
| `TELEGRAM_BOT_TOKEN` | سري | Bot API |

## ضوابط منع الإزعاج

تُخزن كل مسودة outreach مع مصدرها ودليلها، وتظل `approval_required=true`. يمنع النظام تكرار التواصل مع المصدر نفسه ضمن فترة تهدئة، ويمنع الإرسال إذا لم يكن المصدر يسمح بالتواصل أو إذا كان المحتوى لا يتضمن طلبًا أو مشكلة واضحة. لا توجد ميزة bulk send، ولا تدوير مفاتيح بهدف تجاوز حصص أي منصة.

## قبول الإنتاج

لا تُعتبر النسخة تجارية مكتملة إلا بعد نجاح اختبارات provider الوهمية والحقيقية المحدودة، واختبارات transaction signature المكرر، والمبلغ الناقص، والعقد الخاطئ، والعنوان الخاطئ، والتأكيدات الناقصة، والانتهاء، وإعادة المحاولة، والتنزيل بعد الدفع، وعدم التسليم قبل الدفع. يجب أن يظهر `/api/health` أن `postgresConfigured=true` وأن verifier مهيأ فقط عندما يكون provider ومعلومات USDT الصحيحة متاحة.
