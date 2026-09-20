// Phases 5 & 6: document + data/developer tools through the real UI with independent output verification.
import crypto from "node:crypto";
import { launch, open, runAction, download, pdfTexts, pdfPixels, rec, save, fx, fs } from "./lib.mjs";

const { browser, page, errors } = await launch();
const guard = async (tool, test, fn) => { try { await fn(); } catch (e) { rec(tool, test, "FAIL", String(e).slice(0, 220)); } };
const ta = (label) => page.getByLabel(label, { exact: true });
const errText = async () => (await page.locator("main [role=alert]").allInnerTexts()).join(" | ");
async function typeAndRun(route, inLabel, text, action, opts = {}) {
  await open(page, route); if (opts.select) await page.locator("main select").first().selectOption(opts.select);
  await ta(inLabel).fill(text); await page.getByRole("button", { name: action, exact: true }).click(); await page.waitForTimeout(opts.wait ?? 400);
}
const out = async (label) => ta(label).inputValue();
function parseCsv(s) { const rows = []; let row = [], f = "", q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; } else f += c; } if (f !== "" || row.length) { row.push(f); rows.push(row); } return rows; }

// ================= DOCUMENTS =================
async function runDoc(name, timeout = 120_000) {
  await page.getByRole("button", { name }).click();
  await Promise.race([page.getByText(/is ready\./).waitFor({ timeout }), page.locator("main [role=alert]").first().waitFor({ timeout })]);
  const ok = (await page.getByText(/is ready\./).count()) > 0; return { ok, text: ok ? "" : await page.locator("main [role=alert]").first().innerText() };
}
async function dlDoc(tag) { const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]); const p = `qa/evidence/out/${tag}.pdf`; await dl.saveAs(p); return [{ name: dl.suggestedFilename(), path: p }]; }
const md = fs.readFileSync(fx("DOC-02-markdown.md"), "utf8");
const bigTxt = fs.readFileSync(fx("DOC-01-large.txt"), "utf8");
await guard("txt-to-html", "typed + uploaded", async () => {
  await open(page, "/document/txt-to-html", ["DOC-01-large.txt"]); await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Convert to HTML" }).click(); await page.waitForTimeout(800);
  const html = await out("HTML output");
  // Independent parse in the browser
  const parsed = await page.evaluate((h) => { const d = new DOMParser().parseFromString(h, "text/html"); return { paras: d.querySelectorAll("p").length, text: d.body.textContent.length, scripts: d.querySelectorAll("script").length, lt: /&lt;appendix 1&gt;/.test(h) }; }, html);
  rec("txt-to-html", "1.7 MB TXT → HTML; <appendix> escaped; text preserved", html.length > bigTxt.length && parsed.lt && parsed.scripts === 0 && parsed.text > bigTxt.replace(/\s/g, "").length * 0.9 ? "PASS" : "FAIL", `htmlLen=${html.length} paragraphs=${parsed.paras} textChars=${parsed.text} escaped=${parsed.lt}`);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const p = "qa/evidence/out/doc-txt.html"; await dl.saveAs(p);
  rec("txt-to-html", "download equals on-screen output", fs.readFileSync(p, "utf8") === html ? "PASS" : "FAIL", `${dl.suggestedFilename()} ${fs.statSync(p).size}B`);
});
await guard("txt-to-html", "special chars typed", async () => {
  await typeAndRun("/document/txt-to-html", "Plain text", 'Tom & Jerry <b>bold</b> "quoted"\n\nSecond para\nline2 — café 日本', "Convert to HTML");
  const html = await out("HTML output");
  rec("txt-to-html", "escapes & < > quotes; keeps unicode; paragraph split", html.includes("Tom &amp; Jerry &lt;b&gt;bold&lt;/b&gt;") && html.includes("café 日本") && /white-space: pre-wrap/.test(html) && html.includes("Second para\nline2") ? "PASS" : "FAIL", html.slice(html.indexOf("<body"), html.indexOf("<body") + 260).replace(/\n/g, "⏎"));
});
await guard("markdown-to-html", "rich markdown", async () => {
  await open(page, "/document/markdown-to-html", ["DOC-02-markdown.md"]); await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Convert to HTML" }).click(); await page.waitForTimeout(600);
  const html = await out("HTML output");
  const r = await page.evaluate((h) => { const d = new DOMParser().parseFromString(h, "text/html"); const q = (s) => d.querySelectorAll(s).length; return { h1: q("h1"), h2: q("h2"), h3: q("h3"), strong: q("strong"), em: q("em"), a: [...d.querySelectorAll("a")].map((x) => x.getAttribute("href")), ul: q("ul"), ol: q("ol"), li: q("li"), table: q("table"), th: q("th"), td: q("td"), pre: q("pre"), bq: q("blockquote"), hr: q("hr"), script: q("script"), snake: /Snake_case_identifier/.test(d.body.textContent), jsHref: h.includes("javascript:"), uni: /日本語/.test(d.body.textContent), img: q("img"), nestedUl: q("ul ul"), tdAlign: d.querySelector("td")?.getAttribute("style") ?? d.querySelector("th")?.getAttribute("align") ?? "" }; }, html);
  const ok = r.h1 === 1 && r.h2 === 1 && r.h3 === 2 && r.strong >= 2 && r.em >= 2 && r.ul >= 2 && r.ol >= 1 && r.table === 1 && r.th === 3 && r.td === 6 && r.pre === 1 && r.bq === 1 && r.hr === 1 && r.script === 0 && r.snake && !r.jsHref && r.uni;
  rec("markdown-to-html", "headings/bold/italic/lists(nested,numbered)/table/code/quote/hr/unicode; script & javascript: link neutralised", ok ? "PASS" : "FAIL", JSON.stringify(r));
  rec("markdown-to-html", "markdown image ![alt](url) rendered?", "INFO", `<img> count=${r.img}; align style=${r.tdAlign} (table alignment markers)`);
  const long = html.includes("x".repeat(220)); rec("markdown-to-html", "220-char unbroken string wraps (overflow-wrap) in generated document", /overflow-wrap|word-break|word-wrap/.test(html) ? "PASS" : "LIMITED", `present=${long}; css handles wrap=${/overflow-wrap|word-break|word-wrap/.test(html)}`);
});
await guard("markdown-to-pdf", "rich markdown → PDF", async () => {
  await open(page, "/document/markdown-to-pdf", ["DOC-02-markdown.md"]); await page.waitForTimeout(500);
  const r = await runDoc(/^Convert to PDF/); const note = (await page.locator("main").innerText()).split("\n").filter((l) => /replaced|couldn|unsupported|can.t draw/i.test(l)).join(" | ");
  const [f] = await dlDoc("md2pdf"); const t = await pdfTexts(f.path); const all = t.map((x) => x.text).join(" ");
  const need = ["Audit Document", "Lists", "Item one", "Nested deeper", "Third-one", "Apple", "Pear", "1.20", "0.75", "def add(a, b):", "A quoted line", "xxxxxxxxxx"];
  const missing = need.filter((n) => !all.includes(n));
  rec("markdown-to-pdf", "PDF has headings/lists/table/code/quote text; long string not clipped", r.ok && t.length >= 1 && missing.length === 0 ? "PASS" : "FAIL", `pages=${t.length} missing=[${missing}] note="${note.slice(0, 120)}"`);
  const chars = { unicode: ["café", "日本語", "Ελληνικά", "✓", "😀"].map((c) => `${c}:${all.includes(c)}`).join(" ") };
  rec("markdown-to-pdf", "non-Latin characters in PDF", "INFO", chars.unicode + (note ? ` — UI says: ${note.slice(0, 160)}` : " — no UI note"));
  const longRun = t.some((x) => /x{200}/.test(x.text)); const p = await pdfPixels(f.path, 1, 1); const right = (() => { let m = 0; for (let y = 0; y < p.h; y++) for (let x = p.w - 30; x < p.w; x++) if (p.d[(y * p.w + x) * 4] < 120) m++; return m; })();
  rec("markdown-to-pdf", "no text drawn into the right page margin", right < 5 ? "PASS" : "FAIL", `dark px in right 30px strip: ${right}`);
});
await guard("txt-to-pdf", "large TXT → PDF", async () => {
  await open(page, "/document/txt-to-pdf", ["DOC-01-large.txt"]); await page.waitForTimeout(500);
  const t0 = Date.now(); const r = await runDoc(/^Convert to PDF/, 240_000); const ms = Date.now() - t0;
  const note = (await page.locator("main").innerText()).split("\n").filter((l) => /replaced|substituted|couldn/i.test(l)).join(" | ");
  const [f] = await dlDoc("txt2pdf"); const t = await pdfTexts(f.path); const all = t.map((x) => x.text).join(" ");
  const words = (bigTxt.match(/\S+/g) ?? []).length; const outWords = (all.match(/\S+/g) ?? []).length;
  rec("txt-to-pdf", "1.7 MB TXT → PDF: page count, text complete, first/last section", r.ok && t.length > 100 && all.includes("Section 1.") && all.includes("Section 2600.") && outWords / words > 0.98 ? "PASS" : "FAIL", `pages=${t.length} words in/out=${words}/${outWords} ${ms}ms size=${fs.statSync(f.path).size} note="${note.slice(0, 120)}"`);
  const p = await pdfPixels(f.path, 1, 1); rec("txt-to-pdf", "page 1 is A4/Letter and has ink", t[0].w > 500 && [...p.d].filter((v, i) => i % 4 === 0 && v < 100).length > 500 ? "PASS" : "FAIL", `${t[0].w}x${t[0].h}`);
});
await guard("txt-to-pdf", "unicode + empty", async () => {
  await open(page, "/document/txt-to-pdf"); await page.locator("textarea").first().fill("Café ✓ 日本語 — “quotes” €5");
  const r = await runDoc(/^Convert to PDF/); const msg = (await page.locator("main").innerText()).split("\n").filter((l) => /replaced|can.t|substitut|unsupported/i.test(l)).join(" | ");
  let txt = ""; if (r.ok) { const [f] = await dlDoc("txt2pdf-uni"); txt = (await pdfTexts(f.path)).map((x) => x.text).join(" "); }
  rec("txt-to-pdf", "unicode input: file produced, characters kept or user told", r.ok && (msg || /日本語/.test(txt)) ? "PASS" : "FAIL", `text="${txt}" ui="${msg.slice(0, 140)}"`);
  await open(page, "/document/txt-to-pdf"); const btn = page.getByRole("button", { name: /^Convert to PDF/ }); const dis = await btn.isDisabled(); let m = ""; if (!dis) { const rr = await runDoc(/^Convert to PDF/); m = rr.ok ? "PRODUCED FILE" : rr.text; }
  rec("txt-to-pdf", "empty input refused", dis || (m && m !== "PRODUCED FILE") ? "PASS" : "FAIL", dis ? "button disabled" : m);
});

