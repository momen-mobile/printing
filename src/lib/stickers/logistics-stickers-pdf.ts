import fs from "fs";
import path from "path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { EST_LOGO_BASE64 } from "./est-logo-base64";
import { getFloorSortWeight } from "./est-reference-data";

export interface RoomDetail {
  room: string;
  studentCount?: number;
  subjectsText?: string;
  est1Subjects?: string;
  est1Count?: number;
  est2Subjects?: string;
  est2Count?: number;
  isAssn?: boolean;
}

export interface FloorRoomsData {
  floor: string;
  rooms: (string | RoomDetail)[];
  totalStudents?: number;
  est1Students?: number;
  est2Students?: number;
}

export interface LogisticsStickerOptions {
  examName?: string;          // e.g. "EST 1" or "EST 2" (or "EST I" / "EST II")
  governorate?: string;       // e.g. "Alexandria"
  center?: string;            // e.g. "Abu Qir" or "Momen Center"
  building?: string;          // e.g. "Pharmacy" or "Momen Building"
  date?: string;              // e.g. "December 2026"
  totalRooms?: number;
  totalStudents?: number;
  roomNames?: string[];       // e.g. ["M101", "M102", "M103", ...]
  floors?: FloorRoomsData[];   // Grouped floors with their rooms & student counts
  boxNumber?: number;         // e.g. 1
  totalBoxes?: number;        // e.g. 1
  securitySeal?: string;
  notes?: string;
  isCombined?: boolean;
  est1Total?: number;
  est2Total?: number;
}

// 100% Black & White Palette
const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_CHARCOAL = rgb(0, 0, 0);
const COLOR_MUTED = rgb(0.28, 0.28, 0.28);
const COLOR_GOLD = rgb(0, 0, 0); // Solid black
const COLOR_LIGHT_BG = rgb(1, 1, 1); // Clean white background
const COLOR_BORDER = rgb(0.75, 0.75, 0.75); // Clean simple border
const COLOR_WHITE = rgb(1, 1, 1);
const COLOR_EMERGENCY_RED = rgb(0, 0, 0);
const COLOR_EMERGENCY_LIGHT = rgb(1, 1, 1);

// Static decoded logo bytes in memory - zero filesystem dependency
const LOGO_JPEG_BYTES: Uint8Array = new Uint8Array(Buffer.from(EST_LOGO_BASE64, "base64"));

async function loadLogoImage(pdfDoc: PDFDocument): Promise<any> {
  try {
    return await pdfDoc.embedJpg(LOGO_JPEG_BYTES);
  } catch {
    return null;
  }
}

async function loadStickerFont(pdfDoc: PDFDocument): Promise<any> {
  const fontPaths = [
    path.join(process.cwd(), "src", "assets", "fonts", "Arial-Bold.ttf"),
    path.join(process.cwd(), "public", "fonts", "Arial-Bold.ttf"),
  ];

  for (const fp of fontPaths) {
    if (fs.existsSync(/*turbopackIgnore: true*/ fp)) {
      try {
        const fontBytes = fs.readFileSync(/*turbopackIgnore: true*/ fp);
        return await pdfDoc.embedFont(fontBytes, { subset: true });
      } catch {}
    }
  }

  return await pdfDoc.embedFont(StandardFonts.HelveticaBold);
}

export interface NormalizedRoom {
  room: string;
  studentCount?: number;
  subjectsText?: string;
  est1Subjects?: string;
  est1Count?: number;
  est2Subjects?: string;
  est2Count?: number;
  isAssn?: boolean;
}

export interface NormalizedFloor {
  floor: string;
  rooms: NormalizedRoom[];
  totalStudents: number;
  est1Students?: number;
  est2Students?: number;
}

/**
 * Normalizes, deduplicates, and sorts floors and rooms data for building stickers.
 * Guarantees:
 * 1. No duplicate floors (merges multiple folders with the same floor name).
 * 2. No duplicate rooms within each floor.
 * 3. Natural ascending alphanumeric room order (e.g. AD3A, AD4A, ... AD9A).
 * 4. Standard building logical floor order (Ground -> 1st -> 2nd -> 3rd -> 4th...).
 * 5. Accurate total candidate count strictly matching enclosed rooms.
 * 6. Dual EST 1 and EST 2 allocations and subject breakdowns.
 */
export function normalizeFloorsData(options: LogisticsStickerOptions): NormalizedFloor[] {
  const isEst2Selected = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(options.examName || "");

  const cleanAndSortFloors = (rawFloors: NormalizedFloor[]): NormalizedFloor[] => {
    const floorMap = new Map<
      string,
      { floor: string; roomsMap: Map<string, NormalizedRoom> }
    >();

    for (const f of rawFloors) {
      // Normalize floor key to prevent duplicate cards (e.g. "3rd Floor", "Floor 3", "3rd")
      const flKey = f.floor
        .trim()
        .toLowerCase()
        .replace(/^(the\s+|floor\s*)/i, "")
        .replace(/\s*floor$/i, "")
        .trim();
      let entry = floorMap.get(flKey);
      if (!entry) {
        entry = {
          floor: f.floor.trim(),
          roomsMap: new Map(),
        };
        floorMap.set(flKey, entry);
      }

      for (const r of f.rooms as any[]) {
        const rName = (typeof r === "string" ? r : r?.room || "").trim();
        if (!rName) continue;
        const rKey = rName.toLowerCase();
        if (!entry.roomsMap.has(rKey)) {
          // Strictly use real student count if present, otherwise 0 (NO fake 25 fallback)
          const sCount =
            typeof r === "object" && r !== null && typeof r.studentCount === "number" && r.studentCount > 0
              ? r.studentCount
              : 0;
          const sText = typeof r === "object" && r !== null ? r.subjectsText : undefined;

          let est1C = typeof r === "object" && r !== null && typeof r.est1Count === "number" && r.est1Count > 0 ? r.est1Count : undefined;
          let est1S = typeof r === "object" && r !== null && r.est1Subjects ? r.est1Subjects : undefined;
          let est2C = typeof r === "object" && r !== null && typeof r.est2Count === "number" && r.est2Count > 0 ? r.est2Count : undefined;
          let est2S = typeof r === "object" && r !== null && r.est2Subjects ? r.est2Subjects : undefined;

          if (isEst2Selected) {
            if (est2C === undefined && sCount > 0) est2C = sCount;
            if (!est2S && sText) est2S = sText;
          } else {
            if (est1C === undefined && sCount > 0) est1C = sCount;
            if (!est1S && sText) est1S = sText;
          }

          const isAssn = typeof r === "object" && r !== null ? Boolean(r.isAssn) : false;

          entry.roomsMap.set(rKey, {
            room: rName,
            studentCount: sCount,
            subjectsText: sText,
            est1Count: est1C,
            est1Subjects: est1S,
            est2Count: est2C,
            est2Subjects: est2S,
            isAssn,
          });
        }
      }
    }

    const mergedFloors: NormalizedFloor[] = Array.from(floorMap.values()).map((entry) => {
      const sortedRooms = Array.from(entry.roomsMap.values()).sort((a, b) =>
        a.room.localeCompare(b.room, undefined, { numeric: true }),
      );
      const totalStudents = sortedRooms.reduce((sum, r) => sum + (r.studentCount || 0), 0);
      const est1Students = sortedRooms.reduce((sum, r) => sum + (r.est1Count || 0), 0);
      const est2Students = sortedRooms.reduce((sum, r) => sum + (r.est2Count || 0), 0);
      return {
        floor: entry.floor,
        rooms: sortedRooms,
        totalStudents,
        est1Students,
        est2Students,
      };
    });

    mergedFloors.sort((a, b) => getFloorSortWeight(a.floor) - getFloorSortWeight(b.floor));
    return mergedFloors;
  };

  // 1. If explicit floors are provided, normalize, deduplicate, and sort them
  if (options.floors && options.floors.length > 0) {
    const rawFloors: NormalizedFloor[] = options.floors.map((f) => {
      const normalizedRooms = f.rooms.map((r) => {
        if (typeof r === "string") return { room: r };
        return r;
      });
      const sumStudents =
        f.totalStudents ??
        normalizedRooms.reduce((sum, r) => sum + (r.studentCount || 0), 0);
      return {
        floor: f.floor,
        rooms: normalizedRooms,
        totalStudents: sumStudents,
        est1Students: f.est1Students,
        est2Students: f.est2Students,
      };
    });
    const cleaned = cleanAndSortFloors(rawFloors);
    if (cleaned.length > 0) return cleaned;
  }

  // 2. If roomNames provided, infer floors
  if (options.roomNames && options.roomNames.length > 0) {
    const floorMap = new Map<string, { rooms: { room: string; studentCount?: number }[]; totalStudents: number }>();
    for (const rName of options.roomNames) {
      const clean = rName.trim();
      let fl = "General Floor";
      const explicitFloor = clean.match(/(?:floor|دور|طابق)\s*([^\s\-_]+)/i);
      if (explicitFloor) {
        fl = `Floor ${explicitFloor[1]}`;
      } else {
        const numMatch = clean.match(/\b([1-9])\d{2,3}[A-Za-z]?\b/);
        if (numMatch) {
          const digit = numMatch[1];
          const suffix = digit === "1" ? "1st" : digit === "2" ? "2nd" : digit === "3" ? "3rd" : `${digit}th`;
          fl = `${suffix} Floor`;
        }
      }
      const entry = floorMap.get(fl) || { rooms: [], totalStudents: 0 };
      if (!entry.rooms.some((rm) => rm.room.toLowerCase() === clean.toLowerCase())) {
        entry.rooms.push({ room: clean, studentCount: 0 });
      }
      floorMap.set(fl, entry);
    }
    const raw = Array.from(floorMap.entries()).map(([floor, data]) => ({
      floor,
      rooms: data.rooms,
      totalStudents: data.totalStudents,
    }));
    return cleanAndSortFloors(raw);
  }

  // 3. No rooms or floors provided: return empty array (zero fake data)
  return [];
}

/**
 * Translates and standardizes Arabic months, governorates, and common logistics terms to English.
 */
export function toEnglishText(input: string | undefined): string {
  if (!input) return "";
  let str = input.trim();
  // Arabic months
  str = str.replace(/ديسمبر/gi, "December");
  str = str.replace(/يناير/gi, "January");
  str = str.replace(/فبراير/gi, "February");
  str = str.replace(/مارس/gi, "March");
  str = str.replace(/أبريل|ابريل/gi, "April");
  str = str.replace(/مايو/gi, "May");
  str = str.replace(/يونيو/gi, "June");
  str = str.replace(/يوليو/gi, "July");
  str = str.replace(/أغسطس|اغسطس/gi, "August");
  str = str.replace(/سبتمبر/gi, "September");
  str = str.replace(/أكتوبر|اكتوبر/gi, "October");
  str = str.replace(/نوفمبر/gi, "November");
  // Arabic governorates
  str = str.replace(/الإسكندرية|الاسكندرية|اسكندرية/gi, "Alexandria");
  str = str.replace(/القاهرة|قاهرة/gi, "Cairo");
  str = str.replace(/الجيزة|جيزة/gi, "Giza");
  str = str.replace(/المنوفية|منوفية/gi, "Menofia");
  str = str.replace(/الدقهلية|دقهلية/gi, "Dakahlia");
  str = str.replace(/الغربية|غربية/gi, "Gharbia");
  str = str.replace(/الشرقية|شرقية/gi, "Sharqia");
  str = str.replace(/القليوبية|قليوبية/gi, "Qalyubia");
  str = str.replace(/البحيرة|بحيرة/gi, "Beheira");
  str = str.replace(/بني سويف|بنى سويف/gi, "Beni Suef");
  str = str.replace(/سوهاج/gi, "Sohag");
  str = str.replace(/أسيوط|اسيوط/gi, "Assiut");
  str = str.replace(/الإسماعيلية|الاسماعيلية/gi, "Ismailia");
  str = str.replace(/السويس/gi, "Suez");
  str = str.replace(/بورسعيد/gi, "Port Said");
  str = str.replace(/كفر الشيخ/gi, "Kafr El Sheikh");
  str = str.replace(/دمياط/gi, "Damietta");
  str = str.replace(/الفيوم/gi, "Fayoum");
  // Arabic floor descriptions
  str = str.replace(/الدور\s*الأرضي|الدور\s*الارضي|أرضي|ارضي/gi, "Ground Floor");
  str = str.replace(/الدور\s*الأول|الدور\s*الاول|أول|اول/gi, "1st Floor");
  str = str.replace(/الدور\s*الثاني|الدور\s*الثانى|ثاني|ثانى/gi, "2nd Floor");
  str = str.replace(/الدور\s*الثالث|ثالث/gi, "3rd Floor");
  str = str.replace(/الدور\s*الرابع|رابع/gi, "4th Floor");
  str = str.replace(/الدور\s*الخامس|خامس/gi, "5th Floor");
  str = str.replace(/الدور\s*السادس|سادس/gi, "6th Floor");
  str = str.replace(/دور/gi, "Floor");
  // Terms
  str = str.replace(/دورة/gi, "Session");
  str = str.replace(/مدرسة/gi, "School");
  str = str.replace(/سنتر/gi, "Center");
  str = str.replace(/مبنى/gi, "Building");
  str = str.replace(/قاعة|قاعه|غرفة|غرفه/gi, "Room");
  // Arabic digits to Western digits
  str = str.replace(/[\u0660-\u0669]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48));

  return str.trim();
}

