// Verify a tailored .docx using the app's OWN reader, not a hand-rolled regex.
import fs from "node:fs";
import { readDocx } from "../lib/docx";
import { numbersIn } from "../lib/tailor";

async function main() {
  const [originalPath, tailoredPath] = process.argv.slice(2);
  const original = await readDocx(fs.readFileSync(originalPath));
  const tailored = await readDocx(fs.readFileSync(tailoredPath));

  console.log(
    `paragraphs: original ${original.paragraphs.length}, tailored ${tailored.paragraphs.length}`,
  );
  if (original.paragraphs.length !== tailored.paragraphs.length) {
    console.log("FAIL  paragraph count changed");
    process.exit(1);
  }

  let changed = 0;
  console.log("\n--- paragraph by paragraph ---");
  for (let i = 0; i < original.paragraphs.length; i++) {
    const a = original.paragraphs[i].text;
    const b = tailored.paragraphs[i].text;
    if (!a && !b) continue;
    if (a === b) {
      console.log(`  [${String(i).padStart(2)}] same   ${a.slice(0, 92)}`);
    } else {
      changed++;
      console.log(`  [${String(i).padStart(2)}] CHANGED`);
      console.log(`         before: ${a.slice(0, 92)}`);
      console.log(`         after:  ${b.slice(0, 92)}`);
    }
  }

  // Every figure in the original must still be present somewhere.
  const before = numbersIn(original.plainText);
  const after = numbersIn(tailored.plainText);
  const lost = [...before].filter((n) => !after.has(n));
  const gained = [...after].filter((n) => !before.has(n));

  console.log(`\nchanged paragraphs: ${changed}`);
  console.log(`figures lost:   ${lost.length ? lost.join(", ") : "none"}`);
  console.log(`figures gained: ${gained.length ? gained.join(", ") : "none"}`);

  const ok = lost.length === 0 && gained.length === 0 && changed > 0;
  console.log(
    ok
      ? "\nPASS  edits applied, no figure invented or dropped"
      : "\nFAIL  see above",
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
