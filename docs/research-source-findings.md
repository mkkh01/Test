# نتائج التحقق من مصادر البحث العامة

## Reddit

المصدر الرسمي: https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki

بحسب صفحة Reddit المحدثة في 11 مايو 2026، يتطلب Reddit OAuth للمصادقة، وقد يتم throttling أو حظر مستخدمي Data API غير المعرّفين. توصي Reddit باستخدام User-Agent وصفي وفريد. حد الاستخدام المجاني المذكور هو 100 طلب في الدقيقة لكل OAuth client id، مع مراقبة رؤوس X-Ratelimit. يجب حذف المحتوى الذي حذفه صاحبه أو حُذف حسابه، وتوصي الصفحة بحذف بيانات المستخدم المحذوف خلال 48 ساعة. لذلك يجب أن يقتصر التكامل على القراءة العامة المسموحة، مع تخزين الحد الأدنى والرابط واسم الحساب العام، ومنع الرد أو الإرسال الآلي.

## X

المصدر الرسمي: https://docs.x.com/x-api/posts/search/quickstart/recent-search

توثيق X الرسمي يوضح أن Recent Search يبحث في المنشورات العامة خلال آخر 7 أيام، ويتطلب تطبيقًا معتمدًا وApp Bearer Token من Developer Console. البحث يستخدم مشغلات الاستعلام، مثل استبعاد إعادة النشر وتقييد اللغة. يجب التحقق من خطة الوصول الحالية وحدودها قبل تفعيل المصدر؛ لا ينبغي افتراض أن الوصول المجاني أو البحث التاريخي الكامل متاح.

## قرار أولي

المصادر الحالية في المشروع هي Hacker News وStack Exchange/Stack Overflow وDEV وBluesky. Reddit وX مناسبان كمصدرين إضافيين للعثور على منشورات عامة تتحدث عن مشاكل الدفع أو زحف النطاق، لكن Reddit يحتاج OAuth وتطبيقًا مسجلاً، وX يحتاج Bearer Token وتحققًا من الوصول/التكلفة. ستُحفظ المسودة والحساب والرابط فقط للمراجعة، وسيبقى OUTREACH_SEND_ENABLED متوقفًا.

## حدود السلامة

لن يُستخدم scraping خاص أو تسجيل دخول بحساب المستخدم أو CAPTCHA bypass أو رسائل خاصة أو نشر تلقائي. لا يجوز اعتبار وجود منشور دليلًا على الرغبة في الشراء، ويجب أن تبقى كل مسودة تحت موافقة المستخدم قبل أن يرسلها يدويًا. 

## تفاصيل نقاط البحث الرسمية

مرجع Reddit الرسمي للبحث: https://www.reddit.com/dev/api/oauth/#GET_search. يوضح المرجع أن البحث يعيد نتائج عامة عبر معاملات مثل `q`, `limit`, `sort`, و` t`، مع حد أقصى مذكور للنتائج في الطلب الواحد. سيستخدم التطبيق endpoint OAuth الموثق فقط، ولن يعتمد على robots.txt أو scraping لصفحات المستخدمين.

مرجع X الرسمي: https://docs.x.com/x-api/posts/search-recent-posts. نقطة `GET /2/tweets/search/recent` تتطلب Authorization header، وتقبل query بطول 1–4096، و`max_results` بين 10 و100، وتدعم `post.fields` مثل `created_at`, `lang`, `text` وexpansion لـ`author_id` مع `user.fields=username,name`. قيد `start_time` يجب أن يكون داخل آخر 7 أيام. سيبني التطبيق رابط المنشور من `username` و`id`، ويستبعد إعادة النشر ويقيد البحث بالإنجليزية حيث يلزم.

## Google والبديل الواسع

المصدر الرسمي من Google: https://developers.google.com/custom-search/v1/overview. توضح Google أن Custom Search JSON API مغلق للعملاء الجدد، وأن العملاء الحاليين لديهم مهلة انتقال حتى 1 يناير 2027. لذلك لا ينبغي بناء النظام على Google Custom Search API كحل جديد. تقترح الصفحة Vertex AI Search للبحث في عدد محدود من النطاقات، أو التواصل مع Google بخصوص حل البحث الكامل. كما أن Custom Search JSON API يتطلب API key ومحرك بحث معرفًا.

بديل بحث عام موثق: https://brave.com/search/api/. يقدم Brave Search API بحث الويب عبر endpoint رسمي باستخدام `X-Subscription-Token`، وتذكر الصفحة رصيدًا مجانيًا شهريًا بقيمة 5 دولارات. هذا لا يحتاج إلى إنشاء تطبيق داخل Reddit أو X، لكنه يحتاج حساب Brave ومفتاح API، وقد يتطلب وسيلة دفع وفق إعداد الحساب. سيبقى استخدامه محدودًا ومعدلًا، مع تخزين النتائج العامة الضرورية فقط.

لا ينبغي كشط صفحات نتائج Google HTML أو إرسال استعلامات آلية مباشرة إلى Google؛ المسار الأنسب هو Brave Search API كطبقة بحث عامة، مع إبقاء المصادر الرسمية المباشرة مثل GitHub وStack Exchange وDEV وBluesky وReddit/X اختيارية.

## مراجعة Bluesky في دورة Render

سجل Render أظهر `fetch failed` من Bluesky. اختُبر `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts` وendpoint البديل `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts` ببحث عام محدود، وكلاهما أعاد HTTP 403 من بيئة التشغيل مع رسالة administrative rules. لذلك لا ينبغي اعتبار Bluesky مصدرًا مجانيًا مضمونًا في هذه البيئة؛ يجب عزله أو تعطيله افتراضيًا بدل تسجيل فشل متكرر، مع إبقاء بقية المصادر تعمل.