/**
 * Intelligent separation of Center and Building:
 * Detects whether a center is a university/campus containing a specific faculty/building,
 * or a single school/facility. Eliminates redundant repetitions.
 */
export function splitCenterAndBuilding(
  rawCenter: string | undefined,
  rawBuilding?: string | undefined,
): { center: string; building: string; isCampus: boolean } {
  const c = toEnglishText(rawCenter || "").trim();
  let b = toEnglishText(rawBuilding || "").trim();

  // If rawBuilding is missing, identical to center, or center contains the building
  if (!b || b.toLowerCase() === c.toLowerCase()) {
    // Regex matching university campuses with faculties or buildings
    const facMatch = c.match(
      /^(.*?)(?:\s*[-–—:]\s*|\s+)(Faculty\s+of\s+.*|College\s+of\s+.*|Building\s+[A-Za-z0-9].*)$/i,
    );
    if (facMatch && facMatch[1] && facMatch[2]) {
      const cleanCenter = facMatch[1].replace(/[-–—:\s]+$/, "").trim();
      const cleanBuilding = facMatch[2].trim();
      return {
        center: cleanCenter,
        building: cleanBuilding,
        isCampus: true,
      };
    }

    // Single school or standalone center
    return {
      center: c,
      building: "",
      isCampus: false,
    };
  }

  // If building was already provided and starts with center name, strip repetition
  if (b.toLowerCase().startsWith(c.toLowerCase())) {
    b = b.substring(c.length).replace(/^[-–—:\s]+/, "").trim();
  }

  return {
    center: c,
    building: b,
    isCampus: Boolean(b && b.toLowerCase() !== c.toLowerCase()),
  };
}

/**
 * Fits and draws text in a rectangular bounding box with multi-line wrapping and dynamic font scaling.
 * Guarantees zero text collision with adjacent columns.
 */
function drawFittedTextInBox(
  page: any,
  text: string,
  font: any,
  color: any,
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
    baseSize?: number;
    minSize?: number;
    maxLines?: number;
  },
) {
  const maxW = Math.max(10, box.width);
  const baseSize = box.baseSize || 13;
  const minSize = box.minSize || 8;
  const maxLines = box.maxLines || 2;

  // 1. Check if fits on a single line
  const singleLineW = font.widthOfTextAtSize(text, baseSize);
  if (singleLineW <= maxW) {
    page.drawText(text, {
      x: box.x,
      y: box.y + (box.height - baseSize) / 2,
      size: baseSize,
      font,
      color,
    });
    return;
  }

  // 2. Wrap words into lines
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1 || maxLines === 1) {
    // Single long word or 1 line forced: scale down font
    const effSize = Math.max(minSize, (maxW / singleLineW) * baseSize);
    page.drawText(text, {
      x: box.x,
      y: box.y + (box.height - effSize) / 2,
      size: effSize,
      font,
      color,
    });
    return;
  }

  // Break across 2 lines
  let bestLine1 = "";
  let bestLine2 = "";
  const mid = Math.ceil(words.length / 2);
  bestLine1 = words.slice(0, mid).join(" ");
  bestLine2 = words.slice(mid).join(" ");

  let l1W = font.widthOfTextAtSize(bestLine1, baseSize);
  let l2W = font.widthOfTextAtSize(bestLine2, baseSize);
  let maxLineW = Math.max(l1W, l2W);

  let effSize = baseSize;
  if (maxLineW > maxW) {
    effSize = Math.max(minSize, (maxW / maxLineW) * baseSize);
  }

  const lineSpacing = effSize * 1.15;
  const totalH = lineSpacing * 2;
  const startY = box.y + (box.height - totalH) / 2 + lineSpacing * 0.8;

  page.drawText(bestLine1, {
    x: box.x,
    y: startY,
    size: effSize,
    font,
    color,
  });

  page.drawText(bestLine2, {
    x: box.x,
    y: startY - lineSpacing,
    size: effSize,
    font,
    color,
  });
}

/**
 * 1. Building Master Carton Sticker (A4 Landscape)
 * Affixed to the outside of the large carton box containing all room packets for that building.
 * Displays all Floors in the building, and for each floor, lists its constituent rooms with checkboxes.
 */
