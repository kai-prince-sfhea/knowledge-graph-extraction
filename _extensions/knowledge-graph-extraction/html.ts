/**
 * Count lexical HTML id attributes in ordinary fragment-addressable markup.
 * This is a bounded scanner, not a browser tree builder or an HTML validator.
 * Comments and raw/RCDATA contents cannot supply IDs. Template and noscript
 * content is conservatively excluded because its active-document status varies.
 * Unsupported/ambiguous ID entities and malformed tag syntax fail closed.
 * Script normal/escaped/double-escaped text is modeled to keep apparent tags
 * inside legacy comment wrappers inert. Foreign-content tree repair and other
 * legacy HTML parsing quirks are not modeled.
 */
export function htmlIds(html: string): Map<string, number> {
  const ids = new Map<string, number>();
  if (html.includes("\u0000")) invalid("NUL characters are unsupported");
  let position = 0;
  let templateDepth = 0;

  while (position < html.length) {
    const start = html.indexOf("<", position);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      if (end < 0) invalid("unterminated HTML comment");
      position = end + 3;
      continue;
    }
    if (/^<!doctype(?:[\t\n\f\r ]|>)/i.test(html.slice(start, start + 11))) {
      position = declarationEnd(html, start + 2);
      continue;
    }
    if (html.startsWith("<!", start) || html.startsWith("<?", start)) {
      invalid("unsupported HTML declaration");
    }
    if (!/^<\/?[A-Za-z]/.test(html.slice(start, start + 3))) {
      position = start + 1; // A literal less-than sign, rather than a tag.
      continue;
    }
    const tag = readTag(html, start);
    position = tag.end;
    if (tag.closing) {
      if (tag.name === "template" && templateDepth > 0) templateDepth--;
      continue;
    }
    if (tag.name === "template") {
      templateDepth++;
      continue;
    }
    if (templateDepth === 0 && tag.name !== "noscript" && tag.id !== undefined) {
      const id = attributeValue(tag.id);
      ids.set(id, (ids.get(id) ?? 0) + 1);
    }
    if (tag.name === "plaintext") {
      position = html.length; // HTML plaintext consumes the remainder.
      break;
    }
    if (tag.name === "script") {
      position = scriptEnd(html, position);
    } else if (RAW_CONTENT.has(tag.name)) {
      // In HTML, a slash on a non-void start tag does not terminate raw text.
      const closing = new RegExp(`</${tag.name}[\\t\\n\\f\\r ]*>`, "gi");
      closing.lastIndex = position;
      const match = closing.exec(html);
      if (!match) invalid(`unterminated ${tag.name} element`);
      position = match.index + match[0].length;
    }
  }
  if (templateDepth !== 0) invalid("unterminated template element");
  return ids;
}

const RAW_CONTENT = new Set([
  "style", "textarea", "title", "xmp", "iframe", "noembed",
  "noframes", "noscript",
]);
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
};
// HTML numeric character references map these legacy Windows-1252 values.
const LEGACY: Record<number, number> = {
  128: 0x20ac, 130: 0x201a, 131: 0x0192, 132: 0x201e, 133: 0x2026,
  134: 0x2020, 135: 0x2021, 136: 0x02c6, 137: 0x2030, 138: 0x0160,
  139: 0x2039, 140: 0x0152, 142: 0x017d, 145: 0x2018, 146: 0x2019,
  147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014,
  152: 0x02dc, 153: 0x2122, 154: 0x0161, 155: 0x203a, 156: 0x0153,
  158: 0x017e, 159: 0x0178,
};

function invalid(message: string): never {
  throw new Error(`knowledge-graph-extraction: HTML ID verification: ${message}`);
}

function space(character: string | undefined): boolean {
  return character !== undefined && /[\t\n\f\r ]/.test(character);
}

/** Bounded script tokenizer, without JavaScript evaluation or DOM repair.
 * WHATWG HTML 13.2.5.15–31:
 * https://html.spec.whatwg.org/multipage/parsing.html#script-data-less-than-sign-state
 * https://html.spec.whatwg.org/multipage/parsing.html#script-data-double-escape-end-state
 * In double-escaped text an apparent </script> only returns to escaped text.
 * Dash count retains the escaped dash/dash-dash substates, including <!-->.
 * Actual end tags still use this scanner's strict fail-closed tag grammar.
 */
