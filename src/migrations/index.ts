/**
 * Migration manifests for Trellis versions
 *
 * Each version's migrations are stored in separate JSON files under manifests/
 * Format: manifests/{version}.json (e.g., manifests/0.1.9.json)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MigrationItem, MigrationManifest } from "../types/migration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFESTS_DIR = path.join(__dirname, "manifests");

/**
 * Cache for loaded manifests
 */
let manifestCache: Record<string, MigrationManifest> | null = null;

/**
 * Load all migration manifests from JSON files
 */
function loadManifests(): Record<string, MigrationManifest> {
  if (manifestCache) {
    return manifestCache;
  }

  const manifests: Record<string, MigrationManifest> = {};

  // Check if manifests directory exists
  if (!fs.existsSync(MANIFESTS_DIR)) {
    manifestCache = manifests;
    return manifests;
  }

  // Load all JSON files from manifests directory
  const files = fs.readdirSync(MANIFESTS_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const filePath = path.join(MANIFESTS_DIR, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const manifest = JSON.parse(content) as MigrationManifest;

      // Use version from manifest as key
      if (manifest.version) {
        manifests[manifest.version] = manifest;
      }
    } catch {
      // Skip invalid manifest files
      console.warn(`Warning: Failed to load migration manifest ${file}`);
    }
  }

  manifestCache = manifests;
  return manifests;
}

/**
 * Compare two semver versions (handles prerelease versions)
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 *
 * Semver rules:
 * - 0.3.0-beta.1 < 0.3.0 (prerelease is less than release)
 * - 0.3.0-alpha < 0.3.0-beta (alphabetically)
 * - 0.3.0-beta.1 < 0.3.0-beta.2 (numerically)
 */
function compareVersions(a: string, b: string): number {
  // Split into base version and prerelease parts
  const [aBase, aPrerelease] = a.split("-", 2);
  const [bBase, bPrerelease] = b.split("-", 2);

  // Parse base version (only numeric parts before any hyphen)
  const parseBase = (v: string): number[] =>
    v.split(".").map((n) => parseInt(n, 10) || 0);

  const aBaseParts = parseBase(aBase);
  const bBaseParts = parseBase(bBase);
  const maxBaseLen = Math.max(aBaseParts.length, bBaseParts.length);

  // Compare base versions first
  for (let i = 0; i < maxBaseLen; i++) {
    const aVal = aBaseParts[i] ?? 0;
    const bVal = bBaseParts[i] ?? 0;
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
  }

  // Base versions are equal, compare prerelease
  // No prerelease > prerelease (1.0.0 > 1.0.0-beta)
  if (!aPrerelease && bPrerelease) return 1;
  if (aPrerelease && !bPrerelease) return -1;
  if (!aPrerelease && !bPrerelease) return 0;

  // Both have prerelease, compare them (guaranteed non-null by checks above)
  // Split prerelease by dots and compare each part
  const aPre = (aPrerelease as string).split(".");
  const bPre = (bPrerelease as string).split(".");
  const maxPreLen = Math.max(aPre.length, bPre.length);

  for (let i = 0; i < maxPreLen; i++) {
    const aP = aPre[i];
    const bP = bPre[i];

    // Missing part means shorter prerelease comes first
    if (aP === undefined) return -1;
    if (bP === undefined) return 1;

    // Try numeric comparison first
    const aNum = parseInt(aP, 10);
    const bNum = parseInt(bP, 10);
    const aIsNum = !isNaN(aNum) && String(aNum) === aP;
    const bIsNum = !isNaN(bNum) && String(bNum) === bP;

    // Numeric identifiers have lower precedence than string identifiers
    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;

    if (aIsNum && bIsNum) {
      if (aNum < bNum) return -1;
      if (aNum > bNum) return 1;
    } else {
      // String comparison
      if (aP < bP) return -1;
      if (aP > bP) return 1;
    }
  }

  return 0;
}

