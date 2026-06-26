import type { VercelRequest, VercelResponse } from '@vercel/node';
import dotenv from 'dotenv';
import { AnalyzeTicketInputSchema, validateResponse } from '../src/types';
import { matchTransaction, runRulesFallback } from '../src/services/rules';
import { analyzeTicketWithGemini } from '../src/services/gemini';
import { applySafetyGuardrails } from '../src/services/guardrails';
import { logTicketAnalysis } from '../src/services/supabase';

dotenv.config();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  const body = req.body;
  
  // 2. Validate input schema
  const validation = AnalyzeTicketInputSchema.safeParse(body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Schema validation error',
      details: validation.error.format()
    });
  }

  const input = validation.data;

  try {
    // 3. Execution Phase: Hybrid Pipeline
    
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
      // If the LLM returned invalid enums or fields, fallback immediately
      const fallbackResult = runRulesFallback(input);
      finalOutput = validateResponse(applySafetyGuardrails(fallbackResult, input.language));
    }

    // 4. Supabase DB Logging (Fire-and-forget: do not await so we optimize latency)
    logTicketAnalysis(input, finalOutput).catch(err => {
      console.error('Failed to log transaction to Supabase in background:', err);
    });

    // 5. Response output
    return res.status(200).json(finalOutput);

  } catch (error) {
    console.error(`[Critical Error] Unexpected exception in analyze-ticket:`, error);
    
    // In case of any unexpected core logic errors, output our deterministic fallback.
    // This guarantees the service never returns a 500 crash, ensuring max reliability points.
    const fallbackResult = runRulesFallback(input);
    const safeFallback = applySafetyGuardrails(fallbackResult, input.language);
    return res.status(200).json(validateResponse(safeFallback));
  }
}
