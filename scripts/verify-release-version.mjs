#!/usr/bin/env node
/**
 * Release version contract: the tag that triggered the release workflow must
 * equal `v${@viskod/cli version}`. packages/cli/package.json is the publishable
 * version authority (the release workflow publishes that package), so a tag
 * naming any other version is an error — there is no fallback or warning mode.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLI_PACKAGE_JSON = resolve(ROOT, 'packages/cli/package.json');

function fail(message) {
  console.error(`[verify-release-version] ${message}`);
  process.exit(1);
}

const tag = process.argv[2];
if (!tag) {
  fail('missing tag argument: expected `node scripts/verify-release-version.mjs v<version>`');
}
if (!/^v[0-9]+\.[0-9]+\.[0-9]+/.test(tag)) {
  fail(
    `malformed tag "${tag}": tags must start with a "v" prefix followed by a semver version (e.g. v0.2.2-alpha)`,
  );
}

let cliPackage;
try {
  cliPackage = JSON.parse(readFileSync(CLI_PACKAGE_JSON, 'utf8'));
} catch (error) {
  fail(`could not read ${CLI_PACKAGE_JSON}: ${error.message}`);
}
if (!cliPackage || typeof cliPackage.version !== 'string' || !cliPackage.version) {
  fail(`missing or invalid version field in ${CLI_PACKAGE_JSON}`);
}

const expected = `v${cliPackage.version}`;
if (tag !== expected) {
  fail(
    `tag "${tag}" does not match the publishable package version ${expected} (@viskod/cli). Refusing to publish a package whose version disagrees with the triggering tag.`,
  );
}

console.log(`[verify-release-version] OK: tag ${tag} matches @viskod/cli@${cliPackage.version}`);