/**
 * Get all migrations needed to upgrade from one version to another
 *
 * @param fromVersion - Current installed version
 * @param toVersion - Target version to upgrade to
 * @returns Array of migration items to apply, in version order
 */
export function getMigrationsForVersion(
  fromVersion: string,
  toVersion: string
): MigrationItem[] {
  const manifests = loadManifests();

  // Get all versions that have migrations
  const versions = Object.keys(manifests).sort(compareVersions);

  // Filter to versions > fromVersion and <= toVersion
  const applicableVersions = versions.filter((v) => {
    const afterFrom = compareVersions(v, fromVersion) > 0;
    const atOrBeforeTo = compareVersions(v, toVersion) <= 0;
    return afterFrom && atOrBeforeTo;
  });

  // Collect all migrations from applicable versions
  const allMigrations: MigrationItem[] = [];
  for (const version of applicableVersions) {
    const manifest = manifests[version];
    if (manifest) {
      allMigrations.push(...manifest.migrations);
    }
  }

  return allMigrations;
}

/**
 * Check if there are any pending migrations between versions
 */
export function hasPendingMigrations(
  fromVersion: string,
  toVersion: string
): boolean {
  return getMigrationsForVersion(fromVersion, toVersion).length > 0;
}

/**
 * Get human-readable summary of pending migrations
 */
export function getMigrationSummary(
  fromVersion: string,
  toVersion: string
): { renames: number; deletes: number } {
  const migrations = getMigrationsForVersion(fromVersion, toVersion);
  return {
    renames: migrations.filter((m) => m.type === "rename").length,
    deletes: migrations.filter((m) => m.type === "delete").length,
  };
}

/**
 * Get all registered migration versions
 */
export function getAllMigrationVersions(): string[] {
  const manifests = loadManifests();
  return Object.keys(manifests).sort(compareVersions);
}

/**
 * Get ALL migrations from all manifests (regardless of version)
 * Used for detecting orphaned migrations that should have been applied
 */
export function getAllMigrations(): MigrationItem[] {
  const manifests = loadManifests();
  const allMigrations: MigrationItem[] = [];
  for (const manifest of Object.values(manifests)) {
    allMigrations.push(...manifest.migrations);
  }
  return allMigrations;
}

/**
 * Clear the manifest cache (useful for testing)
 */
export function clearManifestCache(): void {
  manifestCache = null;
}

/**
 * Get aggregated metadata for migrations between versions
 * Returns combined changelog, breaking status, migrate recommendation, and migration guides
 */
export function getMigrationMetadata(
  fromVersion: string,
  toVersion: string
): {
  changelog: string[];
  breaking: boolean;
  recommendMigrate: boolean;
  migrationGuides: { version: string; guide: string; aiInstructions?: string }[];
} {
  const manifests = loadManifests();
  const versions = Object.keys(manifests).sort(compareVersions);

  // Filter to versions > fromVersion and <= toVersion
  const applicableVersions = versions.filter((v) => {
    const afterFrom = compareVersions(v, fromVersion) > 0;
    const atOrBeforeTo = compareVersions(v, toVersion) <= 0;
    return afterFrom && atOrBeforeTo;
  });

  const result = {
    changelog: [] as string[],
    breaking: false,
    recommendMigrate: false,
    migrationGuides: [] as { version: string; guide: string; aiInstructions?: string }[],
  };

  for (const version of applicableVersions) {
    const manifest = manifests[version];
    if (manifest) {
      if (manifest.changelog) {
        result.changelog.push(`v${version}: ${manifest.changelog}`);
      }
      if (manifest.breaking) {
        result.breaking = true;
      }
      if (manifest.recommendMigrate) {
        result.recommendMigrate = true;
      }
      if (manifest.migrationGuide) {
        result.migrationGuides.push({
          version,
          guide: manifest.migrationGuide,
          aiInstructions: manifest.aiInstructions,
        });
      }
    }
  }

  return result;
}
