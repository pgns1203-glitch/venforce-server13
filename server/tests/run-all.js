const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const testsDir = __dirname;
const skipped = new Set(String(process.env.TEST_SKIP || "").split(",").map((name) => name.trim()).filter(Boolean));
const files = fs.readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.js"))
  .filter((name) => !skipped.has(name))
  .sort();

for (const file of files) {
  process.stdout.write(`\n▸ tests/${file}\n`);
  const result = spawnSync(process.execPath, [path.join(testsDir, file)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`\n✓ ${files.length} arquivos de teste concluídos`);
