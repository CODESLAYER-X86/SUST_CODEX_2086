import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { AnalyzeTicketInput, AnalyzeTicketOutput } from '../types';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase: SupabaseClient | null = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
  }
} else {
  console.info('Supabase environment variables not fully configured. Database logging is disabled (running in local-only fallback mode).');
}

/**
 * Log the ticket input and our analysis verdict to the Supabase database.
 * This runs as a fail-safe background task so it doesn't block the API response.
 */
export async function logTicketAnalysis(
  input: AnalyzeTicketInput, 
  output: AnalyzeTicketOutput
): Promise<void> {
  if (!supabase) {
    return;
  }

  const logPayload = {
    ticket_id: input.ticket_id,
    complaint: input.complaint,
    language: input.language || 'unknown',
    channel: input.channel || 'unknown',
    user_type: input.user_type || 'unknown',
    relevant_transaction_id: output.relevant_transaction_id,
    evidence_verdict: output.evidence_verdict,
    case_type: output.case_type,
    severity: output.severity,
    department: output.department,
    agent_summary: output.agent_summary,
    recommended_next_action: output.recommended_next_action,
    customer_reply: output.customer_reply,
    human_review_required: output.human_review_required,
    confidence: output.confidence ?? null,
    reason_codes: output.reason_codes ?? [],
    created_at: new Date().toISOString()
  };

  try {
    // Attempt inserting into tickets_audit table
    const { error } = await supabase
      .from('tickets_audit')
      .insert([logPayload]);

    if (error) {
      console.warn(`[Supabase Log Warning] Could not write to table tickets_audit. Details: ${error.message}`);
      console.info('Tip: Ensure you have created a "tickets_audit" table in your Supabase dashboard.');
    } else {
      console.info(`[Supabase Log Success] Logged ticket ${input.ticket_id} successfully.`);
    }
  } catch (err) {
    console.warn('[Supabase Log Exception] Gracefully caught insert error:', err);
  }
}

/**
 * Helper SQL definition that the user can run in Supabase SQL editor:
 * 
 * CREATE TABLE tickets_audit (
 *   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   ticket_id text NOT NULL,
 *   complaint text NOT NULL,
 *   language text,
 *   channel text,
 *   user_type text,
 *   relevant_transaction_id text,
 *   evidence_verdict text NOT NULL,
 *   case_type text NOT NULL,
 *   severity text NOT NULL,
 *   department text NOT NULL,
 *   agent_summary text NOT NULL,
 *   recommended_next_action text NOT NULL,
 *   customer_reply text NOT NULL,
 *   human_review_required boolean NOT NULL,
 *   confidence double precision,
 *   reason_codes text[] DEFAULT '{}'::text[],
 *   created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
 * );
 */
