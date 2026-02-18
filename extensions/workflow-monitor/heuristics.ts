import path from "node:path";

const TEST_PATTERNS = [
  /\.(test|spec)\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)$/,
  /(^|\/)tests?\//,
  /\/__tests__\//,
  /^test_\w+\.py$/,
  /\/test_\w+\.py$/,
  /\w+_test\.py$/,
  /\w+_test\.go$/,
];

const SOURCE_EXTENSIONS = /\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)$/;

const CONFIG_PATTERNS = [
  /\.config\.(ts|js|mjs|cjs)$/,
  /^\./, // dotfiles
  /package\.json$/,
  /tsconfig.*\.json$/,
];

export function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(path));
}

export function isSourceFile(path: string): boolean {
  if (!SOURCE_EXTENSIONS.test(path)) return false;
  if (isTestFile(path)) return false;
  if (CONFIG_PATTERNS.some((p) => p.test(path))) return false;
  return true;
}

export function findCorrespondingTestFile(filePath: string): string[] {
  const parsed = path.posix.parse(filePath);
  const baseDir = parsed.dir;
  const stem = parsed.name;
  const ext = parsed.ext;

  if (!stem || !ext) return [];

  const candidates = [
    path.posix.join(baseDir, `${stem}.test${ext}`),
    path.posix.join(baseDir, `${stem}.spec${ext}`),
    path.posix.join(baseDir, "__tests__", `${stem}.test${ext}`),
    path.posix.join(baseDir, "__tests__", `${stem}.spec${ext}`),
  ];

  if (filePath.startsWith("src/")) {
    const relFromSrc = filePath.slice("src/".length);
    const relParsed = path.posix.parse(relFromSrc);
    candidates.push(
      path.posix.join("tests", relParsed.dir, `${relParsed.name}.test${relParsed.ext}`),
      path.posix.join("tests", relParsed.dir, `${relParsed.name}.spec${relParsed.ext}`),
    );
  }

  return candidates;
}
