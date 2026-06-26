import { 
  AnalyzeTicketInput, 
  AnalyzeTicketOutput, 
  Transaction, 
  CaseType, 
  Department, 
  Severity, 
  EvidenceVerdict 
} from '../types';
import { extractNumbers } from '../utils/parser';

interface MatchingResult {
  relevantTransaction: Transaction | null;
  evidenceVerdict: EvidenceVerdict;
  matchedCandidates: Transaction[];
  reasonCodes: string[];
}

/**
 * Perform deterministic rules-based matching of complaint against transaction history.
 */
export function matchTransaction(input: AnalyzeTicketInput): MatchingResult {
  const history = input.transaction_history || [];
  const complaint = input.complaint.toLowerCase();
  
  // Extract potential transaction amounts from complaint text
  const extractedAmounts = extractNumbers(input.complaint);
  
  const matchedCandidates = history.filter(tx => {
    // Check if the transaction amount is mentioned in the complaint
    const amountMatches = extractedAmounts.includes(tx.amount);
    
    // If the text contains decimals or specific numbers, check direct matches
    return amountMatches;
  });

  const reasonCodes: string[] = [];

  // Case 1: No history or no matching candidates
  if (history.length === 0 || matchedCandidates.length === 0) {
    reasonCodes.push('no_transaction_match');
    
    // Phishing or general queries don't need transactions
    const isPhishing = complaint.includes('otp') || complaint.includes('pin') || complaint.includes('password') || complaint.includes('ওটিপি') || complaint.includes('পিন');
    
    return {
      relevantTransaction: null,
      evidenceVerdict: isPhishing ? 'insufficient_data' : 'insufficient_data',
      matchedCandidates: [],
      reasonCodes
    };
  }

  // Case 2: Exactly one matching candidate
  if (matchedCandidates.length === 1) {
    const candidate = matchedCandidates[0];
    reasonCodes.push('transaction_match_found');

    // Check for inconsistent claims (e.g., wrong transfer claim, but history shows multiple previous transfers to this recipient)
    if (candidate.type === 'transfer' && complaint.includes('wrong') || complaint.includes('ভুল')) {
      const priorTransfersToSameRecipient = history.filter(tx => 
        tx.transaction_id !== candidate.transaction_id && 
        tx.type === 'transfer' && 
        tx.counterparty === candidate.counterparty &&
        tx.status === 'completed'
      );
      
      if (priorTransfersToSameRecipient.length >= 2) {
        reasonCodes.push('established_recipient_pattern');
        return {
          relevantTransaction: candidate,
          evidenceVerdict: 'inconsistent',
          matchedCandidates,
          reasonCodes
        };
      }
    }

    return {
      relevantTransaction: candidate,
      evidenceVerdict: 'consistent',
      matchedCandidates,
      reasonCodes
    };
  }

  // Case 3: Multiple matching candidates (Ambiguous matching or Duplicate payment)
  // Check for duplicate payment (identical amount and same counterparty in a short time frame)
  const isDuplicateClaim = complaint.includes('twice') || complaint.includes('double') || complaint.includes('duplicate') || complaint.includes('দুইবার') || complaint.includes('২ বার');
  
  if (isDuplicateClaim) {
    // Sort matched candidates by timestamp descending
    const sorted = [...matchedCandidates].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Find two transactions of the same amount and same counterparty
    for (let i = 0; i < sorted.length - 1; i++) {
      const tx1 = sorted[i];
      const tx2 = sorted[i + 1];
      if (tx1.amount === tx2.amount && tx1.counterparty === tx2.counterparty && tx1.type === tx2.type) {
        reasonCodes.push('duplicate_payment_detected');
        // The relevant transaction is the suspected duplicate (the later one, i.e. tx1 since sorted descending)
        return {
          relevantTransaction: tx1,
          evidenceVerdict: 'consistent',
          matchedCandidates: [tx1, tx2],
          reasonCodes
        };
      }
    }
  }

  // If there are multiple matches but it's ambiguous which one it refers to
  reasonCodes.push('ambiguous_transaction_matches');
  return {
    relevantTransaction: null,
    evidenceVerdict: 'insufficient_data',
    matchedCandidates,
    reasonCodes
  };
}

/**
 * Detect language of the complaint (simple regex wrapper).
 */
export function detectLanguage(text: string): 'en' | 'bn' {
  // Regex pattern for Bengali script characters
  const bnPattern = /[\u0980-\u09FF]/;
  return bnPattern.test(text) ? 'bn' : 'en';
}

/**
 * Fallback rules-based ticket analyzer used when the Gemini LLM is offline or fails.
 */
