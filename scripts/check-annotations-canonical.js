#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const repoRoot = process.cwd();
const annotationsPath = path.join(repoRoot, "annotations-live.json");

function fail(message) {
  process.stderr.write(`pre-push guard failed: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(annotationsPath)) {
  fail("annotations-live.json is missing.");
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(annotationsPath, "utf8"));
} catch (error) {
  fail(`annotations-live.json is invalid JSON (${error.message}).`);
}

const pins = parsed?.annotations?.pins;
if (!Array.isArray(pins) || pins.length <= 0) {
  fail("annotations-live.json must contain annotations.pins with at least one pin.");
}

process.stdout.write("pre-push guard passed: annotations-live.json JSON is valid.\n");
