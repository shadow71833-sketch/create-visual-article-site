import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {validateArticlePackage} from "../lib/content-model.mjs";
import {migrateArticlePackageV1, migrateSourceSnapshotV1} from "../migrate-v1-to-v2.mjs";

const fixtureUrl = new URL("./fixtures/article-package.json", import.meta.url);
const snapshotUrl = new URL("./fixtures/source-snapshot.json", import.meta.url);

test("migrates v1 inputs deterministically while flagging legacy AI provenance", async () => {
  const packageV1 = JSON.parse(await readFile(fixtureUrl, "utf8"));
  packageV1.version = 1;
  for (const metric of packageV1.onePage.metrics) delete metric.factIds;
  for (const module of packageV1.onePage.modules) for (const item of module.items) delete item.factIds;
  delete packageV1.comic.pages[0].panelIds;
  delete packageV1.comic.pages[0].subtitles[0].panelId;
  delete packageV1.sourceManifest.assets[0].generationMethod;
  delete packageV1.sourceManifest.assets[0].createdFor;
  const snapshotV1 = JSON.parse(await readFile(snapshotUrl, "utf8"));
  snapshotV1.version = 1;

  const migratedPackage = migrateArticlePackageV1(packageV1);
  const migratedSnapshot = migrateSourceSnapshotV1(snapshotV1);

  assert.equal(migratedPackage.version, 2);
  assert.equal(migratedSnapshot.version, 2);
  assert.equal(migratedPackage.sourceManifest.assets[0].generationMethod, "legacy-unverified");
  assert.equal(migratedPackage.migration.requiresManualReview, true);
  assert.equal(validateArticlePackage(migratedPackage).length, 0);
});
