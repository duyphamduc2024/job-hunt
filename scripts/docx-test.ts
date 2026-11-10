// Throwaway: exercise readDocx / rewriteDocx against a hand-built .docx that
// includes the awkward cases - split runs, bold sub-runs, a table, a textbox
// with nested paragraphs, tabs, and an entity-escaped ampersand.
import JSZip from "jszip";
import {
  readDocx,
  rewriteDocx,
} from "../lib/docx";

const P = (runs: string, pPr = "") =>
  `<w:p>${pPr}${runs}</w:p>`;
const R = (text: string, rPr = "") =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const BOLD = "<w:rPr><w:b/></w:rPr>";

const body = [
  P(R("Jane Doe")),
  P(R("jane@example.com")),
  P("", ""), // genuinely empty paragraph, no runs
  P(R("EXPERIENCE"), "<w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr>"),
  // Split across runs, with one bold word in the middle.
  P(R("Led ") + R("Python", BOLD) + R(" migration for 12 services")),
  // Tab + ampersand entity.
  P(R("Research &amp; Development") + "<w:r><w:tab/></w:r>" + R("2021")),
  // A table cell paragraph.
  `<w:tbl><w:tr><w:tc>${P(R("Skills"))}</w:tc><w:tc>${P(
    R("SQL, dbt, Airflow"),
  )}</w:tc></w:tr></w:tbl>`,
  // A paragraph containing a textbox that itself holds a paragraph.
  `<w:p><w:r><mc:AlternateContent><mc:Choice><w:txbxContent>${P(
    R("inside a textbox"),
  )}</w:txbxContent></mc:Choice></mc:AlternateContent></w:r>${R(
    "outer paragraph text",
  )}</w:p>`,
  P(R("Built dashboards used by 40 analysts")),
].join("");

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;

async function buildDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file("word/document.xml", documentXml);
  return (await zip.generateAsync({ type: "nodebuffer" })) as Buffer;
}

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
  return ok;
}

async function main() {
  const original = await buildDocx();
  const doc = await readDocx(original);

  console.log("--- paragraphs read ---");
  doc.paragraphs.forEach((p) =>
    console.log(`  [${p.index}]${p.empty ? " (empty)" : ""} ${JSON.stringify(p.text)}`),
  );

  let allOk = true;
  allOk = check("para 0 is the name", doc.paragraphs[0].text, "Jane Doe") && allOk;
  allOk =
    check("empty paragraph flagged", doc.paragraphs[2].empty, true) && allOk;
  allOk =
    check(
      "split runs with bold are joined",
      doc.paragraphs[4].text,
      "Led Python migration for 12 services",
    ) && allOk;
  allOk =
    check(
      "ampersand unescaped and tab becomes a space",
      doc.paragraphs[5].text,
      "Research & Development 2021",
    ) && allOk;
  allOk =
    check("table cell paragraphs are listed", doc.paragraphs[6].text, "Skills") &&
    allOk;

  // Rewrite two paragraphs: one split-run bullet and one plain one.
  const edits = new Map<number, string>([
    [4, "Drove Python migration across 12 production services"],
    [
      doc.paragraphs.length - 1,
      "Built dashboards relied on by 40 analysts weekly",
    ],
  ]);
  const { buffer: rewritten, applied, skipped } = await rewriteDocx(
    original,
    edits,
  );
  console.log(`\n--- rewrite: applied ${JSON.stringify(applied)}, skipped ${JSON.stringify(skipped)} ---`);

  const after = await readDocx(rewritten);
  allOk =
    check(
      "edited bullet has new text",
      after.paragraphs[4].text,
      "Drove Python migration across 12 production services",
    ) && allOk;
  allOk =
    check(
      "last paragraph edited",
      after.paragraphs[after.paragraphs.length - 1].text,
      "Built dashboards relied on by 40 analysts weekly",
    ) && allOk;
  allOk =
    check(
      "paragraph count unchanged",
      after.paragraphs.length,
      doc.paragraphs.length,
    ) && allOk;
  allOk =
    check("untouched paragraph intact", after.paragraphs[0].text, "Jane Doe") &&
    allOk;
  allOk =
    check(
      "untouched table cell intact",
      after.paragraphs[7].text,
      "SQL, dbt, Airflow",
    ) && allOk;
  allOk = check("nothing skipped", skipped.length, 0) && allOk;

  // The zip must still be a valid docx, and styles must survive.
  const reZip = await JSZip.loadAsync(rewritten);
  const xml = await reZip.file("word/document.xml")!.async("string");
  allOk =
    check("Heading1 style preserved", xml.includes('w:val="Heading1"'), true) &&
    allOk;
  allOk =
    check("sectPr (page setup) preserved", xml.includes("<w:sectPr>"), true) &&
    allOk;
  allOk =
    check(
      "content types part preserved",
      reZip.file("[Content_Types].xml") !== null,
      true,
    ) && allOk;

  // An edit addressed at a paragraph with no runs must be reported, not lost.
  const bad = await rewriteDocx(original, new Map([[2, "cannot go here"]]));
  allOk = check("run-less paragraph is skipped", bad.skipped, [2]) && allOk;

  // Rejecting non-docx input.
  try {
    await readDocx(Buffer.from("this is a PDF, not a docx"));
    console.log("FAIL  non-docx input should throw");
    allOk = false;
  } catch (err) {
    console.log(
      `PASS  non-docx rejected: ${(err as Error).message.slice(0, 60)}...`,
    );
  }

  console.log(`\n${allOk ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
