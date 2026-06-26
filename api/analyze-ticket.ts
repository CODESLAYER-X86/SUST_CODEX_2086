import { withSupabase } from '@supabase/server';
import { AnalyzeTicketInputSchema, validateResponse } from '../src/types';
import { matchTransaction, runRulesFallback } from '../src/services/rules';
import { analyzeTicketWithGemini } from '../src/services/gemini';
import { applySafetyGuardrails } from '../src/services/guardrails';

export const config = { runtime: 'edge' };

export default withSupabase({ auth: 'none' }, async (req, ctx) => {
  // 1. Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 2. Parse request body
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Malformed JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 3. Validate input schema
  const validation = AnalyzeTicketInputSchema.safeParse(body);
  if (!validation.success) {
    return new Response(JSON.stringify({
      error: 'Schema validation error',
      details: validation.error.format()
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const input = validation.data;

  try {
    // 4. Execution Phase: Hybrid Pipeline
    
    // Step A: Run deterministic rules pre-matching
    const preMatchResult = matchTransaction(input);

    // Step B: Call Gemini AI Studio reasoning
    let rawAnalysis = await analyzeTicketWithGemini(input, preMatchResult);

    // Step C: Apply safety guardrails (re-write OTP, PIN, refund promises if needed)
    let safeAnalysis = applySafetyGuardrails(rawAnalysis, input.language);

    // Step D: Confirm final output compliance (Safety gate check)
    let finalOutput;
    try {
      finalOutput = validateResponse(safeAnalysis);
    } catch (schemaErr) {
      console.warn('[Validation Warning] Response schema validation failed. Reverting to safe fallback rules engine.', schemaErr);
      const fallbackResult = runRulesFallback(input);
      finalOutput = validateResponse(applySafetyGuardrails(fallbackResult, input.language));
    }

    // 5. Supabase DB Logging via ctx.supabaseAdmin (Fire-and-forget: do not await)
    try {
      const logPayload = {
        ticket_id: input.ticket_id,
        complaint: input.complaint,
        language: input.language || 'unknown',
        channel: input.channel || 'unknown',
        user_type: input.user_type || 'unknown',
        relevant_transaction_id: finalOutput.relevant_transaction_id,
        evidence_verdict: finalOutput.evidence_verdict,
        case_type: finalOutput.case_type,
        severity: finalOutput.severity,
        department: finalOutput.department,
        agent_summary: finalOutput.agent_summary,
        recommended_next_action: finalOutput.recommended_next_action,
        customer_reply: finalOutput.customer_reply,
        human_review_required: finalOutput.human_review_required,
        confidence: finalOutput.confidence ?? null,
        reason_codes: finalOutput.reason_codes ?? [],
        created_at: new Date().toISOString()
      };

      (ctx.supabaseAdmin as any)
        .from('tickets_audit')
        .insert([logPayload])
        .then(({ error }: any) => {
          if (error) {
            console.warn('[Supabase Log Warning] SDK insert failed:', error.message);
          } else {
            console.info(`[Supabase Log Success] Logged ticket ${input.ticket_id} via SDK.`);
          }
        });
    } catch (err) {
      console.warn('[Supabase Log Exception] Gracefully caught logging setup error:', err);
    }

    // 6. Response output
    return new Response(JSON.stringify(finalOutput), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(`[Critical Error] Unexpected exception in analyze-ticket:`, error);
    
    // In case of any unexpected core logic errors, output our deterministic fallback.
    const fallbackResult = runRulesFallback(input);
    const safeFallback = applySafetyGuardrails(fallbackResult, input.language);
    return new Response(JSON.stringify(validateResponse(safeFallback)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