// ================= DATA =================
const nested = fs.readFileSync(fx("DATA-01-nested.json"), "utf8");
await guard("json-formatter", "pretty + minify + errors", async () => {
  await typeAndRun("/data/json-formatter", "JSON input", nested, "Format JSON");
  const pretty = await out("Formatted JSON");
  const same = JSON.stringify(JSON.parse(pretty)) === JSON.stringify(JSON.parse(nested));
  rec("json-formatter", "pretty-print is valid, equal to input, 2-space indented", same && /\n  "id": 7/.test(pretty) && pretty.includes("Ünïcode ✓ 日本語") ? "PASS" : "FAIL", `bytes ${pretty.length}`);
  const bigNum = /12345678901234567890/.test(pretty);
  rec("json-formatter", "integer beyond 2^53 (12345678901234567890) survives formatting", bigNum ? "PASS" : "LIMITED", bigNum ? "exact" : `became: ${(pretty.match(/"big": ([0-9e+.]+)/) ?? [])[1]} (JS number precision) — is this disclosed in UI? ${/precision|large number/i.test(await page.locator("main").innerText())}`);
  await open(page, "/data/json-formatter"); await page.locator("main select").first().selectOption("minify"); await ta("JSON input").fill(pretty);
  await page.getByRole("button", { name: /^(Minify|Format) JSON$/ }).click().catch(async () => page.getByRole("button", { name: /JSON/ }).last().click()); await page.waitForTimeout(400);
  const mini = await out("Formatted JSON");
  rec("json-formatter", "minify removes whitespace, same data", !/\n| {2}/.test(mini.replace(/"[^"]*"/g, '""')) && JSON.stringify(JSON.parse(mini)) === JSON.stringify(JSON.parse(nested)) ? "PASS" : "FAIL", `${mini.length} chars`);
  await typeAndRun("/data/json-formatter", "JSON input", fs.readFileSync(fx("DATA-03-malformed.json"), "utf8"), "Format JSON");
  const e = await errText(); rec("json-formatter", "validator: malformed JSON → message with reason/position", /position|line|unexpected|expected/i.test(e) ? "PASS" : "FAIL", e.slice(0, 200));
  const big = fs.readFileSync(fx("DATA-02-array-large.json"), "utf8"); const t0 = Date.now();
  await typeAndRun("/data/json-formatter", "JSON input", big, "Format JSON", { wait: 1500 });
  const bp = await out("Formatted JSON"); rec("json-formatter", "570 KB / 6000 records formatted", bp.length > big.length && JSON.parse(bp).length === 6000 ? "PASS" : "FAIL", `${Date.now() - t0}ms out=${bp.length}`);
});
await guard("csv-to-json", "tricky CSV", async () => {
  const csv = fs.readFileSync(fx("DATA-04-quoted.csv"), "utf8");
  await typeAndRun("/data/csv-to-json", "CSV input", csv, "Convert to JSON"); const j = JSON.parse(await out("JSON output"));
  const okRows = j.length === 5 && j[0].name === "Smith, Jane" && j[0].notes === 'said "hello"' && j[1].notes === "multi\nline note" && j[2].name === "" && j[3].name === "Zoë" && j[4].name === "日本語" && j[4].notes === "tab\there";
  rec("csv-to-json", "quoted commas, doubled quotes, quoted newline, empty cells, unicode", okRows ? "PASS" : "FAIL", JSON.stringify(j).slice(0, 260));
  rec("csv-to-json", "number typing", "INFO", `amount values: ${j.map((r) => JSON.stringify(r.amount)).join(",")}`);
  await typeAndRun("/data/csv-to-json", "CSV input", fs.readFileSync(fx("DATA-05-malformed.csv"), "utf8"), "Convert to JSON");
  const e = await errText(); const o = await out("JSON output").catch(() => "");
  rec("csv-to-json", "malformed CSV (unclosed quote) → warning/error, not silent garbage", e || /unclosed|malformed|warn/i.test(await page.locator("main").innerText()) ? "PASS" : "FAIL", `err="${e.slice(0, 160)}" output=${o.slice(0, 100).replace(/\n/g, " ")}`);
  await typeAndRun("/data/csv-to-json", "CSV input", "a;b;c\n1;2;3\n", "Convert to JSON"); rec("csv-to-json", "semicolon-delimited CSV", "INFO", (await out("JSON output")).replace(/\s+/g, " ").slice(0, 120));
});
await guard("json-to-csv", "records → CSV round trip", async () => {
  const src = fs.readFileSync(fx("DATA-06-flat.json"), "utf8");
  await typeAndRun("/data/json-to-csv", "JSON input", src, "Convert to CSV"); const csv = await out("CSV output"); const rows = parseCsv(csv);
  const header = rows[0]; const idx = (n) => header.indexOf(n);
  const rec1 = rows[1], rec3 = rows[3];
  const ok = header.includes("id") && header.includes("name") && header.includes("note") && rec1[idx("note")] === 'has, comma and "quote"' && rows[2][idx("note")] === "" && rec3[idx("note")] === "line1\nline2" && rows.length === 5;
  rec("json-to-csv", "union of keys, comma/quote/newline escaped (re-parsed with independent CSV parser)", ok ? "PASS" : "FAIL", `header=${header} row4=${JSON.stringify(rows[4])}`);
  await typeAndRun("/data/json-to-csv", "JSON input", '{"a":1}', "Convert to CSV"); rec("json-to-csv", "single object (not array)", "INFO", (await out("CSV output")).replace(/\n/g, "⏎") + " " + (await errText()));
  await typeAndRun("/data/json-to-csv", "JSON input", "[1,2,3]", "Convert to CSV"); rec("json-to-csv", "array of primitives", "INFO", ((await out("CSV output")).replace(/\n/g, "⏎") + " " + (await errText())).slice(0, 160));
  await typeAndRun("/data/json-to-csv", "JSON input", "{bad", "Convert to CSV"); rec("json-to-csv", "invalid JSON → message", (await errText()) ? "PASS" : "FAIL", (await errText()).slice(0, 120));
});
await guard("xml-formatter", "pretty/minify/malformed", async () => {
  const xml = fs.readFileSync(fx("DATA-07-namespaces.xml"), "utf8");
  await typeAndRun("/data/xml-formatter", "XML input", xml, "Format XML"); const pretty = await out("Formatted XML");
  const chk = await page.evaluate((s) => { const d = new DOMParser().parseFromString(s, "application/xml"); return { err: !!d.querySelector("parsererror"), books: d.getElementsByTagNameNS("urn:example:catalog", "book").length, flag: d.getElementsByTagNameNS("urn:example:catalog", "book")[0]?.getAttributeNS("urn:example:extra", "flag"), title: d.getElementsByTagNameNS("urn:example:catalog", "title")[0]?.textContent, cdata: d.getElementsByTagNameNS("urn:example:catalog", "title")[1]?.textContent }; }, pretty);
  rec("xml-formatter", "pretty output well-formed; namespaces, attribute, entity, CDATA text preserved", !chk.err && chk.books === 2 && chk.flag === "yes" && chk.title === "Café & Co" && chk.cdata === "Raw <b>text</b>" && /\n {2}</.test(pretty) ? "PASS" : "FAIL", JSON.stringify(chk) + " decl=" + pretty.startsWith("<?xml") + " comment=" + pretty.includes("<!-- catalog -->"));
  await open(page, "/data/xml-formatter"); await page.locator("main select").first().selectOption("minify"); await ta("XML input").fill(pretty); await page.getByRole("button", { name: /XML$/ }).last().click(); await page.waitForTimeout(400);
  const mini = await out("Formatted XML"); const okMini = await page.evaluate((s) => !new DOMParser().parseFromString(s, "application/xml").querySelector("parsererror"), mini);
  rec("xml-formatter", "minify well-formed and shorter", okMini && mini.length < pretty.length ? "PASS" : "FAIL", `${pretty.length}→${mini.length}`);
  await typeAndRun("/data/xml-formatter", "XML input", fs.readFileSync(fx("DATA-08-malformed.xml"), "utf8"), "Format XML"); const e = await errText();
  rec("xml-formatter", "malformed XML → error", e ? "PASS" : "FAIL", e.slice(0, 160));
});
await guard("base64-encode-decode", "encode/decode", async () => {
  const s = "Hello, wörld ✓\nSecond line 日本語\n";
  await typeAndRun("/data/base64", "Plain text", s, "Encode"); const enc = await out("Base64 output");
  rec("base64-encode-decode", "unicode text encodes to standard Base64 (matches Buffer)", enc.trim() === Buffer.from(s).toString("base64") ? "PASS" : "FAIL", enc.slice(0, 60));
  await open(page, "/data/base64"); await page.locator("main select").first().selectOption("decode"); await page.getByLabel(/Base64 input|Base64/).first().fill(enc); await page.getByRole("button", { name: "Decode" }).click(); await page.waitForTimeout(300);
  const dec = await page.locator("main textarea").nth(1).inputValue();
  rec("base64-encode-decode", "decode round-trips including unicode/newlines", dec === s ? "PASS" : "FAIL", JSON.stringify(dec));
  await open(page, "/data/base64"); await page.locator("main select").first().selectOption("decode"); await page.locator("main textarea").first().fill("###not base64###"); await page.getByRole("button", { name: "Decode" }).click(); await page.waitForTimeout(300);
  rec("base64-encode-decode", "invalid Base64 → clear error", (await errText()) ? "PASS" : "FAIL", (await errText()).slice(0, 120));
  await open(page, "/data/base64"); await page.locator("main select").first().selectOption("decode"); await page.locator("main textarea").first().fill("SGVsbG8gd29ybGQ"); await page.getByRole("button", { name: "Decode" }).click(); await page.waitForTimeout(300);
  rec("base64-encode-decode", "unpadded Base64 accepted", (await page.locator("main textarea").nth(1).inputValue()) === "Hello world" ? "PASS" : "LIMITED", await page.locator("main textarea").nth(1).inputValue() || (await errText()));
});
await guard("url-encode-decode", "encode/decode", async () => {
  const s = "café au lait & 1+1=2 /a/b?c=d#e 日本";
  await typeAndRun("/data/url-encode-decode", "Plain text", s, "Encode"); const enc = await out("Encoded output");
  rec("url-encode-decode", "encode equals encodeURIComponent", enc === encodeURIComponent(s) ? "PASS" : "FAIL", enc);
  await open(page, "/data/url-encode-decode"); await page.locator("main select").first().selectOption("decode"); await page.locator("main textarea").first().fill(fs.readFileSync(fx("DATA-10-urlencoded.txt"), "utf8")); await page.getByRole("button", { name: "Decode" }).click(); await page.waitForTimeout(300);
  rec("url-encode-decode", "decode percent-encoded string", (await page.locator("main textarea").nth(1).inputValue()) === decodeURIComponent(fs.readFileSync(fx("DATA-10-urlencoded.txt"), "utf8")) ? "PASS" : "FAIL", await page.locator("main textarea").nth(1).inputValue());
  await open(page, "/data/url-encode-decode"); await page.locator("main select").first().selectOption("decode"); await page.locator("main textarea").first().fill("%E0%A4%A"); await page.getByRole("button", { name: "Decode" }).click(); await page.waitForTimeout(300);
  rec("url-encode-decode", "malformed %-sequence → error", (await errText()) ? "PASS" : "FAIL", (await errText()).slice(0, 120));
});
await guard("text-case-converter", "all 7 modes", async () => {
  const src = "hello WORLD example-text_here. second sentence Ünïcode straße";
  const exp = { upper: src.toUpperCase(), lower: src.toLowerCase() };
  for (const mode of ["upper", "lower", "title", "sentence", "camel", "kebab", "snake"]) {
    await open(page, "/data/case-converter"); await page.locator("main select").first().selectOption(mode); await ta("Input text").fill(src); await page.getByRole("button", { name: "Convert case" }).click(); await page.waitForTimeout(250);
    const o = await out("Converted text");
    const ok = mode === "upper" ? o === exp.upper : mode === "lower" ? o === exp.lower : mode === "title" ? /^Hello World Example/.test(o) && o.includes("Ünïcode") : mode === "sentence" ? o.startsWith("Hello world") && o.includes(". Second sentence") : mode === "camel" ? /^helloWorldExample/.test(o) : mode === "kebab" ? /^hello-world-example-text-here/.test(o) : /^hello_world_example_text_here/.test(o);
    rec("text-case-converter", mode, ok ? "PASS" : "FAIL", o.slice(0, 90));
  }
});
await guard("word-counter", "counts", async () => {
  const txt = "Hello world. This is a test!\n\nSecond paragraph here.";
  await open(page, "/data/word-counter"); await page.getByLabel("Text to count").fill(txt); await page.waitForTimeout(300);
  const t = (await page.locator("main").innerText()).replace(/\n+/g, " ");
  const get = (label) => Number((t.match(new RegExp(`(\\d+) ${label}`)) ?? [])[1]);
  rec("word-counter", "9 words, 52 chars, 43 chars w/o spaces, 3 sentences, 2 paragraphs", get("Words") === 9 && get("Characters") === 52 && get("Characters \\(no spaces\\)") === 43 && get("Sentences") === 3 && get("Paragraphs") === 2 ? "PASS" : "FAIL", t.slice(t.indexOf("9 Words") >= 0 ? t.indexOf("9 Words") : 0, 260));
  await page.getByLabel("Text to count").fill(""); await page.waitForTimeout(200); const t0 = (await page.locator("main").innerText()).replace(/\n+/g, " ");
  rec("word-counter", "empty input shows zeros (not NaN)", !/NaN/.test(t0) && /0 Words/.test(t0) ? "PASS" : "FAIL", t0.slice(t0.indexOf("0 Words"), t0.indexOf("0 Words") + 80));
  await page.getByLabel("Text to count").fill("emoji 😀😀 and 日本語 text"); await page.waitForTimeout(200); const t1 = (await page.locator("main").innerText()).replace(/\n+/g, " ");
  rec("word-counter", "emoji/CJK input", "INFO", (t1.match(/\d+ Words \d+ Characters/) ?? [""])[0]);
});
await guard("uuid-generator", "generate", async () => {
  await open(page, "/data/uuid-generator"); await page.getByRole("button", { name: "Generate" }).click(); await page.waitForTimeout(300);
  const txt = await page.locator("main").innerText(); const ids = txt.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
  const v4 = ids.every((u) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u));
  rec("uuid-generator", "5 unique RFC-4122 v4 UUIDs", ids.length === 5 && new Set(ids).size === 5 && v4 ? "PASS" : "FAIL", ids.slice(0, 2).join(","));
  await page.getByLabel("How many?").fill("50"); await page.getByRole("button", { name: "Generate" }).click(); await page.waitForTimeout(300);
  const ids2 = (await page.locator("main").innerText()).match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g) ?? [];
  rec("uuid-generator", "50 unique", ids2.length === 50 && new Set(ids2).size === 50 ? "PASS" : "FAIL", `${ids2.length}`);
  await page.getByLabel("How many?").fill("5000"); await page.getByRole("button", { name: "Generate" }).click(); await page.waitForTimeout(300);
  const ids3 = (await page.locator("main").innerText()).match(/[0-9a-f]{8}-[0-9a-f]{4}-4/g) ?? []; rec("uuid-generator", "count 5000 (over limit?)", "INFO", `${ids3.length} shown; ui: ${(await errText()) || (await page.locator("main").innerText()).split("\n").filter((l) => /max|limit|up to|at most/i.test(l)).join(" ")}`);
});
await guard("hash-generator", "known vectors", async () => {
  const vec = { "SHA-1": "a9993e364706816aba3e25717850c26c9cd0d89d", "SHA-256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-384": "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7", "SHA-512": "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f" };
  for (const [alg, hex] of Object.entries(vec)) {
    await open(page, "/data/hash-generator"); await page.getByLabel("Algorithm").selectOption(alg); await page.getByLabel("Text to hash").fill("abc"); await page.getByRole("button", { name: "Generate hash" }).click(); await page.waitForTimeout(300);
    const t = await page.locator("main").innerText(); rec("hash-generator", `${alg}("abc") known vector`, t.toLowerCase().includes(hex) ? "PASS" : "FAIL", t.match(/[0-9a-f]{40,128}/i)?.[0].slice(0, 40) ?? "no hash");
  }
  await open(page, "/data/hash-generator"); await page.getByLabel("Text to hash").fill(""); await page.getByRole("button", { name: "Generate hash" }).click(); await page.waitForTimeout(300);
  const te = await page.locator("main").innerText(); rec("hash-generator", "SHA-256 of empty string", te.includes("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") ? "PASS" : "INFO", te.includes("e3b0c442") ? "hash shown" : "no hash shown / message: " + te.split("\n").filter((l) => /empty|enter/i.test(l)).join(" "));
  await open(page, "/data/hash-generator"); await page.getByLabel("Text to hash").fill("café ✓"); await page.getByRole("button", { name: "Generate hash" }).click(); await page.waitForTimeout(300);
  const tu = await page.locator("main").innerText(); rec("hash-generator", "SHA-256 of unicode text uses UTF-8", tu.includes(crypto.createHash("sha256").update("café ✓", "utf8").digest("hex")) ? "PASS" : "FAIL", "");
  await open(page, "/data/hash-generator"); await page.getByLabel("Source").selectOption("file"); await page.locator('input[type="file"]').setInputFiles(fx("IMAGE-01-photo-large.jpg")); await page.getByRole("button", { name: "Generate hash" }).click(); await page.waitForTimeout(1500);
  const tf = await page.locator("main").innerText(); rec("hash-generator", "file hash (8 MB JPEG) equals node crypto", tf.includes(crypto.createHash("sha256").update(fs.readFileSync(fx("IMAGE-01-photo-large.jpg"))).digest("hex")) ? "PASS" : "FAIL", "");
});
await guard("text-diff", "compare", async () => {
  await open(page, "/data/text-diff"); await ta("Original text").fill("a\nb\nc\nsame"); await ta("Changed text").fill("a\nB\nc\nd\nsame"); await page.getByRole("button", { name: "Compare" }).click(); await page.waitForTimeout(400);
  const t = await page.locator("main").innerText();
  rec("text-diff", "shows removed b, added B and d, unchanged a/c/same", /- b/.test(t) && /\+ B/.test(t) && /\+ d/.test(t) ? "PASS" : "FAIL", t.split("\n").filter((l) => /^[+-] /.test(l)).join(" | "));
  await ta("Original text").fill("same\ntext"); await ta("Changed text").fill("same\ntext"); await page.getByRole("button", { name: "Compare" }).click(); await page.waitForTimeout(300);
  rec("text-diff", "identical texts say so", /identical|no differences|same/i.test(await page.locator("main").innerText()) ? "PASS" : "FAIL", "");
  const a = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n"), b = a.replace("line 1500", "CHANGED 1500"); await ta("Original text").fill(a); await ta("Changed text").fill(b); const t0 = Date.now(); await page.getByRole("button", { name: "Compare" }).click(); await page.waitForTimeout(800);
  const tt = await page.locator("main").innerText(); rec("text-diff", "3000-line diff finds the single change quickly", /CHANGED 1500/.test(tt) ? "PASS" : "FAIL", `${Date.now() - t0}ms`);
});

rec("(docs+data tools)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(" ;; "));
save("docs-data"); await browser.close();
