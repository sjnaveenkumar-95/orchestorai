const PROJECT_ISSUE_PREFIX_FALLBACK = "PRJ";
const PROJECT_PREFIX_STOPWORDS = new Set(["APP", "PLATFORM", "PROJECT", "SERVICE", "SYSTEM", "TOOL"]);

function tokenizeProjectName(name: string): string[] {
  return name
    .toUpperCase()
    .split(/[^A-Z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildPrefixFromTokens(tokens: string[]): string {
  if (tokens.length === 0) return PROJECT_ISSUE_PREFIX_FALLBACK;
  if (tokens.length === 1) {
    const single = tokens[0]!;
    if (single.length >= 3) return single.slice(0, 3);
    return (single + single[0]!.repeat(3)).slice(0, 3);
  }

  let prefix = "";
  for (let index = 0; index < tokens.length && prefix.length < 3; index += 1) {
    const token = tokens[index]!;
    if (index === 0 && token.length <= 2) {
      prefix += token.slice(0, Math.min(2, 3 - prefix.length));
      continue;
    }
    prefix += token[0]!;
  }

  if (prefix.length >= 3) return prefix.slice(0, 3);

  for (const token of tokens) {
    const startIndex = prefix.startsWith(token) ? token.length : 1;
    for (let charIndex = startIndex; charIndex < token.length && prefix.length < 3; charIndex += 1) {
      prefix += token[charIndex]!;
    }
    if (prefix.length >= 3) break;
  }

  if (prefix.length >= 3) return prefix.slice(0, 3);
  return (prefix + PROJECT_ISSUE_PREFIX_FALLBACK).slice(0, 3);
}

export function deriveProjectIssuePrefixBase(name: string): string {
  const rawTokens = tokenizeProjectName(name);
  const significantTokens = rawTokens.filter((token) => !PROJECT_PREFIX_STOPWORDS.has(token));
  const tokens = significantTokens.length > 0 ? significantTokens : rawTokens;
  return buildPrefixFromTokens(tokens);
}
