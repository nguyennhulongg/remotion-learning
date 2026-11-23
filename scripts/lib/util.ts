import fs from "node:fs/promises";
import { createHash } from "node:crypto";

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTerms(
  query: string,
  ignored: ReadonlySet<string>,
  minLength: number,
): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= minLength && !ignored.has(word));
}

/** Matches score 1, or 2 when the term is at least `longTermLength` characters. */
export function scoreTerms(text: string, terms: string[], longTermLength: number): number {
  const haystack = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return terms.reduce(
    (score, term) =>
      score + (haystack.includes(term) ? (term.length >= longTermLength ? 2 : 1) : 0),
    0,
  );
}