export async function renderBuildingCartonPage(
  pdfDoc: PDFDocument,
  options: LogisticsStickerOptions,
  font: any,
  logoImg: any,
): Promise<void> {
  // A4 Landscape: 841.89 x 595.28 pt
  const width = 841.89;
  const height = 595.28;
  const page = pdfDoc.addPage([width, height]);

  const margin = 22;
  const cardX = margin;
  const cardY = margin;
  const cardW = width - margin * 2;
  const cardH = height - margin * 2;

  // Normalized Floors and Rooms data
  const floors = normalizeFloorsData(options);
  const totalFloorsCount = floors.length;
  const totalRoomsCount =
    typeof options.totalRooms === "number" && options.totalRooms > 0
      ? options.totalRooms
      : floors.reduce((sum, f) => sum + f.rooms.length, 0);

  // Header Bar
  const headerH = 64;
  const headerY = cardY + cardH - headerH - 8;
  const logoH = 46;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 0;
  const logoX = cardX + 16;
  const logoY = headerY + (headerH - logoH) / 2;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  }

  const textStartX = logoImg ? logoX + logoW + 16 : cardX + 16;
  const rawExam = options.examName || "EST";
  const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(rawExam);
  const examLabel = options.isCombined ? "EST I & EST II" : isEst2 ? "EST II" : "EST I";
  const sessionText = toEnglishText(options.date) || "DECEMBER 2026";
  const subtitleText = options.isCombined
    ? `COMBINED MASTER CARTON — ${sessionText.toUpperCase()}`
    : `BUILDING MASTER CARTON — ${sessionText.toUpperCase()}`;

  page.drawText(examLabel, {
    x: textStartX,
    y: headerY + 34,
    size: options.isCombined ? 19 : 22,
    font,
    color: COLOR_CHARCOAL,
  });

  page.drawText(subtitleText, {
    x: textStartX,
    y: headerY + 16,
    size: 10,
    font,
    color: COLOR_MUTED,
  });

  // ----------------------------------------------------
  // Top-Right Corner: High-Visibility Box Identifier (ZERO black fill!)
  // ----------------------------------------------------
  const boxBadgeW = 210;
  const boxBadgeH = 54;
  const boxBadgeX = cardX + cardW - boxBadgeW - 12;
  const boxBadgeY = headerY + (headerH - boxBadgeH) / 2;

  // Clean White Card with Crisp Charcoal Border (2pt) - NO black background!
  page.drawRectangle({
    x: boxBadgeX,
    y: boxBadgeY,
    width: boxBadgeW,
    height: boxBadgeH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 2,
  });

  // Top Sub-heading: CARTON BOX NUMBER
  const boxSubLabel =
    options.totalBoxes && options.totalBoxes > 1
      ? `CARTON ${options.boxNumber || 1} OF ${options.totalBoxes}`
      : "CARTON BOX NUMBER";
  const boxSubW = font.widthOfTextAtSize(boxSubLabel, 8);
  page.drawText(boxSubLabel, {
    x: boxBadgeX + (boxBadgeW - boxSubW) / 2,
    y: boxBadgeY + boxBadgeH - 14,
    size: 8,
    font,
    color: COLOR_MUTED,
  });

  // Huge Prominent Box Number: e.g. "BOX #1" or "BOX #2"
  const boxMainText = `BOX #${options.boxNumber || 1}`;
  const boxMainW = font.widthOfTextAtSize(boxMainText, 22);
  page.drawText(boxMainText, {
    x: boxBadgeX + (boxBadgeW - boxMainW) / 2,
    y: boxBadgeY + 8,
    size: 22,
    font,
    color: COLOR_CHARCOAL,
  });

  // Divider Line
  page.drawLine({
    start: { x: cardX + 10, y: headerY },
    end: { x: cardX + cardW - 10, y: headerY },
    thickness: 1.5,
    color: COLOR_BORDER,
  });

  // Location Highlight Ribbon (Governorate - Center - Building)
  const locRibbonY = headerY - 54;
  const locRibbonH = 48;
  const ribbonInnerW = cardW - 24;

  page.drawRectangle({
    x: cardX + 12,
    y: locRibbonY,
    width: ribbonInnerW,
    height: locRibbonH,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });

  const { center: cleanCenter, building: cleanBuilding, isCampus } = splitCenterAndBuilding(
    options.center,
    options.building,
  );
  const govText = toEnglishText(options.governorate) || "All Governorates";

  if (isCampus && cleanBuilding) {
    // 3-Column Layout: Governorate | Test Center | Building
    const col1W = 150;
    const colRem = ribbonInnerW - col1W;
    const col2W = Math.floor(colRem / 2);
    const col3W = colRem - col2W;

    const c1X = cardX + 12;
    const c2X = c1X + col1W;
    const c3X = c2X + col2W;

    // Col 1: Governorate
    page.drawText("GOVERNORATE", {
      x: c1X + 12,
      y: locRibbonY + locRibbonH - 13,
      size: 7,
      font,
      color: COLOR_MUTED,
    });
    drawFittedTextInBox(page, govText, font, COLOR_CHARCOAL, {
      x: c1X + 12,
      y: locRibbonY + 4,
      width: col1W - 24,
      height: locRibbonH - 18,
      baseSize: 13,
      minSize: 9,
      maxLines: 1,
    });

    // Col 2: Test Center
    page.drawText("TEST CENTER", {
      x: c2X + 12,
      y: locRibbonY + locRibbonH - 13,
      size: 7,
      font,
      color: COLOR_MUTED,
    });
    drawFittedTextInBox(page, cleanCenter, font, COLOR_CHARCOAL, {
      x: c2X + 12,
      y: locRibbonY + 4,
      width: col2W - 24,
      height: locRibbonH - 18,
      baseSize: 13,
      minSize: 8.5,
      maxLines: 2,
    });

    // Col 3: Building
    page.drawText("BUILDING", {
      x: c3X + 12,
      y: locRibbonY + locRibbonH - 13,
      size: 7,
      font,
      color: COLOR_MUTED,
    });
    drawFittedTextInBox(page, cleanBuilding, font, COLOR_CHARCOAL, {
      x: c3X + 12,
      y: locRibbonY + 4,
      width: col3W - 24,
      height: locRibbonH - 18,
      baseSize: 13,
      minSize: 8.5,
      maxLines: 2,
    });

    // Vertical Divider Lines
    page.drawLine({
      start: { x: c2X, y: locRibbonY + 4 },
      end: { x: c2X, y: locRibbonY + locRibbonH - 4 },
      thickness: 0.6,
      color: COLOR_BORDER,
    });
    page.drawLine({
      start: { x: c3X, y: locRibbonY + 4 },
      end: { x: c3X, y: locRibbonY + locRibbonH - 4 },
      thickness: 0.6,
      color: COLOR_BORDER,
    });
  } else {
    // 2-Column Layout for Single School / Center: Governorate | Examination Center / School
    const col1W = 160;
    const col2W = ribbonInnerW - col1W;
    const c1X = cardX + 12;
    const c2X = c1X + col1W;

    // Col 1: Governorate
    page.drawText("GOVERNORATE", {
      x: c1X + 12,
      y: locRibbonY + locRibbonH - 13,
      size: 7,
      font,
      color: COLOR_MUTED,
    });
    drawFittedTextInBox(page, govText, font, COLOR_CHARCOAL, {
      x: c1X + 12,
      y: locRibbonY + 4,
      width: col1W - 24,
      height: locRibbonH - 18,
      baseSize: 13,
      minSize: 9,
      maxLines: 1,
    });

    // Col 2: Examination Center / School
    page.drawText("EXAMINATION CENTER / SCHOOL", {
      x: c2X + 14,
      y: locRibbonY + locRibbonH - 13,
      size: 7,
      font,
      color: COLOR_MUTED,
    });
    drawFittedTextInBox(page, cleanCenter, font, COLOR_CHARCOAL, {
      x: c2X + 14,
      y: locRibbonY + 4,
      width: col2W - 28,
      height: locRibbonH - 18,
      baseSize: 14,
      minSize: 9.5,
      maxLines: 2,
    });

    // Vertical Divider Line
    page.drawLine({
      start: { x: c2X, y: locRibbonY + 4 },
      end: { x: c2X, y: locRibbonY + locRibbonH - 4 },
      thickness: 0.6,
      color: COLOR_BORDER,
    });
  }

  // Body Layout
  const bodyTop = locRibbonY - 10;
  const bodyBottom = cardY + 12;
  const bodyH = bodyTop - bodyBottom;
  const leftW = 205;
  const rightW = cardW - 24 - leftW - 10;
  const leftX = cardX + 12;
  const rightX = leftX + leftW + 10;

  // ----------------------------------------------------
  // LEFT COLUMN: Specifications & Key Statistics (NO ASSIGNED CANDIDATES)
  // ----------------------------------------------------
  page.drawRectangle({
    x: leftX,
    y: bodyBottom,
    width: leftW,
    height: bodyH,
    color: COLOR_WHITE,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });

  // Title for Left (Light background, NO black bar)
  page.drawRectangle({
    x: leftX + 1,
    y: bodyBottom + bodyH - 24,
    width: leftW - 2,
    height: 23,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 0.8,
  });
  page.drawText("CARTON SPECIFICATIONS", {
    x: leftX + 12,
    y: bodyBottom + bodyH - 16,
    size: 8.5,
    font,
    color: COLOR_CHARCOAL,
  });

  // Metric Cards filling the Left Column
  const leftCardsTop = bodyBottom + bodyH - 24 - 10;
  const leftCardsBottom = bodyBottom + 10;
  const leftAvailableH = leftCardsTop - leftCardsBottom;

  if (options.isCombined) {
    // 3 Metric Cards: Floors, Rooms, and Combined Candidate Allocations
    const statBoxH = Math.floor((leftAvailableH - 16) / 3);

    // Stat Card 1: Total Building Floors
    const stat1Y = leftCardsTop - statBoxH;
    page.drawRectangle({
      x: leftX + 8,
      y: stat1Y,
      width: leftW - 16,
      height: statBoxH,
      color: COLOR_LIGHT_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.8,
    });
    page.drawText("TOTAL BUILDING FLOORS:", {
      x: leftX + 14,
      y: stat1Y + statBoxH - 18,
      size: 7.5,
      font,
      color: COLOR_MUTED,
    });
    page.drawText(`${totalFloorsCount} FLOORS`, {
      x: leftX + 14,
      y: stat1Y + 10,
      size: 18,
      font,
      color: COLOR_CHARCOAL,
    });

    // Stat Card 2: Total Enclosed Rooms
    const stat2Y = stat1Y - 8 - statBoxH;
    page.drawRectangle({
      x: leftX + 8,
      y: stat2Y,
      width: leftW - 16,
      height: statBoxH,
      color: COLOR_LIGHT_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.8,
    });
    page.drawText("TOTAL ENCLOSED ROOMS:", {
      x: leftX + 14,
      y: stat2Y + statBoxH - 18,
      size: 7.5,
      font,
      color: COLOR_MUTED,
    });
    page.drawText(`${totalRoomsCount} ROOMS`, {
      x: leftX + 14,
      y: stat2Y + 10,
      size: 18,
      font,
      color: COLOR_CHARCOAL,
    });

    // Stat Card 3: Combined Candidate Breakdown
    const stat3Y = stat2Y - 8 - statBoxH;
    page.drawRectangle({
      x: leftX + 8,
      y: stat3Y,
      width: leftW - 16,
      height: statBoxH,
      color: COLOR_LIGHT_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.8,
    });
    const e1Tot = options.est1Total || 0;
    const e2Tot = options.est2Total || 0;
    const combTot = e1Tot + e2Tot;
    page.drawText(`EST I: ${e1Tot}  •  EST II: ${e2Tot}`, {
      x: leftX + 14,
      y: stat3Y + statBoxH - 18,
      size: 7,
      font,
      color: COLOR_MUTED,
    });
    page.drawText(`${combTot} CANDIDATES`, {
      x: leftX + 14,
      y: stat3Y + 10,
      size: 14.5,
      font,
      color: COLOR_CHARCOAL,
    });
  } else {
    // 2 Prominent Metric Cards
    const statBoxH = Math.floor((leftAvailableH - 16) / 2);

    // Stat Card 1: Total Building Floors
    const stat1Y = leftCardsTop - statBoxH;
    page.drawRectangle({
      x: leftX + 8,
      y: stat1Y,
      width: leftW - 16,
      height: statBoxH,
      color: COLOR_LIGHT_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.8,
    });
    page.drawText("TOTAL BUILDING FLOORS:", {
      x: leftX + 16,
      y: stat1Y + statBoxH - 24,
      size: 8.5,
      font,
      color: COLOR_MUTED,
    });
    page.drawText(`${totalFloorsCount} FLOORS`, {
      x: leftX + 16,
      y: stat1Y + (statBoxH - 36) / 2 + 2,
      size: 24,
      font,
      color: COLOR_CHARCOAL,
    });

    // Stat Card 2: Total Enclosed Rooms
    const stat2Y = stat1Y - 16 - statBoxH;
    page.drawRectangle({
      x: leftX + 8,
      y: stat2Y,
      width: leftW - 16,
      height: statBoxH,
      color: COLOR_LIGHT_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.8,
    });
    page.drawText("TOTAL ENCLOSED ROOMS:", {
      x: leftX + 16,
      y: stat2Y + statBoxH - 24,
      size: 8.5,
      font,
      color: COLOR_MUTED,
    });
    page.drawText(`${totalRoomsCount} ROOMS`, {
      x: leftX + 16,
      y: stat2Y + (statBoxH - 36) / 2 + 2,
      size: 24,
      font,
      color: COLOR_CHARCOAL,
    });
  }

  // ----------------------------------------------------
  // RIGHT COLUMN: Floors & Rooms Directory
  // ----------------------------------------------------
  page.drawRectangle({
    x: rightX,
    y: bodyBottom,
    width: rightW,
    height: bodyH,
    color: COLOR_WHITE,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });

  // Top header for Right (Light background, NO black bar)
  page.drawRectangle({
    x: rightX + 1,
    y: bodyBottom + bodyH - 24,
    width: rightW - 2,
    height: 23,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 0.8,
  });
  page.drawText("BUILDING FLOORS & ENCLOSED ROOMS DIRECTORY", {
    x: rightX + 14,
    y: bodyBottom + bodyH - 16,
    size: 8.5,
    font,
    color: COLOR_CHARCOAL,
  });

  const dirSubtitle = "[ CHECK OFF [✓] EACH ROOM UPON PACKING ]";
  const dirSubW = font.widthOfTextAtSize(dirSubtitle, 7.5);
  page.drawText(dirSubtitle, {
    x: rightX + rightW - dirSubW - 14,
    y: bodyBottom + bodyH - 16,
    size: 7.5,
    font,
    color: COLOR_MUTED,
  });

  // Layout floors dynamically
  const contentTop = bodyBottom + bodyH - 24 - 8;
  const contentBottom = bodyBottom + 8;
  const contentH = contentTop - contentBottom;
  const contentW = rightW - 16;

  const numFloors = floors.length;
  if (numFloors === 0) {
    const emptyNotice = "NO FLOORS OR ROOMS REGISTERED YET";
    const subNotice = "[ This building currently has no floor or room records uploaded ]";
    page.drawText(emptyNotice, {
      x: rightX + 24,
      y: bodyBottom + bodyH / 2 + 10,
      size: 13,
      font,
      color: COLOR_MUTED,
    });
    page.drawText(subNotice, {
      x: rightX + 24,
      y: bodyBottom + bodyH / 2 - 12,
      size: 9,
      font,
      color: COLOR_MUTED,
    });
  } else {
    const floorCols = numFloors <= 3 ? 1 : 2;
    const floorRows = Math.ceil(numFloors / floorCols);
    const gapX = 8;
    const gapY = 8;
    const fCardW = (contentW - (floorCols - 1) * gapX) / floorCols;
    const fCardH = (contentH - (floorRows - 1) * gapY) / floorRows;

    for (let fi = 0; fi < numFloors; fi++) {
      const fl = floors[fi];
      const col = fi % floorCols;
      const row = Math.floor(fi / floorCols);
      const fx = rightX + 8 + col * (fCardW + gapX);
      const fy = contentTop - (row + 1) * fCardH - row * gapY;

      // Floor Card Outer Box
      page.drawRectangle({
        x: fx,
        y: fy,
        width: fCardW,
        height: fCardH,
        color: COLOR_WHITE,
        borderColor: COLOR_BORDER,
        borderWidth: 1,
      });

      // Floor Header Ribbon
      const fHeaderH = 20;
      const fHeaderY = fy + fCardH - fHeaderH;
      page.drawRectangle({
        x: fx + 0.5,
        y: fHeaderY,
        width: fCardW - 1,
        height: fHeaderH,
        color: COLOR_LIGHT_BG,
        borderColor: COLOR_BORDER,
        borderWidth: 0.5,
      });

      // Floor Title (left) - 100% English
      const floorLabel = toEnglishText(fl.floor).toUpperCase();
      page.drawText(floorLabel, {
        x: fx + 8,
        y: fHeaderY + 6,
        size: 8.5,
        font,
        color: COLOR_CHARCOAL,
      });

      // Floor Badge (right)
      let badgeText = `${fl.rooms.length} ENCLOSED ROOMS`;
      if (options.isCombined) {
        const e1 = fl.est1Students ?? fl.rooms.reduce((s, r) => s + (r.est1Count || 0), 0);
        const e2 = fl.est2Students ?? fl.rooms.reduce((s, r) => s + (r.est2Count || 0), 0);
        if (e1 > 0 || e2 > 0) {
          badgeText = `${fl.rooms.length} ROOMS (${e1} E1 • ${e2} E2)`;
        }
      }
      const badgeW = font.widthOfTextAtSize(badgeText, 7.5);
      page.drawText(badgeText, {
        x: fx + fCardW - badgeW - 8,
        y: fHeaderY + 6,
        size: 7.5,
        font,
        color: COLOR_MUTED,
      });

      // Rooms Grid inside Floor Card
      const rAreaTop = fHeaderY - 4;
      const rAreaBottom = fy + 4;
      const rAreaH = rAreaTop - rAreaBottom;
      const rAreaW = fCardW - 12;

      const rCount = fl.rooms.length;
      const rCols = floorCols === 1
        ? (rCount > 6 ? 4 : rCount > 3 ? 3 : rCount)
        : (rCount > 6 ? 3 : rCount > 2 ? 2 : rCount);
      const rRows = Math.max(1, Math.ceil(rCount / Math.max(1, rCols)));
      const rGapX = 5;
      const rGapY = 4;
      const rCellW = (rAreaW - (rCols - 1) * rGapX) / rCols;
      const rCellH = Math.min(26, (rAreaH - (rRows - 1) * rGapY) / rRows);

      for (let ri = 0; ri < rCount; ri++) {
        const rm = fl.rooms[ri];
        const rCol = ri % rCols;
        const rRow = Math.floor(ri / rCols);
        const rcx = fx + 6 + rCol * (rCellW + rGapX);
        const rcy = rAreaTop - (rRow + 1) * rCellH - rRow * rGapY;

        // Room Chip Background
        page.drawRectangle({
          x: rcx,
          y: rcy,
          width: rCellW,
          height: rCellH,
          color: COLOR_LIGHT_BG,
          borderColor: COLOR_BORDER,
          borderWidth: 0.6,
        });

        // Checkbox square (10x10)
        page.drawRectangle({
          x: rcx + 5,
          y: rcy + (rCellH - 10) / 2,
          width: 10,
          height: 10,
          color: COLOR_WHITE,
          borderColor: COLOR_CHARCOAL,
          borderWidth: 0.8,
        });

        // Room Name Label
        const rmRaw = typeof rm === "string" ? rm : rm.room;
        let label = toEnglishText(rmRaw);
        if (options.isCombined && typeof rm === "object" && rm !== null) {
          const e1 = rm.est1Count || 0;
          const e2 = rm.est2Count || 0;
          if (e1 > 0 || e2 > 0) {
            label += ` (${e1}|${e2})`;
          }
        }
        let fSize = 8;
        let textW = font.widthOfTextAtSize(label, fSize);
        if (textW > rCellW - 20) {
          fSize = Math.max(6, ((rCellW - 20) / textW) * fSize);
          textW = font.widthOfTextAtSize(label, fSize);
        }

        page.drawText(label, {
          x: rcx + 18,
          y: rcy + (rCellH - fSize) / 2 + 1,
          size: fSize,
          font,
          color: COLOR_CHARCOAL,
        });
      }
    }
  }
}