export function runRulesFallback(input: AnalyzeTicketInput): AnalyzeTicketOutput {
  const complaint = input.complaint.toLowerCase();
  const lang = input.language || detectLanguage(input.complaint);
  
  // 1. Match transaction
  const match = matchTransaction(input);
  
  // 2. Classify Case Type (ordered from most specific to most general)
  let caseType: CaseType = 'other';
  
  if (complaint.includes('otp') || complaint.includes('pin') || complaint.includes('password') || complaint.includes('ওটিপি') || complaint.includes('পিন')) {
    caseType = 'phishing_or_social_engineering';
  } else if (complaint.includes('twice') || complaint.includes('double') || complaint.includes('duplicate') || complaint.includes('two times') || complaint.includes('দুইবার') || complaint.includes('২ বার') || complaint.includes('২বার')) {
    caseType = 'duplicate_payment';
  } else if (complaint.includes('settle') || complaint.includes('merchant sales') || complaint.includes('সেটেল')) {
    caseType = 'merchant_settlement_delay';
  } else if (complaint.includes('agent') || complaint.includes('cash in') || complaint.includes('cash-in') || complaint.includes('এজেন্ট') || complaint.includes('ক্যাশ ইন') || complaint.includes('ক্যাশইন')) {
    caseType = 'agent_cash_in_issue';
  } else if (
    complaint.includes('wrong number') || complaint.includes('wrong recipient') || complaint.includes('wrong person') || 
    complaint.includes('wrong account') || complaint.includes('typed it wrong') || complaint.includes('typed wrong') ||
    complaint.includes('ভুল নম্বরে') || complaint.includes('ভুল নাম্বারে') || complaint.includes('ভুল ব্যক্তি') || complaint.includes('ভুল একাউন্টে') ||
    (complaint.includes('sent') && (complaint.includes('brother') || complaint.includes('sister') || complaint.includes('friend')) && (complaint.includes('not receive') || complaint.includes("didn't get") || complaint.includes("didn't receive")))
  ) {
    caseType = 'wrong_transfer';
  } else if (complaint.includes('failed') || complaint.includes('deduct') || complaint.includes('সফল হয়নি') || complaint.includes('অসফল') || complaint.includes('কেটে')) {
    caseType = 'payment_failed';
  } else if (complaint.includes('refund') || complaint.includes('ফেরত')) {
    caseType = 'refund_request';
  }

  // 3. Determine Department & Severity
  let department: Department = 'customer_support';
  let severity: Severity = 'low';
  let humanReviewRequired = false;

  switch (caseType) {
    case 'phishing_or_social_engineering':
      department = 'fraud_risk';
      severity = 'critical';
      humanReviewRequired = true;
      break;
    case 'wrong_transfer':
      department = 'dispute_resolution';
      severity = 'high';
      humanReviewRequired = true;
      break;
    case 'payment_failed':
      department = 'payments_ops';
      severity = 'high';
      humanReviewRequired = false;
      break;
    case 'duplicate_payment':
      department = 'payments_ops';
      severity = 'high';
      humanReviewRequired = true;
      break;
    case 'merchant_settlement_delay':
      department = 'merchant_operations';
      severity = 'medium';
      humanReviewRequired = false;
      break;
    case 'agent_cash_in_issue':
      department = 'agent_operations';
      severity = 'high';
      humanReviewRequired = true;
      break;
    case 'refund_request':
      department = 'customer_support';
      severity = 'low';
      humanReviewRequired = false;
      break;
    default:
      department = 'customer_support';
      severity = 'low';
      humanReviewRequired = false;
  }

  // If evidence is insufficient_data, we do not escalate to human review yet (except for phishing)
  if (match.evidenceVerdict === 'insufficient_data' && caseType !== 'phishing_or_social_engineering') {
    humanReviewRequired = false;
  }

  // If evidence is inconsistent, we always escalate
  if (match.evidenceVerdict === 'inconsistent') {
    humanReviewRequired = true;
  }

  // 4. Generate Summaries and Replies
  let agentSummary = '';
  let recommendedNextAction = '';
  let customerReply = '';

  const txId = match.relevantTransaction?.transaction_id || '';
  const amountStr = match.relevantTransaction?.amount ? `${match.relevantTransaction.amount} BDT` : 'the transaction amount';

  if (lang === 'bn') {
    // Bengali Responses
    if (caseType === 'phishing_or_social_engineering') {
      agentSummary = 'গ্রাহক ওটিপি বা পিন সংক্রান্ত সন্দেহজনক প্রতারণার কল বা এসএমএস রিপোর্ট করেছেন।';
      recommendedNextAction = 'তাত্ক্ষণিকভাবে ফ্রড রিস্ক দলের কাছে পাঠান। রিপোর্ট করা নম্বরটি ব্লক এবং ট্র্যাক করুন।';
      customerReply = 'আপনার নিরাপত্তা আমাদের অগ্রাধিকার। আমরা কখনোই আপনার ওটিপি (OTP), পিন (PIN) বা পাসওয়ার্ড জানতে চাই না। অনুগ্রহ করে এগুলো কারো সাথে শেয়ার করবেন না। আমাদের প্রতারণা প্রতিরোধ দল বিষয়টি খতিয়ে দেখছে।';
    } else if (caseType === 'wrong_transfer') {
      agentSummary = `গ্রাহক ভুল নম্বরে টাকা পাঠানোর অভিযোগ করেছেন। লেনদেন আইডি: ${txId || 'পাওয়া যায়নি'}।`;
      recommendedNextAction = `গ্রাহকের সাথে লেনদেনের বিবরণ যাচাই করুন এবং নীতি অনুযায়ী ভুল টাকা স্থানান্তরের ডিসপুট প্রক্রিয়া শুরু করুন।`;
      customerReply = `আপনার লেনদেন ${txId ? `ID: ${txId}` : ''} এর বিষয়ে আমরা অবগত হয়েছি। আমাদের ডিসপুট দল বিষয়টি যাচাই করছে। অফিসিয়াল চ্যানেলে আপনার সাথে যোগাযোগ করা হবে। অনুগ্রহ করে কারো সাথে পিন বা ওটিপি শেয়ার করবেন না।`;
    } else if (caseType === 'payment_failed') {
      agentSummary = `পেমেন্ট ব্যর্থ হলেও ব্যালেন্স কাটা হয়েছে বলে গ্রাহক অভিযোগ করেছেন। লেনদেন আইডি: ${txId}।`;
      recommendedNextAction = `লেনদেন আইডি ${txId} এর লেজার চেক করুন এবং ব্যালেন্স কেটে নেওয়া হলে ৩ কার্যদিবসের মধ্যে রিভার্সাল প্রক্রিয়া সম্পন্ন করুন।`;
      customerReply = `পেমেন্ট অসফল হওয়ার পরও ব্যালেন্স কাটার বিষয়টি আমরা দেখছি। আপনার লেনদেন ${txId} এর বিষয়ে আমাদের টিম কাজ করছে। যোগ্য অর্থ অফিসিয়াল চ্যানেলে ফেরত দেওয়া হবে। অনুগ্রহ করে পিন বা ওটিপি শেয়ার করবেন না।`;
    } else {
      agentSummary = 'গ্রাহক সাধারণ জিজ্ঞাসা বা লেনদেন সংক্রান্ত সাহায্য চেয়ে টিকিট ওপেন করেছেন।';
      recommendedNextAction = 'গ্রাহকের সমস্যাটি যাচাই করে কাস্টমার সাপোর্ট দল থেকে সাহায্য প্রদান করুন।';
      customerReply = 'আপনার অনুসন্ধানের জন্য ধন্যবাদ। আমাদের কাস্টমার সাপোর্ট দল আপনার সমস্যাটি দ্রুত সমাধানের চেষ্টা করছে। অনুগ্রহ করে কারো সাথে পিন (PIN) বা ওটিপি (OTP) শেয়ার করবেন না।';
    }
  } else {
    // English Responses
    if (caseType === 'phishing_or_social_engineering') {
      agentSummary = 'Customer reports a suspicious call or message requesting their OTP or PIN details.';
      recommendedNextAction = 'Escalate to fraud_risk team immediately. Verify customer account status and log the attacker number.';
      customerReply = 'Thank you for reaching out. We will never ask for your PIN, OTP, or password under any circumstances. Please do not share these details with anyone. Our fraud prevention team is investigating this incident.';
    } else if (caseType === 'wrong_transfer') {
      agentSummary = `Customer reports sending BDT to a wrong number. Matched Transaction ID: ${txId || 'None'}.`;
      recommendedNextAction = 'Verify recipient details with the customer and initiate the wrong-transfer dispute resolution flow.';
      customerReply = `We have noted your concern regarding transaction ${txId ? `ID: ${txId}` : ''}. Our dispute resolution team will review the case and update you through official channels. Please do not share your PIN or OTP with anyone.`;
    } else if (caseType === 'payment_failed') {
      agentSummary = `Payment failed but balance was deducted from customer account. Transaction ID: ${txId}.`;
      recommendedNextAction = `Verify ledger status for TXN ${txId}. If balance was deducted, initiate automatic reversal flow within SLA.`;
      customerReply = `We have noted that transaction ${txId} may have caused an unexpected balance deduction. Our payments team will review the ledger and any eligible amount will be returned through official channels. Please do not share your PIN or OTP with anyone.`;
    } else if (caseType === 'refund_request') {
      agentSummary = `Customer requests refund of ${amountStr} for payment ${txId} due to change of mind.`;
      recommendedNextAction = 'Inform the customer that refund eligibility depends on the merchant\'s refund policy. Provide instructions on merchant contact.';
      customerReply = `Refunds for completed merchant payments depend on the merchant's own policy. We recommend contacting the merchant directly. If you need help reaching them, please let us know. Please do not share your PIN or OTP with anyone.`;
    } else {
      agentSummary = 'General customer ticket submitted. Insufficient data to identify specific transaction error.';
      recommendedNextAction = 'Review ticket details and contact customer for clarification if necessary.';
      customerReply = 'Thank you for contacting us. Our customer support team will review your query and get back to you shortly. Please do not share your PIN or OTP with anyone.';
    }
  }

  return {
    ticket_id: input.ticket_id,
    relevant_transaction_id: match.relevantTransaction?.transaction_id || null,
    evidence_verdict: match.evidenceVerdict,
    case_type: caseType,
    severity,
    department,
    agent_summary: agentSummary,
    recommended_next_action: recommendedNextAction,
    customer_reply: customerReply,
    human_review_required: humanReviewRequired,
    confidence: 0.8,
    reason_codes: match.reasonCodes
  };
}
