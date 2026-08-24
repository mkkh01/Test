# Invoice network incident notes

- Evidence from user screenshot: a newly created 7 USDT invoice displayed `Network TRC20` and a receiving address beginning with `T`, while the surrounding copy said Solana.
- `public/app.js` renders `order.network` and `order.receivingAddress` directly; it does not transform or invent TRC20 values.
- The server order route writes `paymentConfig().network` and `paymentConfig().receivingAddress` into both `orders` and `invoices`.
- `render.yaml` and `.env.example` specify `USDT_NETWORK=SOLANA_SPL`, the Solana receiving address, and the official USDT-SPL mint, but existing Render environment values may not have been synchronized from the Blueprint.
- Local safety changes now validate the Solana base58 address, require the official USDT-SPL mint, require `USDT_NETWORK=SOLANA_SPL`, and return HTTP 503 before any insert when configuration is invalid.
- No live payment, email, cron run, or deletion was performed during this incident review.