/**
 * 1. Building Master Carton Sticker (A4 Landscape)
 * Generates single-page official carton placard.
 */
export async function generateBuildingCartonStickerPdf(
  options: LogisticsStickerOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  await renderBuildingCartonPage(pdfDoc, options, font, logoImg);
  return await pdfDoc.save();
}

/**
 * Batch Building Master Carton Stickers (A4 Landscape Multi-Page)
 * Generates a unified multi-page PDF where each carton placard occupies one complete A4 page.
 */
export async function generateBatchBuildingCartonStickersPdf(
  cartons: LogisticsStickerOptions[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  for (const cartonOpt of cartons) {
    await renderBuildingCartonPage(pdfDoc, cartonOpt, font, logoImg);
  }

  return await pdfDoc.save();
}

/**
 * 2. Exam Transit Bag Sticker (A4 Portrait)
 * Contains the subject checklists with checkboxes [ ] for EST I or EST II.
 */
export async function generateExamBagChecklistPdf(
  options: LogisticsStickerOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  // A4 Portrait: 595.28 x 841.89 pt
  const width = 595.28;
  const height = 841.89;
  const page = pdfDoc.addPage([width, height]);

  const margin = 20;
  const cardX = margin;
  const cardY = margin;
  const cardW = width - margin * 2;
  const cardH = height - margin * 2;

  // Outer framing card
  page.drawRectangle({
    x: cardX,
    y: cardY,
    width: cardW,
    height: cardH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 2,
  });

  // Inner Gold Accent border
  page.drawRectangle({
    x: cardX + 3.5,
    y: cardY + 3.5,
    width: cardW - 7,
    height: cardH - 7,
    borderColor: COLOR_GOLD,
    borderWidth: 1,
  });

  // Header Bar
  const headerH = 60;
  const headerY = cardY + cardH - headerH - 8;
  const logoH = 42;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 0;
  const logoX = cardX + 14;
  const logoY = headerY + (headerH - logoH) / 2;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  }

  const textStartX = logoImg ? logoX + logoW + 12 : cardX + 14;
  const rawExam = options.examName || "EST";
  const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(rawExam);
  const examLabel = isEst2 ? "EST II" : "EST I";

  page.drawText(`${examLabel} — EXAM TRANSIT BAG & MANIFEST`, {
    x: textStartX,
    y: headerY + 34,
    size: 13,
    font,
    color: COLOR_CHARCOAL,
  });

  page.drawText("EXAM TRANSIT BAG MANIFEST & SECURITY VERIFICATION CHECKLIST", {
    x: textStartX,
    y: headerY + 16,
    size: 9.5,
    font,
    color: COLOR_MUTED,
  });

  // Divider Line
  page.drawLine({
    start: { x: cardX + 10, y: headerY },
    end: { x: cardX + cardW - 10, y: headerY },
    thickness: 1.2,
    color: COLOR_GOLD,
  });

  // Location Highlight Banner
  const locY = headerY - 50;
  const locH = 44;
  page.drawRectangle({
    x: cardX + 10,
    y: locY,
    width: cardW - 20,
    height: locH,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 0.8,
  });

  page.drawText(`GOVERNORATE: ${options.governorate || "All Governorates"}    •    CENTER: ${options.center || "Main Center"}`, {
    x: cardX + 18,
    y: locY + 24,
    size: 9,
    font,
    color: COLOR_MUTED,
  });

  page.drawText(`BUILDING: ${options.building || "Building HQ"}`, {
    x: cardX + 18,
    y: locY + 8,
    size: 12,
    font,
    color: COLOR_CHARCOAL,
  });

  // Instructions Box
  const instrY = locY - 34;
  const instrH = 26;
  page.drawRectangle({
    x: cardX + 10,
    y: instrY,
    width: cardW - 20,
    height: instrH,
    color: COLOR_WHITE,
    borderColor: COLOR_GOLD,
    borderWidth: 1,
  });
  page.drawText("INSTRUCTIONS: Check each subject packet [x] before sealing the transit bag.", {
    x: cardX + 18,
    y: instrY + 8,
    size: 8,
    font,
    color: COLOR_CHARCOAL,
  });

  // Subjects Checklist Table
  const tableTop = instrY - 14;
  const tableBottom = cardY + 28;
  const tableH = tableTop - tableBottom;
  const tableY = tableBottom;

  page.drawRectangle({
    x: cardX + 10,
    y: tableY,
    width: cardW - 20,
    height: tableH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1.2,
  });

  // Table Header Row
  const thH = 30;
  const thY = tableY + tableH - thH;
  page.drawRectangle({
    x: cardX + 11,
    y: thY,
    width: cardW - 22,
    height: thH - 1,
    color: COLOR_CHARCOAL,
  });

  page.drawText("PACKED", { x: cardX + 22, y: thY + 11, size: 9, font, color: COLOR_GOLD });
  page.drawText("EXAMINATION SUBJECT", { x: cardX + 90, y: thY + 11, size: 9, font, color: COLOR_GOLD });
  page.drawText("ENVELOPES COUNT", { x: cardX + 330, y: thY + 11, size: 9, font, color: COLOR_GOLD });
  page.drawText("STATUS", { x: cardX + 460, y: thY + 11, size: 9, font, color: COLOR_GOLD });

  const subjects = isEst2
    ? [
        { code: "MATH1", title: "EST II – Math 1 (Mathematics Level 1)" },
        { code: "MATH2", title: "EST II – Math 2 (Mathematics Level 2)" },
        { code: "BIO", title: "EST II – Biology (E & M)" },
        { code: "CHEM", title: "EST II – Chemistry" },
        { code: "PHY", title: "EST II – Physics" },
      ]
    : [
        { code: "LIT", title: "EST I – Literacy (Reading & Writing)" },
        { code: "MATH", title: "EST I – Mathematics" },
        { code: "ESSAY", title: "EST I – Essay (Optional Component)" },
      ];

  const rowH = (tableH - thH) / subjects.length;

  for (let i = 0; i < subjects.length; i++) {
    const sub = subjects[i];
    const ry = thY - (i + 1) * rowH;

    // Alternating zebra
    if (i % 2 === 1) {
      page.drawRectangle({
        x: cardX + 11,
        y: ry,
        width: cardW - 22,
        height: rowH,
        color: COLOR_LIGHT_BG,
      });
    }

    // Row divider
    if (i > 0) {
      page.drawLine({
        start: { x: cardX + 11, y: ry + rowH },
        end: { x: cardX + cardW - 11, y: ry + rowH },
        thickness: 0.8,
        color: COLOR_BORDER,
      });
    }

    // Checkbox Square (Large and clear for pen check)
    const cbSize = 18;
    page.drawRectangle({
      x: cardX + 26,
      y: ry + (rowH - cbSize) / 2,
      width: cbSize,
      height: cbSize,
      color: COLOR_WHITE,
      borderColor: COLOR_CHARCOAL,
      borderWidth: 1.4,
    });

    // Subject title
    page.drawText(sub.title, {
      x: cardX + 90,
      y: ry + (rowH - 12) / 2 + 1,
      size: 12,
      font,
      color: COLOR_CHARCOAL,
    });

    // Envelopes fill-in box
    page.drawText("[ ________ ] Envelopes", {
      x: cardX + 330,
      y: ry + (rowH - 11) / 2 + 1,
      size: 11,
      font,
      color: COLOR_CHARCOAL,
    });

    // Verified checkbox
    page.drawRectangle({
      x: cardX + 460,
      y: ry + (rowH - 14) / 2,
      width: 14,
      height: 14,
      color: COLOR_WHITE,
      borderColor: COLOR_CHARCOAL,
      borderWidth: 1,
    });
    page.drawText("Verified", {
      x: cardX + 482,
      y: ry + (rowH - 9) / 2 + 1,
      size: 9,
      font,
      color: COLOR_MUTED,
    });
  }

  // Footer Note
  const footerNote = "CONFIDENTIAL & STRICTLY CONTROLLED — TRANSIT BAG MANIFEST";
  const noteW = font.widthOfTextAtSize(footerNote, 7.5);
  page.drawText(footerNote, {
    x: cardX + (cardW - noteW) / 2,
    y: cardY + 10,
    size: 7.5,
    font,
    color: COLOR_MUTED,
  });

  return await pdfDoc.save();
}

/**
 * 3a-1. Master Center & Building Examination Manifest Page (A4 Portrait)
 * Comprehensive single-page blueprint detailing all floors, rooms, subjects for EST 1 & EST 2,
 * and candidate counts.
 */
