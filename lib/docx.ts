import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Reading and rewriting .docx without a template engine.
//
// A .docx is a zip; the body lives in word/document.xml as WordprocessingML.
// We locate each <w:p> (paragraph) and read the text out of its <w:t> runs.
// Rewriting puts the replacement text into the paragraph's FIRST run and
// blanks the others.
//
// What that preserves: the document's styles, fonts, margins, section and
// list structure, headers/footers, and the paragraph's own style - i.e. the
// layout the user already has.
//
// What it does not preserve: formatting that varies WITHIN a rewritten
// paragraph. If a bullet reads "Led **Python** migration" with only the word
// Python bold, the rewritten bullet takes the first run's formatting
// throughout. Paragraphs we do not touch are returned byte-identical.
// ---------------------------------------------------------------------------

const DOCUMENT_PATH = "word/document.xml";

export interface DocxParagraph {
  /** Position in the document. Stable for a given file, and the key the
   *  tailorer uses to address an edit. */
  index: number;
  text: string;
  /** True when the paragraph has no <w:t> run to write into. */
  empty: boolean;
}

export interface DocxDocument {
  paragraphs: DocxParagraph[];
  /** The resume as plain text, one paragraph per line. */
  plainText: string;
}

interface ParagraphSpan {
  start: number;
  end: number;
}

/** Depth-aware scan for top-level <w:p> elements, in document order.
 *  Depth matters because a textbox inside a paragraph can itself contain
 *  paragraphs; those are folded into the enclosing one rather than listed. */
function findParagraphSpans(xml: string): ParagraphSpan[] {
  const spans: ParagraphSpan[] = [];
  const tag = /<(\/?)w:p(\s[^>]*?)?(\/?)>/g;
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xml)) !== null) {
    const isClose = m[1] === "/";
    const isSelfClosing = m[3] === "/";
    if (isSelfClosing) {
      if (depth === 0) spans.push({ start: m.index, end: tag.lastIndex });
      continue;
    }
    if (!isClose) {
      if (depth === 0) start = m.index;
      depth++;
    } else {
      depth--;
      if (depth === 0 && start !== -1) {
        spans.push({ start, end: tag.lastIndex });
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return spans;
}

const T_TAG = /<w:t(\s[^>]*?)?>([\s\S]*?)<\/w:t>|<w:t(\s[^>]*?)?\/>/g;

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Every node that contributes characters, matched in document order.
 *  Tabs and breaks live OUTSIDE <w:t>, as siblings inside the run, so they
 *  have to be part of the same scan or words either side run together. */
const TEXT_TOKEN =
  /<w:t(?:\s[^>]*?)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*?)?\/>|<w:(tab|br|cr)(?:\s[^>]*?)?\/>/g;

/** Text of one paragraph: its runs joined, with <w:tab/> as a space and
 *  <w:br/> as a newline, matching how Word renders it. */
function paragraphText(fragment: string): string {
  let text = "";
  let m: RegExpExecArray | null;
  const re = new RegExp(TEXT_TOKEN.source, "g");
  while ((m = re.exec(fragment)) !== null) {
    if (m[1] !== undefined) {
      text += unescapeXml(m[1]);
    } else if (m[2] === "tab") {
      text += " ";
    } else if (m[2] === "br" || m[2] === "cr") {
      text += "\n";
    }
    // A self-closing <w:t/> contributes nothing.
  }
  return text.replace(/[ \t]+/g, " ").trim();
}

async function loadDocumentXml(
  buffer: Buffer,
): Promise<{ zip: JSZip; xml: string }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error(
      "That file is not a readable .docx. If it came from Pages or Google " +
        "Docs, export it again as Word (.docx).",
    );
  }
  const entry = zip.file(DOCUMENT_PATH);
  if (!entry) {
    throw new Error(
      "That .docx has no word/document.xml, so it is not a Word document. " +
        "A .doc renamed to .docx will do this - re-save it as .docx.",
    );
  }
  return { zip, xml: await entry.async("string") };
}

export async function readDocx(buffer: Buffer): Promise<DocxDocument> {
  const { xml } = await loadDocumentXml(buffer);
  const spans = findParagraphSpans(xml);
  const paragraphs: DocxParagraph[] = spans.map((span, index) => {
    const fragment = xml.slice(span.start, span.end);
    const text = paragraphText(fragment);
    return {
      index,
      text,
      empty: !new RegExp(T_TAG.source, "g").test(fragment),
    };
  });
  return {
    paragraphs,
    plainText: paragraphs
      .map((p) => p.text)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

/**
 * Replace the text of specific paragraphs, leaving everything else untouched.
 * Keys of `edits` are paragraph indices from readDocx.
 *
 * Returns the new file plus the indices it could not apply, so the caller can
 * tell the user rather than silently dropping an edit.
 */
export async function rewriteDocx(
  buffer: Buffer,
  edits: Map<number, string>,
): Promise<{ buffer: Buffer; applied: number[]; skipped: number[] }> {
  const { zip, xml } = await loadDocumentXml(buffer);
  const spans = findParagraphSpans(xml);
  const applied: number[] = [];
  const skipped: number[] = [];

  // Rebuild back-to-front so earlier offsets stay valid.
  let out = xml;
  const ordered = [...edits.keys()].sort((a, b) => b - a);
  for (const index of ordered) {
    const span = spans[index];
    const replacement = edits.get(index);
    if (!span || replacement === undefined) {
      skipped.push(index);
      continue;
    }
    const fragment = out.slice(span.start, span.end);
    const rebuilt = replaceParagraphText(fragment, replacement);
    if (rebuilt === null) {
      skipped.push(index);
      continue;
    }
    out = out.slice(0, span.start) + rebuilt + out.slice(span.end);
    applied.push(index);
  }

  zip.file(DOCUMENT_PATH, out);
  const result = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return { buffer: result, applied: applied.reverse(), skipped };
}

/** Put `text` into the paragraph's first run and blank the remaining ones.
 *  Returns null when the paragraph has no run to write into. */
function replaceParagraphText(fragment: string, text: string): string | null {
  const re = new RegExp(T_TAG.source, "g");
  let first = true;
  let found = false;
  const rebuilt = fragment.replace(re, (whole, attrsA, _inner, attrsB) => {
    found = true;
    if (first) {
      first = false;
      const attrs = (attrsA ?? attrsB ?? "").replace(
        /\s*xml:space="[^"]*"/g,
        "",
      );
      // xml:space="preserve" stops Word trimming leading/trailing spaces.
      return `<w:t${attrs} xml:space="preserve">${escapeXml(text)}</w:t>`;
    }
    return whole.startsWith("<w:t") && whole.endsWith("/>")
      ? ""
      : `<w:t${attrsA ?? ""}></w:t>`;
  });
  return found ? rebuilt : null;
}
