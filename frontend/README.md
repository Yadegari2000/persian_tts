# استودیو تبدیل متن به گفتار فارسی چندصدایی (Persian TTS Frontend)

رابط کاربری وب برای تبدیل متن فارسی به گفتار چندصدایی، پیش‌پردازش هوشمند (نرمال‌سازی حروف و نیم‌فاصله، تبدیل اعداد، دیکشنری تلفظ)، حالت دیالوگ/فیلمنامه، کتابخانهٔ کلیپ‌های صوتی با تایم‌لاین و ویرایش/برش خروجی نهایی.

---

## پیش‌نیازها (Node.js)

این پروژه از **Vite 8** و **React 19** استفاده می‌کند و برای اجرا به نسخهٔ زیر نیاز دارد:

- **Node.js 22 LTS** (`>=22.0.0`) و `npm` (`>=10`)

برای بررسی نسخهٔ نصب‌شده:

```bash
node -v
npm -v
```

---

## نصب و راه‌اندازی

۱. نصب وابستگی‌ها:

```bash
npm install
```

۲. پیکربندی متغیرهای محیطی (اختیاری):

یک کپی از فایل `.env.example` با نام `.env` بسازید (فایل `.env` در `.gitignore` قرار دارد و نباید وارد Git شود):

```bash
cp .env.example .env
```

۳. اجرای سرور توسعه (Development):

```bash
npm run dev
```

برنامه به‌صورت پیش‌فرض روی پورت `3000` در دسترس است (`http://localhost:3000`).

۴. ساخت نسخهٔ نهایی (Production Build):

```bash
npm run build
```

خروجی نهایی در پوشهٔ `dist/` ساخته می‌شود و برای پیش‌نمایش آن می‌توانید از دستور زیر استفاده کنید:

```bash
npm run preview
```

---

## تنظیم حالت شبیه‌ساز (Mock) یا Backend واقعی

وضعیت شبیه‌ساز و نشانی سرور API از طریق متغیرهای محیطی Vite در فایل `.env` قابل کنترل است (مقادیر حساس نباید وارد Git شوند):

- **حالت توسعه با شبیه‌ساز داخلی (Mock فعال - پیش‌فرض):**

```env
VITE_USE_MOCK=true
```

- **اتصال به سرور Backend واقعی در Production:**

```env
VITE_USE_MOCK=false
VITE_API_BASE_URL=https://api.example.com
```

---

## تست و بررسی کد

- بررسی تایپ‌های TypeScript:

```bash
npm run lint
```

- اجرای تست‌های واحد منطق متن و موتور صوت:

```bash
npx tsx --test tests/studio.test.mts
```

- اجرای تست منطق ماژول‌های استاتیک داخل `public/assets/aistudio/`:

```bash
node public/assets/aistudio/logic.test_90976956.mjs
```

---

## ساختار پوشه‌ها

- `src/` — سورس اصلی اپلیکیشن React + TypeScript
- `public/` — دارایی‌ها و فایل‌های استاتیک سرو‌شده توسط Vite
- `tests/` — تست‌های واحد برنامه
- `index.html` — نقطهٔ ورود اصلی Vite
- `vite.config.ts` و `tsconfig.json` — تنظیمات Vite و TypeScript
