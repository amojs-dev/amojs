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
 * The semantics mirror the runtime's hole rule exactly (@amojs/core html.js):
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
}

/** A hole as a full attribute value: `<img src=${x}>`. */
export interface AttrHole {
  kind: 'attr';
  expr: ExprIndex;
  path: NodePath;
  /** attribute name, lowercase */
  name: string;
}

/** An `on*` attribute hole: `<button onclick=${fn}>`. */
export interface EventHole {
  kind: 'event';
  expr: ExprIndex;
  path: NodePath;
  /** event name without the `on` prefix, lowercase (e.g. "click") */
  name: string;
}

export type Hole = ChildHole | AttrHole | EventHole;

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
