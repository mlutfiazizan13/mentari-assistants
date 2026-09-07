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
