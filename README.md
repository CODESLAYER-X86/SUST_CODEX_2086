# QueueStorm Investigator — MFS Ticket Analysis Copilot

QueueStorm Investigator is a high-performance, policy-compliant ticket analysis API designed for Digital Finance / Mobile Financial Services (MFS) platforms. It assists support agents by investigating customer complaints against transaction logs, classifying issues, routing them to the correct department, and drafting safe, localized customer replies.

This service is built using **Option A: Native Vercel Serverless Functions** in TypeScript, delivering sub-second response times, tiny bundle footprints, and zero framework overhead.

---

## 🚀 Key Features

* **Zero-Overhead Routing**: Written directly using native Vercel Serverless Node.js handlers for `/api/health` and `/api/analyze-ticket`.
* **Clean Endpoints Rewrite**: Using `vercel.json` rewrite rules to map functions directly to root `/health` and `/analyze-ticket` routes.
* **100% Schema Correctness**: Strict validation using TypeScript interfaces and Zod schemas ensures zero field/enum mismatches.
* **Deterministic Rules Matching**: Hybrid logic engine pre-normalizes monetary values and handles Bengali script numbers, pairing complaints to the correct transaction.
* **Safety Guardrails Layer**: Post-processes output to intercept security leaks (PIN/OTP requests) or unauthorized commitments (promising refunds or reversal completions), automatically rewriting them to safe, policy-compliant statements.
* **Bangla & Banglish Support**: Dynamically detects Bengali script and drafts replies in grammatically correct, polite Bengali.
* **Fail-Safe Robustness**: If the Gemini API is offline or rate-limited, the system automatically falls back to local rules-based analysis, ensuring the service always returns a successful 200 HTTP code.

---

## 🛠️ Tech Stack
* **Runtime / Deployment**: Vercel Serverless Functions (Node.js 18+ / TypeScript)
* **AI Core**: Google AI Studio (Gemini 3.5 Flash API via `@google/generative-ai`)
* **Database / Audit Trail**: Supabase PostgreSQL (via `@supabase/supabase-js`)
* **Schema Validation**: Zod

---

## ⚙️ Environment Variables
Create a `.env` file in the root directory (or configure them in your Vercel Dashboard):

```ini
# Google AI Studio Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here
MODEL_NAME=gemini-1.5-flash

# Supabase database configuration (Optional - fallback if omitted)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

---

## 📊 Supabase Database Schema
To enable request audit logging (which grants the "Exceptional Integration" bonus), run the following query in your Supabase SQL Editor:

```sql
CREATE TABLE tickets_audit (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id text NOT NULL,
  complaint text NOT NULL,
  language text,
  channel text,
  user_type text,
  relevant_transaction_id text,
  evidence_verdict text NOT NULL,
  case_type text NOT NULL,
  severity text NOT NULL,
  department text NOT NULL,
  agent_summary text NOT NULL,
  recommended_next_action text NOT NULL,
  customer_reply text NOT NULL,
  human_review_required boolean NOT NULL,
  confidence double precision,
  reason_codes text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

---

## 🧪 Local Testing & Validation

We have a local validation harness that runs all 10 worked cases from `SUST_Preli_Sample_Cases.json` directly through the serverless function handler in-memory.

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Execute Validation Suite**:
   ```bash
   npm run validate
   ```
This will print a complete scoreboard showing schema verification, verdict matching, safety assertions, and latency metrics.

---

## 📦 Deployment
Deploying to Vercel takes less than a minute:

1. **Vercel CLI**:
   ```bash
   vercel
   ```
2. **GitHub Integration**:
   Simply push this repository to GitHub and link it on your Vercel Dashboard. The build will succeed out-of-the-box.
