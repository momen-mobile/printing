import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { parseAnyEstWorkbook } from "../est-rounds";

describe("parseAnyEstWorkbook", () => {
  it("automatically detects and splits unified master sheet into EST 1 and EST 2", () => {
    const csvPath = path.join(process.cwd(), "src/lib/assets/Stats-per-Room.csv");
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const wb = XLSX.read(csvContent, { type: "string" });

    const result = parseAnyEstWorkbook(wb, "Stats-per-Room.xlsx");

    expect(result.isCombined).toBe(true);
    expect(result.est1).toBeDefined();
    expect(result.est2).toBeDefined();

    // Verify EST 1
    const est1 = result.est1!;
    expect(est1.examType).toBe("EST 1");
    expect(est1.rows.length).toBe(334);
    expect(est1.stats.totalStudents).toBe(6692);
    expect(est1.stats.subjectTotals.LIT).toBe(6692);
    expect(est1.stats.subjectTotals.MATH).toBe(6692);
    expect(est1.stats.subjectTotals.ESSAY).toBe(24);

    // Verify EST 2
    const est2 = result.est2!;
    expect(est2.examType).toBe("EST 2");
    expect(est2.rows.length).toBe(148);
    expect(est2.stats.totalStudents).toBe(3067);
    expect(est2.stats.subjectTotals.MATH1).toBe(2043);
    expect(est2.stats.subjectTotals.MATH2).toBe(66);
    expect(est2.stats.subjectTotals.BIO).toBe(2227);
    expect(est2.stats.subjectTotals.CHEM).toBe(5);
  });
});

