/**
 * The AmoJS intermediate representation (IR) — the contract between every
 * compiler frontend and every codegen backend.
 *
 * LOCKED RULE #4: the IR never names DOM APIs. It describes INTENT — static
 * markup plus where the dynamic holes are — so that a DOM backend, an SSR
 * backend (string concatenation) and a custom-element backend can all be
 * generated from the same object. It is plain JSON: serializable, cacheable,
 * snapshot-testable, and portable to another compiler implementation.
 *
 * The semantics mirror the runtime's hole rule exactly (amojs html.js):
 * the runtime is the semantic source of truth (LOCKED RULE #3).
 */

/**
 * Where a hole's value comes from: the index of the `${…}` expression in the
 * original tagged template, left to right, starting at 0.
 */
export type ExprIndex = number;

/**
 * A positional address inside the template's node tree: child indexes from
 * the template root down to the node, e.g. [0, 2] = first root node → its
 * third child. Computed once at compile time — no runtime searching.
 */
export type NodePath = number[];

/** A hole in text position: `<p>${x}</p>`. Binds to a dedicated text node. */
export interface ChildHole {
  kind: 'child';
  expr: ExprIndex;
  path: NodePath;
  /**
   * Offset in `html` where this hole's `<!---->` marker starts. The string
   * (SSR) backend splices its output here; the DOM backend never reads it.
   * Recorded by the parser at emit time — a position, not a DOM concept.
   */
  htmlAt: number;
}

/** A hole as a full attribute value: `<img src=${x}>`. */
export interface AttrHole {
  kind: 'attr';
  expr: ExprIndex;
  path: NodePath;
  /** attribute name, lowercase */
  name: string;
  /** offset in `html` of the `>` (or `/>`) closing this element's open tag —
   *  where the string backend splices the serialized attribute in */
  htmlAt: number;
  /** the owning element's tag name, lowercase — the string backend needs it
   *  (value/checked/selected serialize per element; the DOM asks `name in el`) */
  tag: string;
}

/** An `on*` attribute hole: `<button onclick=${fn}>`. */
export interface EventHole {
  kind: 'event';
  expr: ExprIndex;
  path: NodePath;
  /** event name without the `on` prefix, lowercase (e.g. "click") */
  name: string;
  /** offset in `html` of the `>` closing this element's open tag — the string
   *  backend still EVALUATES the expression there (a non-function must fail
   *  identically in every mode), it just emits no markup */
  htmlAt: number;
}

/**
 * Text inside a rawtext element's content: `<title>${name}</title>`.
 *
 * `<title>` only, SERVER target only. The client answer is `document.title = …`
 * (binding it would mean walking into rawtext, which neither walker enters);
 * a server has no escape, since a page title must be in the HTML. So the two
 * backends differ in what they ACCEPT here — the mirror of the server-only
 * errors on `<select value>` and `indeterminate`.
 */
export interface ContentHole {
  kind: 'content';
  expr: ExprIndex;
  path: NodePath;
  /** offset in `html` to insert at — no marker (a comment inside rawtext is
   *  literal text). Holes may share an offset: `<title>${a}${b}</title>`. */
  htmlAt: number;
  /** the owning element's tag name, lowercase */
  tag: string;
}

export type Hole = ChildHole | AttrHole | EventHole | ContentHole;

/** The IR of one `html\`…\`` template. */
export interface TemplateIR {
  /**
   * The static markup. Every child hole appears as an empty comment
   * (`<!---->`) at its exact position — serialized HTML cannot express empty
   * text nodes, and without a separator adjacent static texts would merge on
   * reparse and shift every path. Consumers replace each marker comment with
   * an empty text node once, on the cached template content.
   * Attribute/event holes are stripped from the markup entirely.
   */
  html: string;
  /** All dynamic holes, in source order. */
  holes: Hole[];
  /**
   * If the template has exactly one root ELEMENT and nothing else at root
   * level except whitespace text, this is that element's root child index —
   * the static form of the runtime's "unwrap" decision. Otherwise null.
   */
  singleRootIndex: number | null;
}