export async function drawMasterBuildingManifestPage(
  pdfDoc: PDFDocument,
  font: any,
  logoImg: any,
  options: LogisticsStickerOptions,
  pageIndex = 1,
  totalPages = 2,
): Promise<any> {
  const width = 595.28;
  const height = 841.89;
  const page = pdfDoc.addPage([width, height]);

  const margin = 20;
  const cardX = margin;
  const cardY = margin;
  const cardW = width - margin * 2;
  const cardH = height - margin * 2;

  // Outer framing card with Charcoal/Gold double border
  page.drawRectangle({
    x: cardX,
    y: cardY,
    width: cardW,
    height: cardH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1.5,
  });

  page.drawRectangle({
    x: cardX + 3,
    y: cardY + 3,
    width: cardW - 6,
    height: cardH - 6,
    borderColor: COLOR_GOLD,
    borderWidth: 0.75,
  });

  const innerCardW = cardW - 12;
  const innerCardX = cardX + 6;

  // 1. Top Header Banner
  const headerH = 58;
  const headerY = cardY + cardH - headerH - 8;

  page.drawRectangle({
    x: innerCardX,
    y: headerY,
    width: innerCardW,
    height: headerH,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 0.75,
  });

  const logoH = 40;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 0;
  const logoX = innerCardX + 10;
  const logoY = headerY + (headerH - logoH) / 2;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  }

  const textStartX = logoImg ? logoX + logoW + 10 : innerCardX + 12;

  page.drawText("EGYPTIAN SCHOLASTIC TEST (EST) — OFFICIAL LOGISTICS", {
    x: textStartX,
    y: headerY + 41,
    size: 7.5,
    font,
    color: COLOR_GOLD,
  });

  page.drawText("MASTER CENTER & BUILDING EXAMINATION MANIFEST", {
    x: textStartX,
    y: headerY + 24,
    size: 12.5,
    font,
    color: COLOR_CHARCOAL,
  });

  page.drawText("CONTROL ROOM BLUEPRINT • ROOM-BY-ROOM ALLOCATION & CANDIDATE BREAKDOWN (EST I & EST II)", {
    x: textStartX,
    y: headerY + 11,
    size: 7,
    font,
    color: COLOR_MUTED,
  });

  // Right Badge Box
  const badgeW = 120;
  const badgeH = 44;
  const badgeX = innerCardX + innerCardW - badgeW - 8;
  const badgeY = headerY + (headerH - badgeH) / 2;

  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeW,
    height: badgeH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 0.8,
  });

  const bText1 = "CONTROL ROOM MASTER";
  const bText1W = font.widthOfTextAtSize(bText1, 7.5);
  page.drawText(bText1, {
    x: badgeX + (badgeW - bText1W) / 2,
    y: badgeY + 28,
    size: 7.5,
    font,
    color: COLOR_CHARCOAL,
  });

  const bText2 = "CHIEF PROCTOR DOSSIER";
  const bText2W = font.widthOfTextAtSize(bText2, 6.5);
  page.drawText(bText2, {
    x: badgeX + (badgeW - bText2W) / 2,
    y: badgeY + 16,
    size: 6.5,
    font,
    color: COLOR_MUTED,
  });

  const bText3 = `PAGE ${pageIndex} OF ${totalPages}`;
  const bText3W = font.widthOfTextAtSize(bText3, 7);
  page.drawText(bText3, {
    x: badgeX + (badgeW - bText3W) / 2,
    y: badgeY + 5,
    size: 7,
    font,
    color: COLOR_GOLD,
  });

  // 2. Location & Session Info Bar
  const metaH = 28;
  const metaY = headerY - metaH - 5;
  page.drawRectangle({
    x: innerCardX,
    y: metaY,
    width: innerCardW,
    height: metaH,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 0.6,
  });

  const colMetaW = innerCardW / 4;
  const metaFields = [
    { label: "EXAMINATION CYCLE", val: options.date || "December 2026" },
    { label: "GOVERNORATE", val: options.governorate || "All Governorates" },
    { label: "CENTER / SCHOOL", val: options.center || options.building || "Main Center" },
    { label: "BUILDING", val: options.building || "Building HQ" },
  ];

  metaFields.forEach((mf, i) => {
    const fx = innerCardX + i * colMetaW + 8;
    page.drawText(mf.label, {
      x: fx,
      y: metaY + 16,
      size: 5.5,
      font,
      color: COLOR_MUTED,
    });
    let displayVal = mf.val;
    if (displayVal.length > 28) displayVal = displayVal.slice(0, 26) + "...";
    page.drawText(displayVal, {
      x: fx,
      y: metaY + 6,
      size: 8,
      font,
      color: COLOR_CHARCOAL,
    });
    if (i < 3) {
      page.drawLine({
        start: { x: innerCardX + (i + 1) * colMetaW, y: metaY + 4 },
        end: { x: innerCardX + (i + 1) * colMetaW, y: metaY + metaH - 4 },
        thickness: 0.5,
        color: COLOR_BORDER,
      });
    }
  });

  // 3. Metric KPI Badges Bar
  const normalizedFloors = normalizeFloorsData(options);
  const totalFloors = normalizedFloors.length;
  const allRooms = normalizedFloors.flatMap((f) => f.rooms);
  const totalRooms = allRooms.length;
  const totalEst1 = normalizedFloors.reduce(
    (sum, f) => sum + (f.est1Students ?? f.rooms.reduce((s, r) => s + (r.est1Count || 0), 0)),
    0,
  );
  const totalEst2 = normalizedFloors.reduce(
    (sum, f) => sum + (f.est2Students ?? f.rooms.reduce((s, r) => s + (r.est2Count || 0), 0)),
    0,
  );
  const grandTotal = totalEst1 + totalEst2;

  const kpiH = 26;
  const kpiY = metaY - kpiH - 5;
  const kpiColW = innerCardW / 5;

  const kpiItems = [
    { label: "TOTAL FLOORS", val: `${totalFloors} Floors` },
    { label: "ENCLOSED ROOMS", val: `${totalRooms} Rooms` },
    { label: "EST I CANDIDATES", val: totalEst1 > 0 ? `${totalEst1} Candidates` : "0 (Pending)" },
    { label: "EST II CANDIDATES", val: totalEst2 > 0 ? `${totalEst2} Candidates` : "0 (Pending)" },
    { label: "TOTAL ALLOCATIONS", val: grandTotal > 0 ? `${grandTotal} Sessions` : "0 Sessions" },
  ];

  kpiItems.forEach((item, i) => {
    const kx = innerCardX + i * kpiColW;
    page.drawRectangle({
      x: kx,
      y: kpiY,
      width: kpiColW - 3,
      height: kpiH,
      color: COLOR_LIGHT_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.6,
    });
    const lW = font.widthOfTextAtSize(item.label, 5.5);
    page.drawText(item.label, {
      x: kx + (kpiColW - 3 - lW) / 2,
      y: kpiY + 15,
      size: 5.5,
      font,
      color: COLOR_MUTED,
    });
    const vW = font.widthOfTextAtSize(item.val, 7.5);
    page.drawText(item.val, {
      x: kx + (kpiColW - 3 - vW) / 2,
      y: kpiY + 4.5,
      size: 7.5,
      font,
      color: i === 4 ? COLOR_GOLD : COLOR_CHARCOAL,
    });
  });

  // 4. Bottom Sign-Off Footer
  const footerH = 46;
  const footerY = cardY + 22;
  page.drawRectangle({
    x: innerCardX,
    y: footerY,
    width: innerCardW,
    height: footerH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 0.8,
  });

  const signColW = innerCardW / 3;
  // Sign Box 1
  page.drawText("CHIEF PROCTOR VERIFICATION", { x: innerCardX + 8, y: footerY + 32, size: 6.5, font, color: COLOR_MUTED });
  page.drawText("Name: _______________________________", { x: innerCardX + 8, y: footerY + 18, size: 7, font, color: COLOR_CHARCOAL });
  page.drawText("Signature: __________________________", { x: innerCardX + 8, y: footerY + 6, size: 7, font, color: COLOR_CHARCOAL });

  // Divider 1
  page.drawLine({
    start: { x: innerCardX + signColW, y: footerY + 4 },
    end: { x: innerCardX + signColW, y: footerY + footerH - 4 },
    thickness: 0.5,
    color: COLOR_BORDER,
  });

  // Sign Box 2
  page.drawText("CONTROL ROOM SUPERVISOR", { x: innerCardX + signColW + 8, y: footerY + 32, size: 6.5, font, color: COLOR_MUTED });
  page.drawText("Name: _______________________________", { x: innerCardX + signColW + 8, y: footerY + 18, size: 7, font, color: COLOR_CHARCOAL });
  page.drawText("Signature: __________________________", { x: innerCardX + signColW + 8, y: footerY + 6, size: 7, font, color: COLOR_CHARCOAL });

  // Divider 2
  page.drawLine({
    start: { x: innerCardX + signColW * 2, y: footerY + 4 },
    end: { x: innerCardX + signColW * 2, y: footerY + footerH - 4 },
    thickness: 0.5,
    color: COLOR_BORDER,
  });

  // Sign Box 3
  page.drawText("SECURITY SEAL & DISPATCH", { x: innerCardX + signColW * 2 + 8, y: footerY + 32, size: 6.5, font, color: COLOR_MUTED });
  page.drawText(`Seal ID: [ ${options.securitySeal || "EST-OFFICIAL-SEAL"} ]`, { x: innerCardX + signColW * 2 + 8, y: footerY + 18, size: 7, font, color: COLOR_CHARCOAL });
  page.drawText("Custody Timestamp: __________________", { x: innerCardX + signColW * 2 + 8, y: footerY + 6, size: 7, font, color: COLOR_CHARCOAL });

  // Watermark text at the very bottom
  page.drawText("EST OFFICIAL LOGISTICS • MASTER CENTER & BUILDING MANIFEST • CONTROL ROOM CUSTODY ONLY", {
    x: cardX + 10,
    y: cardY + 8,
    size: 6.5,
    font,
    color: COLOR_MUTED,
  });

  const btmPageInfo = `PAGE ${pageIndex} OF ${totalPages}`;
  const btmInfoW = font.widthOfTextAtSize(btmPageInfo, 6.5);
  page.drawText(btmPageInfo, {
    x: cardX + cardW - btmInfoW - 10,
    y: cardY + 8,
    size: 6.5,
    font,
    color: COLOR_CHARCOAL,
  });

  // 5. Main Directory Table
  const tableTop = kpiY - 6;
  const tableBottom = footerY + footerH + 6;
  const availableTableH = tableTop - tableBottom;
  const tableX = innerCardX;
  const tableW = innerCardW;

  // Outer Table Box
  page.drawRectangle({
    x: tableX,
    y: tableBottom,
    width: tableW,
    height: availableTableH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1,
  });

  // Column headers
  const colHeaderH = 18;
  const colHeaderY = tableTop - colHeaderH;

  page.drawRectangle({
    x: tableX,
    y: colHeaderY,
    width: tableW,
    height: colHeaderH,
    color: COLOR_CHARCOAL,
  });

  // Column width allocations (Total = tableW)
  const colW_room = 46;
  const colW_est1Subj = 175;
  const colW_est1Cand = 54;
  const colW_est2Subj = 175;
  const colW_est2Cand = 54;
  const colW_total = tableW - (colW_room + colW_est1Subj + colW_est1Cand + colW_est2Subj + colW_est2Cand);

  const cX_room = tableX;
  const cX_est1Subj = cX_room + colW_room;
  const cX_est1Cand = cX_est1Subj + colW_est1Subj;
  const cX_est2Subj = cX_est1Cand + colW_est1Cand;
  const cX_est2Cand = cX_est2Subj + colW_est2Subj;
  const cX_total = cX_est2Cand + colW_est2Cand;

  const drawColHeaderText = (text: string, startX: number, w: number, color = COLOR_GOLD) => {
    const tW = font.widthOfTextAtSize(text, 6.8);
    page.drawText(text, {
      x: startX + (w - tW) / 2,
      y: colHeaderY + 5.5,
      size: 6.8,
      font,
      color,
    });
  };

  drawColHeaderText("ROOM #", cX_room, colW_room);
  page.drawText("EST I EXAMINATION & SUBJECTS", { x: cX_est1Subj + 8, y: colHeaderY + 5.5, size: 6.8, font, color: COLOR_GOLD });
  drawColHeaderText("EST I", cX_est1Cand, colW_est1Cand);
  page.drawText("EST II EXAMINATION & SUBJECTS", { x: cX_est2Subj + 8, y: colHeaderY + 5.5, size: 6.8, font, color: COLOR_GOLD });
  drawColHeaderText("EST II", cX_est2Cand, colW_est2Cand);
  drawColHeaderText("TOTAL", cX_total, colW_total);

  // Calculate dynamic row height so all floors and rooms fit comfortably
  const floorHeaderH = 16;
  const totalFloorHeadersH = normalizedFloors.length * floorHeaderH;
  const roomRowsSpace = colHeaderY - tableBottom - totalFloorHeadersH;
  const calculatedRowH = Math.min(22, Math.max(12, roomRowsSpace / Math.max(1, totalRooms)));
  const fontSize = calculatedRowH < 14 ? 6 : calculatedRowH < 17 ? 6.5 : 7.2;

  let currentY = colHeaderY;
  let globalRoomIdx = 0;

  for (const fl of normalizedFloors) {
    // Floor Sub-header banner
    currentY -= floorHeaderH;
    page.drawRectangle({
      x: tableX,
      y: currentY,
      width: tableW,
      height: floorHeaderH,
      color: COLOR_LIGHT_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.5,
    });

    const floorEst1 = fl.est1Students ?? fl.rooms.reduce((s, r) => s + (r.est1Count || 0), 0);
    const floorEst2 = fl.est2Students ?? fl.rooms.reduce((s, r) => s + (r.est2Count || 0), 0);
    const floorText =
      floorEst1 > 0 || floorEst2 > 0
        ? `${fl.floor.toUpperCase()}  —  ${fl.rooms.length} ROOMS  ( ${floorEst1} EST I  •  ${floorEst2} EST II )`
        : `${fl.floor.toUpperCase()}  —  ${fl.rooms.length} ROOMS  ( Pending File Upload )`;

    page.drawText(floorText, {
      x: tableX + 10,
      y: currentY + 4.5,
      size: 7,
      font,
      color: COLOR_CHARCOAL,
    });

    // Rooms for this floor
    for (const rm of fl.rooms) {
      currentY -= calculatedRowH;
      globalRoomIdx++;

      // Zebra striping
      if (globalRoomIdx % 2 === 1) {
        page.drawRectangle({
          x: tableX + 0.5,
          y: currentY + 0.5,
          width: tableW - 1,
          height: calculatedRowH - 0.5,
          color: COLOR_LIGHT_BG,
        });
      }

      // Horizontal border
      page.drawLine({
        start: { x: tableX, y: currentY },
        end: { x: tableX + tableW, y: currentY },
        thickness: 0.4,
        color: COLOR_BORDER,
      });

      // 1. Room Name (Centered)
      const rName = rm.room;
      const rW = font.widthOfTextAtSize(rName, fontSize + 0.5);
      page.drawText(rName, {
        x: cX_room + (colW_room - rW) / 2,
        y: currentY + (calculatedRowH - fontSize) / 2 + 1,
        size: fontSize + 0.5,
        font,
        color: COLOR_CHARCOAL,
      });

      // 2. EST 1 Subjects (Real parsed subjects only, or "—" if not uploaded yet)
      let e1Subj = rm.est1Subjects || "—";
      if (e1Subj.length > 34) e1Subj = e1Subj.slice(0, 32) + "...";
      page.drawText(e1Subj, {
        x: cX_est1Subj + 6,
        y: currentY + (calculatedRowH - fontSize) / 2 + 1,
        size: fontSize,
        font,
        color: rm.est1Subjects ? COLOR_CHARCOAL : COLOR_MUTED,
      });

      // 3. EST 1 Count (Centered - Real count or "—" if empty)
      const e1Cnt = rm.est1Count !== undefined && rm.est1Count > 0 ? String(rm.est1Count) : "—";
      const e1W = font.widthOfTextAtSize(e1Cnt, fontSize + 0.5);
      page.drawText(e1Cnt, {
        x: cX_est1Cand + (colW_est1Cand - e1W) / 2,
        y: currentY + (calculatedRowH - fontSize) / 2 + 1,
        size: fontSize + 0.5,
        font,
        color: rm.est1Count ? COLOR_CHARCOAL : COLOR_MUTED,
      });

      // 4. EST 2 Subjects (Real parsed subjects only, or "—" if not uploaded yet)
      let e2Subj = rm.est2Subjects || "—";
      if (e2Subj.length > 34) e2Subj = e2Subj.slice(0, 32) + "...";
      page.drawText(e2Subj, {
        x: cX_est2Subj + 6,
        y: currentY + (calculatedRowH - fontSize) / 2 + 1,
        size: fontSize,
        font,
        color: rm.est2Subjects ? COLOR_CHARCOAL : COLOR_MUTED,
      });

      // 5. EST 2 Count (Centered - Real count or "—" if empty)
      const e2Cnt = rm.est2Count !== undefined && rm.est2Count > 0 ? String(rm.est2Count) : "—";
      const e2W = font.widthOfTextAtSize(e2Cnt, fontSize + 0.5);
      page.drawText(e2Cnt, {
        x: cX_est2Cand + (colW_est2Cand - e2W) / 2,
        y: currentY + (calculatedRowH - fontSize) / 2 + 1,
        size: fontSize + 0.5,
        font,
        color: rm.est2Count ? COLOR_CHARCOAL : COLOR_MUTED,
      });

      // 6. Total Count (Centered - Real combined allocations or "—" if 0)
      const rSum = (rm.est1Count || 0) + (rm.est2Count || 0);
      const rTotal = rSum > 0 ? String(rSum) : "—";
      const totW = font.widthOfTextAtSize(rTotal, fontSize + 0.5);
      page.drawText(rTotal, {
        x: cX_total + (colW_total - totW) / 2,
        y: currentY + (calculatedRowH - fontSize) / 2 + 1,
        size: fontSize + 0.5,
        font,
        color: rSum > 0 ? COLOR_GOLD : COLOR_MUTED,
      });
    }
  }

  // Draw Vertical Column Lines across the entire table
  const colLines = [cX_est1Subj, cX_est1Cand, cX_est2Subj, cX_est2Cand, cX_total];
  for (const lineX of colLines) {
    page.drawLine({
      start: { x: lineX, y: colHeaderY + colHeaderH },
      end: { x: lineX, y: tableBottom },
      thickness: 0.5,
      color: COLOR_BORDER,
    });
  }

  return page;
}

