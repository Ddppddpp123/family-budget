# Ledger v16 - Stable Credit Import

This version keeps the existing Ledger data model and cloud backup, and replaces credit-card PDF import with a server-side Vercel parser.

## What changed

- PDF files are parsed through `/api/parse-card` using Vercel Functions and `pdf-parse`.
- Credit-card imports are grouped by card in the UI and sorted chronologically inside each card.
- Merchant names are extracted from PDF coordinates instead of broad text guesses.
- Installments are detected where the PDF contains `תשלום X מתוך Y`.
- Family member selection now works from the transaction table.
- Imports use duplicate detection by card/date/merchant/amount.
- Existing income, fixed expenses, offsets, categories, rules and cloud state are preserved.

## Deploy

Upload all files in this repository to the existing GitHub repository connected to Vercel. Vercel will install dependencies from `package.json` and deploy automatically.

## Environment variables

The existing server backup continues to use:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LEDGER_EMAIL`
- `LEDGER_PASSWORD`
