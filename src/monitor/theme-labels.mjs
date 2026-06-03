export function canonicalizeThemeLabel(value) {
  const normalized = normalizeThemeCandidate(value);
  if (!normalized) return "";

  if (/people skills?/iu.test(normalized) || /social skills?/iu.test(normalized)) {
    return "people skills";
  }
  if (
    /street[-\s]?smart/iu.test(normalized) &&
    /(children|child|kids|kid|parenting|familyeducation|family education|raise)/iu.test(normalized)
  ) {
    return "raise children street smart";
  }
  return "";
}

export function inferThemeFromCaption(caption) {
  const text = String(caption ?? "").trim();
  if (!text) return "";

  const quotedMatch = text.match(/[“"]([^"”]{3,48})[”"]/u);
  const quoted = canonicalizeThemeLabel(quotedMatch?.[1] ?? "");
  if (quoted) return quoted;

  return canonicalizeThemeLabel(
    text
      .replace(/[#\n\r\t]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

export function normalizeThemeCandidate(value) {
  return String(value ?? "")
    .replace(/[【】\[\]()（）|｜]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}