/**
 * 3a-2. Emergency Reserve Dispatch Log Sheet Page (A4 Portrait)
 * Attached to the emergency reserve packet bag, with 18 incident tracking rows.
 */
export async function drawCleanSkinDispatchLogPage(
  pdfDoc: PDFDocument,
  font: any,
  logoImg: any,
  options: LogisticsStickerOptions,
  pageIndex = 2,
  totalPages = 2,
): Promise<any> {
  const width = 595.28;
  const height = 841.89;
  const page = pdfDoc.addPage([width, height]);

  // Safe 24pt margins to ensure 100% single-page output across all printers
  const margin = 24;
  const cardX = margin;
  const cardY = margin;
  const cardW = width - margin * 2;
  const cardH = height - margin * 2;

  // Outer framing card with Emergency Border
  page.drawRectangle({
    x: cardX,
    y: cardY,
    width: cardW,
    height: cardH,
    color: COLOR_WHITE,
    borderColor: COLOR_EMERGENCY_RED,
    borderWidth: 2,
  });

  page.drawRectangle({
    x: cardX + 3,
    y: cardY + 3,
    width: cardW - 6,
    height: cardH - 6,
    borderColor: COLOR_GOLD,
    borderWidth: 1,
  });

  // Emergency Header Banner
  const headerH = 68;
  const headerY = cardY + cardH - headerH - 8;
  const innerCardW = cardW - 12;
  const innerCardX = cardX + 6;

  page.drawRectangle({
    x: innerCardX,
    y: headerY,
    width: innerCardW,
    height: headerH,
    color: COLOR_EMERGENCY_LIGHT,
    borderColor: COLOR_EMERGENCY_RED,
    borderWidth: 0.6,
  });

  const logoH = 42;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 0;
  const logoX = innerCardX + 12;
  const logoY = headerY + (headerH - logoH) / 2;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  }

  const textStartX = logoImg ? logoX + logoW + 12 : innerCardX + 14;
  const rawExam = options.examName || "EST";
  const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(rawExam);
  const examLabel = isEst2 ? "EST II" : "EST I";

  page.drawText(`${examLabel} — OFFICIAL EMERGENCY RESERVE (CLEAN SKIN)`, {
    x: textStartX,
    y: headerY + 44,
    size: 11.5,
    font,
    color: COLOR_EMERGENCY_RED,
  });

  page.drawText("EMERGENCY & RESERVE EXAM PAPERS PACKET — CONTROL MASTER CUSTODY", {
    x: textStartX,
    y: headerY + 27,
    size: 8.5,
    font,
    color: COLOR_CHARCOAL,
  });

  page.drawText("STRICTLY CONFIDENTIAL — FOR EMERGENCY REPLACEMENTS ONLY", {
    x: textStartX,
    y: headerY + 12,
    size: 7,
    font,
    color: COLOR_MUTED,
  });

  // Warning Banner
  const warnH = 22;
  const warnY = headerY - warnH - 6;
  page.drawRectangle({
    x: innerCardX,
    y: warnY,
    width: innerCardW,
    height: warnH,
    color: COLOR_CHARCOAL,
  });

  const warnText = "ATTENTION: DO NOT OPEN EXCEPT UPON CHIEF PROCTOR APPROVAL FOR ACTIVE INCIDENTS";
  const warnW = font.widthOfTextAtSize(warnText, 7.5);
  page.drawText(warnText, {
    x: innerCardX + (innerCardW - warnW) / 2,
    y: warnY + 7,
    size: 7.5,
    font,
    color: COLOR_GOLD,
  });

  // Location details
  const locH = 34;
  const locY = warnY - locH - 6;
  page.drawRectangle({
    x: innerCardX,
    y: locY,
    width: innerCardW,
    height: locH,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 0.75,
  });

  page.drawText(`GOVERNORATE: ${options.governorate || "Alexandria"}    •    CENTER: ${options.center || "Main Center"}`, {
    x: innerCardX + 12,
    y: locY + 19,
    size: 8,
    font,
    color: COLOR_MUTED,
  });
  page.drawText(`BUILDING: ${options.building || "Building HQ"}    •    SESSION: ${options.date || "December 2026"}`, {
    x: innerCardX + 12,
    y: locY + 7,
    size: 9,
    font,
    color: COLOR_CHARCOAL,
  });

  // Emergency Dispatch Log Table
  const footerH = 16;
  const tableTop = locY - 8;
  const tableBottom = cardY + 8 + footerH;
  const tableH = tableTop - tableBottom;
  const tableX = innerCardX;
  const tableW = innerCardW;
  const tableY = tableBottom;

  // Outer Table Box
  page.drawRectangle({
    x: tableX,
    y: tableY,
    width: tableW,
    height: tableH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1.2,
  });

  // Table Title Bar
  const thH = 22;
  const thY = tableTop - thH;
  page.drawRectangle({
    x: tableX,
    y: thY,
    width: tableW,
    height: thH,
    color: COLOR_CHARCOAL,
  });

  page.drawText("EMERGENCY DISPATCH LOG SHEET", {
    x: tableX + 12,
    y: thY + 7,
    size: 8.5,
    font,
    color: COLOR_GOLD,
  });

  const subTitle = "[ MANUAL INCIDENT DISPATCH RECORD ]";
  const subTitleW = font.widthOfTextAtSize(subTitle, 7);
  page.drawText(subTitle, {
    x: tableX + tableW - subTitleW - 12,
    y: thY + 7.5,
    size: 7,
    font,
    color: COLOR_GOLD,
  });

  // Table Column Definitions
  const colHeaderH = 22;
  const colHeaderY = thY - colHeaderH;

  const w0 = 28;  // #
  const w1 = 52;  // TIME
  const w2 = 60;  // ROOM
  const w3 = 135; // SUBJECT
  const w4 = 52;  // COPIES
  const w5 = tableW - (w0 + w1 + w2 + w3 + w4); // REASON / NOTES

  const colWidths = [w0, w1, w2, w3, w4, w5];
  const colX = [
    tableX,
    tableX + w0,
    tableX + w0 + w1,
    tableX + w0 + w1 + w2,
    tableX + w0 + w1 + w2 + w3,
    tableX + w0 + w1 + w2 + w3 + w4,
    tableX + tableW,
  ];

  // Column Header Background
  page.drawRectangle({
    x: tableX,
    y: colHeaderY,
    width: tableW,
    height: colHeaderH,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 0.8,
  });

  const drawCenteredHeader = (text: string, startX: number, colW: number) => {
    const textW = font.widthOfTextAtSize(text, 7.5);
    page.drawText(text, {
      x: startX + (colW - textW) / 2,
      y: colHeaderY + 7,
      size: 7.5,
      font,
      color: COLOR_CHARCOAL,
    });
  };

  drawCenteredHeader("#", colX[0], w0);
  drawCenteredHeader("TIME", colX[1], w1);
  drawCenteredHeader("ROOM", colX[2], w2);
  page.drawText("SUBJECT", { x: colX[3] + 10, y: colHeaderY + 7, size: 7.5, font, color: COLOR_CHARCOAL });
  drawCenteredHeader("COPIES", colX[4], w4);
  page.drawText("REASON / NOTES (DEFECT / EXTRA)", { x: colX[5] + 10, y: colHeaderY + 7, size: 7.5, font, color: COLOR_CHARCOAL });

  // 18 Rows with Zebra Striping
  const numRows = 18;
  const availableRowsH = colHeaderY - tableBottom;
  const rowH = availableRowsH / numRows;

  for (let r = 0; r < numRows; r++) {
    const ry = colHeaderY - (r + 1) * rowH;

    if (r % 2 === 1) {
      page.drawRectangle({
        x: tableX + 0.5,
        y: ry + 0.5,
        width: tableW - 1,
        height: rowH - 0.5,
        color: COLOR_LIGHT_BG,
      });
    }

    page.drawLine({
      start: { x: tableX, y: ry },
      end: { x: tableX + tableW, y: ry },
      thickness: 0.5,
      color: COLOR_BORDER,
    });

    const rowNumStr = String(r + 1);
    const numW = font.widthOfTextAtSize(rowNumStr, 7.5);
    page.drawText(rowNumStr, {
      x: colX[0] + (w0 - numW) / 2,
      y: ry + (rowH - 7.5) / 2 + 1,
      size: 7.5,
      font,
      color: COLOR_MUTED,
    });
  }

  for (let i = 1; i < colX.length - 1; i++) {
    page.drawLine({
      start: { x: colX[i], y: thY },
      end: { x: colX[i], y: tableBottom },
      thickness: 0.6,
      color: COLOR_BORDER,
    });
  }

  // Bottom Footer Bar
  const footerY = cardY + 7;
  page.drawText("EST OFFICIAL LOGISTICS • EMERGENCY RESERVE MASTER LOG • CONTROL ROOM CUSTODY ONLY", {
    x: cardX + 12,
    y: footerY,
    size: 6.5,
    font,
    color: COLOR_MUTED,
  });

  const pageInfo = `PAGE ${pageIndex} OF ${totalPages}`;
  const pageInfoW = font.widthOfTextAtSize(pageInfo, 6.5);
  page.drawText(pageInfo, {
    x: cardX + cardW - pageInfoW - 12,
    y: footerY,
    size: 6.5,
    font,
    color: COLOR_CHARCOAL,
  });

  return page;
}

/**
 * 3a. Complete Emergency Reserve Master Packet (2 Pages A4 Portrait)
 * Page 1: Master Center & Building Examination Manifest (all center/building details in one page)
 * Page 2: Emergency Reserve Dispatch Log Sheet (18 zebra-striped incident rows)
 */
