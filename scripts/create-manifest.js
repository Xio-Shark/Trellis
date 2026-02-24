#!/usr/bin/env node
/**
 * Create migration manifest for a new version.
 *
 * Usage:
 *   node scripts/create-manifest.js                          # interactive
 *   node scripts/create-manifest.js --breaking
 *   node scripts/create-manifest.js --version 0.3.0-rc.0
 *   node scripts/create-manifest.js -y --description "..." --changelog "..."  # non-interactive
 *
 * Non-interactive mode (-y):
 *   When -y is passed, all values are taken from CLI flags (no prompts).
 *   --version defaults to next prerelease from package.json.
 *   --description and --changelog are required in -y mode.
 *   --notes overrides the auto-generated notes field.
 *
 * Interactive prompts will ask for:
 *   - Version (default: next prerelease from package.json)
 *   - Description
 *   - Changelog
 *   - Breaking change (y/n)
 *
 * Version suggestion logic:
 *   beta.N  → beta.(N+1)    (also shows rc.0 hint)
 *   rc.N    → rc.(N+1)      (also shows release hint)
 *   X.Y.Z   → X.Y.(Z+1)-beta.0
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFESTS_DIR = path.join(__dirname, "../src/migrations/manifests");

function readPackageVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../package.json"), "utf-8")
  );
  return pkg.version;
}

function getNextVersion(currentVersion) {
  // beta.N → next beta
  const betaMatch = currentVersion.match(/^(\d+\.\d+\.\d+)-beta\.(\d+)$/);
  if (betaMatch) {
    const base = betaMatch[1];
    const next = parseInt(betaMatch[2], 10) + 1;
    return { suggested: `${base}-beta.${next}`, hint: `or ${base}-rc.0 to promote to RC` };
  }
  // rc.N → next rc
  const rcMatch = currentVersion.match(/^(\d+\.\d+\.\d+)-rc\.(\d+)$/);
  if (rcMatch) {
    const base = rcMatch[1];
    const next = parseInt(rcMatch[2], 10) + 1;
    return { suggested: `${base}-rc.${next}`, hint: `or ${base} to release` };
  }
  // stable X.Y.Z → next patch beta
  const stableMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (stableMatch) {
    const [, major, minor, patch] = stableMatch;
    const nextPatch = `${major}.${minor}.${parseInt(patch, 10) + 1}`;
    return { suggested: `${nextPatch}-beta.0`, hint: null };
  }
  return { suggested: currentVersion, hint: null };
}

function getArgValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

function askQuestion(rl, question, defaultValue = "") {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const nonInteractive = args.includes("-y");
  const isBreaking = args.includes("--breaking");
  const versionArg = getArgValue(args, "--version");
  const descriptionArg = getArgValue(args, "--description");
  const changelogArg = getArgValue(args, "--changelog");
  const notesArg = getArgValue(args, "--notes");

  const currentVersion = readPackageVersion();
  const { suggested, hint } = getNextVersion(currentVersion);

  // --- Non-interactive mode ---
  if (nonInteractive) {
    if (!descriptionArg || !changelogArg) {
      console.error("Error: -y mode requires --description and --changelog");
      process.exit(1);
    }
    const version = versionArg || suggested;
    const manifestPath = path.join(MANIFESTS_DIR, `${version}.json`);

    const manifest = {
      version,
      description: descriptionArg,
      breaking: isBreaking,
      recommendMigrate: isBreaking,
      changelog: changelogArg,
      migrations: [],
      notes: notesArg || (isBreaking
        ? "Review changelog and run with --migrate if needed."
        : "No migration required."),
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`✅ Created: ${manifestPath}`);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  // --- Interactive mode ---
  const suggestedVersion = versionArg || suggested;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n📝 Create Migration Manifest\n");
  console.log(`Current package.json version: ${currentVersion}`);
  if (!versionArg && hint) {
    console.log(`Hint: ${hint}`);
  }
  console.log("");

  try {
    // Get version
    const version = await askQuestion(rl, "Version", suggestedVersion);

    // Check if manifest already exists
    const manifestPath = path.join(MANIFESTS_DIR, `${version}.json`);
    if (fs.existsSync(manifestPath)) {
      console.log(`\n⚠️  Manifest already exists: ${manifestPath}`);
      const overwrite = await askQuestion(rl, "Overwrite? (y/n)", "n");
      if (overwrite.toLowerCase() !== "y") {
        console.log("Cancelled.");
        rl.close();
        return;
      }
    }

    // Get description
    const description = descriptionArg || await askQuestion(rl, "Description (short)");

    // Get changelog
    const changelog = changelogArg || await askQuestion(rl, "Changelog (one line summary)");

    // Get breaking status
    let breaking = isBreaking;
    if (!isBreaking) {
      const breakingAnswer = await askQuestion(rl, "Breaking change? (y/n)", "n");
      breaking = breakingAnswer.toLowerCase() === "y";
    }

    // Get recommend migrate
    let recommendMigrate = false;
    if (breaking) {
      const migrateAnswer = await askQuestion(rl, "Recommend --migrate? (y/n)", "y");
      recommendMigrate = migrateAnswer.toLowerCase() === "y";
    }

    // Build manifest
    const manifest = {
      version,
      description,
      breaking,
      recommendMigrate,
      changelog,
      migrations: [],
      notes: notesArg || (breaking
        ? "Review changelog and run with --migrate if needed."
        : "No migration required."),
    };

    // Write manifest
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    console.log(`\n✅ Created: ${manifestPath}`);
    console.log("\nManifest content:");
    console.log(JSON.stringify(manifest, null, 2));

    // Detect release type for next steps hint
    const releaseCmd = version.includes("-beta.") ? "pnpm release:beta" : version.includes("-rc.") ? "pnpm release:rc" : "pnpm release";

    console.log("\n📋 Next steps:");
    console.log(`  1. Edit ${version}.json if needed (add migrations, migrationGuide, etc.)`);
    console.log(`  2. ${releaseCmd}`);
  } finally {
    rl.close();
  }
}

main().catch(console.error);
