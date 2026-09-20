import { liveTools, allTools } from "../../src/lib/tools/registry";
console.log(`all=${allTools.length} live=${liveTools.length}`);
for (const t of liveTools) console.log([t.category, t.id, t.href, t.status].join("\t"));