export async function generateCleanSkinMasterPdf(
  options: LogisticsStickerOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  // Page 1: Master Center & Building Examination Manifest
  await drawMasterBuildingManifestPage(pdfDoc, font, logoImg, options, 1, 2);

  // Page 2: Emergency Reserve Dispatch Log Sheet
  await drawCleanSkinDispatchLogPage(pdfDoc, font, logoImg, options, 2, 2);

  return await pdfDoc.save();
}

/**
 * Standalone Master Center & Building Examination Manifest (Single Page A4 Portrait)
 */
export async function generateMasterBuildingManifestPdf(
  options: LogisticsStickerOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  await drawMasterBuildingManifestPage(pdfDoc, font, logoImg, options, 1, 1);

  return await pdfDoc.save();
}

/**
 * Standalone Emergency Dispatch Log Sheet (Single Page A4 Portrait)
 */
export async function generateCleanSkinDispatchLogPdf(
  options: LogisticsStickerOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  await drawCleanSkinDispatchLogPage(pdfDoc, font, logoImg, options, 1, 1);

  return await pdfDoc.save();
}

/**
 * 3b. Subject Clean Skin Stickers (Quarter A4, 4-up on A4 Landscape)
 * Blank quantity field left for manual pen entry after packing.
 */
export async function generateCleanSkinSubjectStickersPdf(
  options: LogisticsStickerOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  const rawExam = options.examName || "EST";
  const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(rawExam);
  const examPrefix = isEst2 ? "EST II" : "EST I";

  const subjects = isEst2
    ? [
        { code: "MATH1", title: `${examPrefix} – Math 1` },
        { code: "MATH2", title: `${examPrefix} – Math 2` },
        { code: "BIO", title: `${examPrefix} – Biology` },
        { code: "CHEM", title: `${examPrefix} – Chemistry` },
        { code: "PHY", title: `${examPrefix} – Physics` },
      ]
    : [
        { code: "LIT", title: `${examPrefix} – Literacy` },
        { code: "MATH", title: `${examPrefix} – Math` },
        { code: "ESSAY", title: `${examPrefix} – Essay` },
      ];

  // Standard A4 Portrait in points: 595.28 x 841.89 pt
  const a4Width = 595.28;
  const a4Height = 841.89;
  const midX = a4Width / 2;
  const midY = a4Height / 2;

  const quadrants = [
    { x: 0, y: midY, width: midX, height: midY },    // Top-Left
    { x: midX, y: midY, width: midX, height: midY }, // Top-Right
    { x: 0, y: 0, width: midX, height: midY },       // Bottom-Left
    { x: midX, y: 0, width: midX, height: midY },    // Bottom-Right
  ];

  // Draw 2 copies per subject (or chunk 4 per page)
  const items: Array<{ subject: string; code: string; copyIndex: number }> = [];
  for (const s of subjects) {
    items.push({ subject: s.title, code: s.code, copyIndex: 1 });
    items.push({ subject: s.title, code: s.code, copyIndex: 2 });
  }

  for (let i = 0; i < items.length; i += 4) {
    const pageItems = items.slice(i, i + 4);
    const page = pdfDoc.addPage([a4Width, a4Height]);

    // Cutting guide lines
    page.drawLine({
      start: { x: midX, y: 0 },
      end: { x: midX, y: a4Height },
      thickness: 0.5,
      color: COLOR_BORDER,
      dashArray: [4, 4],
    });
    page.drawLine({
      start: { x: 0, y: midY },
      end: { x: a4Width, y: midY },
      thickness: 0.5,
      color: COLOR_BORDER,
      dashArray: [4, 4],
    });

    for (let qIdx = 0; qIdx < pageItems.length; qIdx++) {
      const q = quadrants[qIdx];
      const item = pageItems[qIdx];
      drawQuarterCleanSkinSticker({
        page,
        font,
        logoImg,
        options,
        item,
        slotX: q.x,
        slotY: q.y,
        slotWidth: q.width,
        slotHeight: q.height,
      });
    }
  }

  return await pdfDoc.save();
}

/**
 * Draws a single Quarter A4 Clean Skin sticker.
 */
