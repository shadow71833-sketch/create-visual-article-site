import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {buildDemo} from "../build-demo.mjs";

test("builds and verifies the complete showcase", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-demo-"));
  try {
    const outputPath = path.join(root, "site");
    const result = await buildDemo({approvedRoot: root, outputPath});
    assert.equal(result.outputPath, outputPath);
    assert.equal(result.verification.ok, true);
    assert.equal(result.verification.metrics.views, 3);
    assert.equal(result.verification.metrics.textCoverage, 1);
    assert.equal(result.verification.metrics.sectionCoverage, 1);
    assert.equal(result.verification.metrics.onePageFactCoverage, 1);
    assert.equal(result.verification.metrics.comicFactCoverage, 1);
    assert.equal(result.verification.metrics.comicPages, 2);
    assert.equal(result.verification.metrics.comicPanels, 8);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
