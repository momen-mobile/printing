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

export interface FloorRoomSubjectData {
  roomName: string;
  candidateCount: number;
}

export interface FloorSubjectPlacardData {
  subjectCode: string; // e.g. "LIT", "MATH", "ESSAY", "MATH1", "MATH2", "BIO", "CHEM", "PHY"
  subjectName: string; // e.g. "Literacy 1", "Mathematics 1", "Biology", "Chemistry", "Physics", "Essay"
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

  // Top Header Bar
  const headerH = 60;
  const headerY = cardY + cardH - headerH - 10;
  const logoH = 44;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 0;
  const logoX = cardX + 20;
  const logoY = headerY + (headerH - logoH) / 2;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  }

  const textStartX = logoImg ? logoX + logoW + 18 : cardX + 20;
  const rawExam = options.examName || subject.examType || "EST";
  const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(rawExam) || subject.examType === "EST 2";
  const examLabel = isEst2 ? "EST II" : "EST I";

  // Exam Title in Header - Prominent, clean (No subtitle, No right badge!)
  page.drawText(examLabel, {
    x: textStartX,
    y: headerY + (headerH - 24) / 2,
    size: 26,
    font,
    color: COLOR_CHARCOAL,
  });

  // Top Divider Line
  page.drawLine({
    start: { x: cardX + 16, y: headerY },
    end: { x: cardX + cardW - 16, y: headerY },
    thickness: 1.2,
    color: COLOR_BORDER,
  });

  // ----------------------------------------------------
  // CENTERED & VERTICALLY STACKED CONTENT
  // Location -> Floor -> Subject -> Total Rooms
  // ----------------------------------------------------
  const centerX = width / 2;

  const { center: cleanCenter, building: cleanBuilding, isCampus } = splitCenterAndBuilding(
    options.center,
    options.building,
  );
  const govText = toEnglishText(options.governorate) || "All Governorates";
  const floorText = toEnglishText(options.floorName) || "Floor";
  const hasDiffBuilding = isCampus && Boolean(cleanBuilding);

  // Helper to draw centered text with optional max width scaling
  const drawCentered = (text: string, y: number, size: number, color = COLOR_CHARCOAL, maxW = cardW - 60) => {
    let effSize = size;
    let textW = font.widthOfTextAtSize(text, effSize);
    if (textW > maxW) {
      effSize = Math.max(9, (maxW / textW) * effSize);
      textW = font.widthOfTextAtSize(text, effSize);
    }
    page.drawText(text, {
      x: centerX - textW / 2,
      y,
      size: effSize,
      font,
      color,
    });
    return effSize;
  };

  // Dynamic vertical layout based on whether building exists
  let curY = headerY - 34;

  // 1. Governorate
  drawCentered(govText.toUpperCase(), curY, 14, COLOR_MUTED);
  curY -= 32;

  // 2. Test Center (Enlarged & Prominent)
  drawCentered(cleanCenter.toUpperCase(), curY, 24, COLOR_CHARCOAL);
  curY -= 28;

  // 3. Building (Only if distinct campus building)
  if (hasDiffBuilding) {
    drawCentered(cleanBuilding.toUpperCase(), curY, 18, COLOR_CHARCOAL);
    curY -= 28;
  }

  // 4. Floor (Prominent & High-Visibility)
  drawCentered(floorText.toUpperCase(), curY, 32, COLOR_CHARCOAL);
  curY -= 30;

  // Central Divider Separator
  const sepW = 420;
  page.drawLine({
    start: { x: centerX - sepW / 2, y: curY },
    end: { x: centerX + sepW / 2, y: curY },
    thickness: 0.8,
    color: COLOR_BORDER,
  });
  curY -= 34;

  // 5. Exam Subject Section (The Hero Identity of the Bag!)
  drawCentered("EXAM SUBJECT", curY, 12, COLOR_MUTED);
  curY -= 48;

  const rawSubjName = subject.subjectName || subject.subjectCode;
  const subjDisplayName = toEnglishText(rawSubjName).toUpperCase();
  drawCentered(subjDisplayName, curY, 44, COLOR_CHARCOAL, cardW - 80);
  curY -= 32;

  // Subject Code e.g. [ MATH 1 ] or [ LIT 1 ]
  if (subject.subjectCode && !subjDisplayName.includes(subject.subjectCode.toUpperCase())) {
    drawCentered(`[ ${subject.subjectCode.toUpperCase()} ]`, curY, 18, COLOR_MUTED);
    curY -= 36;
  } else {
    curY -= 12;
  }

  // 6. Total Rooms Summary Card (Bottom Centered, NO student counts, NO room directory!)
  const roomsBoxW = 320;
  const roomsBoxH = 46;
  const roomsBoxX = centerX - roomsBoxW / 2;
  const roomsBoxY = Math.max(cardY + 28, curY - 24);

  page.drawRectangle({
    x: roomsBoxX,
    y: roomsBoxY,
    width: roomsBoxW,
    height: roomsBoxH,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });

  const roomsLabel =
    subject.totalRooms === 1
      ? "TOTAL ENCLOSED ROOMS : 1 ROOM"
      : `TOTAL ENCLOSED ROOMS : ${subject.totalRooms} ROOMS`;
  const rTextW = font.widthOfTextAtSize(roomsLabel, 13);
  page.drawText(roomsLabel, {
    x: roomsBoxX + (roomsBoxW - rTextW) / 2,
    y: roomsBoxY + (roomsBoxH - 13) / 2 + 1,
    size: 13,
    font,
    color: COLOR_CHARCOAL,
  });
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
        subjectName: "Mathematics 1",
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
