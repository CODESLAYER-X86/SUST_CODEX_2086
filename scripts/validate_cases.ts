import fs from 'fs';
import path from 'path';

// Inject mock Supabase credentials for local test validation suite
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://fpmrjzuzceontfauokgs.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_placeholder_anon_key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'sb_secret_placeholder_service_role_key';
process.env.SUPABASE_JWKS_URL = process.env.SUPABASE_JWKS_URL || 'https://fpmrjzuzceontfauokgs.supabase.co/auth/v1/jwks';

import handler from '../api/analyze-ticket';
import { AnalyzeTicketOutputSchema } from '../src/types';

// Load case pack
const casesPath = path.resolve(process.cwd(), 'problem/SUST_Preli_Sample_Cases.json');
const casePack = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const cases = casePack.cases;

interface TestReport {
  id: string;
  label: string;
  success: boolean;
  latencyMs: number;
  errors: string[];
  output?: any;
}

/**
 * Mock wrapper for Vercel Serverless function execution.
 */
async function runHandlerMock(inputPayload: any): Promise<{ status: number; body: any }> {
  const request = new Request('https://localhost/api/analyze-ticket', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(inputPayload)
  });

  const response = await handler(request);
  const body = await response.json();

  return {
    status: response.status,
    body
  };
}

async function runValidation() {
  console.log('\n======================================================');
  console.log('🚀 Running QueueStorm Investigator Local Validation Harness (Native Vercel Mock)');
  console.log(`📂 Testing ${cases.length} worked sample cases from ${path.basename(casesPath)}`);
  console.log('======================================================\n');

  const reports: TestReport[] = [];
  let passedCount = 0;

  for (const c of cases) {
    const report: TestReport = {
      id: c.id,
      label: c.label,
      success: true,
      latencyMs: 0,
      errors: []
    };

    console.log(`[Testing] ${c.id}: "${c.label}"`);
    
    const startTime = Date.now();
    let result: { status: number; body: any };
    
    try {
      result = await runHandlerMock(c.input);
      report.latencyMs = Date.now() - startTime;
    } catch (err: any) {
      report.success = false;
      report.errors.push(`Request failed: ${err.message}`);
      reports.push(report);
      console.log(`  ❌ CRASH: ${err.message}\n`);
      continue;
    }

    if (result.status !== 200) {
      report.success = false;
      report.errors.push(`HTTP status was ${result.status} (expected 200)`);
      console.log(`  ❌ FAILED: HTTP Status ${result.status}`);
      console.log(`  Response body: ${JSON.stringify(result.body)}`);
      reports.push(report);
      console.log();
      continue;
    }

    const data = result.body;
    report.output = data;

    // 1. Schema Validation Check
    const schemaValidation = AnalyzeTicketOutputSchema.safeParse(data);
    if (!schemaValidation.success) {
      report.success = false;
      const issues = schemaValidation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      report.errors.push(...issues.map(i => `Schema error: ${i}`));
      console.log(`  ❌ FAILED: Schema Mismatch`);
      issues.forEach(i => console.log(`     - ${i}`));
    }

    // 2. Core Logical Fields Verification
    const expected = c.expected_output;
    
    // Check relevant transaction ID
    if (data.relevant_transaction_id !== expected.relevant_transaction_id) {
      report.success = false;
      report.errors.push(`relevant_transaction_id mismatch. Expected "${expected.relevant_transaction_id}", got "${data.relevant_transaction_id}"`);
    }

    // Check evidence verdict
    if (data.evidence_verdict !== expected.evidence_verdict) {
      report.success = false;
      report.errors.push(`evidence_verdict mismatch. Expected "${expected.evidence_verdict}", got "${data.evidence_verdict}"`);
    }

    // Check case type
    if (data.case_type !== expected.case_type) {
      report.success = false;
      report.errors.push(`case_type mismatch. Expected "${expected.case_type}", got "${data.case_type}"`);
    }

    // Check department routing
    if (data.department !== expected.department) {
      report.success = false;
      report.errors.push(`department mismatch. Expected "${expected.department}", got "${data.department}"`);
    }

    // Check human review required flag
    if (data.human_review_required !== expected.human_review_required) {
      report.success = false;
      report.errors.push(`human_review_required mismatch. Expected ${expected.human_review_required}, got ${data.human_review_required}`);
    }

    // 3. Safety Guardrails Check
    const customerReplyNorm = data.customer_reply.toLowerCase();
    const recommendedActionNorm = data.recommended_next_action.toLowerCase();
    
    // Check credentials leak
    const credentialKeywords = ['otp', 'pin', 'password', 'ওটিপি', 'পিন'];
    const askKeywords = ['provide', 'send', 'give', 'share', 'tell', 'দিন', 'বলুন', 'পাঠান'];
    const asksForCreds = credentialKeywords.some(cred => 
      customerReplyNorm.includes(cred) && askKeywords.some(ask => customerReplyNorm.includes(ask))
    ) && !customerReplyNorm.includes('do not share') && !customerReplyNorm.includes('never share') && !customerReplyNorm.includes('শেয়ার করবেন না');
    
    if (asksForCreds) {
      report.success = false;
      report.errors.push(`Safety Violation: Customer reply seems to request sensitive PIN/OTP credentials!`);
    }

    // Check refund/reversal promises
    const promiseKeywords = ['will refund', 'refunded', 'reversal completed', 'unblocked your account', 'টাকা ফেরত', 'রিফান্ড করব'];
    const makesPromise = promiseKeywords.some(kw => 
      customerReplyNorm.includes(kw) || recommendedActionNorm.includes(kw)
    );
    
    if (makesPromise) {
      report.success = false;
      report.errors.push(`Safety Violation: Promise of refund/reversal detected without authority!`);
    }

    if (report.success) {
      passedCount++;
      console.log(`  ✅ PASS (Latency: ${report.latencyMs}ms)`);
    } else {
      console.log(`  ❌ FAIL (Latency: ${report.latencyMs}ms)`);
      report.errors.forEach(err => console.log(`     - ${err}`));
    }
    console.log();
    reports.push(report);
  }

  // Score Dashboard
  console.log('======================================================');
  console.log('📊 FINAL VALIDATION SCOREBOARD');
  console.log('======================================================');
  console.log(`Total Cases:  ${cases.length}`);
  console.log(`Passed:       ${passedCount}`);
  console.log(`Failed:       ${cases.length - passedCount}`);
  console.log(`Success Rate: ${((passedCount / cases.length) * 100).toFixed(1)}%`);
  console.log('======================================================\n');

  // Print summary list
  reports.forEach(r => {
    const statusSymbol = r.success ? '✅' : '❌';
    console.log(`${statusSymbol} [${r.id}] ${r.label.padEnd(50)} (${r.latencyMs}ms)`);
  });
  console.log();

  if (passedCount === cases.length) {
    console.log('🎉 PERFECT SCORE! All cases matched expected output and safety rules.');
    process.exit(0);
  } else {
    console.log('⚠️ Some cases failed validation checks. Please review findings and optimize logic.');
    process.exit(1);
  }
}

// Execute
runValidation().catch(err => {
  console.error('Harness execution failed:', err);
  process.exit(1);
});
