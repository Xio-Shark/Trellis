#!/usr/bin/env node
/**
 * Create migration manifest for a new version.
 *
 * Usage:
 *   node scripts/create-manifest.js
 *   node scripts/create-manifest.js --breaking
 *   node scripts/create-manifest.js --version 0.3.0-beta.9
 *
 * Interactive prompts will ask for:
 *   - Version (default: next beta from package.json)
 *   - Description
 *   - Changelog
 *   - Breaking change (y/n)
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

function getNextBetaVersion(currentVersion) {
  // Parse current version like "0.3.0-beta.7"
  const match = currentVersion.match(/^(\d+\.\d+\.\d+)-beta\.(\d+)$/);
  if (match) {
    const base = match[1];
    const betaNum = parseInt(match[2], 10) + 1;
    return `${base}-beta.${betaNum}`;
  }
  // If not beta, suggest beta.0
  const baseMatch = currentVersion.match(/^(\d+\.\d+\.\d+)/);
  if (baseMatch) {
    return `${baseMatch[1]}-beta.0`;
  }
  return currentVersion;
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
  const isBreaking = args.includes("--breaking");
  const versionArgIndex = args.indexOf("--version");
  const versionArg = versionArgIndex !== -1 ? args[versionArgIndex + 1] : null;

  const currentVersion = readPackageVersion();
  const suggestedVersion = versionArg || getNextBetaVersion(currentVersion);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n📝 Create Migration Manifest\n");
  console.log(`Current package.json version: ${currentVersion}`);
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
    const description = await askQuestion(rl, "Description (short)");

    // Get changelog
    const changelog = await askQuestion(rl, "Changelog (one line summary)");

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
      notes: breaking
        ? "Review changelog and run with --migrate if needed."
        : "No migration required.",
    };

    // Write manifest
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    console.log(`\n✅ Created: ${manifestPath}`);
    console.log("\nManifest content:");
    console.log(JSON.stringify(manifest, null, 2));

    console.log("\n📋 Next steps:");
    console.log(`  1. Edit ${version}.json if needed (add migrations, migrationGuide, etc.)`);
    console.log("  2. git add && git commit");
    console.log("  3. pnpm release:beta");
  } finally {
    rl.close();
  }
}

main().catch(console.error);
