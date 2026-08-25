import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {buildSite} from "./build-site.mjs";
import {verifyOutput} from "./verify-output.mjs";
import {assertApprovedDescendant, atomicWriteFile} from "./lib/security.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const showcaseRoot = path.join(repositoryRoot, "examples", "showcase");

export async function buildDemo({approvedRoot, outputPath} = {}) {
  const resolvedApproved = path.resolve(approvedRoot);
  const resolvedOutput = assertApprovedDescendant(resolvedApproved, path.resolve(outputPath));
  const result = await buildSite({
    inputPath: path.join(showcaseRoot, "article-package.json"),
    sourceSnapshotPath: path.join(showcaseRoot, "source-snapshot.json"),
    approvedOutputRoot: resolvedApproved,
    outputPath: resolvedOutput,
  });
  const verification = await verifyOutput(resolvedOutput);
  await atomicWriteFile(path.join(resolvedOutput, "verification-report.json"), `${JSON.stringify(verification, null, 2)}\n`, {mode: 0o644});
  if (!verification.ok) {
    throw new Error(`showcase verification failed: ${verification.errors.map(({message}) => message).join("; ")}`);
  }
  return {...result, verification};
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new TypeError("Usage: node build-demo.mjs --approved-root <directory> --output <directory>");
    }
    result[flag.slice(2)] = value;
  }
  return result;
}

async function main(argv) {
  const args = parseArgs(argv);
  const result = await buildDemo({approvedRoot: args["approved-root"], outputPath: args.output});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
