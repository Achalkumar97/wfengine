/**
 * Optional path selection for `github.files.read` when merged data includes
 * `sourceFiles` (e.g. from `github.repo.analyze`).
 */

const SOURCE_EXT =
  /\.(py|pyi|ts|tsx|js|jsx|mjs|cjs|go|java|rs|cs|kt|kts|rb|php|swift|cpp|cc|cxx|h|hpp|c)$/i;

function isTestLikePath(p: string): boolean {
  const n = p.replace(/\\/g, "/").toLowerCase();
  return (
    n.includes("__tests__") ||
    n.includes("/test/") ||
    n.includes("/tests/") ||
    n.includes(".test.") ||
    n.includes(".spec.") ||
    n.endsWith("_test.py") ||
    n.endsWith("_test.go") ||
    /\/spec\//.test(n)
  );
}

function isVendorOrBuildPath(p: string): boolean {
  const n = p.replace(/\\/g, "/").toLowerCase();
  return (
    n.includes("node_modules/") ||
    n.includes("/vendor/") ||
    n.includes("/.git/") ||
    n.includes("/dist/") ||
    n.includes("/build/") ||
    n.includes("/target/") ||
    n.includes("/__pycache__/") ||
    n.endsWith(".min.js")
  );
}

export function isProbableApplicationSourcePath(path: string): boolean {
  if (isTestLikePath(path) || isVendorOrBuildPath(path)) return false;
  return SOURCE_EXT.test(path);
}

const CORE_SEGMENTS = new Set([
  "src",
  "core",
  "lib",
  "services",
  "utils",
  "engines",
  "pkg",
  "internal",
  "app",
  "packages",
  "python",
  "typescript",
  "golang",
  "java",
  "rust",
]);

/** Higher score = more "core" application code paths. */
export function scoreCorePath(path: string): number {
  let score = 0;
  const norm = path.replace(/\\/g, "/");
  const segments = norm.split("/").filter(Boolean);
  for (const seg of segments) {
    const low = seg.toLowerCase();
    if (CORE_SEGMENTS.has(low)) score += 6;
  }
  if (/\/(src|lib|core|services|utils|engines|pkg|internal)\//i.test(norm)) {
    score += 4;
  }
  return score;
}

export function sortPathsCorePriority(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const d = scoreCorePath(b) - scoreCorePath(a);
    if (d !== 0) return d;
    return a.localeCompare(b);
  });
}
