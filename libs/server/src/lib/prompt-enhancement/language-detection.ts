/**
 * Language detection adapter (design.md §4.3-bis).
 *
 * v1 ships a heuristic adapter — sub-millisecond budget, zero deps. The
 * `franc` library is mentioned in the design as the intended production
 * implementation; we wrap behind an interface so it can be swapped in
 * later without touching call sites or tests.
 *
 * The heuristic is intentionally conservative: when uncertain (text too
 * short, or no non-ASCII signal) we return `"en"` so the auto-translate
 * phase becomes a no-op. False negatives (treating Spanish as English)
 * skip translation but still let generation proceed; false positives
 * (treating English as Spanish) would burn a sampling round-trip — the
 * worse failure mode — so we lean toward `"en"`.
 */

/** Result is an ISO-639-1 code or `"und"` for "undetermined". */
export type LanguageCode = string;

export interface LanguageDetectionAdapter {
  /** Detects the language of `text`. Sub-millisecond, no I/O. */
  detect(text: string): LanguageCode;
}

/**
 * Heuristic adapter:
 * - Strings under 8 graphemes → `"en"` (too short to disambiguate).
 * - Strings containing only ASCII letters/punctuation → assumed `"en"`.
 * - CJK-range characters → returns `"ja"` (Japanese), `"zh"` (Chinese
 *   only), or `"ko"` (Hangul). When mixed CJK, hiragana/katakana wins
 *   over Hanzi → `"ja"`. Pure Hanzi → `"zh"`. Hangul-dominant → `"ko"`.
 * - Cyrillic → `"ru"`.
 * - Arabic → `"ar"`.
 * - Latin script with Spanish-specific characters (ñ, ¿, ¡, accented
 *   vowels in common patterns) → `"es"`.
 * - Latin script with French-specific markers (ç, œ, common accent
 *   patterns) → `"fr"`.
 * - Latin script with German-specific markers (ß, ÄÖÜäöü) → `"de"`.
 * - Latin script with Portuguese-specific markers (ã, õ + ç) → `"pt"`.
 * - Latin script with diacritics that don't match any of the above →
 *   `"es"` as a safe default (covers Italian, Catalan, etc.; the
 *   downstream agent translates fine regardless).
 *
 * The downstream system prompt instructs the agent to translate from
 * any language; ambiguity here only affects whether the auto-translate
 * phase fires, not its correctness.
 */
export class HeuristicLanguageAdapter implements LanguageDetectionAdapter {
  detect(text: string): LanguageCode {
    const t = text.trim();
    if (t.length < 8) return 'en';

    // Script families.
    const hasHiragana = /[぀-ゟ]/.test(t);
    const hasKatakana = /[゠-ヿ]/.test(t);
    const hasHangul = /[가-힯]/.test(t);
    const hasHanzi = /[一-鿿]/.test(t);
    const hasCyrillic = /[Ѐ-ӿ]/.test(t);
    const hasArabic = /[؀-ۿ]/.test(t);

    if (hasHangul) return 'ko';
    if (hasHiragana || hasKatakana) return 'ja';
    if (hasHanzi) return 'zh';
    if (hasCyrillic) return 'ru';
    if (hasArabic) return 'ar';

    // Latin-script disambiguation.
    if (/[ñ¿¡]/.test(t)) return 'es';
    if (/[ß]/.test(t) || /[ÄÖÜäöü]/.test(t)) return 'de';
    if (/[ãõ]/.test(t) && /[ç]/.test(t)) return 'pt';
    if (/[œçÇ]/.test(t) || /\b(c'est|d'un|qu'il|c’est)\b/i.test(t)) return 'fr';

    // Accented vowels without script-specific markers.
    if (/[áéíóúÁÉÍÓÚ]/.test(t)) {
      // Lean Spanish; the agent translates fine regardless.
      return 'es';
    }

    return 'en';
  }
}

export const defaultLanguageAdapter = new HeuristicLanguageAdapter();
