// Build a realistic test resume .docx: headings, split runs, bold sub-runs,
// bullet characters, a tab-aligned date, and a skills line.
import fs from "node:fs";
import JSZip from "jszip";

const R = (text: string, rPr = "") =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</w:t></w:r>`;
const BOLD = "<w:rPr><w:b/></w:rPr>";
const P = (inner: string, style?: string) =>
  `<w:p>${
    style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""
  }${inner}</w:p>`;
const BULLET = (text: string) => P(R(`• ${text}`), "ListParagraph");

const body = [
  P(R("Dana Whitfield"), "Title"),
  P(R("dana.whitfield@example.com | (512) 555-0134 | Austin, TX")),
  P(R("https://linkedin.com/in/danawhitfield | https://github.com/danaw")),
  P(""),
  P(R("PROFESSIONAL SUMMARY"), "Heading1"),
  P(
    R(
      "Data analyst with 7 years turning operational data into decisions for finance and supply chain teams. Comfortable owning a problem end to end, from warehouse modelling through to the dashboard an executive actually opens.",
    ),
  ),
  P(""),
  P(R("EXPERIENCE"), "Heading1"),
  P(R("Senior Data Analyst", BOLD) + R(" — Northwind Analytics") + "<w:r><w:tab/></w:r>" + R("Mar 2021 - Present")),
  BULLET("Responsible for the finance reporting layer, cutting month-end close time by 30%"),
  BULLET("Built 24 self-serve dashboards in Tableau now used by 40 analysts weekly"),
  BULLET("Managed a team of 4 analysts across 2 regions, running hiring and onboarding"),
  BULLET("Worked on migrating 60 legacy SQL reports into dbt, removing 12 hours of manual work per week"),
  P(R("Data Analyst", BOLD) + R(" — Brightline Health") + "<w:r><w:tab/></w:r>" + R("Jun 2018 - Feb 2021")),
  BULLET("Utilized Python and SQL to automate clinical operations reporting for 9 facilities"),
  BULLET("Helped to design the KPI framework adopted by the operations leadership team"),
  BULLET("Reduced report turnaround from 5 days to 1 day by rebuilding the ETL in Airflow"),
  P(""),
  P(R("EDUCATION"), "Heading1"),
  P(R("BS Statistics, University of Texas at Austin, 2018")),
  P(""),
  P(R("SKILLS"), "Heading1"),
  P(R("SQL, Python, dbt, Airflow, Tableau, Excel, Snowflake, Git, statistics, forecasting, stakeholder management")),
  P(""),
  P(R("CERTIFICATIONS"), "Heading1"),
  BULLET("Tableau Desktop Certified Associate"),
].join("");

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style></w:styles>`;

async function main() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", styles);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const out = process.argv[2];
  fs.writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
}

main();
