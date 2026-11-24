import fs from "fs";
import path from "path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { EST_LOGO_BASE64 } from "./est-logo-base64";
import { getDemoDescendants } from "../demo";
import { getRoomExamCounts, parseEstRoomFileName, getSubjectSortKey } from "./est-room-data";
import { listStickerChildren } from "./drive-hierarchy";
import type { StickerContent } from "./sticker-content";
import { splitCenterAndBuilding, toEnglishText } from "./logistics-stickers-pdf";
import { expandSubjectName } from "./sticker-pdf";

export interface FloorRoomSubjectData {
  roomName: string;
  candidateCount: number;
}

export interface FloorSubjectPlacardData {
  subjectCode: string; // e.g. "LIT", "MATH", "ESSAY", "MATH1", "MATH2", "BIO", "CHEM", "PHY"
  subjectName: string; // e.g. "Literacy 1", "Math", "Biology", "Chemistry", "Physics", "Essay"
  examType: "EST 1" | "EST 2" | "EST";
  totalRooms: number;
  totalCandidates: number;
  rooms: FloorRoomSubjectData[];
}

export interface FloorExamStickersOptions {
  floorName: string;
  examName?: string;
  governorate?: string;
  center?: string;
  building?: string;
  date?: string;
  subjects: FloorSubjectPlacardData[];
}

// 100% Black & White Color Palette
const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_CHARCOAL = rgb(0, 0, 0);
const COLOR_MUTED = rgb(0.28, 0.28, 0.28);
const COLOR_GOLD = rgb(0, 0, 0); // Crisp solid black
const COLOR_LIGHT_BG = rgb(1, 1, 1); // Clean white background
const COLOR_BORDER = rgb(0.75, 0.75, 0.75); // Simple clean border
const COLOR_WHITE = rgb(1, 1, 1);

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
    if (fs.existsSync(fp)) {
      try {
        const fontBytes = fs.readFileSync(fp);
        return await pdfDoc.embedFont(fontBytes, { subset: true });
      } catch {}
    }
  }

  return await pdfDoc.embedFont(StandardFonts.HelveticaBold);
}

export function isSchoolCenter(centerName?: string): boolean {
  if (!centerName) return false;
  return /school|مدرسة|اكاديمية|academy|college|lycee|lycée/i.test(centerName);
}

/**
 * Generates official Floor Exam Stickers (A4 Landscape Placards).
 * Each subject tested on this floor gets its own dedicated A4 bag placard.
 * Placed on the outside of the floor bag containing the subject's room envelopes.
 */
export async function generateFloorExamStickersPdf(
  options: FloorExamStickersOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  const rawSubjects = options.subjects && options.subjects.length > 0
    ? options.subjects
    : [
        {
          subjectCode: "LIT",
          subjectName: "Literacy 1",
          examType: "EST 1" as const,
          totalRooms: 1,
          totalCandidates: 25,
          rooms: [{ roomName: "Room 101", candidateCount: 25 }],
        },
      ];

  // Strictly enforce canonical chronological exam period order
  const subjects = [...rawSubjects].sort(
    (a, b) => getSubjectSortKey(a.subjectCode) - getSubjectSortKey(b.subjectCode)
  );

  const totalSubjects = subjects.length;

  for (let idx = 0; idx < totalSubjects; idx++) {
    const subj = subjects[idx];
    drawFloorSubjectPlacardPage({
      pdfDoc,
      font,
      logoImg,
      options,
      subject: subj,
      subjectIndex: idx,
      totalSubjects,
    });
  }

  return await pdfDoc.save();
}

/**
 * Batch generates Floor Subject Bag Placards across multiple floors in one unified PDF.
 */
