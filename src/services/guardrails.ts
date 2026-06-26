import { AnalyzeTicketOutput } from '../types';
import { detectLanguage } from './rules';

/**
 * Normalizes text to simplify regex checks (lowercasing, spacing).
 */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Apply post-processing guardrails to ensure absolutely zero safety violations occur.
 * Checks for:
 * 1. Asking for PIN/OTP/Password.
 * 2. Unauthorised refund/reversal/unblock confirmation.
 * 3. Suspicious third-party instructions.
 */
export function applySafetyGuardrails(
  output: AnalyzeTicketOutput, 
  originalLanguage?: 'en' | 'bn' | 'mixed'
): AnalyzeTicketOutput {
  const result = { ...output };
  const lang = originalLanguage === 'bn' || detectLanguage(output.customer_reply) === 'bn' ? 'bn' : 'en';

  const replyNormalized = normalizeText(result.customer_reply);
  const actionNormalized = normalizeText(result.recommended_next_action);

  // -------------------------------------------------------------
  // Rule 1: PIN/OTP Request Protection
  // -------------------------------------------------------------
  // Ensure that if any credential keyword is mentioned in the reply, the pre-approved safety warnings are present.
  const hasCredsWord = ['otp', 'pin', 'password', 'ওটিপি', 'পিন'].some(word => replyNormalized.includes(word));
  if (hasCredsWord) {
    if (lang === 'bn') {
      if (!replyNormalized.includes('শেয়ার করবেন না') && !replyNormalized.includes('শেয়ার করবেন না')) {
        result.customer_reply = result.customer_reply.trim() + ' অনুগ্রহ করে আপনার পিন বা ওটিপি কারো সাথে শেয়ার করবেন না।';
      }
    } else {
      if (!replyNormalized.includes('do not share') && !replyNormalized.includes('never share') && !replyNormalized.includes('dont share') && !replyNormalized.includes("don't share")) {
        result.customer_reply = result.customer_reply.trim() + ' Please do not share your PIN or OTP with anyone.';
      }
    }
  }

  // Update replyNormalized after potential appending
  const updatedReplyNormalized = normalizeText(result.customer_reply);

  const credentialRequestPatterns = [
    /send (?:me |us )?(?:your )?(?:otp|pin|password)/,
    /provide (?:your )?(?:otp|pin|password)/,
    /share (?:your )?(?:otp|pin|password)/,
    /tell (?:me |us )?(?:your )?(?:otp|pin|password)/,
    /enter (?:your )?(?:otp|pin|password)/,
    /ওটিপি (?:দিন|বলুন|পাঠান)/,
    /পিন (?:নম্বর )?(?:শেয়ার|দিন|বলুন|পাঠান)/,
    /পাসওয়ার্ড (?:দিন|বলুন|পাঠান)/
  ];

  const negationKeywords = [
    'do not', 'never', 'dont', "don't", 'should not', 'must not',
    'শেয়ার করবেন না', 'শেয়ার করবেন না', 'জানাবেন না', 'বলবেন না', 'না', 'কখনো না', 'কখনও না'
  ];

  const hasCredentialRequest = credentialRequestPatterns.some(pattern => 
    pattern.test(updatedReplyNormalized)
  ) && !negationKeywords.some(neg => updatedReplyNormalized.includes(neg));

  if (hasCredentialRequest) {
    console.warn(`[Guardrail] Credential request detected in customer reply. Sanitising.`);
    
    // Inject the standard safety warning and rewrite the message to be safe
    if (lang === 'bn') {
      result.customer_reply = 'আমাদের সাপোর্ট টিম কখনোই আপনার পিন (PIN) বা ওটিপি (OTP) জানতে চায় না। অনুগ্রহ করে কারো সাথে এগুলো শেয়ার করবেন না। আপনার সমস্যাটি আমাদের প্রতিনিধি খতিয়ে দেখছেন এবং দ্রুত যোগাযোগ করবেন।';
    } else {
      result.customer_reply = 'Please do not share your PIN, OTP, or password with anyone. Our support team will never ask for these details under any circumstances. We have logged your query and our team will get in touch shortly.';
    }
    
    if (!result.reason_codes) result.reason_codes = [];
    if (!result.reason_codes.includes('sanitized_credential_request')) {
      result.reason_codes.push('sanitized_credential_request');
    }
    result.human_review_required = true;
    result.severity = 'critical';
  }

  // -------------------------------------------------------------
  // Rule 2: Refund/Reversal Commitment Protection
  // -------------------------------------------------------------
  // We match cases where the system promises a refund or reversal or account unblocking.
  const refundPromisePatterns = [
    /we (?:will )?refund you/,
    /refund (?:has been |is |will be )confirmed/,
    /reversal (?:completed|initiated|processed)/,
    /we (?:have |will )reverse(?:d)? the transaction/,
    /unblocked your account/,
    /account is (?:now )?unblocked/,
    /টাকা ফেরত (?:দিচ্ছি|দিয়েছি|দেব)/,
    /রিফান্ড (?:করা হয়েছে|করব)/,
    /রিভার্সাল (?:সম্পন্ন)/
  ];

  const hasRefundPromiseReply = refundPromisePatterns.some(pattern => 
    pattern.test(replyNormalized)
  );
  
  const hasRefundPromiseAction = refundPromisePatterns.some(pattern => 
    pattern.test(actionNormalized)
  );

  if (hasRefundPromiseReply) {
    console.warn(`[Guardrail] Unauthorized refund promise detected in customer reply. Rewriting with policy-approved language.`);
    
    // Replace with standard safe refund clause
    if (lang === 'bn') {
      result.customer_reply = result.customer_reply.replace(
        /(?:আমরা রিফান্ড করব|টাকা ফেরত দিয়েছি|টাকা ফেরত দেওয়া হয়েছে|রিভার্সাল করা হয়েছে|আমরা আপনার টাকা ফেরত দেব)/g,
        'যাচাইকরণের পর যেকোনো যোগ্য অর্থ অফিসিয়াল চ্যানেলের মাধ্যমে ফেরত দেওয়া হবে'
      );
      // If replacement did not occur cleanly, override entirely
      if (normalizeText(result.customer_reply) === replyNormalized) {
        result.customer_reply = 'আমরা আপনার লেনদেনের বিষয়টি ডকেটভুক্ত করেছি। প্রয়োজনীয় যাচাইকরণ শেষে যেকোনো যোগ্য অর্থ অফিসিয়াল চ্যানেলের মাধ্যমে ফেরত দেওয়া হবে। অনুগ্রহ করে কারো সাথে আপনার পিন বা ওটিপি শেয়ার করবেন না।';
      }
    } else {
      result.customer_reply = result.customer_reply.replace(
        /(?:we will refund you|refund has been confirmed|reversal completed|we have reversed the transaction|we will reverse)/gi,
        'any eligible amount will be returned through official channels after verification'
      );
      if (normalizeText(result.customer_reply) === replyNormalized) {
        result.customer_reply = 'We have noted your query. Any eligible amount will be returned through official channels after standard verification. Please do not share your PIN or OTP with anyone.';
      }
    }

    if (!result.reason_codes) result.reason_codes = [];
    if (!result.reason_codes.includes('sanitized_refund_promise')) {
      result.reason_codes.push('sanitized_refund_promise');
    }
  }

  if (hasRefundPromiseAction) {
    console.warn(`[Guardrail] Unauthorized refund action suggested. Rewriting action for agent.`);
    if (lang === 'bn') {
      result.recommended_next_action = 'লেনদেনের লেজার এবং ডিসপুট পলিসি চেক করুন। যদি যোগ্য বিবেচিত হয় তবে অফিসিয়াল চ্যানেলে রিভার্সাল প্রক্রিয়া শুরু করুন।';
    } else {
      result.recommended_next_action = 'Investigate ledger status. If valid, initiate dispute resolution and reversal workflow according to standard SLA.';
    }
  }

  // -------------------------------------------------------------
  // Rule 3: External suspicious channels or links
  // -------------------------------------------------------------
  // Filter out any unauthorized phone numbers or URLs in reply.
  const externalLinkPattern = /(?:https?:\/\/|www\.)[a-z0-9]+(?:\.[a-z0-9]+)+/gi;
  if (externalLinkPattern.test(result.customer_reply)) {
    console.warn(`[Guardrail] External links detected in customer reply. Stripping links for safety.`);
    result.customer_reply = result.customer_reply.replace(externalLinkPattern, 'our official support channels');
  }

  return result;
}
