/**
 * Converts Bengali digits to English digits in a string.
 */
export function convertBanglaDigits(text: string): string {
  const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  let normalized = text;
  for (let i = 0; i < 10; i++) {
    const regex = new RegExp(banglaDigits[i], 'g');
    normalized = normalized.replace(regex, i.toString());
  }
  return normalized;
}

/**
 * Extracts all numbers from a string (including float-like values).
 */
export function extractNumbers(text: string): number[] {
  const normalized = convertBanglaDigits(text);
  // Match contiguous digits optionally containing commas or decimals
  // E.g., 5,000 or 500.50
  const regex = /\b\d+(?:,\d+)*(?:\.\d+)?\b/g;
  const matches = normalized.match(regex);
  if (!matches) return [];

  return matches.map(match => {
    // Remove commas for clean parsing
    const clean = match.replace(/,/g, '');
    return parseFloat(clean);
  });
}

/**
 * Checks if a specific target amount (number) is mentioned in the text.
 * Standardizes to prevent false positives for partial digits.
 */
export function hasAmount(text: string, amount: number): boolean {
  const numbers = extractNumbers(text);
  return numbers.includes(amount);
}
