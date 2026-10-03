const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
let count = 0;
function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(cjs|js)$/.test(f.name)) {
      const r = spawnSync(process.execPath, ["--check", p], {
        stdio: "inherit",
      });
      if (r.status !== 0) process.exit(1);
      count++;
    }
  }
}
for (const dir of ["src", "scripts", "test"]) walk(dir);
console.log(`Syntax checked ${count} JavaScript files.`);
