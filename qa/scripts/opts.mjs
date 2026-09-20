import { chromium } from "@playwright/test";
const b = await chromium.launch(); const p = await b.newPage();
for (const r of ["json-formatter","xml-formatter","base64","url-encode-decode","case-converter","hash-generator"]) { await p.goto("http://localhost:3000/data/"+r); console.log(r, JSON.stringify(await p.locator("main select").evaluateAll(els=>els.map(e=>[...e.options].map(o=>o.value+"="+o.text)))));}
await p.goto("http://localhost:3000/data/text-diff"); await p.locator("textarea").nth(0).fill("a\nb\nc"); await p.locator("textarea").nth(1).fill("a\nB\nc\nd"); await p.getByRole("button",{name:"Compare"}).click(); await p.waitForTimeout(500); console.log((await p.locator("main").innerText()).slice(200,700));
await p.goto("http://localhost:3000/data/word-counter"); await p.locator("textarea").fill("Hello world. This is a test!\n\nSecond paragraph here."); await p.waitForTimeout(300); console.log((await p.locator("main").innerText()).slice(150,500));
await b.close();
