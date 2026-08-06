/**
 * diagnose — template errors as document ranges, for an editor.
 *
 * This lives in the compiler on purpose. The alternative was to put it in the
 * editor extension, and that is exactly how two implementations of "what is a
 * legal template" come to exist and then disagree: the editor calls a template
 * fine while the build fails, or the reverse. Everything about legality comes
 * from `parseTemplate`; this module only turns a template-relative position into
 * a document-relative one, and it is covered by the same suite as the parser.
 *
 * It answers one question — "what is wrong with this file, and where" — with no
 * DOM, no filesystem and no editor API involved. A consumer converts the offsets
 * into whatever range type it uses.
 */

import { detectTemplates } from './detect.js';
import { parseTemplate, TemplateError } from './template.js';

export interface Diagnostic {
  /** the bare message, e.g. `unclosed <div>` */
  message: string;
  /** absolute offset in the source text where the problem starts */
  start: number;
  /** absolute offset one past the end of the highlighted range */
  end: number;
  /**
   * false when the range is the whole static part rather than the exact spot.
   * The only cause is an escape sequence in the template: `parseTemplate` reads
   * COOKED strings, so its offsets count `\`` as one character while the source
   * spends two. Rather than place a confidently wrong squiggle, the range widens
   * to the part and says so.
   */
  exact: boolean;
}

/**
 * Every template error in a module.
 *
 * One diagnostic per template at most: `parseTemplate` stops at its first
 * failure, so a file with three broken templates reports three problems — one
 * each — and a second error inside the same template only appears once the
 * first is fixed.
 *
 * Returns [] for a file that does not import amojs, and [] for a file that is
 * not valid JavaScript: acorn cannot parse it, but the editor's own JS/TS
 * support already reports syntax errors and duplicating them is noise.
 */
export function diagnose(source: string): Diagnostic[] {
  let templates;
  try {
    templates = detectTemplates(source);
  } catch {
    return []; // not parseable as a module — not our error to report
  }

  const out: Diagnostic[] = [];
  for (const t of templates) {
    try {
      parseTemplate(t.strings);
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err; // a real bug, not a template
      const quasi = t.quasis[err.part];
      if (!quasi) continue; // defensive: a part index we cannot place
      const cooked = t.strings[err.part] ?? '';
      const rawLength = quasi.end - quasi.start;

      if (rawLength !== cooked.length) {
        // escapes present — offsets do not line up, so widen instead of lying
        out.push({
          message: err.detail,
          start: quasi.start,
          end: quasi.end,
          exact: false,
        });
        continue;
      }

      const start = quasi.start + Math.min(err.offset, cooked.length);
      out.push({
        message: err.detail,
        ...span(source, start, quasi, t.quasis[err.part + 1]),
        exact: true,
      });
    }
  }
  return out;
}

/**
 * How wide to underline.
 *
 * The parser reports a point; a zero-width squiggle is invisible and a
 * one-character one is nearly so, so the point is grown into the smallest thing
 * a reader would call "the problem".
 *
 * @param next the following static part, when there is one — meaning a `${…}`
 *   sits between it and `quasi`
 */
function span(
  source: string,
  start: number,
  quasi: { start: number; end: number },
  next?: { start: number },
): { start: number; end: number } {
  if (start >= quasi.end) {
    // The error is at the very end of the part, which is where a hole lives.
    // Underline the WHOLE `${…}` — for "a hole may only be an element child"
    // the hole IS the problem, and the alternative was underlining the single
    // space before it, which a reader would never notice.
    if (next) return { start: quasi.end, end: next.start };
    return { start: Math.max(quasi.start, start - 1), end: start };
  }

  const rest = source.slice(start, quasi.end);

  // a tag, including the `>` when it closes right after the name
  const tag = /^<\/?[a-zA-Z][a-zA-Z0-9:._-]*>?/.exec(rest);
  if (tag) return { start, end: start + tag[0].length };

  // `/>` reads as one thing
  if (rest.startsWith('/>')) return { start, end: start + 2 };

  const token = /^[^\s>"'=]+/.exec(rest);
  const width = token ? token[0].length : 1;
  return { start, end: Math.min(quasi.end, start + width) };
}
