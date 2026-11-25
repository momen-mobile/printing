import * as XLSX from "xlsx";
import { prisma } from "./prisma";
import {
  OFFICIAL_EST_SCHOOLS,
  OFFICIAL_EST_CENTERS,
  stripGovernorateFromName,
} from "./stickers/est-reference-data";
import { getSubjectSortKey } from "./stickers/est-room-data";
import { isSameOrRedundantBuilding } from "./stickers/sticker-pdf";

export { getSubjectSortKey };

export interface EstRoundSubjectItem {
  code: string;
  name: string;
  count: number;
}

export interface EstRoundRow {
  id: string;
  index: number;
  governorate: string;
  center: string;
  floor: string;
  room: string;
  rawRoom: string;
  subjects: Record<string, number>;
  totalStudents: number;
  breakdownText: string;
}

export interface EstRoundSummaryStats {
  totalGovernorates: number;
  totalCenters: number;
  totalFloors: number;
  totalRooms: number;
  totalStudents: number;
  subjectTotals: Record<string, number>;
  governoratesList: string[];
  centersList: string[];
}

export interface ParsedEstRoundResult {
  examType: "EST 1" | "EST 2";
  sheetName: string;
  rows: EstRoundRow[];
  stats: EstRoundSummaryStats;
}

let ensureTablePromise: Promise<void> | null = null;

/**
 * Ensures the EstExamRound table exists in PostgreSQL.
 */
