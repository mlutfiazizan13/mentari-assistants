/**
 * Question and answer bodies come from Mentari as HTML fragments, but they are
 * routinely *about* code -- `<?php`, `$a < $b`, `array<int>`. A blanket
 * `/<[^>]*>/g` eats those spans as if they were markup and hands the model a
 * question with the code missing, so match only things that really look like a
 * tag.
 */

// `<p>`, `</strong>`, `<br/>`, `<img src="...">` -- a tag name must start with a
// letter, which is what keeps `<?php ... ?>` and `2 < 3` out of the match.
const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
// Tags that imply a visual break; everything else is inline and must not gain a
// space, or `<b>array</b>_push` would come back as "array _push".
const BREAK_TAG = /<\s*(?:br|\/?(?:p|div|li|tr|h[1-6]|blockquote|pre))\b[^<>]*>/gi;

const NAMED_ENTITIES: [RegExp, string][] = [
  [/&nbsp;/gi, " "],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#0*39;|&apos;|&#x0*27;/gi, "'"],
  [/&#0*34;/g, '"'],
];

function decodeEntities(text: string): string {
  let out = text;
  for (const [pattern, replacement] of NAMED_ENTITIES) {
    out = out.replace(pattern, replacement);
  }
  out = out
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10))
    );
  // `&amp;` goes last so `&amp;lt;` decodes to the literal text `&lt;` rather
  // than being decoded twice into `<`.
  return out.replace(/&amp;/gi, "&");
}

/** HTML fragment -> single-line plain text, with code snippets left intact. */
export function stripHtml(html: string): string {
  if (!html) return "";

  const withoutTags = html
    .replace(HTML_COMMENT, "")
    .replace(BREAK_TAG, " ")
    .replace(HTML_TAG, "");

  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

/** Block-level tags: each starts and ends a paragraph. */
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "blockquote", "pre", "table", "tr",
  "h1", "h2", "h3", "h4", "h5", "h6", "figure", "hr",
]);

/**
 * HTML fragment -> plain text that keeps the layout a reader sees: paragraphs,
 * line breaks, and numbered or bulleted lists ("1. ", "• ", nested lists
 * indented). Newlines already in the text are kept too, since Mentari shows
 * posts with `white-space: pre-wrap` and students type replies as plain text.
 *
 * `stripHtml` stays the choice for quiz questions, where one line is wanted.
 */
export function htmlToText(html: string): string {
  if (!html) return "";

  // Comments, plus any tag whose name starts with a letter -- the same rule as
  // HTML_TAG, so `<?php` and `a < b` in code survive as text.
  const token = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?\/?>/g;
  const lists: { ordered: boolean; n: number }[] = [];
  let out = "";
  let last = 0;

  // Start a new line (or paragraph) only if the text does not already end with
  // one, so `</li><li>` and nested lists leave no blank lines between items.
  const lineBreak = () => {
    if (!/\n[ \t]*$/.test(out)) out += "\n";
  };
  const paragraph = () => {
    if (/\n[ \t]*\n[ \t]*$/.test(out)) return;
    out += /\n[ \t]*$/.test(out) ? "\n" : "\n\n";
  };

  for (let m = token.exec(html); m; m = token.exec(html)) {
    out += html.slice(last, m.index);
    last = token.lastIndex;

    const tag = m[2]?.toLowerCase();
    if (!tag) continue; // a comment
    const closing = m[1] === "/";

    if (tag === "br") {
      out += "\n";
    } else if (BLOCK_TAGS.has(tag)) {
      // A <p> inside a list item belongs on the item's line, not a new paragraph.
      if (lists.length) {
        if (closing) lineBreak();
      } else {
        paragraph();
      }
    } else if (tag === "ol" || tag === "ul") {
      if (closing) lists.pop();
      else lists.push({ ordered: tag === "ol", n: 0 });
      lineBreak();
    } else if (tag === "li") {
      lineBreak();
      if (!closing) {
        const list = lists[lists.length - 1];
        const indent = "   ".repeat(Math.max(0, lists.length - 1));
        out += `${indent}${list?.ordered ? `${++list.n}. ` : "• "}`;
      }
    } else if ((tag === "td" || tag === "th") && closing) {
      out += "  |  ";
    }
    // Inline tags (b, strong, i, em, span, a, code, ...) just disappear.
  }
  out += html.slice(last);

  return decodeEntities(out)
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    // Collapse runs of spaces inside a line, but keep a list's leading indent.
    .map((line) => line.replace(/(\S)[ \t]+/g, "$1 ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