function scriptEnd(html: string, position: number): number {
  let mode: "normal" | "escaped" | "double" = "normal", dashes = 0;
  const delimiter = (character: string | undefined) => space(character) || character === "/" || character === ">";
  while (position < html.length) {
    const character = html[position];
    if (mode !== "normal") {
      if (character === "-") { dashes = Math.min(2, dashes + 1); position++; continue; }
      if (character === ">" && dashes === 2) { mode = "normal"; dashes = 0; position++; continue; }
      dashes = 0;
    }
    if (character !== "<") { position++; continue; }
    if (mode !== "double" && /^<\/script(?=[\t\n\f\r />])/i.test(html.slice(position, position + 10))) {
      return readTag(html, position).end;
    }
    if (mode === "normal") {
      if (html.startsWith("<!--", position)) { mode = "escaped"; dashes = 2; position += 4; }
      else position++;
      continue;
    }
    const opening: boolean = mode === "escaped" && /[A-Za-z]/.test(html[position + 1] ?? "");
    const ending: boolean = mode === "double" && html[position + 1] === "/";
    if (opening || ending) {
      const start = position + (ending ? 2 : 1);
      let end = start;
      while (end < html.length && /[A-Za-z]/.test(html[end])) end++;
      if (html.slice(start, end).toLowerCase() === "script" && delimiter(html[end])) {
        mode = opening ? "double" : "escaped";
        position = end + 1; // The delimiter is emitted as script text too.
      } else position = end; // Reconsume a non-name character in this mode.
    } else position++;
  }
  return invalid("unterminated script element");
}

function declarationEnd(html: string, position: number): number {
  let quote = "";
  for (; position < html.length; position++) {
    const character = html[position];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return position + 1;
    }
  }
  return invalid("unterminated HTML declaration");
}

function readTag(html: string, start: number): {
  name: string; closing: boolean; end: number; id?: string;
} {
  const opening = /^<(\/)?([A-Za-z][A-Za-z0-9:._-]*)/.exec(html.slice(start));
  if (!opening) return invalid("unsupported tag name");
  const closing = opening[1] === "/";
  const name = opening[2].toLowerCase();
  let position = start + opening[0].length;
  const attributes = new Set<string>();
  let id: string | undefined;
  while (position < html.length) {
    const beforeSpace = position;
    while (space(html[position])) position++;
    if (html[position] === ">") return { name, closing, end: position + 1, id };
    if (!closing && html.startsWith("/>", position)) {
      return { name, closing, end: position + 2, id };
    }
    if (closing) return invalid("attributes or malformed syntax on an end tag");
    if (position === beforeSpace) return invalid("missing whitespace before an attribute");
    const attributeStart = position;
    while (position < html.length && !space(html[position]) && !/[\/>=]/.test(html[position])) {
      if (/["'<`]/.test(html[position])) invalid("malformed attribute name");
      position++;
    }
    if (position === attributeStart) return invalid("malformed attribute name");
    const attribute = html.slice(attributeStart, position).toLowerCase();
    if (attributes.has(attribute)) invalid("duplicate attribute on an HTML element");
    attributes.add(attribute);
    const afterName = position;
    while (space(html[position])) position++;
    let value = "";
    if (html[position] === "=") {
      position++;
      while (space(html[position])) position++;
      const quote = html[position];
      if (quote === '"' || quote === "'") {
        const end = html.indexOf(quote, position + 1);
        if (end < 0) return invalid("unterminated quoted attribute");
        value = html.slice(position + 1, end);
        position = end + 1;
      } else {
        const valueStart = position;
        while (position < html.length && !space(html[position]) && html[position] !== ">") {
          if (/["'<`=]/.test(html[position])) invalid("malformed unquoted attribute");
          position++;
        }
        if (position === valueStart) return invalid("missing attribute value");
        value = html.slice(valueStart, position);
      }
    } else {
      // Preserve the separating whitespace after a boolean attribute for the
      // next loop; the lookahead above only belongs to this attribute if '='.
      position = afterName;
    }
    if (attribute === "id") id = value;
  }
  return invalid("unterminated HTML tag");
}

function attributeValue(value: string): string {
  let decoded = "";
  for (let position = 0; position < value.length;) {
    if (value[position] !== "&") {
      decoded += value[position++];
      continue;
    }
    const rest = value.slice(position);
    const numeric = /^&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/.exec(rest);
    if (numeric) {
      const code = numeric[1] ? Number.parseInt(numeric[1], 16) : Number.parseInt(numeric[2], 10);
      if (!Number.isSafeInteger(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        invalid("invalid numeric entity in an ID");
      }
      decoded += String.fromCodePoint(LEGACY[code] ?? code);
      position += numeric[0].length;
      continue;
    }
    const named = /^&(amp|lt|gt|quot|apos|nbsp)(;?)/.exec(rest);
    if (named && (named[2] || (named[1] !== "apos" && !/[A-Za-z0-9=]/.test(rest[named[0].length] ?? "")))) {
      decoded += NAMED[named[1]];
      position += named[0].length;
      continue;
    }
    // Unknown named references may resolve differently in a browser; do not
    // mistake their raw spelling for a verified destination. Bare '&' is literal.
    if (/^&(?:#|[A-Za-z])/.test(rest)) invalid("unsupported or malformed entity in an ID");
    decoded += "&";
    position++;
  }
  return decoded;
}