export async function ensureEstExamRoundTable(): Promise<void> {
  if (ensureTablePromise) return ensureTablePromise;
  ensureTablePromise = (async () => {
    try {
      // Test if table exists by querying 1 row
      await prisma.estExamRound.findFirst({ select: { id: true } });
      return;
    } catch (error: any) {
      const code = String(error?.code || "");
      const msg = String(error?.message || "").toLowerCase();
      const missing =
        code === "P2021" ||
        (msg.includes("relation") && msg.includes("does not exist")) ||
        msg.includes("estexamround");
      if (!missing) {
        throw error;
      }
    }

    // Best-effort runtime bootstrap for environments where migration hasn't been applied yet
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "EstExamRound" (
        "id" TEXT NOT NULL,
        "userId" TEXT,
        "name" TEXT NOT NULL,
        "examType" TEXT NOT NULL,
        "roundDate" TIMESTAMP(3),
        "roundDay" TEXT,
        "cycleName" TEXT,
        "fileName" TEXT,
        "sheetData" JSONB NOT NULL,
        "summaryStats" JSONB,
        "status" TEXT NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "EstExamRound_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EstExamRound_userId_idx" ON "EstExamRound"("userId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EstExamRound_examType_idx" ON "EstExamRound"("examType");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EstExamRound_status_idx" ON "EstExamRound"("status");`);
  })().catch((err) => {
    ensureTablePromise = null;
    throw err;
  });

  return ensureTablePromise;
}

/**
 * Normalizes a floor name into standard title case:
 * "3rd floor" -> "3rd Floor", "ground" -> "Ground"
 */
function normalizeFloorTitle(floorStr: string): string {
  const clean = floorStr.trim();
  if (/^ground$/i.test(clean)) return "Ground";
  if (/^basement$/i.test(clean)) return "Basement";
  if (/^mezzanine$/i.test(clean)) return "Mezzanine";
  const m = clean.match(/^(\d+(?:st|nd|rd|th))\s*(floor)?$/i);
  if (m) {
    return `${m[1]} Floor`;
  }
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extracts floor and room name from raw room text, e.g.:
 * "3rd floor 12A" -> { floor: "3rd Floor", room: "12A" }
 * "1st floor Room 1" -> { floor: "1st Floor", room: "Room 1" }
 * "Seniors-1" (at Hotep) -> { floor: "3rd Floor", room: "Senior1" }
 */
export function extractFloorAndRoom(
  rawRoom: string,
  centerName?: string,
): { floor: string; room: string } {
  if (!rawRoom) return { floor: "1st Floor", room: "Room" };
  const raw = rawRoom.trim();

  // 1. Regex: starts with floor pattern
  const floorMatch = raw.match(
    /^((?:(?:\d+(?:st|nd|rd|th))\s*floor|ground(?:\s*floor)?|basement|mezzanine))\s*(?:[-_:,]\s*)?(.*)$/i,
  );

  if (floorMatch) {
    const rawFl = floorMatch[1].trim();
    const rest = floorMatch[2].trim();
    return {
      floor: normalizeFloorTitle(rawFl),
      room: rest || raw,
    };
  }

  // 2. Check official definitions if centerName is known
  if (centerName) {
    const cleanCenter = stripGovernorateFromName(centerName).toLowerCase();
    const school = OFFICIAL_EST_SCHOOLS.find(
      (s) =>
        s.schoolName.toLowerCase() === cleanCenter ||
        s.fullFolderName.toLowerCase().includes(cleanCenter) ||
        cleanCenter.includes(s.schoolName.toLowerCase()),
    );

    if (school) {
      const normRaw = raw.toLowerCase().replace(/[\s_-]+/g, "");
      for (const fl of school.floors) {
        for (const rm of fl.rooms) {
          const normRm = rm.toLowerCase().replace(/[\s_-]+/g, "");
          if (normRaw === normRm || normRaw.includes(normRm) || normRm.includes(normRaw)) {
            return {
              floor: fl.floorName,
              room: rm,
            };
          }
        }
      }
    }

    // Check official centers
    for (const c of OFFICIAL_EST_CENTERS) {
      if (cleanCenter.includes(c.centerName.toLowerCase()) || c.centerName.toLowerCase().includes(cleanCenter)) {
        const normRaw = raw.toLowerCase().replace(/[\s_-]+/g, "");
        for (const bld of c.buildings) {
          for (const fl of bld.floors) {
            for (const rm of fl.rooms) {
              const normRm = rm.toLowerCase().replace(/[\s_-]+/g, "");
              if (normRaw === normRm || normRaw.includes(normRm) || normRm.includes(normRaw)) {
                return {
                  floor: fl.floorName,
                  room: rm,
                };
              }
            }
          }
        }
      }
    }
  }

  // 3. Center-specific patterns
  if (centerName) {
    if (/business/i.test(centerName)) {
      if (/^C1\./i.test(raw)) return { floor: "Basement", room: raw };
      if (/^C3\./i.test(raw)) return { floor: "1st Floor", room: raw };
      if (/^C4\./i.test(raw)) return { floor: "2nd Floor", room: raw };
      if (/^C5\./i.test(raw)) return { floor: "3rd Floor", room: raw };
    }
    if (/political/i.test(centerName)) {
      if (/^F1\./i.test(raw)) return { floor: "1st Floor", room: raw };
      if (/^F2\./i.test(raw)) return { floor: "2nd Floor", room: raw };
      if (/^F3\./i.test(raw)) return { floor: "3rd Floor", room: raw };
      if (/^F4\./i.test(raw)) return { floor: "4th Floor", room: raw };
    }
    if (/hotep/i.test(centerName)) {
      if (/senior/i.test(raw)) return { floor: "3rd Floor", room: raw };
      if (/junior/i.test(raw)) return { floor: "2nd Floor", room: raw };
    }
    if (/rawasy/i.test(centerName)) {
      return { floor: "2nd Floor", room: raw };
    }
  }

  // 4. St. Fatima Badr specific 4-digit codes
  if (/^410[1-5]$/.test(raw)) return { floor: "1st Floor", room: "Room " + raw };
  if (/^41(?:0[6-9]|1[0-3])$/.test(raw)) return { floor: "2nd Floor", room: "Room " + raw };
  if (/^41(?:1[4-9]|20)$/.test(raw)) return { floor: "3rd Floor", room: "Room " + raw };

  // 5. Standard 3-digit room numbers: 202 -> 2nd Floor, 304 -> 3rd Floor, etc.
  const numMatch = raw.match(/^([1-9])(\d{2})$/);
  if (numMatch) {
    const digit = parseInt(numMatch[1], 10);
    const suffix =
      digit === 1
        ? "1st Floor"
        : digit === 2
          ? "2nd Floor"
          : digit === 3
            ? "3rd Floor"
            : digit === 4
              ? "4th Floor"
              : digit === 5
                ? "5th Floor"
                : `${digit}th Floor`;
    return { floor: suffix, room: raw };
  }

  // 6. Letter + digit prefix: A101 -> 1st Floor, A301 -> 3rd Floor, B005 -> Ground, B102 -> 1st Floor, B201 -> 2nd Floor
  const letterDigitMatch = raw.match(/^[A-Za-z]+([0-9])/);
  if (letterDigitMatch) {
    const digit = parseInt(letterDigitMatch[1], 10);
    let fl = "1st Floor";
    if (digit === 0) fl = "Ground";
    else if (digit === 1) fl = "1st Floor";
    else if (digit === 2) fl = "2nd Floor";
    else if (digit === 3) fl = "3rd Floor";
    else if (digit === 4) fl = "4th Floor";
    else if (digit === 5) fl = "5th Floor";
    else fl = `${digit}th Floor`;
    return { floor: fl, room: raw };
  }

  // Fallback: heuristic room code without explicit floor
  return {
    floor: "1st Floor",
    room: raw,
  };
}

interface ColumnMapping {
  govCol: number;
  centerCol: number;
  roomCol: number;
  subjects: Array<{
    colIdx: number;
    code: string;
    name: string;
  }>;
}

/**
 * Detects columns from the header row of an EST sheet.
 */
function detectColumnMapping(headerRow: any[]): ColumnMapping | null {
  if (!Array.isArray(headerRow)) return null;

  let govCol = -1;
  let centerCol = -1;
  let roomCol = -1;
  const subjects: ColumnMapping["subjects"] = [];

  for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
    const cell = String(headerRow[colIdx] ?? "").trim().toLowerCase();
    if (!cell) continue;

    // Governorate
    if (govCol === -1 && /governorate|محافظة/i.test(cell)) {
      govCol = colIdx;
      continue;
    }

    // Center / School
    if (centerCol === -1 && /center|school|مدرسة|سنتر/i.test(cell)) {
      centerCol = colIdx;
      continue;
    }

    // Room
    if (roomCol === -1 && /room|class|hall|قاعة|فصل/i.test(cell)) {
      roomCol = colIdx;
      continue;
    }

    // Subjects:
    // Math 1
    if (/math\s*1\b|math1\b|mathematics\s*1\b/i.test(cell)) {
      subjects.push({ colIdx, code: "MATH1", name: "Math 1" });
      continue;
    }

    // Math 2
    if (/math\s*2\b|math2\b|mathematics\s*2\b/i.test(cell)) {
      subjects.push({ colIdx, code: "MATH2", name: "Math 2" });
      continue;
    }

    // Biology
    if (/bio|biology|أحياء/i.test(cell)) {
      subjects.push({ colIdx, code: "BIO", name: "Biology" });
      continue;
    }

    // Chemistry
    if (/chem|chemistry|كيمياء/i.test(cell)) {
      subjects.push({ colIdx, code: "CHEM", name: "Chemistry" });
      continue;
    }

    // Physics
    if (/phy|physics|فيزياء/i.test(cell)) {
      subjects.push({ colIdx, code: "PHY", name: "Physics" });
      continue;
    }

    // Literacy (EST 1)
    if (/lit|literacy|reading|writing/i.test(cell)) {
      subjects.push({ colIdx, code: "LIT", name: "Literacy" });
      continue;
    }

    // Essay (EST 1)
    if (/essay|مقال/i.test(cell)) {
      subjects.push({ colIdx, code: "ESSAY", name: "Essay" });
      continue;
    }

    // Generic Math (EST 1)
    if (/math|mathematics|رياضيات/i.test(cell) && !/1|2/.test(cell)) {
      subjects.push({ colIdx, code: "MATH", name: "Math" });
      continue;
    }
  }

  // Basic sanity check: need at least center, room, and 1 subject
  if (centerCol === -1 || roomCol === -1 || subjects.length === 0) {
    return null;
  }

  // Strictly enforce canonical chronological exam period order:
  // EST 1: Literacy (Period 1) -> Math (Period 2) -> Essay (Period 3)
  // EST 2: Math 1 & Math 2 (Period 1) -> Biology (Period 2) -> Chemistry / Physics (Period 3)
  subjects.sort((a, b) => getSubjectSortKey(a.code) - getSubjectSortKey(b.code));

  return {
    govCol: govCol >= 0 ? govCol : 0,
    centerCol,
    roomCol,
    subjects,
  };
}

/**
 * Parses an EST Excel workbook (EST 1 or EST 2) into structured rows and summary stats.
 */
export function parseEstExcelWorkbook(
  workbook: XLSX.WorkBook,
  fileName?: string,
): ParsedEstRoundResult {
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error("Excel workbook contains no sheets");
  }

  // Find the primary sheet (preferably one containing "EST" or the first sheet)
  let sheetName = sheetNames.find((s) => /EST/i.test(s)) || sheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found in workbook`);
  }

  const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  if (rawData.length < 2) {
    throw new Error("Sheet contains less than 2 rows");
  }

  // Find header row (search first 10 rows)
  let headerRowIdx = -1;
  let mapping: ColumnMapping | null = null;

  for (let r = 0; r < Math.min(10, rawData.length); r++) {
    const candidate = rawData[r];
    const detected = detectColumnMapping(candidate);
    if (detected) {
      headerRowIdx = r;
      mapping = detected;
      break;
    }
  }

  if (headerRowIdx === -1 || !mapping) {
    throw new Error(
      "Could not detect valid EST header columns (e.g. Center, Room, and Students columns)",
    );
  }

  // Determine examType based on subject codes
  const hasEst2Subject = mapping.subjects.some((s) =>
    ["MATH1", "MATH2", "BIO", "CHEM", "PHY"].includes(s.code),
  );
  const examType: "EST 1" | "EST 2" = hasEst2Subject ? "EST 2" : "EST 1";

  const rows: EstRoundRow[] = [];
  const subjectTotals: Record<string, number> = {};
  for (const s of mapping.subjects) {
    subjectTotals[s.code] = 0;
  }

  const uniqueGovs = new Set<string>();
  const uniqueCenters = new Set<string>();
  const uniqueFloors = new Set<string>();

  let lastGovernorate = "";

  for (let r = headerRowIdx + 1; r < rawData.length; r++) {
    const rawRow = rawData[r];
    if (!Array.isArray(rawRow) || rawRow.length === 0) continue;

    // Check for "Total" row or empty row
    const firstCell = String(rawRow[0] ?? "").trim();
    const secondCell = String(rawRow[1] ?? "").trim();
    if (/^total$/i.test(firstCell) || /^total$/i.test(secondCell)) {
      continue; // Skip summary row
    }

    const rawGov = mapping.govCol >= 0 ? String(rawRow[mapping.govCol] ?? "").trim() : "";
    const rawCenter = String(rawRow[mapping.centerCol] ?? "").trim();
    const rawRoom = String(rawRow[mapping.roomCol] ?? "").trim();

    if (!rawCenter && !rawRoom) continue;

    // Keep governorate sticky if empty in current row
    if (rawGov) {
      lastGovernorate = rawGov;
    }
    const governorate = lastGovernorate || "Main";
    const center = rawCenter;

    const { floor, room } = extractFloorAndRoom(rawRoom, center);

    const subjects: Record<string, number> = {};
    const breakdownParts: string[] = [];

    for (const sub of mapping.subjects) {
      const rawVal = rawRow[sub.colIdx];
      const count = typeof rawVal === "number" ? Math.max(0, Math.round(rawVal)) : parseInt(String(rawVal ?? "0").replace(/\D/g, ""), 10) || 0;
      subjects[sub.code] = count;
      subjectTotals[sub.code] = (subjectTotals[sub.code] || 0) + count;
      if (count > 0 || mapping.subjects.length <= 4) {
        breakdownParts.push(`${sub.name}: ${count}`);
      }
    }

    const totalStudents = Math.max(...Object.values(subjects), 0);
    const breakdownText = breakdownParts.join("  |  ");

    uniqueGovs.add(governorate);
    uniqueCenters.add(center);
    uniqueFloors.add(`${governorate}::${center}::${floor}`);

    rows.push({
      id: `row-${rows.length + 1}`,
      index: rows.length + 1,
      governorate,
      center,
      floor,
      room,
      rawRoom,
      subjects,
      totalStudents,
      breakdownText,
    });
  }

  const grandTotalStudents = rows.reduce((sum, r) => sum + r.totalStudents, 0);

  const stats: EstRoundSummaryStats = {
    totalGovernorates: uniqueGovs.size,
    totalCenters: uniqueCenters.size,
    totalFloors: uniqueFloors.size,
    totalRooms: rows.length,
    totalStudents: grandTotalStudents,
    subjectTotals,
    governoratesList: Array.from(uniqueGovs),
    centersList: Array.from(uniqueCenters),
  };

  return {
    examType,
    sheetName,
    rows,
    stats,
  };
}

export interface ParsedCombinedEstResult {
  isCombined: boolean;
  est1?: ParsedEstRoundResult;
  est2?: ParsedEstRoundResult;
  single?: ParsedEstRoundResult;
}

/**
 * Intelligent parser that handles both:
 * 1. Unified Combined Master Sheets (containing both EST I & EST II columns),
 *    splitting them automatically into dedicated EST 1 and EST 2 rounds.
 * 2. Dedicated single-exam sheets (either pure EST 1 or pure EST 2).
 */
export function parseAnyEstWorkbook(
  workbook: XLSX.WorkBook,
  fileName?: string,
): ParsedCombinedEstResult {
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error("Excel workbook contains no sheets");
  }

  // Find the primary sheet (02-Stats per Room, or containing "Stats" or "EST" or the first sheet)
  const sheetName =
    sheetNames.find((s) => /02-Stats|Stats\s*per\s*Room/i.test(s)) ||
    sheetNames.find((s) => /EST/i.test(s)) ||
    sheetNames[0];

  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found in workbook`);
  }

  const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet);
  if (!Array.isArray(rawJson) || rawJson.length === 0) {
    const single = parseEstExcelWorkbook(workbook, fileName);
    return { isCombined: false, single };
  }

  // Check if first row has combined EST I and EST II columns
  const firstRow = rawJson[0] || {};
  const keys = Object.keys(firstRow).map((k) => k.trim().toLowerCase());
  const hasEst1Col = keys.some((k) => /students\s*est\s*i\b|est\s*i\b|est\s*1\b/i.test(k));
  const hasEst2Col = keys.some(
    (k) => /students\s*est\s*ii\b|est\s*ii\b|est\s*2\b|math\s*1\b|biology\b/i.test(k),
  );

  if (hasEst1Col && hasEst2Col) {
    const est1Rows: EstRoundRow[] = [];
    const est2Rows: EstRoundRow[] = [];
    let lastGov = "Alexandria";

    for (let i = 0; i < rawJson.length; i++) {
      const r = rawJson[i];
      const rawGov = String(r["Governorate AR"] || r["Governorate"] || r["Gov"] || "").trim();
      if (rawGov && !/^total$/i.test(rawGov)) lastGov = rawGov;

      const center = String(r["Center"] || r["Test Center"] || r["School"] || "").trim();
      const rawRoom = String(r["Room"] || r["Room#"] || "").trim();
      if (!center || !rawRoom || /^total$/i.test(center) || /^total$/i.test(rawGov)) continue;

      const rawBuilding = String(r["Building"] || center).trim() || center;
      const building = isSameOrRedundantBuilding(center, rawBuilding) ? center : rawBuilding;
      const gov = lastGov;

      let floor = "1st Floor";
      let room = rawRoom;
      if (r["Floor"] && String(r["Floor"]).trim()) {
        floor = String(r["Floor"]).trim();
      } else {
        const extracted = extractFloorAndRoom(rawRoom, center);
        floor = extracted.floor;
        room = extracted.room || rawRoom;
      }

      const est1Students = Number(r["Students EST I"] || r["EST I"] || r["EST 1"]) || 0;
      const est2Students = Number(r["Students EST II"] || r["EST II"] || r["EST 2"]) || 0;
      const withEssay = Number(r["Students with Essay"] || r["Essay"]) || 0;
      const m1 = Number(r["Students Math 1"] || r["Math 1"] || r["MATH1"]) || 0;
      const bio = Number(r["Students Biology"] || r["Biology"] || r["BIO"]) || 0;
      const phy = Number(r["Students Physics"] || r["Physics"] || r["PHY"]) || 0;
      const chem = Number(r["Students Chemistry"] || r["Chemistry"] || r["CHEM"]) || 0;
      const m2 = Number(r["Students Math 2"] || r["Math 2"] || r["MATH2"]) || 0;

      // 1. EST 1 Row
      if (est1Students > 0) {
        const breakdown: string[] = [`Literacy: ${est1Students}`, `Math: ${est1Students}`];
        if (withEssay > 0) breakdown.push(`Essay: ${withEssay}`);

        est1Rows.push({
          id: `est1-row-${est1Rows.length + 1}`,
          index: est1Rows.length + 1,
          governorate: gov,
          center,
          building,
          floor,
          room,
          rawRoom,
          subjects: {
            LIT: est1Students,
            MATH: est1Students,
            ESSAY: withEssay,
          },
          totalStudents: est1Students,
          breakdownText: breakdown.join("  |  "),
        } as any);
      }

      // 2. EST 2 Row
      if (est2Students > 0 || m1 > 0 || m2 > 0 || bio > 0 || chem > 0 || phy > 0) {
        const breakdown: string[] = [];
        if (m1 > 0) breakdown.push(`Math 1: ${m1}`);
        if (m2 > 0) breakdown.push(`Math 2: ${m2}`);
        if (bio > 0) breakdown.push(`Biology: ${bio}`);
        if (chem > 0) breakdown.push(`Chemistry: ${chem}`);
        if (phy > 0) breakdown.push(`Physics: ${phy}`);

        const totalStudents = est2Students || Math.max(m1, m2, bio, chem, phy, 0);

        est2Rows.push({
          id: `est2-row-${est2Rows.length + 1}`,
          index: est2Rows.length + 1,
          governorate: gov,
          center,
          building,
          floor,
          room,
          rawRoom,
          subjects: {
            MATH1: m1,
            MATH2: m2,
            BIO: bio,
            CHEM: chem,
            PHY: phy,
          },
          totalStudents,
          breakdownText: breakdown.join("  |  "),
        } as any);
      }
    }

    const calcStats = (rows: EstRoundRow[]): EstRoundSummaryStats => {
      const govs = new Set<string>();
      const centers = new Set<string>();
      const floors = new Set<string>();
      const subjectTotals: Record<string, number> = {};

      rows.forEach((r) => {
        govs.add(r.governorate);
        centers.add(r.center);
        floors.add(`${r.governorate}::${r.center}::${r.floor}`);
        Object.entries(r.subjects || {}).forEach(([code, count]) => {
          subjectTotals[code] = (subjectTotals[code] || 0) + count;
        });
      });

      const totalStudents = rows.reduce((s, r) => s + r.totalStudents, 0);

      return {
        totalGovernorates: govs.size,
        totalCenters: centers.size,
        totalFloors: floors.size,
        totalRooms: rows.length,
        totalStudents,
        subjectTotals,
        governoratesList: Array.from(govs),
        centersList: Array.from(centers),
      };
    };

    return {
      isCombined: true,
      est1: {
        examType: "EST 1",
        sheetName,
        rows: est1Rows,
        stats: calcStats(est1Rows),
      },
      est2: {
        examType: "EST 2",
        sheetName,
        rows: est2Rows,
        stats: calcStats(est2Rows),
      },
    };
  }

  // Fallback to single exam sheet parsing
  const single = parseEstExcelWorkbook(workbook, fileName);
  return {
    isCombined: false,
    single,
  };
}