function drawQuarterCleanSkinSticker(params: {
  page: any;
  font: any;
  logoImg: any;
  options: LogisticsStickerOptions;
  item: { subject: string; code: string; copyIndex: number };
  slotX: number;
  slotY: number;
  slotWidth: number;
  slotHeight: number;
}) {
  const { page, font, logoImg, options, item, slotX, slotY, slotWidth, slotHeight } = params;

  const margin = 12;
  const x = slotX + margin;
  const y = slotY + margin;
  const width = slotWidth - margin * 2;
  const height = slotHeight - margin * 2;

  // NO OUTER BORDER BOX around sticker (per user request)

  // Header: Logo & Clean Skin tag
  const logoH = 26;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 0;
  const logoX = x + 4;
  const logoY = y + height - 4 - logoH;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  }

  const textStartX = logoImg ? logoX + logoW + 10 : x + 6;
  page.drawText("CLEAN SKIN", {
    x: textStartX,
    y: logoY + 7,
    size: 14,
    font,
    color: COLOR_CHARCOAL,
  });

  // Copy badge
  const copyText = `PACKET ${item.copyIndex}`;
  const copySize = 7.5;
  const copyW = font.widthOfTextAtSize(copyText, copySize);
  const copyBadgeW = copyW + 12;
  const copyBadgeH = 16;
  const copyBadgeX = x + width - copyBadgeW - 4;
  const copyBadgeY = logoY + (logoH - copyBadgeH) / 2;

  page.drawRectangle({
    x: copyBadgeX,
    y: copyBadgeY,
    width: copyBadgeW,
    height: copyBadgeH,
    color: COLOR_EMERGENCY_LIGHT,
    borderColor: COLOR_EMERGENCY_RED,
    borderWidth: 0.5,
  });

  page.drawText(copyText, {
    x: copyBadgeX + (copyBadgeW - copyW) / 2,
    y: copyBadgeY + 4,
    size: copySize,
    font,
    color: COLOR_EMERGENCY_RED,
  });

  const headerBottom = logoY - 6;

  // Divider line
  page.drawLine({
    start: { x: x + 4, y: headerBottom },
    end: { x: x + width - 4, y: headerBottom },
    thickness: 1,
    color: COLOR_GOLD,
  });

  // Location ribbon broken into clean lines ("نكسر الصف")
  const center = (options.center || "").trim();
  const gov = (options.governorate || "").trim();
  let bld = (options.building || "").trim();
  if (bld.toLowerCase() === center.toLowerCase()) bld = "";

  const locLines: string[] = [];
  if (center) locLines.push(center);
  const sub = [gov, bld].filter(Boolean).join("   •   ");
  if (sub) locLines.push(sub);
  if (locLines.length === 0) locLines.push("Examination Center");

  const ribbonH = locLines.length > 1 ? 24 : 16;
  const ribbonY = headerBottom - 6 - ribbonH;
  page.drawRectangle({
    x: x + 4,
    y: ribbonY,
    width: width - 8,
    height: ribbonH,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 0.5,
  });

  let lineY = ribbonY + (locLines.length > 1 ? 13 : 4);
  for (const line of locLines) {
    const lSize = 7.5;
    let lW = font.widthOfTextAtSize(line, lSize);
    const maxW = width - 20;
    const effSize = lW > maxW ? Math.max(6, (maxW / lW) * lSize) : lSize;
    lW = font.widthOfTextAtSize(line, effSize);
    page.drawText(line, {
      x: x + (width - lW) / 2,
      y: lineY,
      size: effSize,
      font,
      color: COLOR_CHARCOAL,
    });
    lineY -= 9.5;
  }

  // Body Layout in Portrait
  const bodyTop = ribbonY - 10;

  // 1. EXAM SUBJECT SECTION (Prominent, clean, centered)
  const subjSectionY = bodyTop - 12;
  const bannerTitle = "EXAM SUBJECT:";
  const bannerTitleSize = 9;
  const bannerTitleW = font.widthOfTextAtSize(bannerTitle, bannerTitleSize);
  page.drawText(bannerTitle, {
    x: x + (width - bannerTitleW) / 2,
    y: subjSectionY,
    size: bannerTitleSize,
    font,
    color: COLOR_MUTED,
  });

  const subjText = item.subject.toUpperCase();
  let subjSize = 22;
  let subjW = font.widthOfTextAtSize(subjText, subjSize);
  if (subjW > width - 20) {
    subjSize = Math.max(13, ((width - 20) / subjW) * subjSize);
    subjW = font.widthOfTextAtSize(subjText, subjSize);
  }
  const subjY = subjSectionY - 10 - subjSize;
  page.drawText(subjText, {
    x: x + (width - subjW) / 2,
    y: subjY,
    size: subjSize,
    font,
    color: COLOR_CHARCOAL,
  });

  const subjDividerY = subjY - 14;
  page.drawLine({
    start: { x: x + 4, y: subjDividerY },
    end: { x: x + width - 4, y: subjDividerY },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  // 3. MANUAL QUANTITY ENTRY BOX
  const countBoxY = y + 14;
  const countBoxH = subjDividerY - countBoxY - 12;

  page.drawRectangle({
    x: x + 4,
    y: countBoxY,
    width: width - 8,
    height: countBoxH,
    color: COLOR_WHITE,
    borderColor: COLOR_GOLD,
    borderWidth: 1.2,
  });

  page.drawText("PACKET QUANTITY (WRITE BY HAND):", {
    x: x + 12,
    y: countBoxY + countBoxH - 16,
    size: 7.5,
    font,
    color: COLOR_MUTED,
  });

  const manualCountText = "COUNT: [  ____________  ]  COPIES";
  const manualW = font.widthOfTextAtSize(manualCountText, 12.5);
  page.drawText(manualCountText, {
    x: x + 4 + (width - 8 - manualW) / 2,
    y: countBoxY + (countBoxH - 24) / 2 + 2,
    size: 12.5,
    font,
    color: COLOR_CHARCOAL,
  });
}

/**
 * 4. Master Logistics Bundle PDF
 * Combines all 4 components into one ready-to-print file:
 * 1. Building Carton (A4 Landscape)
 * 2. Exam Bag Checklist (A4 Portrait)
 * 3. Clean Skin Master Outer Bag (A4 Portrait)
 * 4. Clean Skin Subject Stickers (Quarter-A4 4-up)
 */
export async function generateCompleteLogisticsBundlePdf(
  options: LogisticsStickerOptions,
): Promise<Uint8Array> {
  const masterDoc = await PDFDocument.create();

  const [cartonBytes, bagBytes, masterBytes, subjectBytes] = await Promise.all([
    generateBuildingCartonStickerPdf(options),
    generateExamBagChecklistPdf(options),
    generateCleanSkinMasterPdf(options),
    generateCleanSkinSubjectStickersPdf(options),
  ]);

  const docs = await Promise.all([
    PDFDocument.load(cartonBytes),
    PDFDocument.load(bagBytes),
    PDFDocument.load(masterBytes),
    PDFDocument.load(subjectBytes),
  ]);

  for (const doc of docs) {
    const pageIndices = doc.getPageIndices();
    const copiedPages = await masterDoc.copyPages(doc, pageIndices);
    for (const p of copiedPages) {
      masterDoc.addPage(p);
    }
  }

  return await masterDoc.save();
}

/**
 * 5. Master Carton Driver Delivery Manifest Sheet (A4 Landscape)
 * Consolidated delivery sheet for the driver/carrier transporting exam cartons.
 * Contains carton numbers, governorate, test center, building, rooms, candidate totals,
 * driver custody info, check-off boxes, and receiver signature/stamp section.
 */
export interface DriverManifestOptions {
  isCombined?: boolean;
  cycleName?: string;
  driverName?: string;
  vehicleNumber?: string;
  date?: string;
}

export async function generateCartonDriverManifestPdf(
  cartons: LogisticsStickerOptions[],
  manifestOptions?: DriverManifestOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  const isCombined = Boolean(manifestOptions?.isCombined);
  const cycleName = manifestOptions?.cycleName || "December 2026";
  const dateStr = manifestOptions?.date || "December 2026";

  const totalCartons = cartons.length;
  const uniqueCenters = new Set(cartons.map((c) => c.center)).size;
  const totalRooms = cartons.reduce((s, c) => s + (c.totalRooms || 0), 0);
  const totalStudents = cartons.reduce((s, c) => s + (c.totalStudents || 0), 0);
  const totalEst1 = cartons.reduce((s, c) => s + (c.est1Total || 0), 0);
  const totalEst2 = cartons.reduce((s, c) => s + (c.est2Total || 0), 0);

  // Rows per page (A4 Landscape)
  const rowsPerPage = 16;
  const totalPages = Math.max(1, Math.ceil(totalCartons / rowsPerPage));

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page = pdfDoc.addPage([841.89, 595.28]); // A4 Landscape
    const cardX = 20;
    const cardY = 20;
    const cardW = 841.89 - 40;
    const cardH = 595.28 - 40;

    // Outer frame
    page.drawRectangle({
      x: cardX,
      y: cardY,
      width: cardW,
      height: cardH,
      color: COLOR_WHITE,
      borderColor: COLOR_CHARCOAL,
      borderWidth: 1.5,
    });

    // 1. Top Header Banner
    const headerH = 50;
    const headerY = cardY + cardH - headerH - 8;

    const logoH = 34;
    const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 0;
    const logoX = cardX + 12;
    const logoY = headerY + (headerH - logoH) / 2;

    if (logoImg) {
      page.drawImage(logoImg, {
        x: logoX,
        y: logoY,
        width: logoW,
        height: logoH,
      });
    }

    const titleX = logoImg ? logoX + logoW + 12 : cardX + 14;
    const mainTitle = isCombined
      ? "EST I & EST II — MASTER CARTON DELIVERY MANIFEST"
      : `${cartons[0]?.examName || "EST"} — MASTER CARTON DELIVERY MANIFEST`;

    page.drawText(mainTitle, {
      x: titleX,
      y: headerY + 28,
      size: 13,
      font,
      color: COLOR_CHARCOAL,
    });

    page.drawText(`LOGISTICS CARRIER & DISTRIBUTION DISPATCH SHEET — ${cycleName.toUpperCase()}`, {
      x: titleX,
      y: headerY + 14,
      size: 8,
      font,
      color: COLOR_MUTED,
    });

    // Driver & Vehicle Card on the right
    const driverBoxW = 270;
    const driverBoxH = 46;
    const driverBoxX = cardX + cardW - driverBoxW - 12;
    const driverBoxY = headerY + (headerH - driverBoxH) / 2;

    page.drawRectangle({
      x: driverBoxX,
      y: driverBoxY,
      width: driverBoxW,
      height: driverBoxH,
      color: COLOR_LIGHT_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.8,
    });

    page.drawText(`DATE: [ ${dateStr} ]   •   TRUCK #: [ ________________ ]`, {
      x: driverBoxX + 10,
      y: driverBoxY + 28,
      size: 7,
      font,
      color: COLOR_CHARCOAL,
    });

    page.drawText(`DRIVER NAME & SIG: [ ___________________________________ ]`, {
      x: driverBoxX + 10,
      y: driverBoxY + 11,
      size: 7,
      font,
      color: COLOR_CHARCOAL,
    });

    // Divider line
    const div1Y = headerY - 5;
    page.drawLine({
      start: { x: cardX + 10, y: div1Y },
      end: { x: cardX + cardW - 10, y: div1Y },
      thickness: 1,
      color: COLOR_BORDER,
    });

    // 2. Summary KPI Badges Bar
    const kpiH = 24;
    const kpiY = div1Y - kpiH - 6;
    const kpiItems = isCombined
      ? [
          { label: "TOTAL CARTONS", val: `${totalCartons} Boxes` },
          { label: "EXAM CENTERS", val: `${uniqueCenters} Centers` },
          { label: "TOTAL ROOMS", val: `${totalRooms} Rooms` },
          { label: "EST I CANDIDATES", val: `${totalEst1} Candidates` },
          { label: "EST II CANDIDATES", val: `${totalEst2} Candidates` },
          { label: "TOTAL CANDIDATES", val: `${totalEst1 + totalEst2} Candidates` },
        ]
      : [
          { label: "TOTAL CARTONS", val: `${totalCartons} Boxes` },
          { label: "EXAM CENTERS", val: `${uniqueCenters} Centers` },
          { label: "TOTAL ROOMS", val: `${totalRooms} Rooms` },
          { label: "TOTAL CANDIDATES", val: `${totalStudents} Candidates` },
        ];

    const kpiW = (cardW - 24) / kpiItems.length;
    kpiItems.forEach((item, idx) => {
      const kx = cardX + 12 + idx * kpiW;
      page.drawRectangle({
        x: kx,
        y: kpiY,
        width: kpiW - 4,
        height: kpiH,
        color: COLOR_LIGHT_BG,
        borderColor: COLOR_BORDER,
        borderWidth: 0.6,
      });

      const lblW = font.widthOfTextAtSize(item.label, 5.5);
      page.drawText(item.label, {
        x: kx + (kpiW - 4 - lblW) / 2,
        y: kpiY + 14,
        size: 5.5,
        font,
        color: COLOR_MUTED,
      });

      const valW = font.widthOfTextAtSize(item.val, 7.5);
      page.drawText(item.val, {
        x: kx + (kpiW - 4 - valW) / 2,
        y: kpiY + 4,
        size: 7.5,
        font,
        color: COLOR_CHARCOAL,
      });
    });

    // 3. Table Layout
    const tableTop = kpiY - 8;
    const footerH = 34;
    const footerY = cardY + 10;
    const tableBottom = footerY + footerH + 6;
    const tableX = cardX + 12;
    const tableW = cardW - 24;

    // Table Columns Widths (sum = tableW = 777.89)
    const colW_box = 46;
    const colW_gov = 72;
    const colW_center = 195;
    const colW_bld = 135;
    const colW_rooms = 48;
    const colW_cand = isCombined ? 86 : 64;
    const colW_check = 32;
    const colW_recv = tableW - (colW_box + colW_gov + colW_center + colW_bld + colW_rooms + colW_cand + colW_check);

    const cX_box = tableX;
    const cX_gov = cX_box + colW_box;
    const cX_center = cX_gov + colW_gov;
    const cX_bld = cX_center + colW_center;
    const cX_rooms = cX_bld + colW_bld;
    const cX_cand = cX_rooms + colW_rooms;
    const cX_check = cX_cand + colW_cand;
    const cX_recv = cX_check + colW_check;

    // Header Row
    const headerRowH = 18;
    const headerRowY = tableTop - headerRowH;

    page.drawRectangle({
      x: tableX,
      y: headerRowY,
      width: tableW,
      height: headerRowH,
      color: COLOR_CHARCOAL,
    });

    const drawColH = (text: string, xPos: number, w: number, alignCenter = true) => {
      const s = 6.5;
      const tW = font.widthOfTextAtSize(text, s);
      page.drawText(text, {
        x: alignCenter ? xPos + (w - tW) / 2 : xPos + 5,
        y: headerRowY + 5.5,
        size: s,
        font,
        color: COLOR_WHITE,
      });
    };

    drawColH("BOX #", cX_box, colW_box);
    drawColH("GOVERNORATE", cX_gov, colW_gov);
    drawColH("TEST CENTER / SCHOOL", cX_center, colW_center, false);
    drawColH("BUILDING / FACILITY", cX_bld, colW_bld, false);
    drawColH("ROOMS", cX_rooms, colW_rooms);
    drawColH(isCombined ? "EST I / II CAND" : "CANDIDATES", cX_cand, colW_cand);
    drawColH("CHK", cX_check, colW_check);
    drawColH("RECEIVER CONFIRMATION (NAME, PHONE, SIGN & STAMP)", cX_recv, colW_recv, false);

    // Rows for current page
    const pageCartons = cartons.slice(pageIdx * rowsPerPage, (pageIdx + 1) * rowsPerPage);
    const rowH = (headerRowY - tableBottom) / rowsPerPage;

    pageCartons.forEach((carton, rIdx) => {
      const rowY = headerRowY - (rIdx + 1) * rowH;

      // Zebra striping
      if (rIdx % 2 === 1) {
        page.drawRectangle({
          x: tableX,
          y: rowY,
          width: tableW,
          height: rowH,
          color: COLOR_LIGHT_BG,
        });
      }

      // Horizontal line
      page.drawLine({
        start: { x: tableX, y: rowY },
        end: { x: tableX + tableW, y: rowY },
        thickness: 0.4,
        color: COLOR_BORDER,
      });

      const { center, building } = splitCenterAndBuilding(carton.center, carton.building);
      const bldDisplay = building || "Main Campus";

      // 1. Box #
      const boxStr = `BOX #${carton.boxNumber || pageIdx * rowsPerPage + rIdx + 1}`;
      const bSize = 7.5;
      const bW = font.widthOfTextAtSize(boxStr, bSize);
      page.drawText(boxStr, {
        x: cX_box + (colW_box - bW) / 2,
        y: rowY + (rowH - bSize) / 2 + 1,
        size: bSize,
        font,
        color: COLOR_CHARCOAL,
      });

      // 2. Gov
      const govStr = toEnglishText(carton.governorate) || "Cairo";
      const gSize = 6.5;
      const gW = font.widthOfTextAtSize(govStr, gSize);
      page.drawText(govStr, {
        x: cX_gov + (colW_gov - gW) / 2,
        y: rowY + (rowH - gSize) / 2 + 1,
        size: gSize,
        font,
        color: COLOR_CHARCOAL,
      });

      // 3. Center
      const cSize = center.length > 32 ? 5.5 : center.length > 24 ? 6 : 6.8;
      page.drawText(center, {
        x: cX_center + 5,
        y: rowY + (rowH - cSize) / 2 + 1,
        size: cSize,
        font,
        color: COLOR_CHARCOAL,
      });

      // 4. Building
      const bdSize = bldDisplay.length > 25 ? 5.5 : 6.5;
      page.drawText(bldDisplay, {
        x: cX_bld + 5,
        y: rowY + (rowH - bdSize) / 2 + 1,
        size: bdSize,
        font,
        color: COLOR_MUTED,
      });

      // 5. Rooms
      const rStr = `${carton.totalRooms || 0} Rms`;
      const rW = font.widthOfTextAtSize(rStr, 6.5);
      page.drawText(rStr, {
        x: cX_rooms + (colW_rooms - rW) / 2,
        y: rowY + (rowH - 6.5) / 2 + 1,
        size: 6.5,
        font,
        color: COLOR_CHARCOAL,
      });

      // 6. Candidates
      const candStr = isCombined
        ? `E1:${carton.est1Total || 0} | E2:${carton.est2Total || 0}`
        : `${carton.totalStudents || 0}`;
      const cdSize = isCombined ? 6 : 7;
      const cdW = font.widthOfTextAtSize(candStr, cdSize);
      page.drawText(candStr, {
        x: cX_cand + (colW_cand - cdW) / 2,
        y: rowY + (rowH - cdSize) / 2 + 1,
        size: cdSize,
        font,
        color: COLOR_CHARCOAL,
      });

      // 7. Checkbox
      page.drawRectangle({
        x: cX_check + (colW_check - 9) / 2,
        y: rowY + (rowH - 9) / 2,
        width: 9,
        height: 9,
        color: COLOR_WHITE,
        borderColor: COLOR_CHARCOAL,
        borderWidth: 0.8,
      });

      // 8. Receiver entry line
      page.drawText("Name: _________________  Sig: ___________  [Stamp]", {
        x: cX_recv + 5,
        y: rowY + (rowH - 6) / 2 + 1,
        size: 5.5,
        font,
        color: COLOR_MUTED,
      });
    });

    // Outer table border & vertical grid lines
    page.drawRectangle({
      x: tableX,
      y: tableBottom,
      width: tableW,
      height: tableTop - tableBottom,
      color: undefined,
      borderColor: COLOR_CHARCOAL,
      borderWidth: 1,
    });

    const vCols = [cX_gov, cX_center, cX_bld, cX_rooms, cX_cand, cX_check, cX_recv];
    vCols.forEach((vx) => {
      page.drawLine({
        start: { x: vx, y: tableBottom },
        end: { x: vx, y: tableTop },
        thickness: 0.5,
        color: COLOR_BORDER,
      });
    });

    // 4. Footer
    page.drawText(
      "INSTRUCTIONS: The carrier/driver must check off each carton upon loading. The receiving representative must verify box integrity, box number, print full name, sign, and apply center stamp.",
      {
        x: cardX + 12,
        y: footerY + 12,
        size: 5.8,
        font,
        color: COLOR_MUTED,
      },
    );

    const pageInfo = `PAGE ${pageIdx + 1} OF ${totalPages}`;
    const piW = font.widthOfTextAtSize(pageInfo, 6.5);
    page.drawText(pageInfo, {
      x: cardX + cardW - piW - 12,
      y: footerY + 12,
      size: 6.5,
      font,
      color: COLOR_CHARCOAL,
    });
  }

  return await pdfDoc.save();
}