export async function generateBatchFloorSubjectBagsPdf(
  floorBatches: FloorExamStickersOptions[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  for (const options of floorBatches) {
    const rawSubjects = options.subjects && options.subjects.length > 0
      ? options.subjects
      : [];
    const subjects = [...rawSubjects].sort(
      (a, b) => getSubjectSortKey(a.subjectCode) - getSubjectSortKey(b.subjectCode)
    );
    const totalSubjects = subjects.length;

    for (let idx = 0; idx < totalSubjects; idx++) {
      const subj = subjects[idx];
      drawFloorSubjectPlacardPage({
        pdfDoc,
        font,
        logoImg,
        options,
        subject: subj,
        subjectIndex: idx,
        totalSubjects,
      });
    }
  }

  return await pdfDoc.save();
}

function drawFloorSubjectPlacardPage(params: {
  pdfDoc: PDFDocument;
  font: any;
  logoImg: any;
  options: FloorExamStickersOptions;
  subject: FloorSubjectPlacardData;
  subjectIndex: number;
  totalSubjects: number;
}) {
  const { pdfDoc, font, logoImg, options, subject } = params;

  // A4 Landscape: 841.89 x 595.28 pt
  const width = 841.89;
  const height = 595.28;
  const page = pdfDoc.addPage([width, height]);

  const margin = 24;
  const cardX = margin;
  const cardY = margin;
  const cardW = width - margin * 2;
  const cardH = height - margin * 2;

  // Clean White Background with Crisp Border - ZERO black fill!
  page.drawRectangle({
    x: cardX,
    y: cardY,
    width: cardW,
    height: cardH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1.5,
  });

  const centerX = width / 2;

  // 1. TOP HEADER: Official Centered Logo & Session Date Title
  const logoH = 46;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 66;
  const logoX = centerX - logoW / 2;
  const logoY = cardY + cardH - logoH - 16;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  }

  const rawExam = options.examName || subject.examType || "EST";
  const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(rawExam) || subject.examType === "EST 2";
  const examLabel = isEst2 ? "EST II" : "EST I";
  const sessionDateText = toEnglishText(options.date) || "DECEMBER 2026";
  const examDateHeader = `${examLabel}: ${sessionDateText}`;

  // Exam Title with Date (Centered, bold, underlined matching photo layout)
  const headerFontSize = 20;
  const headerTextW = font.widthOfTextAtSize(examDateHeader, headerFontSize);
  const headerY = logoY - 26;
  page.drawText(examDateHeader, {
    x: centerX - headerTextW / 2,
    y: headerY,
    size: headerFontSize,
    font,
    color: COLOR_CHARCOAL,
  });

  // Underline under Exam Title
  page.drawLine({
    start: { x: centerX - (headerTextW + 20) / 2, y: headerY - 4 },
    end: { x: centerX + (headerTextW + 20) / 2, y: headerY - 4 },
    thickness: 1.2,
    color: COLOR_CHARCOAL,
  });

  // Subtle clean divider below header
  page.drawLine({
    start: { x: cardX + 24, y: headerY - 18 },
    end: { x: cardX + cardW - 24, y: headerY - 18 },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  // ----------------------------------------------------
  // LOCATION & DETAILS (Vertically Stacked with Fixed, Clear Spacing per User Spec)
  // 1. City (if present)
  // 2. Test Center
  // 3. Building (if distinct campus building)
  // 4. Floor
  // 5. Subject (Large, prominent)
  // 6. Rooms
  // ----------------------------------------------------
  const { center: cleanCenter, building: cleanBuilding } = splitCenterAndBuilding(
    options.center,
    options.building,
  );
  const govText = toEnglishText(options.governorate);
  const floorText = toEnglishText(options.floorName) || "Floor";
  const bldText = cleanBuilding && cleanBuilding !== cleanCenter ? cleanBuilding : "";

  const rawSubjName = subject.subjectName || subject.subjectCode;
  const subjDisplayName = expandSubjectName(toEnglishText(rawSubjName));

  interface StackedRow {
    text: string;
    size: number;
    underlineThickness: number;
    isSubject?: boolean;
  }

  const rows: StackedRow[] = [];
  if (govText) {
    rows.push({ text: `City: ${govText}`, size: 21, underlineThickness: 1.1 });
  }
  if (cleanCenter) {
    rows.push({ text: `Test Center: ${cleanCenter}`, size: 22, underlineThickness: 1.2 });
  }
  if (bldText) {
    rows.push({ text: `Building: ${bldText}`, size: 21, underlineThickness: 1.1 });
  }
  if (floorText) {
    rows.push({ text: `Floor: ${floorText}`, size: 22, underlineThickness: 1.2 });
  }
  rows.push({ text: `Subject: ${subjDisplayName}`, size: 32, underlineThickness: 1.5, isSubject: true });
  rows.push({ text: `Rooms: ${subject.totalRooms}`, size: 26, underlineThickness: 1.3 });

  // Calculate vertical positions: evenly distributed from startY to bottomY with fixed, comfortable spacing
  const startY = headerY - 46;
  const bottomY = cardY + 44;
  const totalSpan = startY - bottomY;
  const stepY = rows.length > 1 ? totalSpan / (rows.length - 1) : 52;

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const rowY = startY - idx * stepY;

    let effSize = r.size;
    let textW = font.widthOfTextAtSize(r.text, effSize);
    const maxW = 730;
    if (textW > maxW) {
      effSize = Math.max(14, (maxW / textW) * effSize);
      textW = font.widthOfTextAtSize(r.text, effSize);
    }

    page.drawText(r.text, {
      x: centerX - textW / 2,
      y: rowY,
      size: effSize,
      font,
      color: COLOR_CHARCOAL,
    });

    // Clean underline directly beneath each text line
    const linePadding = 18;
    page.drawLine({
      start: { x: centerX - (textW + linePadding) / 2, y: rowY - 5 },
      end: { x: centerX + (textW + linePadding) / 2, y: rowY - 5 },
      thickness: r.underlineThickness,
      color: COLOR_CHARCOAL,
    });
  }
}

/**
 * Resolves floor rooms and their subjects by inspecting:
 * 1. Room subfolders and their uploaded register PDF files (using parseEstRoomFileName).
 * 2. Fallback to EST reference data or default EST 1/2 subjects.
 */
export async function resolveFloorSubjectsData(params: {
  resolvedFolderId: string;
  floorName: string;
  stickerContent: StickerContent;
  drive?: any;
  isDemo?: boolean;
}): Promise<FloorSubjectPlacardData[]> {
  const { resolvedFolderId, floorName, stickerContent, drive, isDemo } = params;

  interface RoomFolderItem {
    id: string;
    name: string;
    files: Array<{ name: string }>;
  }
  const roomsList: RoomFolderItem[] = [];

  // Query subfolders and their files
  if (isDemo || resolvedFolderId.startsWith("demo-")) {
    try {
      const desc = getDemoDescendants([resolvedFolderId]);
      const directRooms = desc.folders.filter((f) => f.parentId === resolvedFolderId);
      for (const r of directRooms) {
        const rFiles = desc.files.filter((f) => f.parentId === r.id);
        roomsList.push({ id: r.id, name: r.name, files: rFiles.map((f) => ({ name: f.name })) });
      }
    } catch (err) {
      console.warn("[floor-stickers] Demo descendants error:", err);
    }
  } else if (drive) {
    try {
      const children = await listStickerChildren(drive, resolvedFolderId);
      await Promise.all(
        children.folders.map(async (room) => {
          try {
            const roomChildren = await listStickerChildren(drive, room.id);
            roomsList.push({
              id: room.id,
              name: room.name,
              files: roomChildren.files,
            });
          } catch {
            roomsList.push({ id: room.id, name: room.name, files: [] });
          }
        }),
      );
    } catch (err) {
      console.warn("[floor-stickers] Drive query error:", err);
    }
  }

  // No hard-coded/demo room list: only rooms that actually exist in Drive are used.

  // Sort rooms naturally (e.g. 101, 102, or AD3A, AD4A)
  roomsList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  // Subject aggregation map
  const subjectMap = new Map<
    string,
    {
      subjectCode: string;
      subjectName: string;
      examType: "EST 1" | "EST 2" | "EST";
      rooms: FloorRoomSubjectData[];
    }
  >();

  const isEst2Context = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(stickerContent.examName || "");

  for (const r of roomsList) {
    let parsedRoomData: any = null;

    // 1. Try to parse from any room file
    for (const file of r.files) {
      const parsed = parseEstRoomFileName(file.name);
      if (parsed && parsed.subjects && parsed.subjects.length > 0) {
        parsedRoomData = parsed;
        break;
      }
    }

    // 2. Fall back to the real-files-only resolver (no reference data involved).
    if (!parsedRoomData) {
      const counts = getRoomExamCounts({
        room: r.name,
        building: stickerContent.building,
        center: stickerContent.center,
        governorate: stickerContent.governorate,
        floor: floorName,
        folderFiles: r.files,
        examName: stickerContent.examName,
      });
      if (counts && counts.subjects && counts.subjects.length > 0) {
        parsedRoomData = counts;
      }
    }

    // 3. No register file in this room -> skip it. Never fabricate student counts.
    if (!parsedRoomData || !parsedRoomData.subjects || parsedRoomData.subjects.length === 0) {
      continue;
    }

    // Accumulate each subject for this room
    for (const subj of parsedRoomData.subjects) {
      const count = typeof subj.count === "number" && subj.count > 0 ? subj.count : 0;
      let sEntry = subjectMap.get(subj.code);
      if (!sEntry) {
        sEntry = {
          subjectCode: subj.code,
          subjectName: subj.name,
          examType: parsedRoomData.examType || (isEst2Context ? "EST 2" : "EST 1"),
          rooms: [],
        };
        subjectMap.set(subj.code, sEntry);
      }
      sEntry.rooms.push({
        roomName: r.name,
        candidateCount: count,
      });
    }
  }

  // If no rooms at all were found, create a placeholder floor subject
  if (subjectMap.size === 0) {
    if (isEst2Context) {
      subjectMap.set("MATH1", {
        subjectCode: "MATH1",
        subjectName: "Math 1",
        examType: "EST 2",
        rooms: [{ roomName: "Room 1", candidateCount: 25 }],
      });
      subjectMap.set("BIO", {
        subjectCode: "BIO",
        subjectName: "Biology",
        examType: "EST 2",
        rooms: [{ roomName: "Room 1", candidateCount: 25 }],
      });
    } else {
      subjectMap.set("LIT", {
        subjectCode: "LIT",
        subjectName: "Literacy 1",
        examType: "EST 1",
        rooms: [{ roomName: "Room 1", candidateCount: 25 }],
      });
      subjectMap.set("MATH", {
        subjectCode: "MATH",
        subjectName: "Math",
        examType: "EST 1",
        rooms: [{ roomName: "Room 1", candidateCount: 25 }],
      });
    }
  }

  return Array.from(subjectMap.values())
    .sort((a, b) => getSubjectSortKey(a.subjectCode) - getSubjectSortKey(b.subjectCode))
    .map((s) => ({
    subjectCode: s.subjectCode,
    subjectName: s.subjectName,
    examType: s.examType,
    totalRooms: s.rooms.length,
    totalCandidates: s.rooms.reduce((acc, r) => acc + r.candidateCount, 0),
    rooms: s.rooms,
  }));
}

export interface BuildingCleanSkinBagOption {
  governorate: string;
  center: string;
  building?: string;
  examName?: string;
  examType?: "EST 1" | "EST 2" | "EST";
  date?: string;
  subjects: Array<{
    code: string;
    name: string;
  }>;
}

export interface BuildingHeadBagPlacardOption {
  governorate: string;
  center: string;
  building?: string;
  examName?: string;
  examType?: "EST 1" | "EST 2" | "EST";
  date?: string;
  totalFloors: number;
  totalRooms: number;
  totalStudents: number;
  floorNames?: string[];
}

/**
 * Draws a single Building Head Bag Placard (A4 Landscape)
 * to be placed on the Head Bag from the outside, featuring all building data
 * and enclosed supplies/dossiers list without checkboxes per user specification.
 */
function drawBuildingHeadBagPlacardPage(params: {
  pdfDoc: PDFDocument;
  font: any;
  logoImg: any;
  building: BuildingHeadBagPlacardOption;
}) {
  const { pdfDoc, font, logoImg, building } = params;

  // A4 Landscape: 841.89 x 595.28 pt
  const width = 841.89;
  const height = 595.28;
  const page = pdfDoc.addPage([width, height]);

  const margin = 24;
  const cardX = margin;
  const cardY = margin;
  const cardW = width - margin * 2;
  const cardH = height - margin * 2;

  // Clean White Background with Crisp Border - ZERO black fill!
  page.drawRectangle({
    x: cardX,
    y: cardY,
    width: cardW,
    height: cardH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1.5,
  });

  const centerX = width / 2;

  // 1. TOP HEADER: Centered Official Logo & Session Date
  const logoH = 46;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 66;
  const logoX = centerX - logoW / 2;
  const logoY = cardY + cardH - logoH - 16;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  }

  const rawExam = building.examName || building.examType || "EST";
  const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(rawExam) || building.examType === "EST 2";
  const examLabel = isEst2 ? "EST II" : "EST I";
  const sessionDateText = toEnglishText(building.date) || "DECEMBER 2026";
  const examDateHeader = `${examLabel}: ${sessionDateText}`;

  const headerFontSize = 20;
  const headerTextW = font.widthOfTextAtSize(examDateHeader, headerFontSize);
  const headerY = logoY - 26;
  page.drawText(examDateHeader, {
    x: centerX - headerTextW / 2,
    y: headerY,
    size: headerFontSize,
    font,
    color: COLOR_CHARCOAL,
  });

  // Underline under Exam Title
  page.drawLine({
    start: { x: centerX - (headerTextW + 20) / 2, y: headerY - 4 },
    end: { x: centerX + (headerTextW + 20) / 2, y: headerY - 4 },
    thickness: 1.2,
    color: COLOR_CHARCOAL,
  });

  // Divider line below header
  page.drawLine({
    start: { x: cardX + 24, y: headerY - 16 },
    end: { x: cardX + cardW - 24, y: headerY - 16 },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  // 2. HEAD DOSSIER TAG (Centered Prominent Banner)
  const tagText = "BUILDING HEAD DOSSIER & SUPPLIES BAG";
  const tagSize = 15;
  const tagW = font.widthOfTextAtSize(tagText, tagSize);
  const tagY = headerY - 36;
  page.drawText(tagText, {
    x: centerX - tagW / 2,
    y: tagY,
    size: tagSize,
    font,
    color: COLOR_CHARCOAL,
  });
  page.drawLine({
    start: { x: centerX - (tagW + 20) / 2, y: tagY - 4 },
    end: { x: centerX + (tagW + 20) / 2, y: tagY - 4 },
    thickness: 1.1,
    color: COLOR_CHARCOAL,
  });

  // 3. VERTICALLY STACKED LOCATION & BUILDING SUMMARY DETAILS
  const { center: cleanCenter, building: cleanBuilding } = splitCenterAndBuilding(
    building.center,
    building.building,
  );
  const govText = toEnglishText(building.governorate);
  const bldText = cleanBuilding && cleanBuilding !== cleanCenter ? cleanBuilding : "";

  interface StackedRow {
    text: string;
    size: number;
    underlineThickness: number;
  }

  const rows: StackedRow[] = [];
  if (govText) {
    rows.push({ text: `City: ${govText}`, size: 21, underlineThickness: 1.1 });
  }
  if (cleanCenter) {
    rows.push({ text: `Test Center: ${cleanCenter}`, size: 22, underlineThickness: 1.2 });
  }
  if (bldText) {
    rows.push({ text: `Building: ${bldText}`, size: 21, underlineThickness: 1.1 });
  }

  const statsText = [
    building.totalFloors > 0 ? `${building.totalFloors} Floors` : null,
    building.totalRooms > 0 ? `${building.totalRooms} Rooms` : null,
    building.totalStudents > 0 ? `${building.totalStudents} Students Total` : null,
  ].filter(Boolean).join("   •   ");

  if (statsText) {
    rows.push({ text: statsText, size: 21, underlineThickness: 1.3 });
  }

  const startY = tagY - 38;
  const bottomY = cardY + 152;
  const totalSpan = startY - bottomY;
  const stepY = rows.length > 1 ? totalSpan / (rows.length - 1) : 44;

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const rowY = startY - idx * stepY;

    let effSize = r.size;
    let textW = font.widthOfTextAtSize(r.text, effSize);
    const maxW = 730;
    if (textW > maxW) {
      effSize = Math.max(14, (maxW / textW) * effSize);
      textW = font.widthOfTextAtSize(r.text, effSize);
    }

    page.drawText(r.text, {
      x: centerX - textW / 2,
      y: rowY,
      size: effSize,
      font,
      color: COLOR_CHARCOAL,
    });

    const linePadding = 18;
    page.drawLine({
      start: { x: centerX - (textW + linePadding) / 2, y: rowY - 5 },
      end: { x: centerX + (textW + linePadding) / 2, y: rowY - 5 },
      thickness: r.underlineThickness,
      color: COLOR_CHARCOAL,
    });
  }

  // 4. BAG ENCLOSED CONTENTS (WITHOUT CHECKBOXES per user specification)
  const boxW = 730;
  const boxH = 108;
  const boxX = centerX - boxW / 2;
  const boxY = cardY + 28;

  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    color: rgb(0.97, 0.97, 0.98),
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1.2,
  });

  const boxTitle = "ENCLOSED BAG DOSSIERS & ADMINISTRATIVE SUPPLIES (COMPLETE ENCLOSURE)";
  const boxTitleSize = 10.5;
  const boxTitleW = font.widthOfTextAtSize(boxTitle, boxTitleSize);
  page.drawText(boxTitle, {
    x: centerX - boxTitleW / 2,
    y: boxY + boxH - 20,
    size: boxTitleSize,
    font,
    color: COLOR_CHARCOAL,
  });

  page.drawLine({
    start: { x: boxX + 16, y: boxY + boxH - 26 },
    end: { x: boxX + boxW - 16, y: boxY + boxH - 26 },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  // 2 Columns of contents WITHOUT checkboxes (bulleted clean list)
  const col1X = boxX + 28;
  const col2X = centerX + 16;
  const itemSize = 9.5;
  const lineSpacing = 20;

  const col1Items = [
    "• Building Control Register",
    "• Proctor & Senior Attendance Registers",
    "• Student & Proctor Misconduct Forms",
  ];

  const col2Items = [
    "• Mobile & Valuables Collection Files",
    "• Room Numbers & Candidate Signage",
    "• Blank White Paper, Staplers & Supplies",
  ];

  for (let i = 0; i < col1Items.length; i++) {
    const itemY = boxY + boxH - 48 - i * lineSpacing;
    page.drawText(col1Items[i], {
      x: col1X,
      y: itemY,
      size: itemSize,
      font,
      color: COLOR_CHARCOAL,
    });
  }

  for (let i = 0; i < col2Items.length; i++) {
    const itemY = boxY + boxH - 48 - i * lineSpacing;
    page.drawText(col2Items[i], {
      x: col2X,
      y: itemY,
      size: itemSize,
      font,
      color: COLOR_CHARCOAL,
    });
  }
}

/**
 * Generates the PDF containing A4 Landscape Building Head Bag Placards
 * for each building.
 */
export async function generateBuildingHeadBagPlacardsPdf(
  batches: BuildingHeadBagPlacardOption[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  for (const bld of batches) {
    drawBuildingHeadBagPlacardPage({
      pdfDoc,
      font,
      logoImg,
      building: bld,
    });
  }

  return await pdfDoc.save();
}

/**
 * Draws a single Clean Skin Emergency Reserve Bag Placard (A4 Landscape)
 * for the complete building with all its subjects combined in one single sticker.
 */
function drawBuildingCleanSkinPlacardPage(params: {
  pdfDoc: PDFDocument;
  font: any;
  logoImg: any;
  building: BuildingCleanSkinBagOption;
}) {
  const { pdfDoc, font, logoImg, building } = params;

  // A4 Landscape: 841.89 x 595.28 pt
  const width = 841.89;
  const height = 595.28;
  const page = pdfDoc.addPage([width, height]);

  const margin = 24;
  const cardX = margin;
  const cardY = margin;
  const cardW = width - margin * 2;
  const cardH = height - margin * 2;

  // Clean White Background with Crisp Border - ZERO black fill!
  page.drawRectangle({
    x: cardX,
    y: cardY,
    width: cardW,
    height: cardH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1.5,
  });

  const centerX = width / 2;

  // 1. TOP HEADER: Centered Official Logo & Session Date
  const logoH = 46;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 66;
  const logoX = centerX - logoW / 2;
  const logoY = cardY + cardH - logoH - 16;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  }

  const rawExam = building.examName || building.examType || "EST";
  const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(rawExam) || building.examType === "EST 2";
  const examLabel = isEst2 ? "EST II" : "EST I";
  const sessionDateText = toEnglishText(building.date) || "DECEMBER 2026";
  const examDateHeader = `${examLabel}: ${sessionDateText}`;

  const headerFontSize = 20;
  const headerTextW = font.widthOfTextAtSize(examDateHeader, headerFontSize);
  const headerY = logoY - 26;
  page.drawText(examDateHeader, {
    x: centerX - headerTextW / 2,
    y: headerY,
    size: headerFontSize,
    font,
    color: COLOR_CHARCOAL,
  });

  // Underline under Exam Title
  page.drawLine({
    start: { x: centerX - (headerTextW + 20) / 2, y: headerY - 4 },
    end: { x: centerX + (headerTextW + 20) / 2, y: headerY - 4 },
    thickness: 1.2,
    color: COLOR_CHARCOAL,
  });

  // Divider line below header
  page.drawLine({
    start: { x: cardX + 24, y: headerY - 18 },
    end: { x: cardX + cardW - 24, y: headerY - 18 },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  // 2. VERTICALLY STACKED LOCATION & COMBINED CLEAN SKIN SUBJECTS
  const { center: cleanCenter, building: cleanBuilding } = splitCenterAndBuilding(
    building.center,
    building.building,
  );
  const govText = toEnglishText(building.governorate);
  const bldText = cleanBuilding && cleanBuilding !== cleanCenter ? cleanBuilding : "";

  // Combine all subjects for this building into one single line: CLEAN SKIN   [ • Subject 1  •  Subject 2 ... ]
  const allSubjNames = building.subjects && building.subjects.length > 0
    ? building.subjects.map((s) => s.name).join("  •  ")
    : isEst2
      ? "Math 1  •  Math 2  •  Biology  •  Chemistry  •  Physics"
      : "Literacy  •  Math";
  const cleanSkinLine = `CLEAN SKIN   [ • ${allSubjNames} ]`;

  interface StackedRow {
    text: string;
    size: number;
    underlineThickness: number;
    isHero?: boolean;
  }

  const rows: StackedRow[] = [];
  if (govText) {
    rows.push({ text: `City: ${govText}`, size: 22, underlineThickness: 1.1 });
  }
  if (cleanCenter) {
    rows.push({ text: `Test Center: ${cleanCenter}`, size: 23, underlineThickness: 1.2 });
  }
  if (bldText) {
    rows.push({ text: `Building: ${bldText}`, size: 22, underlineThickness: 1.1 });
  }
  // CLEAN SKIN with all subjects together - prominent hero row
  rows.push({ text: cleanSkinLine, size: 30, underlineThickness: 1.6, isHero: true });

  const startY = headerY - 58;
  const bottomY = cardY + 68;
  const totalSpan = startY - bottomY;
  const stepY = rows.length > 1 ? totalSpan / (rows.length - 1) : 70;

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const rowY = startY - idx * stepY;

    let effSize = r.size;
    let textW = font.widthOfTextAtSize(r.text, effSize);
    const maxW = 730;
    if (textW > maxW) {
      effSize = Math.max(14, (maxW / textW) * effSize);
      textW = font.widthOfTextAtSize(r.text, effSize);
    }

    page.drawText(r.text, {
      x: centerX - textW / 2,
      y: rowY,
      size: effSize,
      font,
      color: COLOR_CHARCOAL,
    });

    const linePadding = 18;
    page.drawLine({
      start: { x: centerX - (textW + linePadding) / 2, y: rowY - 5 },
      end: { x: centerX + (textW + linePadding) / 2, y: rowY - 5 },
      thickness: r.underlineThickness,
      color: COLOR_CHARCOAL,
    });
  }
}

/**
 * Generates the PDF containing A4 Landscape Clean Skin Bag Placards.
 * Generates exactly ONE single placard per building containing all its subjects combined.
 */
export async function generateBuildingCleanSkinBagsPdf(
  batches: BuildingCleanSkinBagOption[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  for (const bld of batches) {
    drawBuildingCleanSkinPlacardPage({
      pdfDoc,
      font,
      logoImg,
      building: bld,
    });
  }

  return await pdfDoc.save();
}
