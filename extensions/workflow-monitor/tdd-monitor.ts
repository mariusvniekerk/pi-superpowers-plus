import fs from "node:fs";
import { findCorrespondingTestFile, isSourceFile, isTestFile } from "./heuristics";

export type TddPhase = "idle" | "red-pending" | "red" | "green" | "refactor";

export interface TddViolation {
  type: "source-before-test" | "source-during-red";
  file: string;
}

export class TddMonitor {
  private phase: TddPhase = "idle";
  private testFilesWritten = new Set<string>();
  private sourceFilesWritten = new Set<string>();
  private redVerificationPending = false;
  private fileExists: (path: string) => boolean;

  constructor(fileExists?: (path: string) => boolean) {
    this.fileExists = fileExists ?? ((filePath) => fs.existsSync(filePath));
  }

  getPhase(): TddPhase {
    return this.phase;
  }

  isRedVerificationPending(): boolean {
    return this.phase === "red-pending" && this.redVerificationPending;
  }

  onFileWritten(path: string): TddViolation | null {
    if (isTestFile(path)) {
      this.testFilesWritten.add(path);
      this.phase = "red-pending";
      this.redVerificationPending = true;
      return null;
    }

    if (isSourceFile(path)) {
      this.sourceFilesWritten.add(path);

      if (this.testFilesWritten.size === 0) {
        const existingTestFile = findCorrespondingTestFile(path).some((candidatePath) =>
          this.fileExists(candidatePath),
        );
        if (!existingTestFile) {
          return { type: "source-before-test", file: path };
        }
        return null;
      }

      if (this.phase === "red-pending") {
        return { type: "source-during-red", file: path };
      }

      if (this.phase === "green") {
        this.phase = "refactor";
      }
      // red phase: source edits allowed (making the failing test pass), stay in red
      return null;
    }

    return null;
  }

  onTestResult(passed: boolean): void {
    if (this.phase === "red-pending") {
      this.redVerificationPending = false;
      if (passed) {
        this.phase = "green";
      } else {
        this.phase = "red";
      }
      return;
    }

    if (passed && (this.phase === "red" || this.phase === "refactor")) {
      this.phase = "green";
    }
  }

  onCommit(): void {
    this.phase = "idle";
    this.redVerificationPending = false;
    this.testFilesWritten.clear();
    this.sourceFilesWritten.clear();
  }

  setState(phase: TddPhase, testFiles: string[], sourceFiles: string[], redVerificationPending = false): void {
    this.phase = phase;
    this.testFilesWritten = new Set(testFiles);
    this.sourceFilesWritten = new Set(sourceFiles);
    this.redVerificationPending = redVerificationPending;
  }

  getState(): {
    phase: TddPhase;
    testFiles: string[];
    sourceFiles: string[];
    redVerificationPending: boolean;
  } {
    return {
      phase: this.phase,
      testFiles: [...this.testFilesWritten],
      sourceFiles: [...this.sourceFilesWritten],
      redVerificationPending: this.redVerificationPending,
    };
  }
}
