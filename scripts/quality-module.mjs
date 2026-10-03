import { readFile } from "node:fs/promises";
import ts from "typescript";

// Compile the actual pure TypeScript modules for Node without adding a runtime
// dependency or placing test fixtures anywhere in the production bundle.
export async function qualityModule(
  url = new URL("../src/lib/quality/analyzer.ts", import.meta.url),
) {
  let output = ts.transpileModule(await readFile(url, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  for (const match of output.matchAll(/from ["'](\.\.?\/[^"']+)["']/g)) {
    const dependency = await qualityModule(new URL(`${match[1]}.ts`, url));
    output = output.replace(match[1], dependency);
  }
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}
