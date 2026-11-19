const ZERO_WIDTH_AND_BIDI = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

const UI_PHRASES: RegExp[] = [
  /\bselect\s+exams?\b\s*:?/gi,
  /\bi\s+agree\s+to\s+est\s+terms?\s+and\s+conditions?\b/gi,
  /\bproceed\s+to\s+payment\b/gi,
  /\bterms?\s+and\s+conditions?\b/gi,
  /(?:اختر|اختار)\s*الامتحانات?/g,
  /أوافق\s*على\s*شروط\s*(?:و\s*)?(?:أحكام|احكام)?/g,
  /(?:متابعة|الانتقال)\s*(?:إلى|الى|ل)?\s*الدفع/g,
  /(?:الشروط|شروط)\s*(?:و\s*)?(?:الأحكام|الاحكام)/g,
];

const EMPTY_FIELD_LABEL =
  /\b(?:apartment|floor|landmark)\b\s*:\s*(?=(?:[,،•;:\-\s])*(?:$|\b(?:apartment|floor|landmark)\b\s*:))/gi;

const EDGE_SEPARATORS = /^[\s,،•;:\-–—]+|[\s,،•;:\-–—]+$/g;

export function sanitizeText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  let text = String(value).replace(ZERO_WIDTH_AND_BIDI, " ");

  for (let pass = 0; pass < 2; pass++) {
    for (const pattern of UI_PHRASES) {
      text = text.replace(pattern, " ");
    }
    text = text.replace(EMPTY_FIELD_LABEL, " ");
  }

  return text
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(EDGE_SEPARATORS, "")
    .trim();
}

export function sanitizeOptionalText(
  value: string | number | null | undefined,
): string | undefined {
  const cleaned = sanitizeText(value);
  return cleaned ? cleaned : undefined;
}

export const SANITIZABLE_STUDENT_FIELDS = [
  "studentName",
  "studentNameAr",
  "recipient",
  "governorate",
  "city",
  "area",
  "street",
  "apartment",
  "floor",
  "landmark",
  "schoolName",
  "reportsList",
  "batchName",
  "notes",
] as const;
