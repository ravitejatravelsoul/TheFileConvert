import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:3100/pdf-editor", { waitUntil: "networkidle" });
await p.getByTestId("file-input").first().setInputFiles("qa/real-user-fixtures/DOCUMENT-06-resume-native.pdf");
await p.getByTestId("page-surface").waitFor();
await p.waitForTimeout(1200);
await p.screenshot({ path: "qa/review/pdf-editor/_before-editor-desktop.png" });
// the user's flow: click an existing word, expect to edit it
const word = p.getByRole("button", { name: /^Edit text: .*Analyst with 8 years/ }).first();
console.log("region button count:", await word.count());
await word.dblclick();
await p.waitForTimeout(600);
await p.screenshot({ path: "qa/review/pdf-editor/_before-after-dblclick.png" });
console.log("dialog:", await p.getByRole("dialog").count(), "contenteditable/textarea:", await p.locator("[contenteditable=true], textarea").count());
await b.close();
