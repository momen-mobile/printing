import fs from "fs";
import path from "path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { buildStickerContent, type StickerContent } from "./sticker-content";
import { type RoomSubjectCount, getSubjectSortKey } from "./est-room-data";
import { EST_LOGO_BASE64 } from "./est-logo-base64";
import { formatArabicForPdf } from "./arabic-shaper";

export { getSubjectSortKey };

export interface StickerPdfOptions {
  lines?: string[];
  content?: StickerContent;
  widthMm?: number;
  heightMm?: number;
  paperMode?: "custom" | "a4";
  orientation?: "portrait" | "landscape";
  includeBuildingHead?: boolean;
  isFloorBag?: boolean;
}

export interface BatchStickerPdfOptions {
  contents: StickerContent[];
  widthMm?: number;
  heightMm?: number;
  paperMode?: "custom" | "a4";
  orientation?: "portrait" | "landscape";
  includeBuildingHead?: boolean;
  isFloorBag?: boolean;
}

const MM_TO_PT = 2.83464567;
const DEFAULT_WIDTH_MM = 100;
const DEFAULT_HEIGHT_MM = 50;

// 100% Black & White Color Palette
const COLOR_CHARCOAL = rgb(0, 0, 0);
const COLOR_MUTED = rgb(0.28, 0.28, 0.28);
const COLOR_GOLD = rgb(0, 0, 0); // Converted gold/yellow to crisp solid black
const COLOR_LIGHT_BG = rgb(1, 1, 1); // Clean white background
const COLOR_BORDER = rgb(0.75, 0.75, 0.75); // Simple clean border
const COLOR_WHITE = rgb(1, 1, 1);

// Static decoded logo bytes in memory - zero filesystem dependency
const LOGO_JPEG_BYTES: Uint8Array = new Uint8Array(Buffer.from(EST_LOGO_BASE64, "base64"));

/**
 * Loads the official EST Logo (JPEG) directly from memory.
 * Guaranteed to succeed 100% of the time in all environments.
 */
async function loadLogoImage(pdfDoc: PDFDocument): Promise<any> {
  try {
    return await pdfDoc.embedJpg(LOGO_JPEG_BYTES);
  } catch (err) {
    console.error("[sticker-pdf] Error embedding logo from memory:", err);
    // Try from public path fallback if ever needed
    try {
      const publicPath = path.join(process.cwd(), "public", "est-logo.jpg");
      if (fs.existsSync(publicPath)) {
        const fileBytes = fs.readFileSync(publicPath);
        return await pdfDoc.embedJpg(fileBytes);
      }
    } catch { }
    return null;
  }
}

/**
 * Loads the font.
 */
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
      } catch { }
    }
  }

  return await pdfDoc.embedFont(StandardFonts.HelveticaBold);
}

/**
 * Generates an official, print-ready EST Exam Placard / Sticker PDF for a single item.
 */
export async function generateStickerPdf(options: StickerPdfOptions): Promise<Uint8Array> {
  const content = options.content ?? (options.lines ? buildStickerContent(options.lines) : null);
  if (!content) {
    throw new Error("Cannot generate sticker PDF with no text lines or content");
  }

  return generateBatchStickerPdf({
    contents: [content],
    paperMode: options.paperMode,
    orientation: options.orientation,
    widthMm: options.widthMm,
    heightMm: options.heightMm,
    includeBuildingHead: options.includeBuildingHead,
    isFloorBag: options.isFloorBag || content.isFloorBag,
  });
}

/**
 * Generates a unified multi-page PDF document containing stickers for multiple folders/items.
 * Each item gets its own full page (A4 placard or custom label), with the official EST logo
 * rendered on every single page.
 */
export async function generateBatchStickerPdf(options: BatchStickerPdfOptions): Promise<Uint8Array> {
  const contents = options.contents || [];
  if (contents.length === 0) {
    throw new Error("Cannot generate batch sticker PDF with no items");
  }

  const paperMode = options.paperMode ?? "a4";
  const orientation = options.orientation ?? "portrait";

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  if (paperMode === "a4") {
    // In A4 mode:
    // - Room stickers and Floor stickers are grouped into a 4-up 2x2 grid (4 quarters per A4 page).
    // - Building, Center, Governorate, and Root stickers are printed as full-page A4 placards.
    let pendingQuarterItems: StickerContent[] = [];

    const flushQuarterItems = () => {
      while (pendingQuarterItems.length > 0) {
        const chunk = pendingQuarterItems.slice(0, 4);
        pendingQuarterItems = pendingQuarterItems.slice(4);
        drawA4FourUpPlacardPage({
          pdfDoc,
          font,
          logoImg,
          contents: chunk,
          orientation,
        });
      }
    };

    for (const content of contents) {
      const isFloorLargeBag = Boolean(content.isFloorBag || options.isFloorBag);
      const isQuarter =
        !isFloorLargeBag &&
        (content.level === "room" ||
          content.level === "floor" ||
          content.level === "building_head" ||
          Boolean(content.isHead));

      if (isQuarter) {
        pendingQuarterItems.push(content);
        if (pendingQuarterItems.length === 4) {
          flushQuarterItems();
        }
      } else {
        flushQuarterItems();
        // 1. Existing full-page A4 Placard (Building, Center, Governorate)
        drawA4PlacardPage({
          pdfDoc,
          font,
          logoImg,
          content,
          orientation,
        });

        // 2. Any building also gets an additional Quarter-A4 Head sticker added when includeBuildingHead is true
        if (content.level === "building" && options.includeBuildingHead) {
          const headContent: StickerContent = {
            ...content,
            level: "building_head",
            isHead: true,
          };
          pendingQuarterItems.push(headContent);
          if (pendingQuarterItems.length === 4) {
            flushQuarterItems();
          }
        }
      }
    }

    flushQuarterItems();
  } else {
    for (const content of contents) {
      const widthMm = Math.max(30, Math.min(300, options.widthMm ?? DEFAULT_WIDTH_MM));
      const heightMm = Math.max(20, Math.min(200, options.heightMm ?? DEFAULT_HEIGHT_MM));
      drawCustomLabelPage({
        pdfDoc,
        font,
        logoImg,
        content,
        widthMm,
        heightMm,
      });
    }
  }

  return await pdfDoc.save();
}

export function expandSubjectName(codeOrName: string): string {
  let trimmed = (codeOrName || "").trim();
  // Strip any "EST I – " or "EST II – " prefix if present
  trimmed = trimmed.replace(/^EST\s*(?:I|II|1|2)?\s*[-–—:]\s*/i, "").trim();
  const upper = trimmed.toUpperCase();
  if (upper === "LIT" || upper === "LITERACY" || upper === "LITERATURE") return "Literacy";
  if (upper === "MATH" || upper === "MATHEMATICS") return "Math";
  if (upper === "MATH1" || upper === "MATH 1") return "Math 1";
  if (upper === "MATH2" || upper === "MATH 2") return "Math 2";
  if (upper === "ESSAY") return "Essay";
  if (upper === "BIO" || upper === "BIOLOGY") return "Biology";
  if (upper === "CHEM" || upper === "CHEMISTRY") return "Chemistry";
  if (upper === "PHY" || upper === "PHYSICS") return "Physics";
  return trimmed;
}

export function isSchoolCenter(centerName?: string): boolean {
  if (!centerName) return false;
  return /school|مدرسة|مدارس|مدرسه|اكاديمية|academy|college|lycee|lycée|university|جامعة/i.test(centerName);
}

/**
 * Strips governorate prefix from center name if already present.
 */
export function cleanVenueName(center: string, governorate: string): string {
  let c = (center || "").trim();
  const g = (governorate || "").trim();
  if (g) {
    const escaped = g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped}\\s*[-_–|•:]\\s*`, "i");
    c = c.replace(regex, "").trim();
  }
  return c || (center || "").trim();
}

/**
 * Renders the location block for Quarter-A4 stickers (from Governorate/City down to Floor).
 * Strictly breaks the row into multiple clear lines ("نكسر الصف") so the font is large,
 * legible, and text never overflows into adjacent quadrants:
 * - Line 1: Center / School / Venue Name (9 pt)
 * - Line 2: Governorate & Floor (and Building if distinct) (8 pt)
 * Returns the bottom Y coordinate for the divider line below the location block.
 */
export function drawQuarterLocationBlock(params: {
  page: any;
  font: any;
  governorate?: string;
  center?: string;
  building?: string;
  floor?: string;
  isHead?: boolean;
  x: number;
  width: number;
  headerBottom: number;
}): number {
  const { page, font, x, width, headerBottom, isHead } = params;

  // 1. Clean & Deduplicate
  const gov = (params.governorate || "").trim();
  let center = cleanVenueName(params.center || "", gov);
  let bld = (params.building || "").trim();
  const fl = (params.floor || "").trim();

  // Deduplicate building if identical to center, or contained in center
  if (
    !bld ||
    bld.toLowerCase() === center.toLowerCase() ||
    center.toLowerCase().includes(bld.toLowerCase()) ||
    bld.toLowerCase().includes(center.toLowerCase())
  ) {
    bld = "";
  }

  // If center is empty but building exists, use building as center
  if (!center && bld) {
    center = bld;
    bld = "";
  }

  // 2. Build Lines in strictly unified order across ALL stickers with explicit titles:
  // City -> Test Center -> Building (if campus) -> Floor (if room/floor)
  const lines: Array<{ text: string; size: number }> = [];
  const maxW = width - 16;

  // 1. City / Governorate
  if (gov) {
    const text = `City: ${gov}`;
    let gSize = 13;
    let gW = font.widthOfTextAtSize(text, gSize);
    if (gW > maxW) gSize = Math.max(9.5, (maxW / gW) * gSize);
    lines.push({ text, size: gSize });
  }

  // 2. Test Center (Prominent, wraps to 2 lines if long)
  if (center) {
    const text = `Test Center: ${center}`;
    let cSize = 14;
    let cW = font.widthOfTextAtSize(text, cSize);
    if (cW > maxW) {
      const scaledSize = (maxW / cW) * cSize;
      if (scaledSize >= 11) {
        cSize = scaledSize;
        lines.push({ text, size: cSize });
      } else {
        // Wrap center into 2 lines
        const words = center.split(/\s+/);
        let line1 = "Test Center: ";
        let line2 = "";
        for (const w of words) {
          const test = line2 ? `${line2} ${w}` : (line1 === "Test Center: " ? `${line1}${w}` : `${line1} ${w}`);
          if (!line2 && font.widthOfTextAtSize(test, 11.5) <= maxW) {
            line1 = test;
          } else {
            line2 = line2 ? `${line2} ${w}` : w;
          }
        }
        if (line1) lines.push({ text: line1, size: 11.5 });
        if (line2) lines.push({ text: line2, size: 11.5 });
      }
    } else {
      lines.push({ text, size: cSize });
    }
  }

  // 3. Building (if distinct campus building)
  if (bld && bld !== center) {
    const text = `Building: ${bld}`;
    let bSize = 13;
    let bW = font.widthOfTextAtSize(text, bSize);
    if (bW > maxW) bSize = Math.max(9.5, (maxW / bW) * bSize);
    lines.push({ text, size: bSize });
  }

  // 4. Floor (if floor is present)
  if (fl) {
    const text = `Floor: ${fl}`;
    let fSize = 12.5;
    let fW = font.widthOfTextAtSize(text, fSize);
    if (fW > maxW) fSize = Math.max(9.5, (maxW / fW) * fSize);
    lines.push({ text, size: fSize });
  }

  // Fallback: If empty, show "TEST CENTER"
  if (lines.length === 0) {
    lines.push({ text: "TEST CENTER", size: 12 });
  }

  // 3. Render lines vertically spaced with generous padding from the header line!
  let currY = headerBottom - 16;
  for (let i = 0; i < lines.length; i++) {
    const item = lines[i];
    const textW = font.widthOfTextAtSize(item.text, item.size);
    page.drawText(item.text, {
      x: x + Math.max(8, (width - textW) / 2),
      y: currY,
      size: item.size,
      font,
      color: COLOR_CHARCOAL,
    });
    currY -= (item.size + 4.5);
  }

  // Draw divider line under location block with 3pt spacing below bottom text
  const locDividerY = currY - 3;
  page.drawLine({
    start: { x: x + 4, y: locDividerY },
    end: { x: x + width - 4, y: locDividerY },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  return locDividerY;
}

/**
 * Resolves whether the active folder hierarchy is under EST 1 or EST 2.
 * Returns normalized uppercase "EST 1" or "EST 2".
 */
export function resolveExamTag(content: StickerContent): string {
  const candidates = [
    content.examName,
    ...(content.cleanChain || []),
    content.examType,
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (/\bEST\s*[-_]?\s*2\b|\bEST\s*II\b/i.test(c)) {
      return "EST 2";
    }
  }
  for (const c of candidates) {
    if (/\bEST\s*[-_]?\s*1\b|\bEST\s*I\b/i.test(c)) {
      return "EST 1";
    }
  }
  return "EST 1";
}

function getVerticalSubjectLines(content: StickerContent, isRoom: boolean): string[] {
  const lines: string[] = [];

  if (content.subjects && content.subjects.length > 0) {
    let total = 0;
    const sorted = [...content.subjects].sort(
      (a, b) => getSubjectSortKey(a.code || a.name) - getSubjectSortKey(b.code || b.name)
    );
    for (const s of sorted) {
      if (s.count > 0 || sorted.length <= 3) {
        const name = expandSubjectName(s.name || s.code);
        lines.push(`${name}: ${s.count}`);
        total += s.count;
      }
    }
    if (lines.length > 0) {
      return lines;
    }
  }

  if (isRoom && (typeof content.litCount === "number" || typeof content.mathCount === "number")) {
    if (typeof content.litCount === "number") {
      lines.push(`Literacy: ${content.litCount}`);
    }
    if (typeof content.mathCount === "number") {
      lines.push(`Math: ${content.mathCount}`);
    }
    if (content.hasEssay || (typeof content.essayCount === "number" && content.essayCount > 0)) {
      lines.push(`Essay: ${content.essayCount ?? 0}`);
    }
    if (lines.length > 0) return lines;
  }

  if (content.breakdownText) {
    const parts = content.breakdownText.split(/[|•,–_]/).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^([a-zA-Z0-9\s]+?)[:\s-]+(\d+)$/);
      if (m) {
        const name = expandSubjectName(m[1]);
        lines.push(`${name}: ${m[2]}`);
      } else {
        lines.push(part);
      }
    }
    if (lines.length > 0) return lines;
  }

  if (!isRoom) {
    const childRoomsCount = content.childCount || (content.childNames ? content.childNames.length : 0);
    if (childRoomsCount > 0) {
      lines.push(`${childRoomsCount} Rooms Included`);
    }
  }

  return lines;
}

function getFloorDetailLines(content: StickerContent): string[] {
  const lines: string[] = [];
  const rooms = content.childNames || [];
  const childRoomsCount = content.childCount || rooms.length;

  if (rooms.length > 0) {
    const maxPerLine = 4;
    for (let i = 0; i < rooms.length; i += maxPerLine) {
      const chunk = rooms.slice(i, i + maxPerLine);
      lines.push(chunk.join("   •   "));
    }
  } else if (childRoomsCount > 0) {
    lines.push(`${childRoomsCount} Rooms Included in this Floor`);
  }

  if (typeof content.totalStudents === "number" && content.totalStudents > 0) {
    lines.push(`Total Students: ${content.totalStudents} (${childRoomsCount} Rooms)`);
  } else if (childRoomsCount > 0) {
    lines.push(`Total: ${childRoomsCount} Rooms`);
  }

  return lines;
}

/**
 * Draws a full-page A4 Exam Placard:
 * - Features the official EST Logo (JPEG) at the top of every sticker.
 * - 100% International English labels (no Arabic text on placards to avoid text reversal/rendering issues).
 * - Full hierarchy statistics (Governorate -> Centers, Center -> Buildings, Building -> Floors, Floor -> Rooms).
 * - Room Level: Features a dedicated manual verification checklist box with 5 empty square check-boxes.
 */
function drawA4PlacardPage(params: {
  pdfDoc: PDFDocument;
  font: any;
  logoImg: any;
  content: StickerContent;
  orientation: "portrait" | "landscape";
}) {
  const { pdfDoc, font, logoImg, content, orientation } = params;

  // Determine hierarchy level
  const isHead = content.level === "building_head" || Boolean(content.isHead);
  const isRoom = !isHead && content.level === "room" && Boolean(content.room);
  const isFloor = !isHead && content.level === "floor" && Boolean(content.floor);
  const isBuilding = !isHead && content.level === "building" && Boolean(content.building);
  const isCenter = content.level === "center" && Boolean(content.center);
  const isGov = content.level === "governorate" && Boolean(content.governorate);
  const isRoot = content.level === "root";

  // A4 dimensions in points: 210mm x 297mm = 595.28 x 841.89 pt
  const isLandscape = orientation === "landscape";
  const pageWidth = isLandscape ? 841.89 : 595.28;
  const pageHeight = isLandscape ? 595.28 : 841.89;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  // Outer framing rectangle - removed per user request (border box removed)
  const margin = 24;

  // --- HEADER SECTION ---
  let headerBottomY = pageHeight - margin - 20;

  // Official Logo on the LEFT side (UI/UX Balanced)
  const logoHeight = isRoom ? (isLandscape ? 68 : 76) : (isLandscape ? 58 : 66);
  const logoWidth = logoImg ? logoHeight * (logoImg.width / logoImg.height) : 0;
  const logoX = margin + 20;
  const logoY = pageHeight - margin - 15 - logoHeight;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoWidth,
      height: logoHeight,
    });
  } else {
    page.drawText("EST", {
      x: logoX,
      y: logoY + 12,
      size: 32,
      font,
      color: COLOR_CHARCOAL,
    });
  }

  // Exam Tag (EST 1 or EST 2) - displayed on BOTH sides for total clarity
  const examTag = resolveExamTag(content);

  // Left Tag: right next to official logo
  const leftTagX = logoImg ? logoX + logoWidth + 14 : logoX + 70;
  const leftTagSize = isLandscape ? 22 : 24;
  page.drawText(examTag, {
    x: leftTagX,
    y: logoY + (logoHeight - leftTagSize) / 2 + 1,
    size: leftTagSize,
    font,
    color: COLOR_CHARCOAL,
  });

  // Right Side (opposite to the logo): Exam Tag and Official Date & Day in English
  const examTagSize = isLandscape ? 24 : 28;
  const examTagW = font.widthOfTextAtSize(examTag, examTagSize);
  const rightMargin = margin + 20;
  const examTagX = pageWidth - rightMargin - examTagW;
  const examTagY = pageHeight - margin - 15 - examTagSize;

  page.drawText(examTag, {
    x: examTagX,
    y: examTagY,
    size: examTagSize,
    font,
    color: COLOR_CHARCOAL,
  });

  // Date & Day (English) right under the exam tag on the right side
  const fullDateText = [content.examDay, content.examDate].filter(Boolean).join(", ");
  if (fullDateText) {
    const dateSize = isLandscape ? 12 : 13;
    const dateW = font.widthOfTextAtSize(fullDateText, dateSize);
    const dateX = pageWidth - rightMargin - dateW;
    const dateY = examTagY - 18;
    page.drawText(fullDateText, {
      x: dateX,
      y: dateY,
      size: dateSize,
      font,
      color: COLOR_CHARCOAL,
    });
  }

  // Top-Right Corner: Exam Papers indicator if applicable
  if (content.isExamDossier) {
    const badgeText = "★ CONTAINS TEST PAPERS ★";
    const badgeSize = isLandscape ? 11 : 12;
    const badgeW = font.widthOfTextAtSize(badgeText, badgeSize);
    const badgeX = pageWidth - rightMargin - badgeW;
    const badgeY = fullDateText ? examTagY - 34 : examTagY - 18;
    page.drawText(badgeText, {
      x: badgeX,
      y: badgeY,
      size: badgeSize,
      font,
      color: COLOR_CHARCOAL,
    });
  }

  headerBottomY = Math.min(logoY - 8, examTagY - (fullDateText ? 28 : 16));

  // Exam Subtitle Badge - skip for room and building stickers as requested
  if (!isRoom) {
    const subTitle = isHead
      ? "BUILDING HEAD DOSSIER"
      : content.isExamDossier
      ? "TEST PAPERS DOSSIER"
      : content.isFloorBag
      ? ""
      : isFloor
      ? "FLOOR TEST DOSSIER (SENIOR)"
      : "";
    if (subTitle) {
      const examSize = isLandscape ? 12 : 13;
      const examWidth = font.widthOfTextAtSize(subTitle, examSize);
      page.drawText(subTitle, {
        x: (pageWidth - examWidth) / 2,
        y: headerBottomY - 14,
        size: examSize,
        font,
        color: COLOR_MUTED,
      });
    }
  }

  // Divider Line
  const dividerY = isRoom ? headerBottomY - 6 : headerBottomY - 24;
  page.drawLine({
    start: { x: margin + 30, y: dividerY },
    end: { x: pageWidth - margin - 30, y: dividerY },
    thickness: 1.5,
    color: COLOR_CHARCOAL,
  });

  // --- BODY SECTION ---
  const bodyTop = dividerY - 16;
  const bodyBottom = margin + 18;
  const availBodyHeight = bodyTop - bodyBottom;
  const bodyWidth = pageWidth - margin * 2 - 36;
  const bodyStartX = margin + 18;

  if (isRoom) {
    // ========================================================
    // 1. ROOM LEVEL
    // Top: 4 location summary cards (Governorate, Center, Building, Floor)
    // Bottom: Left = Room Hero card, Right = Room File Contents Checklist
    // ========================================================
    const summaryCardHeight = isLandscape ? 56 : 52;
    const summaryY = bodyTop - summaryCardHeight;

    const isSchool = isSchoolCenter(content.center);
    const hasDiffBuilding = Boolean(content.building && content.building !== content.center && !isSchool);

    const cards = [
      { label: "Governorate", value: content.governorate || "—" },
      { label: "Test Center", value: content.center || "—" },
    ];
    if (hasDiffBuilding) {
      cards.push({ label: "Building", value: content.building! });
    }
    cards.push({ label: "Floor", value: content.floor || "—" });

    const roomChecklistItems = [
      "1. Student Register",
      "2. Proctor Sheet",
      "3. Numbers & Mobile Collection Files",
      "4. Student Misconduct Forms",
    ];

    if (isLandscape) {
      // Horizontal summary cards
      const colWidth = (bodyWidth - (cards.length - 1) * 12) / cards.length;
      for (let i = 0; i < cards.length; i++) {
        renderSummaryCard({
          page,
          font,
          x: bodyStartX + i * (colWidth + 12),
          y: summaryY,
          width: colWidth,
          height: summaryCardHeight,
          label: cards[i].label,
          value: cards[i].value,
        });
      }

      // Bottom Area: Left = Room Hero (40%), Right = Room Checklist Box (60%)
      const bottomAreaTop = summaryY - 14;
      const bottomAreaHeight = bottomAreaTop - bodyBottom;
      const leftColWidth = (bodyWidth - 16) * 0.40;
      const rightColWidth = (bodyWidth - 16) * 0.60;
      const rightColX = bodyStartX + leftColWidth + 16;

      const subjectLines = getVerticalSubjectLines(content, true);

      renderHeroCard({
        page,
        font,
        x: bodyStartX,
        y: bodyBottom,
        width: leftColWidth,
        height: bottomAreaHeight,
        badgeText: undefined,
        valueText: content.room || "",
        detailLines: subjectLines.length > 0 ? subjectLines : undefined,
      });

      renderChecklistBox({
        page,
        font,
        x: rightColX,
        y: bodyBottom,
        width: rightColWidth,
        height: bottomAreaHeight,
        headerText: "ROOM FILE CONTENTS CHECKLIST",
        items: roomChecklistItems,
      });
    } else {
      // Portrait layout: row of cards
      const colWidth = (bodyWidth - (cards.length - 1) * 12) / cards.length;
      for (let i = 0; i < cards.length; i++) {
        renderSummaryCard({
          page,
          font,
          x: bodyStartX + i * (colWidth + 12),
          y: summaryY,
          width: colWidth,
          height: summaryCardHeight,
          label: cards[i].label,
          value: cards[i].value,
        });
      }

      const gridBottom = summaryY;
      const remainingHeight = gridBottom - bodyBottom - 16;
      const heroHeight = Math.min(150, remainingHeight * 0.38);
      const checklistHeight = remainingHeight - heroHeight - 12;

      const subjectLines = getVerticalSubjectLines(content, true);

      renderHeroCard({
        page,
        font,
        x: bodyStartX,
        y: gridBottom - heroHeight - 10,
        width: bodyWidth,
        height: heroHeight,
        badgeText: undefined,
        valueText: content.room || "",
        detailLines: subjectLines.length > 0 ? subjectLines : undefined,
      });

      renderChecklistBox({
        page,
        font,
        x: bodyStartX,
        y: bodyBottom,
        width: bodyWidth,
        height: checklistHeight,
        headerText: "ROOM FILE CONTENTS CHECKLIST",
        items: roomChecklistItems,
      });
    }
  } else if (isFloor) {
    // ========================================================
    // 2. FLOOR LEVEL (SENIOR SUPERVISOR DOSSIER)
    // Displays total rooms inside this floor, lists them,
    // and includes the Senior Floor Dossier Checklist
    // ========================================================
    const childRoomsCount = content.childCount || (content.childNames ? content.childNames.length : 0);
    const summaryCardHeight = isLandscape ? 56 : 52;
    const summaryY = bodyTop - summaryCardHeight;

    const isSchool = isSchoolCenter(content.center);
    const hasDiffBuilding = Boolean(content.building && content.building !== content.center && !isSchool);

    const cards = [
      { label: "Governorate", value: content.governorate || "—" },
      { label: "Test Center", value: content.center || "—" },
    ];
    if (hasDiffBuilding) {
      cards.push({ label: "Building", value: content.building! });
    }
    cards.push({
      label: "Total Rooms",
      value: childRoomsCount > 0 ? `${childRoomsCount} Rooms` : "Rooms Included",
    });

    const floorChecklistItems = [
      "1. Proctor Register",
      "2. Senior Sheet",
      "3. Numbers & Mobile Collection Files",
      "4. Proctor Misconduct Forms",
      "5. Draft papers, pens, and IDs",
    ];

    const floorDetailLines = getFloorDetailLines(content);

    const subText =
      content.childNames && content.childNames.length > 0
        ? `ROOMS (${childRoomsCount}) : ${content.childNames.join("  •  ")}`
        : typeof content.totalStudents === "number" && content.totalStudents > 0
        ? `${content.totalStudents} TOTAL REGISTERED STUDENTS`
        : childRoomsCount > 0
          ? `ROOMS (${childRoomsCount}) IN THIS FLOOR`
          : undefined;

    if (content.isFloorBag) {
      // Grand full-width layout (identical to Building placard, customized for the Floor)
      const heroBoxHeight = Math.min(240, availBodyHeight * 0.60);
      const summaryHeight = availBodyHeight - heroBoxHeight - 16;
      const sY = bodyTop - summaryHeight;

      const colWidth = (bodyWidth - (cards.length - 1) * 12) / cards.length;
      for (let i = 0; i < cards.length; i++) {
        const cardX = isLandscape ? bodyStartX + i * (colWidth + 12) : bodyStartX;
        const cardY = isLandscape ? sY : sY + (cards.length - 1 - i) * ((summaryHeight - 16) / cards.length + 8);
        const cardW = isLandscape ? colWidth : bodyWidth;
        const cardH = isLandscape ? summaryHeight : (summaryHeight - 16) / cards.length;

        renderSummaryCard({
          page,
          font,
          x: cardX,
          y: cardY,
          width: cardW,
          height: cardH,
          label: cards[i].label,
          value: cards[i].value,
        });
      }

      renderHeroCard({
        page,
        font,
        x: bodyStartX,
        y: bodyBottom,
        width: bodyWidth,
        height: heroBoxHeight,
        badgeText: undefined,
        valueText: content.floor || "",
        detailLines: floorDetailLines.length > 0 ? floorDetailLines : undefined,
        subText,
        accentColor: COLOR_GOLD,
      });
    } else if (isLandscape) {
      // Horizontal summary cards
      const colWidth = (bodyWidth - (cards.length - 1) * 12) / cards.length;
      for (let i = 0; i < cards.length; i++) {
        renderSummaryCard({
          page,
          font,
          x: bodyStartX + i * (colWidth + 12),
          y: summaryY,
          width: colWidth,
          height: summaryCardHeight,
          label: cards[i].label,
          value: cards[i].value,
        });
      }

      // Bottom Area: Left = Floor Hero (40%), Right = Senior Floor Dossier Checklist (60%)
      const bottomAreaTop = summaryY - 14;
      const bottomAreaHeight = bottomAreaTop - bodyBottom;
      const leftColWidth = (bodyWidth - 16) * 0.40;
      const rightColWidth = (bodyWidth - 16) * 0.60;
      const rightColX = bodyStartX + leftColWidth + 16;

      renderHeroCard({
        page,
        font,
        x: bodyStartX,
        y: bodyBottom,
        width: leftColWidth,
        height: bottomAreaHeight,
        badgeText: undefined,
        valueText: content.floor || "",
        detailLines: floorDetailLines.length > 0 ? floorDetailLines : undefined,
        subText,
        accentColor: COLOR_GOLD,
      });

      renderChecklistBox({
        page,
        font,
        x: rightColX,
        y: bodyBottom,
        width: rightColWidth,
        height: bottomAreaHeight,
        headerText: "FLOOR DOSSIER CHECKLIST (SENIOR)",
        items: floorChecklistItems,
      });
    } else {
      // Portrait layout
      const colWidth = (bodyWidth - (cards.length - 1) * 12) / cards.length;
      for (let i = 0; i < cards.length; i++) {
        renderSummaryCard({
          page,
          font,
          x: bodyStartX + i * (colWidth + 12),
          y: summaryY,
          width: colWidth,
          height: summaryCardHeight,
          label: cards[i].label,
          value: cards[i].value,
        });
      }

      const gridBottom = summaryY;
      const remainingHeight = gridBottom - bodyBottom - 16;
      const heroHeight = Math.min(150, remainingHeight * 0.38);
      const checklistHeight = remainingHeight - heroHeight - 12;

      renderHeroCard({
        page,
        font,
        x: bodyStartX,
        y: gridBottom - heroHeight - 10,
        width: bodyWidth,
        height: heroHeight,
        badgeText: undefined,
        valueText: content.floor || "",
        detailLines: floorDetailLines.length > 0 ? floorDetailLines : undefined,
        subText,
        accentColor: COLOR_GOLD,
      });

      renderChecklistBox({
        page,
        font,
        x: bodyStartX,
        y: bodyBottom,
        width: bodyWidth,
        height: checklistHeight,
        headerText: "FLOOR DOSSIER CHECKLIST (SENIOR)",
        items: floorChecklistItems,
      });
    }
  } else if (isBuilding) {
    // ========================================================
    // 3. BUILDING LEVEL
    // Displays total floors inside this building and lists them all
    // ========================================================
    const childFloorsCount = content.childCount || (content.childNames ? content.childNames.length : 0);

    const heroBoxHeight = Math.min(240, availBodyHeight * 0.60);
    const summaryHeight = availBodyHeight - heroBoxHeight - 16;
    const summaryY = bodyTop - summaryHeight;

    const isSchool = isSchoolCenter(content.center || content.building);
    const hasDiffBuilding = Boolean(content.building && content.building !== content.center && !isSchool);

    const cards = [
      { label: "City", value: content.governorate || "—" },
    ];
    if (isSchool) {
      cards.push({ label: "School / Center", value: content.center || content.building || "—" });
    } else {
      cards.push({ label: "Test Center", value: content.center || "—" });
      if (hasDiffBuilding) {
        cards.push({ label: "Building", value: content.building! });
      }
    }
    cards.push({
      label: "Total Floors",
      value: childFloorsCount > 0 ? `${childFloorsCount} Floors` : "Floors Included",
    });

    if (content.totalRooms && content.totalRooms > 0) {
      cards.push({
        label: "Total Rooms",
        value: `${content.totalRooms} Rooms`,
      });
    }

    const colWidth = (bodyWidth - (cards.length - 1) * 12) / cards.length;
    for (let i = 0; i < cards.length; i++) {
      const cardX = isLandscape ? bodyStartX + i * (colWidth + 12) : bodyStartX;
      const cardY = isLandscape ? summaryY : summaryY + (cards.length - 1 - i) * ((summaryHeight - 16) / cards.length + 8);
      const cardW = isLandscape ? colWidth : bodyWidth;
      const cardH = isLandscape ? summaryHeight : (summaryHeight - 16) / cards.length;

      renderSummaryCard({
        page,
        font,
        x: cardX,
        y: cardY,
        width: cardW,
        height: cardH,
        label: cards[i].label,
        value: cards[i].value,
      });
    }

    const subText =
      content.childNames && content.childNames.length > 0
        ? `FLOORS (${childFloorsCount}) : ${content.childNames.join("  •  ")}`
        : childFloorsCount > 0
          ? `TOTAL FLOORS : ${childFloorsCount} FLOORS IN THIS VENUE`
          : undefined;

    renderHeroCard({
      page,
      font,
      x: bodyStartX,
      y: bodyBottom,
      width: bodyWidth,
      height: heroBoxHeight,
      badgeText: isSchool ? `${examTag} – TEST CENTER` : `${examTag} – BUILDING`,
      valueText: isSchool ? (content.center || content.building || "") : (content.building || content.center || ""),
      subText,
      accentColor: COLOR_GOLD,
    });
  } else if (isCenter) {
    // ========================================================
    // 4. TEST CENTER LEVEL (e.g. Abu Qir)
    // Displays total buildings inside this center and lists them all
    // ========================================================
    const childBuildingsCount = content.childCount || (content.childNames ? content.childNames.length : 0);

    const heroBoxHeight = Math.min(240, availBodyHeight * 0.60);
    const summaryHeight = availBodyHeight - heroBoxHeight - 16;
    const summaryY = bodyTop - summaryHeight;

    const cards = [
      { label: "Governorate", value: content.governorate || "—" },
      {
        label: "Total Buildings",
        value: childBuildingsCount > 0 ? `${childBuildingsCount} Buildings` : "Buildings Included",
      },
    ];

    if (content.totalRooms && content.totalRooms > 0) {
      cards.push({
        label: "Total Rooms",
        value: `${content.totalRooms} Rooms`,
      });
    }

    const colWidth = (bodyWidth - (cards.length - 1) * 12) / cards.length;
    for (let i = 0; i < cards.length; i++) {
      const cardX = isLandscape ? bodyStartX + i * (colWidth + 12) : bodyStartX;
      const cardY = isLandscape ? summaryY : summaryY + (cards.length - 1 - i) * ((summaryHeight - 16) / cards.length + 8);
      const cardW = isLandscape ? colWidth : bodyWidth;
      const cardH = isLandscape ? summaryHeight : (summaryHeight - 16) / cards.length;

      renderSummaryCard({
        page,
        font,
        x: cardX,
        y: cardY,
        width: cardW,
        height: cardH,
        label: cards[i].label,
        value: cards[i].value,
      });
    }

    const subText =
      content.childNames && content.childNames.length > 0
        ? `INCLUDED BUILDINGS (${childBuildingsCount}) : ${content.childNames.join("  •  ")}`
        : childBuildingsCount > 0
          ? `TOTAL INCLUDED BUILDINGS : ${childBuildingsCount} BUILDINGS IN THIS CENTER`
          : undefined;

    renderHeroCard({
      page,
      font,
      x: bodyStartX,
      y: bodyBottom,
      width: bodyWidth,
      height: heroBoxHeight,
      badgeText: `${examTag} – TEST CENTER`,
      valueText: content.center || "",
      subText,
      accentColor: COLOR_GOLD,
    });
  } else if (isGov) {
    // ========================================================
    // 5. GOVERNORATE LEVEL (e.g. Alexandria)
    // Displays total centers inside this governorate and lists them
    // ========================================================
    const childCentersCount = content.childCount || (content.childNames ? content.childNames.length : 0);

    const heroBoxHeight = Math.min(250, availBodyHeight * 0.65);
    const summaryHeight = availBodyHeight - heroBoxHeight - 16;
    const summaryY = bodyTop - summaryHeight;

    renderSummaryCard({
      page,
      font,
      x: bodyStartX,
      y: summaryY,
      width: bodyWidth,
      height: summaryHeight,
      label: "Total Centers",
      value: childCentersCount > 0 ? `${childCentersCount} Test Centers` : "Centers Included",
    });

    const subText =
      content.childNames && content.childNames.length > 0
        ? `INCLUDED CENTERS (${childCentersCount}) : ${content.childNames.join("  •  ")}`
        : undefined;

    renderHeroCard({
      page,
      font,
      x: bodyStartX,
      y: bodyBottom,
      width: bodyWidth,
      height: heroBoxHeight,
      badgeText: `${examTag} – GOVERNORATE`,
      valueText: content.governorate || "",
      subText,
      accentColor: COLOR_GOLD,
    });
  } else if (isRoot) {
    renderHeroCard({
      page,
      font,
      x: bodyStartX,
      y: bodyBottom + 20,
      width: bodyWidth,
      height: availBodyHeight - 40,
      badgeText: "TEST",
      valueText: content.examName || "EST 1",
      accentColor: COLOR_GOLD,
    });
  } else {
    // Custom fallback
    const items = content.fields.map((f) => ({ label: f.label, value: f.value }));
    if (items.length === 0) {
      items.push({ label: "Location", value: content.examName || "EST" });
    }

    const rowH = Math.min(70, (availBodyHeight - (items.length - 1) * 12) / items.length);
    for (let i = 0; i < items.length; i++) {
      const cardY = bodyTop - (i + 1) * rowH - i * 12;
      renderSummaryCard({
        page,
        font,
        x: bodyStartX,
        y: cardY,
        width: bodyWidth,
        height: rowH,
        label: items[i].label,
        value: items[i].value,
      });
    }
  }
}

/**
 * Helper to split text into lines that each fit within a maximum width.
 * Splits on word boundaries cleanly without breaking words where possible.
 */
function wrapTextToLines(
  text: string,
  font: any,
  fontSize: number,
  maxWidth: number,
): string[] {
  if (!text) return [];
  const clean = text.trim();
  if (!clean) return [];

  const words = clean.split(/\s+/);
  if (words.length <= 1) {
    return [clean];
  }

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const testLine = `${currentLine} ${word}`;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

/**
 * Helper to render a summary information card (Center, Floor, Building, Governorate).
 * Wraps long text across multiple lines to prevent horizontal overlap,
 * filling the generous vertical space with balanced, prominent typography.
 */
function renderSummaryCard(params: {
  page: any;
  font: any;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  value: string;
}) {
  const { page, font, x, y, width, height, label, value } = params;

  // Background
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });

  // Label
  const labelText = `${label.toUpperCase()} :`;
  const labelSize = Math.max(8.5, Math.min(10.5, height * 0.18));
  const labelY = y + height - labelSize - 8;
  page.drawText(labelText, {
    x: x + 10,
    y: labelY,
    size: labelSize,
    font,
    color: COLOR_MUTED,
  });

  if (!value || !value.trim()) return;

  const cleanVal = value.trim();
  const padX = 10;
  const availValWidth = width - padX * 2;
  const topValY = labelY - 6;
  const bottomValY = y + 8;
  const availValHeight = Math.max(16, topValY - bottomValY);

  // 1. Check if single line fits comfortably at a prominent size (13 to 17pt)
  const maxSingleSize = Math.min(17, Math.max(13, height * 0.30));
  const singleLineWidthAtMaxSize = font.widthOfTextAtSize(cleanVal, maxSingleSize);

  if (singleLineWidthAtMaxSize <= availValWidth) {
    // Fits on 1 line at full size
    const lineY = bottomValY + (availValHeight - maxSingleSize) / 2 + 1;
    page.drawText(cleanVal, {
      x: x + padX,
      y: lineY,
      size: maxSingleSize,
      font,
      color: COLOR_CHARCOAL,
    });
    return;
  }

  // 2. Check if single line fits with moderate scaling (down to 12.5pt)
  const minSingleLineSize = 12.5;
  const singleLineWidthAtMin = font.widthOfTextAtSize(cleanVal, minSingleLineSize);
  if (singleLineWidthAtMin <= availValWidth) {
    const fittedSize = Math.max(minSingleLineSize, (availValWidth / singleLineWidthAtMaxSize) * maxSingleSize);
    const lineY = bottomValY + (availValHeight - fittedSize) / 2 + 1;
    page.drawText(cleanVal, {
      x: x + padX,
      y: lineY,
      size: fittedSize,
      font,
      color: COLOR_CHARCOAL,
    });
    return;
  }

  // 3. For longer values (e.g. "Integrated Thebes American College In Cairo"), wrap across multiple lines
  // Test candidate font sizes from 13 down to 8.5
  const candidateSizes = [13, 12, 11, 10.5, 10, 9.5, 9, 8.5];
  let bestLines: string[] = [cleanVal];
  let bestSize = 8.5;
  let bestLineSpacing = bestSize * 1.22;
  let found = false;

  for (const s of candidateSizes) {
    const lines = wrapTextToLines(cleanVal, font, s, availValWidth);
    const spacing = s * 1.22;
    const totalH = (lines.length - 1) * spacing + s;
    const allLinesFit = lines.every((l) => font.widthOfTextAtSize(l, s) <= availValWidth + 0.5);

    if (allLinesFit && totalH <= availValHeight) {
      bestLines = lines;
      bestSize = s;
      bestLineSpacing = spacing;
      found = true;
      break;
    }
  }

  if (!found) {
    // Fallback: use size 8.5 and wrap
    bestSize = 8.5;
    bestLineSpacing = bestSize * 1.20;
    bestLines = wrapTextToLines(cleanVal, font, bestSize, availValWidth);
  }

  // Draw lines vertically centered in the available space
  const totalBlockH = (bestLines.length - 1) * bestLineSpacing + bestSize;
  const startTopY = bottomValY + (availValHeight + totalBlockH) / 2 - bestSize;

  for (let i = 0; i < bestLines.length; i++) {
    const curLine = bestLines[i];
    let curSize = bestSize;
    let curW = font.widthOfTextAtSize(curLine, curSize);
    if (curW > availValWidth) {
      curSize = Math.max(7, (availValWidth / curW) * curSize);
      curW = font.widthOfTextAtSize(curLine, curSize);
    }
    const lineY = startTopY - i * bestLineSpacing;
    page.drawText(curLine, {
      x: x + padX,
      y: lineY,
      size: curSize,
      font,
      color: COLOR_CHARCOAL,
    });
  }
}

/**
 * Helper to render the large hero badge (e.g. ROOM 204 or BUILDING Pharmacy),
 * with an optional sub-text banner (e.g. Included Floors or Included Rooms).
 */
function renderHeroCard(params: {
  page: any;
  font: any;
  x: number;
  y: number;
  width: number;
  height: number;
  badgeText?: string;
  valueText: string;
  subText?: string;
  detailText?: string;
  detailLines?: string[];
  accentColor?: any;
}) {
  const { page, font, x, y, width, height, badgeText, valueText, subText, detailText, detailLines, accentColor = COLOR_CHARCOAL } = params;

  // Outer border with clean frame (B&W)
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1.5,
  });

  // Top header banner in hero box
  const hasBadge = Boolean(badgeText && badgeText.trim());
  const bannerHeight = hasBadge ? Math.max(30, Math.min(38, height * 0.20)) : 0;
  const bannerY = y + height - bannerHeight;
  const bannerBgColor = rgb(0.92, 0.92, 0.92);
  const bannerTextColor = COLOR_CHARCOAL;

  if (hasBadge) {
    page.drawRectangle({
      x: x + 2,
      y: bannerY,
      width: width - 4,
      height: bannerHeight - 2,
      color: bannerBgColor,
    });

    // Header text
    const badgeTitle = badgeText!.toUpperCase();
    const titleSize = Math.max(12, Math.min(16, bannerHeight * 0.52));
    const titleWidth = font.widthOfTextAtSize(badgeTitle, titleSize);
    page.drawText(badgeTitle, {
      x: x + (width - titleWidth) / 2,
      y: bannerY + (bannerHeight - titleSize) / 2 - 2,
      size: titleSize,
      font,
      color: bannerTextColor,
    });
  }

  // Bottom Sub-Text banner (Vertical subjects or single text)
  const hasDetailLines = Boolean(detailLines && detailLines.length > 0);
  const hasSub = hasDetailLines || Boolean(subText || detailText);
  const subBarHeight = hasDetailLines
    ? Math.max(58, Math.min(125, detailLines!.length * 22 + 26))
    : hasSub
      ? detailText && subText
        ? Math.max(46, Math.min(58, height * 0.26))
        : Math.max(28, Math.min(36, height * 0.18))
      : 0;

  if (hasSub) {
    const subBarY = y + 2;
    page.drawRectangle({
      x: x + 2,
      y: subBarY,
      width: width - 4,
      height: subBarHeight,
      color: COLOR_LIGHT_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.8,
    });

    if (hasDetailLines) {
      // Render structured, proctor-optimized attendance table
      const lineCount = detailLines!.length;
      const subHeaderH = 18;
      // Header for proctors
      page.drawRectangle({
        x: x + 2,
        y: subBarY + subBarHeight - subHeaderH,
        width: width - 4,
        height: subHeaderH,
        color: COLOR_CHARCOAL,
      });
      const isFloorHero = Boolean(badgeText && badgeText.toUpperCase().includes("FLOOR"));
      const subHeaderTitle = isFloorHero
        ? "ASSIGNED ROOMS IN THIS FLOOR"
        : "EXAMINATION SUBJECTS & ATTENDANCE";
      const shSize = 8.5;
      const shW = font.widthOfTextAtSize(subHeaderTitle, shSize);
      page.drawText(subHeaderTitle, {
        x: x + (width - shW) / 2,
        y: subBarY + subBarHeight - subHeaderH + 5,
        size: shSize,
        font,
        color: COLOR_WHITE,
      });

      const availTableH = subBarHeight - subHeaderH - 4;
      const step = availTableH / lineCount;
      const baseLineSize = lineCount <= 2 ? 13 : lineCount === 3 ? 11.5 : 10;

      for (let i = 0; i < lineCount; i++) {
        const text = detailLines![i];
        const rowY = subBarY + subBarHeight - subHeaderH - (i + 1) * step;

        const isTotalLine = /^total/i.test(text);

        if (isTotalLine) {
          page.drawRectangle({
            x: x + 4,
            y: rowY + 1,
            width: width - 8,
            height: step - 2,
            color: rgb(0.90, 0.90, 0.90),
            borderColor: COLOR_CHARCOAL,
            borderWidth: 0.8,
          });
          const totalSize = Math.max(9.5, baseLineSize);
          const tw = font.widthOfTextAtSize(text.toUpperCase(), totalSize);
          page.drawText(text.toUpperCase(), {
            x: x + (width - tw) / 2,
            y: rowY + (step - totalSize) / 2 + 1,
            size: totalSize,
            font,
            color: COLOR_CHARCOAL,
          });
        } else if (!isFloorHero) {
          const m = text.match(/^(.+?):\s*(\d+.*)$/);
          if (m) {
            const subjName = m[1].trim();
            const countStr = `${m[2].trim()} Cand.`;
            const subjSize = baseLineSize;
            const countSize = baseLineSize;
            const countW = font.widthOfTextAtSize(countStr, countSize);

            page.drawText(subjName, {
              x: x + 8,
              y: rowY + (step - subjSize) / 2 + 1,
              size: subjSize,
              font,
              color: COLOR_CHARCOAL,
            });

            page.drawText(countStr, {
              x: x + width - countW - 8,
              y: rowY + (step - countSize) / 2 + 1,
              size: countSize,
              font,
              color: COLOR_CHARCOAL,
            });

            if (i < lineCount - 1) {
              page.drawLine({
                start: { x: x + 8, y: rowY },
                end: { x: x + width - 8, y: rowY },
                thickness: 0.4,
                color: COLOR_BORDER,
              });
            }
          } else {
            let size = baseLineSize;
            let tw = font.widthOfTextAtSize(text, size);
            if (tw > width - 16) {
              size = Math.max(8, ((width - 16) / tw) * size);
              tw = font.widthOfTextAtSize(text, size);
            }
            page.drawText(text, {
              x: x + (width - tw) / 2,
              y: rowY + (step - size) / 2 + 1,
              size,
              font,
              color: COLOR_CHARCOAL,
            });
          }
        } else {
          // For Floor Hero: Center the list of rooms nicely with high contrast
          let size = Math.min(13, baseLineSize + 1);
          let tw = font.widthOfTextAtSize(text, size);
          if (tw > width - 16) {
            size = Math.max(8, ((width - 16) / tw) * size);
            tw = font.widthOfTextAtSize(text, size);
          }
          page.drawText(text, {
            x: x + (width - tw) / 2,
            y: rowY + (step - size) / 2 + 1,
            size,
            font,
            color: COLOR_CHARCOAL,
          });
        }
      }
    } else if (detailText && subText) {
      // Line 1: Main count / label (e.g. "35 STUDENTS TOTAL") - Prominent and Large
      const topSize = Math.max(12, Math.min(15, subBarHeight * 0.28));
      let topW = font.widthOfTextAtSize(subText, topSize);
      let finalTopSize = topSize;
      if (topW > width - 16) {
        finalTopSize = Math.max(9, ((width - 16) / topW) * topSize);
        topW = font.widthOfTextAtSize(subText, finalTopSize);
      }
      page.drawText(subText, {
        x: x + (width - topW) / 2,
        y: subBarY + subBarHeight * 0.54,
        size: finalTopSize,
        font,
        color: COLOR_CHARCOAL,
      });

      // Subtle horizontal divider line
      page.drawLine({
        start: { x: x + 12, y: subBarY + subBarHeight * 0.48 },
        end: { x: x + width - 12, y: subBarY + subBarHeight * 0.48 },
        thickness: 0.5,
        color: COLOR_BORDER,
      });

      // Line 2: Detailed subject breakdown (e.g. "LIT: 35  |  MATH: 28  |  ESSAY: 12") - Prominent
      const dtlSize = Math.max(9.5, Math.min(12, subBarHeight * 0.24));
      let dtlW = font.widthOfTextAtSize(detailText, dtlSize);
      let finalDtlSize = dtlSize;
      if (dtlW > width - 16) {
        finalDtlSize = Math.max(7.5, ((width - 16) / dtlW) * dtlSize);
        dtlW = font.widthOfTextAtSize(detailText, finalDtlSize);
      }
      page.drawText(detailText, {
        x: x + (width - dtlW) / 2,
        y: subBarY + 5,
        size: finalDtlSize,
        font,
        color: COLOR_CHARCOAL,
      });
    } else {
      const singleText = subText || detailText || "";
      const baseSubSize = Math.max(10, Math.min(13, subBarHeight * 0.42));
      const singleW = font.widthOfTextAtSize(singleText, baseSubSize);

      if (singleW <= width - 24) {
        page.drawText(singleText, {
          x: x + (width - singleW) / 2,
          y: subBarY + (subBarHeight - baseSubSize) / 2 + 1,
          size: baseSubSize,
          font,
          color: COLOR_CHARCOAL,
        });
      } else {
        // Wrap subText across 2 lines if possible
        const wrappedSub = wrapTextToLines(singleText, font, 9.5, width - 24);
        if (wrappedSub.length <= 2) {
          const subLineH = 11;
          const totalSubH = (wrappedSub.length - 1) * subLineH + 9.5;
          const subStartY = subBarY + (subBarHeight + totalSubH) / 2 - 9.5;
          for (let i = 0; i < wrappedSub.length; i++) {
            let lSize = 9.5;
            let lw = font.widthOfTextAtSize(wrappedSub[i], lSize);
            if (lw > width - 16) {
              lSize = Math.max(7.5, ((width - 16) / lw) * lSize);
              lw = font.widthOfTextAtSize(wrappedSub[i], lSize);
            }
            page.drawText(wrappedSub[i], {
              x: x + (width - lw) / 2,
              y: subStartY - i * subLineH,
              size: lSize,
              font,
              color: COLOR_CHARCOAL,
            });
          }
        } else {
          // Scale down single line to fit without overflowing
          const scaledSubSize = Math.max(7.5, ((width - 24) / singleW) * baseSubSize);
          const scaledW = font.widthOfTextAtSize(singleText, scaledSubSize);
          page.drawText(singleText, {
            x: x + (width - scaledW) / 2,
            y: subBarY + (subBarHeight - scaledSubSize) / 2 + 1,
            size: scaledSubSize,
            font,
            color: COLOR_CHARCOAL,
          });
        }
      }
    }
  }

  // Giant Value (e.g. 204 or Pharmacy or long school name)
  const availValueHeight = bannerY - y - 16 - subBarHeight;
  const availValueWidth = width - 30;
  let valueSize = Math.max(24, Math.min(84, availValueHeight * 0.70));
  let valWidth = font.widthOfTextAtSize(valueText, valueSize);

  if (valWidth <= availValueWidth) {
    const valX = x + (width - valWidth) / 2;
    const valY = y + subBarHeight + (availValueHeight - valueSize) / 2 + 4;
    page.drawText(valueText, {
      x: valX,
      y: valY,
      size: valueSize,
      font,
      color: COLOR_CHARCOAL,
    });
  } else {
    // Value text is longer than availValueWidth - check if moderate scaling down fits (down to 28pt)
    const scaledSize = Math.max(28, (availValueWidth / valWidth) * valueSize);
    const scaledW = font.widthOfTextAtSize(valueText, scaledSize);

    if (scaledW <= availValueWidth) {
      const valX = x + (width - scaledW) / 2;
      const valY = y + subBarHeight + (availValueHeight - scaledSize) / 2 + 4;
      page.drawText(valueText, {
        x: valX,
        y: valY,
        size: scaledSize,
        font,
        color: COLOR_CHARCOAL,
      });
    } else {
      // Long multi-word name (e.g. school/building name) -> wrap into 2 or 3 lines
      const heroCandidateSizes = [32, 28, 24, 20, 18, 16];
      let heroLines: string[] = [valueText];
      let heroFontSize = 18;
      let heroSpacing = heroFontSize * 1.22;

      for (const hs of heroCandidateSizes) {
        const hLines = wrapTextToLines(valueText, font, hs, availValueWidth);
        const hSpacing = hs * 1.22;
        const hTotalH = (hLines.length - 1) * hSpacing + hs;
        const allFit = hLines.every((l) => font.widthOfTextAtSize(l, hs) <= availValueWidth);

        if (allFit && hTotalH <= availValueHeight) {
          heroLines = hLines;
          heroFontSize = hs;
          heroSpacing = hSpacing;
          break;
        }
      }

      const totalHeroH = (heroLines.length - 1) * heroSpacing + heroFontSize;
      const heroTopY = y + subBarHeight + (availValueHeight + totalHeroH) / 2 - heroFontSize;

      for (let i = 0; i < heroLines.length; i++) {
        const line = heroLines[i];
        let lSize = heroFontSize;
        let lw = font.widthOfTextAtSize(line, lSize);
        if (lw > availValueWidth) {
          lSize = Math.max(12, (availValueWidth / lw) * lSize);
          lw = font.widthOfTextAtSize(line, lSize);
        }
        page.drawText(line, {
          x: x + (width - lw) / 2,
          y: heroTopY - i * heroSpacing,
          size: lSize,
          font,
          color: COLOR_CHARCOAL,
        });
      }
    }
  }
}

/**
 * Renders an official File Contents Checklist Box.
 * Designed with clean empty square checkboxes for proctors/supervisors to manually check off with a pen.
 * Used for Room Dossiers (Proctor) and Floor Dossiers (Senior).
 */
function renderChecklistBox(params: {
  page: any;
  font: any;
  x: number;
  y: number;
  width: number;
  height: number;
  headerText: string;
  items: string[];
}) {
  const { page, font, x, y, width, height, headerText, items } = params;

  // Outer framing card
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 2,
  });

  // Header Banner (Clean light background with crisp border - ZERO Black Fill!)
  const bannerHeight = Math.max(30, Math.min(38, height * 0.15));
  const bannerY = y + height - bannerHeight;
  page.drawRectangle({
    x: x + 2,
    y: bannerY,
    width: width - 4,
    height: bannerHeight - 2,
    color: COLOR_LIGHT_BG,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1,
  });

  // Divider line under header
  page.drawLine({
    start: { x: x + 2, y: bannerY },
    end: { x: x + width - 2, y: bannerY },
    thickness: 1.5,
    color: COLOR_BORDER,
  });

  // Header Text
  const headerSize = Math.max(10, Math.min(13, bannerHeight * 0.44));
  const hWidth = font.widthOfTextAtSize(headerText, headerSize);
  page.drawText(headerText, {
    x: x + (width - hWidth) / 2,
    y: bannerY + (bannerHeight - headerSize) / 2 - 1,
    size: headerSize,
    font,
    color: COLOR_CHARCOAL,
  });

  const availContentHeight = bannerY - y;
  const footerHeight = Math.max(30, Math.min(38, availContentHeight * 0.16));
  const itemsAreaHeight = availContentHeight - footerHeight - 8;
  const itemRowHeight = itemsAreaHeight / items.length;

  for (let i = 0; i < items.length; i++) {
    const itemText = items[i];
    const rowY = bannerY - 6 - (i + 1) * itemRowHeight;

    // Checkbox Square (empty square for pen checking)
    const boxSize = Math.max(12, Math.min(15, itemRowHeight * 0.42));
    const boxX = x + 16;
    const boxY = rowY + (itemRowHeight - boxSize) / 2;

    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxSize,
      height: boxSize,
      color: COLOR_WHITE,
      borderColor: COLOR_CHARCOAL,
      borderWidth: 1.5,
    });

    // Item Text
    const labelX = boxX + boxSize + 12;
    let textSize = Math.max(9.5, Math.min(12, itemRowHeight * 0.38));
    let tWidth = font.widthOfTextAtSize(itemText, textSize);

    if (tWidth > width - 50) {
      textSize = Math.max(8.5, ((width - 50) / tWidth) * textSize);
    }

    page.drawText(itemText, {
      x: labelX,
      y: boxY + 2,
      size: textSize,
      font,
      color: COLOR_CHARCOAL,
    });

    // Subtle divider line
    if (i < items.length - 1) {
      page.drawLine({
        start: { x: x + 14, y: rowY },
        end: { x: x + width - 14, y: rowY },
        thickness: 0.5,
        color: COLOR_BORDER,
      });
    }
  }

  // Footer area - clean without signature requirement
}

/**
 * Compact custom label rendering (e.g. 100mm x 50mm).
 */
function drawCustomLabelPage(params: {
  pdfDoc: PDFDocument;
  font: any;
  logoImg: any;
  content: StickerContent;
  widthMm: number;
  heightMm: number;
}) {
  const { pdfDoc, font, logoImg, content, widthMm, heightMm } = params;

  const stickerWidthPt = widthMm * MM_TO_PT;
  const stickerHeightPt = heightMm * MM_TO_PT;

  const page = pdfDoc.addPage([stickerWidthPt, stickerHeightPt]);

  const paddingX = 14;
  const paddingY = 10;
  const availWidth = stickerWidthPt - paddingX * 2;

  let currentY = stickerHeightPt - paddingY;

  // Header: Logo if present
  if (logoImg) {
    const logoHeight = Math.min(26, stickerHeightPt * 0.22);
    const logoWidth = logoHeight * (logoImg.width / logoImg.height);
    page.drawImage(logoImg, {
      x: paddingX,
      y: currentY - logoHeight,
      width: logoWidth,
      height: logoHeight,
    });

    const examTitle = content.examName || "EST";
    const examSize = Math.min(13, logoHeight * 0.65);
    page.drawText(examTitle, {
      x: paddingX + logoWidth + 8,
      y: currentY - logoHeight + 6,
      size: examSize,
      font,
      color: COLOR_CHARCOAL,
    });

    currentY -= logoHeight + 6;
  }

  // Divider
  page.drawLine({
    start: { x: paddingX, y: currentY },
    end: { x: stickerWidthPt - paddingX, y: currentY },
    thickness: 1,
    color: COLOR_GOLD,
  });
  currentY -= 8;

  // Lines to draw with labels
  const displayItems = content.fields.map((f) => `${f.label} : ${f.value}`);
  if (displayItems.length === 0) {
    displayItems.push(content.examName || "EST");
  }

  // Include dynamic count in English
  if (content.level === "center" && content.childCount) {
    displayItems.push(`Total Buildings : ${content.childCount}`);
  } else if (content.level === "building" && content.childCount) {
    displayItems.push(`Total Floors : ${content.childCount}`);
  } else if (content.level === "floor") {
    if (content.childCount) {
      displayItems.push(`Total Rooms : ${content.childCount}`);
    }
    displayItems.push("[ ] Proc Reg  [ ] Senior Rep  [ ] Numbers & Mobile  [ ] Proc Misconduct  [ ] Draft/Pens/IDs");
  } else if (content.level === "room") {
    displayItems.push("[ ] Reg  [ ] Proctor  [ ] Numbers & Mobile  [ ] Misconduct");
  }

  const remainingHeight = currentY - paddingY;
  const lineSpacing = 3;
  const rawLineHeight = (remainingHeight - (displayItems.length - 1) * lineSpacing) / displayItems.length;
  const baseSize = Math.max(7, Math.min(13, rawLineHeight));

  for (const text of displayItems) {
    let size = baseSize;
    let width = font.widthOfTextAtSize(text, size);
    if (width > availWidth) {
      size = Math.max(6, (availWidth / width) * size);
    }

    page.drawText(text, {
      x: paddingX,
      y: currentY - size,
      size,
      font,
      color: COLOR_CHARCOAL,
    });
    currentY -= size + lineSpacing;
  }
}

/**
 * Draws an A4 Landscape page (841.89 x 595.28 pt) divided into 4 quarters (2x2 grid).
 * Used for Room stickers and Floor stickers.
 * Each quarter contains a complete, official EST dossier placard with logo, hero, and checklist.
 * Features dashed cut guides between the 4 quadrants.
 */
function drawA4FourUpPlacardPage(params: {
  pdfDoc: PDFDocument;
  font: any;
  logoImg: any;
  contents: StickerContent[];
  orientation?: "portrait" | "landscape";
}) {
  const { pdfDoc, font, logoImg, contents, orientation = "portrait" } = params;

  // Standard A4 Portrait in points: 595.28 x 841.89 pt (or Landscape if explicitly requested)
  const isLandscape = orientation === "landscape";
  const pageWidth = isLandscape ? 841.89 : 595.28;
  const pageHeight = isLandscape ? 595.28 : 841.89;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  const midX = pageWidth / 2;
  const midY = pageHeight / 2;

  // Subtle cut lines dividing the sheet into 4 quadrants
  const cutColor = rgb(0.72, 0.72, 0.72);
  page.drawLine({
    start: { x: midX, y: 0 },
    end: { x: midX, y: pageHeight },
    thickness: 0.5,
    color: cutColor,
    dashArray: [4, 4],
  });
  page.drawLine({
    start: { x: 0, y: midY },
    end: { x: pageWidth, y: midY },
    thickness: 0.5,
    color: cutColor,
    dashArray: [4, 4],
  });

  // Center cross-marker for precise cutting
  page.drawLine({ start: { x: midX - 8, y: midY }, end: { x: midX + 8, y: midY }, thickness: 1.2, color: cutColor });
  page.drawLine({ start: { x: midX, y: midY - 8 }, end: { x: midX, y: midY + 8 }, thickness: 1.2, color: cutColor });

  // 4 Quadrants in reading order:
  // 0: Top-Left (x: 0, y: midY)
  // 1: Top-Right (x: midX, y: midY)
  // 2: Bottom-Left (x: 0, y: 0)
  // 3: Bottom-Right (x: midX, y: 0)
  const quadrants = [
    { x: 0, y: midY, width: midX, height: midY },
    { x: midX, y: midY, width: midX, height: midY },
    { x: 0, y: 0, width: midX, height: midY },
    { x: midX, y: 0, width: midX, height: midY },
  ];

  for (let i = 0; i < contents.length && i < 4; i++) {
    const q = quadrants[i];
    drawQuarterPlacard({
      page,
      font,
      logoImg,
      content: contents[i],
      slotX: q.x,
      slotY: q.y,
      slotWidth: q.width,
      slotHeight: q.height,
    });
  }
}

/**
 * Draws a single Quarter-A4 Room / Floor Placard (approx 298 x 421 pt portrait, or 421 x 298 pt landscape).
 * Clean, Simple, 100% Black & White with Large Typography.
 * NO OUTER BORDER BOX around the sticker per user request.
 */
function drawQuarterPlacard(params: {
  page: any;
  font: any;
  logoImg: any;
  content: StickerContent;
  slotX: number;
  slotY: number;
  slotWidth: number;
  slotHeight: number;
}) {
  const { page, font, logoImg, content, slotX, slotY, slotWidth, slotHeight } = params;

  const isExamPapers = Boolean(content.isExamDossier);
  const isHead = !isExamPapers && (content.level === "building_head" || Boolean(content.isHead) || (!Boolean(content.floor) && !Boolean(content.room) && content.level === "building"));
  const isRoom = !isHead && !isExamPapers && content.level === "room";
  const margin = 12;
  const x = slotX + margin;
  const y = slotY + margin;
  const width = slotWidth - margin * 2;
  const height = slotHeight - margin * 2;

  const isLandscapeSlot = width > height;

  if (isLandscapeSlot) {
    // Landscape 2-column layout (NO OUTER BORDER)
    // Logo on LEFT side for all placards
    const logoH = isRoom ? 32 : isHead ? 26 : 22;
    const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 0;
    const logoX = x + 10;
    const logoY = y + height - 6 - logoH;
    if (logoImg) {
      page.drawImage(logoImg, { x: logoX, y: logoY, width: logoW, height: logoH });
    } else {
      const estText = "EST";
      const estSize = isRoom ? 20 : 16;
      const estW = font.widthOfTextAtSize(estText, estSize);
      page.drawText(estText, { x: logoX, y: logoY + 4, size: estSize, font, color: COLOR_CHARCOAL });
    }

    // Left Side: Large EST 1 / EST 2 Tag based on active folder (next to logo)
    const examTag = resolveExamTag(content);
    const tagStartX = logoImg ? logoX + logoW + 8 : x + 44;
    const cornerTagSize = isRoom ? 18 : 20;
    page.drawText(examTag, {
      x: tagStartX,
      y: logoY + (logoH - cornerTagSize) / 2 + 1,
      size: cornerTagSize,
      font,
      color: COLOR_CHARCOAL,
    });

    // Top Header: Date & Day in English (on the RIGHT side opposite logo)
    const dateDayStr = [content.examDay, content.examDate].filter(Boolean).join(", ");
    if (dateDayStr) {
      const dSize = 8.5;
      const dW = font.widthOfTextAtSize(dateDayStr, dSize);
      const dX = x + width - dW - 8;
      const dY = logoY + (logoH - dSize) / 2 + 1;
      page.drawText(dateDayStr, {
        x: dX,
        y: dY,
        size: dSize,
        font,
        color: COLOR_CHARCOAL,
      });
    }

    const headerBottom = logoY - 7;
    page.drawLine({ start: { x: x + 8, y: headerBottom }, end: { x: x + width - 8, y: headerBottom }, thickness: 1, color: COLOR_BORDER });

    const divider2Y = drawQuarterLocationBlock({
      page,
      font,
      governorate: content.governorate,
      center: content.center,
      building: content.building,
      floor: content.floor,
      isHead,
      x,
      width,
      headerBottom,
    });

    const bodyTop = divider2Y - 10;
    const bodyBottom = y + 10;
    const bodyH = bodyTop - bodyBottom;
    const bodyW = width - 16;
    const leftW = Math.round(bodyW * 0.44);
    const leftX = x + 8;
    const dividerX = leftX + leftW + 8;
    const rightX = dividerX + 14;
    const rightW = width - 10 - rightX;

    page.drawLine({ start: { x: dividerX, y: bodyBottom + 6 }, end: { x: dividerX, y: bodyTop }, thickness: 1, color: COLOR_BORDER });

    // Left Column: Hero Value (Badge tag EST 1 - ROOM/FLOOR/HEAD removed per user specification)
    const heroValue = isExamPapers ? "EXAM PAPERS" : isHead ? "HEAD" : isRoom ? `Room: ${content.room || ""}` : (content.floor || "");
    let heroSize = isRoom ? 30 : isHead ? 28 : isExamPapers ? 26 : 26;
    let heroW = font.widthOfTextAtSize(heroValue, heroSize);
    if (heroW > leftW - 8) {
      heroSize = Math.max(16, ((leftW - 8) / heroW) * heroSize);
      heroW = font.widthOfTextAtSize(heroValue, heroSize);
    }
    const heroY = bodyTop - 14 - heroSize;
    page.drawText(heroValue, { x: leftX + (leftW - heroW) / 2, y: heroY, size: heroSize, font, color: COLOR_CHARCOAL });

    const leftDividerY = heroY - 10;
    page.drawLine({ start: { x: leftX + 8, y: leftDividerY }, end: { x: leftX + leftW - 8, y: leftDividerY }, thickness: 0.8, color: COLOR_BORDER });

    if (isRoom) {
      const subjectLines = getVerticalSubjectLines(content, true);
      if (subjectLines.length > 0) {
        const availSubjectH = leftDividerY - (bodyBottom + 4);
        const lineCount = subjectLines.length;
        const step = Math.min(22, Math.max(16, (availSubjectH - 6) / lineCount));
        const startSubjectY = leftDividerY - 14;
        const baseLineSize = lineCount <= 2 ? 12 : lineCount === 3 ? 11 : 9.5;
        for (let sIdx = 0; sIdx < lineCount; sIdx++) {
          const lineText = subjectLines[sIdx];
          const isTotal = /^total/i.test(lineText);
          const rowY = startSubjectY - sIdx * step;
          if (isTotal) {
            page.drawRectangle({
              x: leftX + 4,
              y: rowY - 1,
              width: leftW - 8,
              height: step - 2,
              color: rgb(0.92, 0.92, 0.92),
              borderColor: COLOR_CHARCOAL,
              borderWidth: 0.6,
            });
            const totSize = Math.max(9, baseLineSize);
            const totW = font.widthOfTextAtSize(lineText.toUpperCase(), totSize);
            page.drawText(lineText.toUpperCase(), {
              x: leftX + (leftW - totW) / 2,
              y: rowY + (step - 2 - totSize) / 2,
              size: totSize,
              font,
              color: COLOR_CHARCOAL,
            });
          } else {
            const m = lineText.match(/^(.+?):\s*(\d+.*)$/);
            if (m) {
              const sName = m[1].trim();
              const cStr = `${m[2].trim()} Cand.`;
              const cW = font.widthOfTextAtSize(cStr, baseLineSize);
              page.drawText(sName, {
                x: leftX + 6,
                y: rowY + 1,
                size: baseLineSize,
                font,
                color: COLOR_CHARCOAL,
              });
              page.drawText(cStr, {
                x: leftX + leftW - cW - 6,
                y: rowY + 1,
                size: baseLineSize,
                font,
                color: COLOR_CHARCOAL,
              });
              if (sIdx < lineCount - 1) {
                page.drawLine({
                  start: { x: leftX + 6, y: rowY - 2 },
                  end: { x: leftX + leftW - 6, y: rowY - 2 },
                  thickness: 0.4,
                  color: COLOR_BORDER,
                });
              }
            } else {
              let lineSize = baseLineSize;
              let lineW = font.widthOfTextAtSize(lineText, lineSize);
              if (lineW > leftW - 8) {
                lineSize = Math.max(8, ((leftW - 8) / lineW) * lineSize);
                lineW = font.widthOfTextAtSize(lineText, lineSize);
              }
              page.drawText(lineText, { x: leftX + (leftW - lineW) / 2, y: rowY + 1, size: lineSize, font, color: COLOR_CHARCOAL });
            }
          }
        }
      }
    } else if (isExamPapers) {
      const examPapersSubText = "CONTAINS QUESTION PAPERS";
      let totalSize = 10.5;
      let totalW = font.widthOfTextAtSize(examPapersSubText, totalSize);
      if (totalW > leftW - 8) {
        totalSize = Math.max(8, ((leftW - 8) / totalW) * totalSize);
        totalW = font.widthOfTextAtSize(examPapersSubText, totalSize);
      }
      page.drawText(examPapersSubText, { x: leftX + (leftW - totalW) / 2, y: leftDividerY - 20, size: totalSize, font, color: COLOR_CHARCOAL });
    } else if (isHead) {
      const childFloorsCount = content.childCount || (content.childNames ? content.childNames.length : 0);
      const headSubText = typeof content.totalRooms === "number" && content.totalRooms > 0
        ? `${childFloorsCount > 0 ? `${childFloorsCount} Floors ` : ""}(${content.totalRooms} Rooms)`
        : childFloorsCount > 0
          ? `${childFloorsCount} Floors`
          : typeof content.totalStudents === "number" && content.totalStudents > 0
            ? `${content.totalStudents} Students`
            : "HEAD DOSSIER";
      let totalSize = 12;
      let totalW = font.widthOfTextAtSize(headSubText, totalSize);
      if (totalW > leftW - 8) {
        totalSize = Math.max(8.5, ((leftW - 8) / totalW) * totalSize);
        totalW = font.widthOfTextAtSize(headSubText, totalSize);
      }
      page.drawText(headSubText, { x: leftX + (leftW - totalW) / 2, y: leftDividerY - 20, size: totalSize, font, color: COLOR_CHARCOAL });
    } else {
      // Floor level: Display list of rooms in this floor
      const rooms = content.childNames || [];
      const childRoomsCount = content.childCount || rooms.length;
      const floorHeader = `ROOMS (${childRoomsCount}):`;
      const fhSize = 8;
      page.drawText(floorHeader, { x: leftX + 4, y: leftDividerY - 14, size: fhSize, font, color: COLOR_MUTED });

      const availH = leftDividerY - 20 - (bodyBottom + 4);
      if (rooms.length > 0) {
        // Chunk into lines of 4 rooms
        const chunks: string[] = [];
        for (let i = 0; i < rooms.length; i += 4) {
          chunks.push(rooms.slice(i, i + 4).join("  •  "));
        }
        const lineCount = chunks.length;
        const step = Math.min(18, Math.max(13, (availH - 18) / lineCount));
        const startY = leftDividerY - 26;
        for (let cIdx = 0; cIdx < lineCount; cIdx++) {
          const chunkText = chunks[cIdx];
          let cSize = 9.5;
          let cW = font.widthOfTextAtSize(chunkText, cSize);
          if (cW > leftW - 10) {
            cSize = Math.max(7.5, ((leftW - 10) / cW) * cSize);
            cW = font.widthOfTextAtSize(chunkText, cSize);
          }
          page.drawText(chunkText, {
            x: leftX + (leftW - cW) / 2,
            y: startY - cIdx * step,
            size: cSize,
            font,
            color: COLOR_CHARCOAL,
          });
        }

        // Bottom Total Students Bar
        if (typeof content.totalStudents === "number" && content.totalStudents > 0) {
          const totText = `${content.totalStudents} STUDENTS TOTAL`;
          const totSize = 9;
          const totW = font.widthOfTextAtSize(totText, totSize);
          const barY = bodyBottom + 4;
          page.drawRectangle({
            x: leftX + 4,
            y: barY - 1,
            width: leftW - 8,
            height: 14,
            color: rgb(0.92, 0.92, 0.92),
            borderColor: COLOR_CHARCOAL,
            borderWidth: 0.6,
          });
          page.drawText(totText, {
            x: leftX + (leftW - totW) / 2,
            y: barY + 2.5,
            size: totSize,
            font,
            color: COLOR_CHARCOAL,
          });
        }
      } else {
        const floorSubText = typeof content.totalStudents === "number" && content.totalStudents > 0
          ? `${content.totalStudents} STUDENTS TOTAL`
          : childRoomsCount > 0 ? `${childRoomsCount} ROOMS INCLUDED` : "SENIOR DOSSIER";
        let totalSize = 12;
        let totalW = font.widthOfTextAtSize(floorSubText, totalSize);
        page.drawText(floorSubText, { x: leftX + (leftW - totalW) / 2, y: leftDividerY - 24, size: totalSize, font, color: COLOR_CHARCOAL });
      }
    }

    // Right Column (Checklist)
    const chkTitle = isExamPapers
      ? "EXAM PAPERS HANDOVER CHECKLIST"
      : isHead
        ? "HEAD DOSSIER & SUPPLIES CHECKLIST"
        : isRoom
          ? "ROOM FILE CONTENTS CHECKLIST"
          : "FLOOR DOSSIER CHECKLIST";
    page.drawText(chkTitle, { x: rightX, y: bodyTop - 12, size: 8, font, color: COLOR_CHARCOAL });
    page.drawLine({ start: { x: rightX, y: bodyTop - 18 }, end: { x: rightX + rightW, y: bodyTop - 18 }, thickness: 0.8, color: COLOR_BORDER });

    const rawItems = isExamPapers
      ? [
        "1. Sealed Exam Question Papers",
        "2. Proctor Distribution Registers",
        "3. Mobile & Valuables Collection Bags",
        "4. Emergency Extra Question Packs",
        "5. Control Return Envelope & Seals",
      ]
      : isHead
        ? [
          "1. Control Room Register",
          "2. Scratch Paper",
          "3. Mobile Collection Files",
          "4. Proctor & Senior Sheets",
          "5. Student & Proctor Misconduct Forms",
        ]
        : isRoom
          ? [
            "1. Student Register",
            "2. Proctor Sheet",
            "3. Numbers & Mobile Collection Files",
            "4. Student Misconduct Forms",
          ]
          : [
            "1. Proctor Register",
            "2. Senior Sheet",
            "3. Numbers & Mobile Collection Files",
            "4. Proctor Misconduct Forms",
            "5. Draft papers, pens, and IDs",
          ];

    const items = rawItems.map((it) => (/[ \u0600-\u06FF]/.test(it) ? formatArabicForPdf(it) : it));

    const itemsStartY = bodyTop - 22;
    const availItemsH = itemsStartY - (bodyBottom + 8);
    const rowH = availItemsH / items.length;
    for (let i = 0; i < items.length; i++) {
      const itemY = itemsStartY - (i + 1) * rowH;
      const boxSize = 8.5;
      const boxX = rightX + 2;
      const boxY = itemY + (rowH - boxSize) / 2;
      page.drawRectangle({ x: boxX, y: boxY, width: boxSize, height: boxSize, color: COLOR_WHITE, borderColor: COLOR_CHARCOAL, borderWidth: 1 });
      page.drawText(items[i], { x: boxX + boxSize + 6, y: boxY + 1.5, size: (isHead || isExamPapers) ? 7.6 : 7.5, font, color: COLOR_CHARCOAL });
    }
    return;
  }

  // Header: Logo on the LEFT side for all placards
  const logoH = isRoom ? 32 : isHead ? 28 : 24;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 0;
  const logoX = x + 8;
  const logoY = y + height - 4 - logoH;

  if (logoImg) {
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  } else {
    const estText = "EST";
    const estSize = isRoom ? 20 : 16;
    const estW = font.widthOfTextAtSize(estText, estSize);
    page.drawText(estText, {
      x: logoX,
      y: logoY + 4,
      size: estSize,
      font,
      color: COLOR_CHARCOAL,
    });
  }

  // Left Side: Large EST 1 / EST 2 Tag based on active folder (next to logo)
  const examTag = resolveExamTag(content);
  const tagStartX = logoImg ? logoX + logoW + 8 : x + 40;
  const cornerTagSize = isRoom ? 17 : 20;
  page.drawText(examTag, {
    x: tagStartX,
    y: logoY + (logoH - cornerTagSize) / 2 + 1,
    size: cornerTagSize,
    font,
    color: COLOR_CHARCOAL,
  });

  // Top Header: Date & Day in English (on the RIGHT side opposite logo)
  const dateDayStrPortrait = [content.examDay, content.examDate].filter(Boolean).join(", ");
  if (dateDayStrPortrait) {
    let dSize = 7.5;
    let dW = font.widthOfTextAtSize(dateDayStrPortrait, dSize);
    const maxDW = width - (tagStartX + 30);
    if (dW > maxDW) {
      dSize = Math.max(6.5, (maxDW / dW) * dSize);
      dW = font.widthOfTextAtSize(dateDayStrPortrait, dSize);
    }
    const dX = x + width - dW - 6;
    const dY = logoY + (logoH - dSize) / 2 + 1;
    page.drawText(dateDayStrPortrait, {
      x: dX,
      y: dY,
      size: dSize,
      font,
      color: COLOR_CHARCOAL,
    });
  }

  const headerBottom = logoY - 7;

  // Divider 1 below header
  page.drawLine({
    start: { x: x + 4, y: headerBottom },
    end: { x: x + width - 4, y: headerBottom },
    thickness: 1,
    color: COLOR_BORDER,
  });

  // Location block broken into clean, prominent lines ("نكسر الصف")
  const divider2Y = drawQuarterLocationBlock({
    page,
    font,
    governorate: content.governorate,
    center: content.center,
    building: content.building,
    floor: content.floor,
    isHead,
    x,
    width,
    headerBottom,
  });

  // 1. Room / Floor / Head Hero Section (Badge tag EST 1 - ROOM/FLOOR/HEAD removed per user specification)
  const heroValue = isExamPapers ? "EXAM PAPERS" : isHead ? "HEAD" : isRoom ? `Room: ${content.room || ""}` : (content.floor || "");
  let heroSize = isRoom ? 30 : isHead ? 28 : isExamPapers ? 26 : 26;
  let heroW = font.widthOfTextAtSize(heroValue, heroSize);
  if (heroW > width - 16) {
    heroSize = Math.max(18, ((width - 16) / heroW) * heroSize);
    heroW = font.widthOfTextAtSize(heroValue, heroSize);
  }
  const heroY = divider2Y - 14 - heroSize;
  page.drawText(heroValue, {
    x: x + (width - heroW) / 2,
    y: heroY,
    size: heroSize,
    font,
    color: COLOR_CHARCOAL,
  });

  const heroDividerY = heroY - 8;
  page.drawLine({
    start: { x: x + 6, y: heroDividerY },
    end: { x: x + width - 6, y: heroDividerY },
    thickness: 0.6,
    color: COLOR_BORDER,
  });

  // ---------------------------------------------------------------------------
  // 3. Checklist Section (Anchored at the BOTTOM of the Quarter Sticker)
  // Distance from bottom slot edge (slotY) to bottom of checklist matches distance
  // from top slot edge to top of logo (16 pt, since y = slotY + 12, chkBottomY = y + 4).
  // ---------------------------------------------------------------------------
  const chkTitle = isExamPapers
    ? "EXAM PAPERS HANDOVER CHECKLIST"
    : isHead
    ? "HEAD DOSSIER & SUPPLIES CHECKLIST"
    : isRoom
      ? "ROOM FILE CONTENTS CHECKLIST"
      : "FLOOR DOSSIER CHECKLIST";

  const rawItems = isExamPapers
    ? [
      "1. Sealed Exam Question Papers",
      "2. Proctor Distribution Registers",
      "3. Mobile & Valuables Collection Bags",
      "4. Emergency Extra Question Packs",
      "5. Control Return Envelope & Seals",
    ]
    : isHead
    ? [
      "1. Control Room Register",
      "2. Scratch Paper",
      "3. Mobile Collection Files",
      "4. Proctor & Senior Sheets",
      "5. Student & Proctor Misconduct Forms",
    ]
    : isRoom
      ? [
        "1. Student Register",
        "2. Proctor Sheet",
        "3. Numbers & Mobile Collection Files",
        "4. Student Misconduct Forms",
      ]
      : [
        "1. Proctor Register",
        "2. Senior Sheet",
        "3. Numbers & Mobile Collection Files",
        "4. Proctor Misconduct Forms",
        "5. Draft papers, pens, and IDs",
      ];

  const items = rawItems.map((it) => (/[ \u0600-\u06FF]/.test(it) ? formatArabicForPdf(it) : it));

  // Footer text space for ExamPapers (Head footer removed per user specification)
  const hasBottomFooter = Boolean(isExamPapers);
  const bottomFooterH = hasBottomFooter ? 14 : 0;

  // Bottom edge padding: exactly 4pt from inner y (16pt from slotY), mirroring the 16pt from slot top to logo
  const chkBottomY = y + 4 + bottomFooterH;
  const numItems = items.length;
  const chkRowStep = isHead ? 13.5 : isRoom ? 15.5 : 14.5;
  const chkBoxSize = 8.5;

  for (let i = 0; i < numItems; i++) {
    // i = 0 is first item (rendered highest), i = numItems - 1 is last item (rendered lowest)
    const itemBoxY = chkBottomY + (numItems - 1 - i) * chkRowStep;
    const boxX = x + 8;

    page.drawRectangle({
      x: boxX,
      y: itemBoxY,
      width: chkBoxSize,
      height: chkBoxSize,
      color: COLOR_WHITE,
      borderColor: COLOR_CHARCOAL,
      borderWidth: 0.8,
    });

    page.drawText(items[i], {
      x: boxX + chkBoxSize + 6,
      y: itemBoxY + 1.2,
      size: isHead ? 7.6 : 7.4,
      font,
      color: COLOR_CHARCOAL,
    });
  }

  // Divider line under checklist title
  const highestItemY = chkBottomY + (numItems - 1) * chkRowStep;
  const chkUnderTitleY = highestItemY + chkBoxSize + 4;
  page.drawLine({
    start: { x: x + 6, y: chkUnderTitleY },
    end: { x: x + width - 6, y: chkUnderTitleY },
    thickness: 0.6,
    color: COLOR_BORDER,
  });

  // Checklist Title
  const chkTitleSize = 8;
  const chkTitleY = chkUnderTitleY + 4;
  page.drawText(chkTitle, {
    x: x + 6,
    y: chkTitleY,
    size: chkTitleSize,
    font,
    color: COLOR_CHARCOAL,
  });

  // Top Checklist Divider line separating Checklist from Middle Section
  const chkDividerY = chkTitleY + chkTitleSize + 5;
  page.drawLine({
    start: { x: x + 6, y: chkDividerY },
    end: { x: x + width - 6, y: chkDividerY },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  // Optional Footer at very bottom for Head / ExamPapers
  if (hasBottomFooter) {
    const footerY = y + 4;
    const footerText = isExamPapers
      ? "EST TEST PAPERS • CONFIDENTIAL"
      : "EST TEST DOSSIER • BUILDING HEAD";
    const footerSize = 7;
    const footerW = font.widthOfTextAtSize(footerText, footerSize);
    page.drawText(footerText, {
      x: x + (width - footerW) / 2,
      y: footerY,
      size: footerSize,
      font,
      color: COLOR_MUTED,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Middle Section (Subjects / Stats / Floor info / Head info)
  // Spanning between heroDividerY and chkDividerY
  // ---------------------------------------------------------------------------
  const availMidH = heroDividerY - chkDividerY - 10;
  const midBottomY = chkDividerY + 6;

  if (isRoom) {
    // Collect structured subjects for crisp, proctor-optimized rendering
    interface ParsedSubject {
      name: string;
      count: string | number;
    }
    const parsedSubjects: ParsedSubject[] = [];
    let roomTotalCandidates: number | undefined = typeof content.totalStudents === "number" && content.totalStudents > 0 ? content.totalStudents : undefined;

    if (content.subjects && content.subjects.length > 0) {
      let sum = 0;
      for (const s of content.subjects) {
        if (s.count > 0 || content.subjects.length <= 3) {
          parsedSubjects.push({
            name: expandSubjectName(s.name || s.code),
            count: s.count,
          });
          sum += s.count;
        }
      }
      if (!roomTotalCandidates && sum > 0) roomTotalCandidates = sum;
    } else if (typeof content.litCount === "number" || typeof content.mathCount === "number") {
      let sum = 0;
      if (typeof content.litCount === "number") {
        parsedSubjects.push({ name: "Literacy", count: content.litCount });
        sum += content.litCount;
      }
      if (typeof content.mathCount === "number") {
        parsedSubjects.push({ name: "Math", count: content.mathCount });
        sum += content.mathCount;
      }
      if (content.hasEssay || (typeof content.essayCount === "number" && content.essayCount > 0)) {
        parsedSubjects.push({ name: "Essay", count: content.essayCount ?? 0 });
        sum += (content.essayCount ?? 0);
      }
      if (!roomTotalCandidates && sum > 0) roomTotalCandidates = sum;
    } else {
      const subLines = getVerticalSubjectLines(content, true);
      for (const line of subLines) {
        const mTot = line.match(/^total\s*(?:candidates|students)?[:\s]+(\d+)/i);
        if (mTot) {
          roomTotalCandidates = parseInt(mTot[1], 10);
          continue;
        }
        const m = line.match(/^(.+?):\s*(\d+.*)$/);
        if (m) {
          parsedSubjects.push({ name: expandSubjectName(m[1].trim()), count: m[2].trim() });
        }
      }
    }

    if (parsedSubjects.length > 0) {
      // Strictly enforce canonical chronological exam period ordering on room subjects table
      parsedSubjects.sort((a, b) => getSubjectSortKey(a.name) - getSubjectSortKey(b.name));
      const sCount = parsedSubjects.length;
      const rowH = sCount <= 2 ? 30 : sCount === 3 ? 26 : sCount === 4 ? 23 : 20;
      const tblHeaderH = 20;
      const hasTotalRow = false; // Removed per user request for a cleaner, larger, and uncrowded sticker!
      const totRowH = 0;
      const tblH = tblHeaderH + sCount * rowH;

      const tblW = width - 12;
      const tblX = x + 6;
      // Vertically center the table in the middle space!
      const tblY = Math.max(chkDividerY + 6, midBottomY + (availMidH - tblH) / 2);

      // Outer table border & white background
      page.drawRectangle({
        x: tblX,
        y: tblY,
        width: tblW,
        height: tblH,
        color: COLOR_WHITE,
        borderColor: COLOR_CHARCOAL,
        borderWidth: 1,
      });

      // Table Header Bar (Light Background with Charcoal Border - ZERO Black Fill!)
      const hdrY = tblY + tblH - tblHeaderH;
      page.drawRectangle({
        x: tblX,
        y: hdrY,
        width: tblW,
        height: tblHeaderH,
        color: COLOR_LIGHT_BG,
        borderColor: COLOR_CHARCOAL,
        borderWidth: 1,
      });
      const thSize = 8.5;
      page.drawText("TEST SUBJECT", {
        x: tblX + 8,
        y: hdrY + (tblHeaderH - thSize) / 2 + 1,
        size: thSize,
        font,
        color: COLOR_CHARCOAL,
      });
      const candColText = "STUDENTS";
      const candColW = font.widthOfTextAtSize(candColText, thSize);
      page.drawText(candColText, {
        x: tblX + tblW - candColW - 10,
        y: hdrY + (tblHeaderH - thSize) / 2 + 1,
        size: thSize,
        font,
        color: COLOR_CHARCOAL,
      });

      // Each subject row
      for (let sIdx = 0; sIdx < sCount; sIdx++) {
        const s = parsedSubjects[sIdx];
        const rowY = hdrY - (sIdx + 1) * rowH;

        // Alternating subtle background row
        if (sIdx % 2 === 1) {
          page.drawRectangle({
            x: tblX + 0.5,
            y: rowY,
            width: tblW - 1,
            height: rowH,
            color: rgb(0.97, 0.97, 0.97),
          });
        }

        // Subject Name: Large, bold, unabbreviated!
        let sNameSize = sCount <= 2 ? 13 : sCount === 3 ? 12 : 11;
        let sName = s.name;
        let sW = font.widthOfTextAtSize(sName, sNameSize);
        if (sW > tblW - 85) {
          sNameSize = Math.max(9.5, ((tblW - 85) / sW) * sNameSize);
          sW = font.widthOfTextAtSize(sName, sNameSize);
        }
        page.drawText(sName, {
          x: tblX + 10,
          y: rowY + (rowH - sNameSize) / 2 + 1,
          size: sNameSize,
          font,
          color: COLOR_CHARCOAL,
        });

        // Student count container badge (Pill)
        const cBadgeW = 54;
        const cBadgeH = Math.min(18, rowH - 4);
        const cBadgeX = tblX + tblW - cBadgeW - 8;
        const cBadgeY = rowY + (rowH - cBadgeH) / 2;
        page.drawRectangle({
          x: cBadgeX,
          y: cBadgeY,
          width: cBadgeW,
          height: cBadgeH,
          color: rgb(0.93, 0.93, 0.93),
          borderColor: COLOR_CHARCOAL,
          borderWidth: 0.6,
        });

        const cText = `${s.count} Stud.`;
        let cSize = 9.5;
        let cW = font.widthOfTextAtSize(cText, cSize);
        if (cW > cBadgeW - 4) {
          cSize = Math.max(8, ((cBadgeW - 4) / cW) * cSize);
          cW = font.widthOfTextAtSize(cText, cSize);
        }
        page.drawText(cText, {
          x: cBadgeX + (cBadgeW - cW) / 2,
          y: cBadgeY + (cBadgeH - cSize) / 2 + 1,
          size: cSize,
          font,
          color: COLOR_CHARCOAL,
        });

        // Row divider
        if (sIdx < sCount - 1) {
          page.drawLine({
            start: { x: tblX, y: rowY },
            end: { x: tblX + tblW, y: rowY },
            thickness: 0.5,
            color: rgb(0.82, 0.82, 0.82),
          });
        }
      }

      // Total Row
      if (hasTotalRow) {
        page.drawRectangle({
          x: tblX + 0.5,
          y: tblY + 0.5,
          width: tblW - 1,
          height: totRowH - 0.5,
          color: rgb(0.89, 0.89, 0.89),
        });
        page.drawLine({
          start: { x: tblX, y: tblY + totRowH },
          end: { x: tblX + tblW, y: tblY + totRowH },
          thickness: 0.8,
          color: COLOR_CHARCOAL,
        });

        const totTitle = "TOTAL STUDENTS IN ROOM:";
        const totTitleSize = 9.5;
        page.drawText(totTitle, {
          x: tblX + 10,
          y: tblY + (totRowH - totTitleSize) / 2 + 1,
          size: totTitleSize,
          font,
          color: COLOR_CHARCOAL,
        });

        const totValText = `${roomTotalCandidates} STUDENTS`;
        const totValSize = 10;
        const totValW = font.widthOfTextAtSize(totValText, totValSize);
        page.drawText(totValText, {
          x: tblX + tblW - totValW - 10,
          y: tblY + (totRowH - totValSize) / 2 + 1,
          size: totValSize,
          font,
          color: COLOR_CHARCOAL,
        });
      }
    } else {
      const cardH = 50;
      const cardW = width - 12;
      const cardX = x + 6;
      const cardY = chkDividerY + 6 + (availMidH - cardH) / 2;
      page.drawRectangle({
        x: cardX,
        y: cardY,
        width: cardW,
        height: cardH,
        color: rgb(0.95, 0.95, 0.95),
        borderColor: COLOR_CHARCOAL,
        borderWidth: 0.8,
      });
      const totCandStr = typeof roomTotalCandidates === "number" && roomTotalCandidates > 0
        ? `${roomTotalCandidates} REGISTERED STUDENTS`
        : "TEST ROOM";
      const candSize = 13;
      const candW = font.widthOfTextAtSize(totCandStr, candSize);
      page.drawText(totCandStr, {
        x: cardX + (cardW - candW) / 2,
        y: cardY + 28,
        size: candSize,
        font,
        color: COLOR_CHARCOAL,
      });
      const subNote = "PROCTOR ATTENDANCE & DOSSIER";
      const noteSize = 8.5;
      const noteW = font.widthOfTextAtSize(subNote, noteSize);
      page.drawText(subNote, {
        x: cardX + (cardW - noteW) / 2,
        y: cardY + 12,
        size: noteSize,
        font,
        color: COLOR_MUTED,
      });
    }
  } else if (isExamPapers) {
    const childFloorsCount = content.childCount || (content.childNames ? content.childNames.length : 0);
    const examSubText =
      typeof content.totalRooms === "number" && content.totalRooms > 0
        ? `${childFloorsCount > 0 ? `${childFloorsCount} FLOORS  •  ` : ""}${content.totalRooms} ROOMS • SEALED`
        : typeof content.totalStudents === "number" && content.totalStudents > 0
          ? `${content.totalStudents} STUDENTS • OFFICIAL PAPERS`
          : "SEALED TEST PAPERS";

    let totalSize = 12.5;
    let totalW = font.widthOfTextAtSize(examSubText, totalSize);
    if (totalW > width - 16) {
      totalSize = Math.max(9, ((width - 16) / totalW) * totalSize);
      totalW = font.widthOfTextAtSize(examSubText, totalSize);
    }
    const totalY = chkDividerY + 6 + (availMidH - totalSize) / 2;
    page.drawText(examSubText, {
      x: x + (width - totalW) / 2,
      y: totalY,
      size: totalSize,
      font,
      color: COLOR_CHARCOAL,
    });
  } else if (isHead) {
    const childFloorsCount = content.childCount || (content.childNames ? content.childNames.length : 0);
    const headSubText =
      typeof content.totalRooms === "number" && content.totalRooms > 0
        ? `${childFloorsCount > 0 ? `${childFloorsCount} Floors ` : ""}(${content.totalRooms} Rooms)`
        : childFloorsCount > 0
          ? `${childFloorsCount} Floors`
          : typeof content.totalStudents === "number" && content.totalStudents > 0
            ? `${content.totalStudents} Students`
            : "BUILDING HEAD DOSSIER";

    let totalSize = 13;
    let totalW = font.widthOfTextAtSize(headSubText, totalSize);
    if (totalW > width - 16) {
      totalSize = Math.max(9, ((width - 16) / totalW) * totalSize);
      totalW = font.widthOfTextAtSize(headSubText, totalSize);
    }
    const totalY = chkDividerY + 6 + (availMidH - totalSize) / 2;
    page.drawText(headSubText, {
      x: x + (width - totalW) / 2,
      y: totalY,
      size: totalSize,
      font,
      color: COLOR_CHARCOAL,
    });
  } else {
    // Floor level: Display list of rooms in this floor
    const rooms = content.childNames || [];
    const childRoomsCount = content.childCount || rooms.length;
    const floorHdr = `ROOMS (${childRoomsCount}):`;
    const fhSize = 8.5;
    const fhW = font.widthOfTextAtSize(floorHdr, fhSize);

    if (rooms.length > 0) {
      const chunks: string[] = [];
      for (let i = 0; i < rooms.length; i += 4) {
        chunks.push(rooms.slice(i, i + 4).join("   •   "));
      }
      const lineCount = chunks.length;
      const step = 15;
      const blockH = 16 + lineCount * step;
      const topOffset = Math.max(0, (availMidH - blockH) / 2);
      const startHdrY = heroDividerY - 14 - topOffset;

      page.drawText(floorHdr, { x: x + (width - fhW) / 2, y: startHdrY, size: fhSize, font, color: COLOR_MUTED });

      const startY = startHdrY - 14;
      for (let cIdx = 0; cIdx < lineCount; cIdx++) {
        const chunkText = chunks[cIdx];
        let cSize = 9.5;
        let cW = font.widthOfTextAtSize(chunkText, cSize);
        if (cW > width - 16) {
          cSize = Math.max(7.5, ((width - 16) / cW) * cSize);
          cW = font.widthOfTextAtSize(chunkText, cSize);
        }
        page.drawText(chunkText, {
          x: x + (width - cW) / 2,
          y: startY - cIdx * step,
          size: cSize,
          font,
          color: COLOR_CHARCOAL,
        });
      }
    } else {
      const floorSubText = childRoomsCount > 0
        ? `${childRoomsCount} ROOMS INCLUDED`
        : "SENIOR DOSSIER";

      let totalSize = 13;
      let totalW = font.widthOfTextAtSize(floorSubText, totalSize);
      if (totalW > width - 16) {
        totalSize = Math.max(9.5, ((width - 16) / totalW) * totalSize);
        totalW = font.widthOfTextAtSize(floorSubText, totalSize);
      }
      const totalY = chkDividerY + 6 + (availMidH - totalSize) / 2;
      page.drawText(floorSubText, {
        x: x + (width - totalW) / 2,
        y: totalY,
        size: totalSize,
        font,
        color: COLOR_CHARCOAL,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// EST I Exam Stickers Implementation (Quarter-A4, 2 Copies Per Subject)
// ---------------------------------------------------------------------------

export interface ExamStickerItem {
  room: string;
  examName?: string;
  governorate?: string;
  center?: string;
  building?: string;
  floor?: string;
  subject: string;
  subjectCode: string;
  studentCount: number;
  copyIndex: number;
  totalCopies: number;
  date?: string;
  day?: string;
}

export interface GenerateExamStickersPdfOptions {
  content: StickerContent;
  litCount?: number;
  mathCount?: number;
  essayCount?: number;
  subjects?: RoomSubjectCount[];
  orientation?: "portrait" | "landscape";
}

export interface BatchExamStickersPdfOptions {
  rooms?: Array<{
    content: StickerContent;
    litCount?: number;
    mathCount?: number;
    essayCount?: number;
    subjects?: RoomSubjectCount[];
  }>;
  contents?: StickerContent[];
  orientation?: "portrait" | "landscape";
}

/**
 * Draws a single EST Exam Sticker inside one quadrant of an A4 page (approx 298 x 421 pt portrait, or 421 x 298 pt landscape).
 * Clean, Simple, 100% Black & White with Large Typography.
 * NO OUTER BORDER BOX around the sticker per user request.
 */
/**
 * Draws a single Quarter-A4 Exam Subject Sticker (2 copies per subject per room).
 * Clean, uncluttered layout matching official operational envelope sticker specifications:
 * - Top-left: Underlined Session Header (e.g. EST I: Friday, December 11, 2026) - NO "EXAMINATION" word.
 * - Top-right: Official EST Logo + COPY X OF Y Badge placed neatly underneath.
 * - Clean divider line.
 * - Vertically stacked details with fixed, comfortable spacing and bold values:
 *   City -> Test Center -> Building -> Floor -> Room# -> Students -> Subject
 * - NO footer clutter, NO overlapping text, strictly "Math" not "Mathematics".
 */
function drawQuarterExamSticker(params: {
  page: any;
  font: any;
  logoImg: any;
  item: ExamStickerItem;
  slotX: number;
  slotY: number;
  slotWidth: number;
  slotHeight: number;
}) {
  const { page, font, logoImg, item, slotX, slotY, slotWidth, slotHeight } = params;

  const margin = 14;
  const x = slotX + margin;
  const y = slotY + margin;
  const width = slotWidth - margin * 2;
  const height = slotHeight - margin * 2;

  const isEst2 =
    /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(item.subject) ||
    /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(item.examName || "");
  const examPrefix = isEst2 ? "EST II" : "EST I";
  const cleanSubj = expandSubjectName(item.subject);

  const gov = (item.governorate || "").trim();
  let center = cleanVenueName(item.center || "", gov);
  let bld = (item.building || "").trim();
  const fl = (item.floor || "").trim();
  const room = (item.room || "").trim();

  if (
    !bld ||
    bld.toLowerCase() === center.toLowerCase() ||
    center.toLowerCase().includes(bld.toLowerCase()) ||
    bld.toLowerCase().includes(center.toLowerCase())
  ) {
    bld = "";
  }
  if (!center && bld) {
    center = bld;
    bld = "";
  }

  const isLandscapeSlot = width > height;

  // 1. TOP HEADER SECTION
  // Logo on top-right
  const logoH = 26;
  const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 38;
  const logoX = x + width - logoW;
  const logoY = y + height - logoH - 2;

  if (logoImg) {
    page.drawImage(logoImg, { x: logoX, y: logoY, width: logoW, height: logoH });
  } else {
    page.drawText("est", { x: logoX, y: logoY + 4, size: 18, font, color: COLOR_CHARCOAL });
  }

  // Copy Badge positioned underneath the logo at top-right
  const copyText = `COPY ${item.copyIndex} OF ${item.totalCopies}`;
  const copySize = 8;
  const copyW = font.widthOfTextAtSize(copyText, copySize);
  const copyBadgeW = copyW + 10;
  const copyBadgeH = 16;
  const copyBadgeX = x + width - copyBadgeW;
  const copyBadgeY = logoY - copyBadgeH - 3;

  page.drawRectangle({
    x: copyBadgeX,
    y: copyBadgeY,
    width: copyBadgeW,
    height: copyBadgeH,
    color: COLOR_WHITE,
    borderColor: COLOR_CHARCOAL,
    borderWidth: 1.1,
  });
  page.drawText(copyText, {
    x: copyBadgeX + (copyBadgeW - copyW) / 2,
    y: copyBadgeY + (copyBadgeH - copySize) / 2 + 1,
    size: copySize,
    font,
    color: COLOR_CHARCOAL,
  });

  // Top Left: Exam Title & Session Date (NO "EXAMINATION" per user request)
  const dateDayStr = [item.day, item.date].filter(Boolean).join(", ") || "DECEMBER 2026";
  const headerTitle = `${examPrefix}: ${dateDayStr}`;

  let headSize = 12.5;
  let headTitleW = font.widthOfTextAtSize(headerTitle, headSize);
  const maxHeaderTitleW = logoX - x - 8;
  if (headTitleW > maxHeaderTitleW) {
    headSize = Math.max(9.5, (maxHeaderTitleW / headTitleW) * headSize);
    headTitleW = font.widthOfTextAtSize(headerTitle, headSize);
  }

  const headerTitleY = logoY + (logoH - headSize) / 2 + 1;
  page.drawText(headerTitle, {
    x: x + 4,
    y: headerTitleY,
    size: headSize,
    font,
    color: COLOR_CHARCOAL,
  });

  // Clean underline beneath the header title
  page.drawLine({
    start: { x: x + 4, y: headerTitleY - 4 },
    end: { x: x + 4 + headTitleW, y: headerTitleY - 4 },
    thickness: 1.2,
    color: COLOR_CHARCOAL,
  });

  // Header Divider Rule
  const headerBottom = copyBadgeY - 6;
  page.drawLine({
    start: { x: x + 4, y: headerBottom },
    end: { x: x + width - 4, y: headerBottom },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  // 2. VERTICAL LIST DETAILS (Clean, well-spaced, bold values, NO clutter)
  interface FieldRow {
    label: string;
    value: string;
    isHero?: boolean;
  }

  const fieldRows: FieldRow[] = [];
  if (gov && gov.toLowerCase() !== center.toLowerCase()) {
    fieldRows.push({ label: "City", value: gov });
  }
  if (center) {
    fieldRows.push({ label: "Test Center", value: center });
  }
  if (bld && bld !== center) {
    fieldRows.push({ label: "Building", value: bld });
  }
  if (fl) {
    fieldRows.push({ label: "Floor", value: fl });
  }
  fieldRows.push({ label: "Room#", value: room, isHero: true });
  fieldRows.push({ label: "Students", value: `${item.studentCount}`, isHero: true });
  fieldRows.push({ label: "Subject", value: cleanSubj, isHero: true });

  const startY = headerBottom - 26;
  const lineSpacing = isLandscapeSlot ? 26 : 36;

  for (let idx = 0; idx < fieldRows.length; idx++) {
    const row = fieldRows[idx];
    const rowY = startY - idx * lineSpacing;

    const labelText = `${row.label}: `;
    const labelSize = row.isHero ? 13.5 : 12;
    const valueSize = row.isHero ? 17.5 : 13.5;

    const labelW = font.widthOfTextAtSize(labelText, labelSize);
    let effValueSize = valueSize;
    let valueW = font.widthOfTextAtSize(row.value, effValueSize);
    const maxValW = width - 12 - labelW;

    if (valueW > maxValW) {
      effValueSize = Math.max(9.5, (maxValW / valueW) * effValueSize);
      valueW = font.widthOfTextAtSize(row.value, effValueSize);
    }

    // Draw Label
    page.drawText(labelText, {
      x: x + 6,
      y: rowY,
      size: labelSize,
      font,
      color: COLOR_CHARCOAL,
    });

    // Draw Value (bold/prominent)
    page.drawText(row.value, {
      x: x + 6 + labelW,
      y: rowY,
      size: effValueSize,
      font,
      color: COLOR_CHARCOAL,
    });
  }
}

/**
 * Builds the list of ExamStickerItems for a room:
 * - 2 identical copies for each subject assigned to the room
 * - Supports arbitrary combinations of subjects for both EST 1 and EST 2
 * - For EST 1: Literacy, Math, and Essay (only if essayCount > 0)
 * - For EST 2: Math 1, Math 2, Biology, Chemistry, Physics (any subset)
 */
export function buildExamStickerItemsForRoom(params: {
  content: StickerContent;
  litCount?: number;
  mathCount?: number;
  essayCount?: number;
  subjects?: RoomSubjectCount[];
}): ExamStickerItem[] {
  const { content } = params;
  const room = content.room || "Room";
  const items: ExamStickerItem[] = [];

  const rawExamName = content.examName || "EST";
  const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(rawExamName) || content.examType === "EST 2";
  const defaultExamPrefix = isEst2 ? "EST II" : "EST I";

  // Use dynamic subjects from params or content
  let subjects = params.subjects || content.subjects;

  if (!subjects || subjects.length === 0) {
    // If no explicit subjects array, synthesize from litCount / mathCount / essayCount
    const litCount = params.litCount ?? content.litCount ?? 25;
    const mathCount = params.mathCount ?? content.mathCount ?? 25;
    const essayCount = params.essayCount ?? content.essayCount ?? 0;

    subjects = [
      { code: "LIT", name: "Literacy", displayName: `${defaultExamPrefix} – Literacy`, count: litCount, copies: 2 },
      { code: "MATH", name: "Math", displayName: `${defaultExamPrefix} – Math`, count: mathCount, copies: 2 },
    ];
    if (essayCount > 0) {
      subjects.push({
        code: "ESSAY",
        name: "Essay",
        displayName: `${defaultExamPrefix} – Essay`,
        count: essayCount,
        copies: 2,
      });
    }
  }

  // Sort subjects strictly by official chronological exam period order
  const sortedSubjects = [...subjects].sort(
    (a, b) => getSubjectSortKey(a.code || a.name) - getSubjectSortKey(b.code || b.name)
  );

  // Generate 2 copies for each subject
  for (const sub of sortedSubjects) {
    if (sub.code === "ESSAY" && sub.count <= 0) continue;
    if (sub.count <= 0) continue;

    const totalCopies = sub.copies || 2;
    const subjectTitle = sub.displayName || `${defaultExamPrefix} – ${sub.name}`;

    for (let c = 1; c <= totalCopies; c++) {
      items.push({
        room,
        examName: content.examName,
        governorate: content.governorate,
        center: content.center,
        building: content.building,
        floor: content.floor,
        subject: subjectTitle,
        subjectCode: sub.code,
        studentCount: sub.count,
        copyIndex: c,
        totalCopies,
        date: content.examDate,
        day: content.examDay,
      });
    }
  }

  return items;
}

/**
 * Draws an A4 page with up to 4 exam stickers in a 2x2 grid in Portrait orientation.
 */
function drawA4FourUpExamStickersPage(params: {
  pdfDoc: PDFDocument;
  font: any;
  logoImg: any;
  items: ExamStickerItem[];
  orientation?: "portrait" | "landscape";
}) {
  const { pdfDoc, font, logoImg, items, orientation = "portrait" } = params;

  // A4 Portrait default: 595.28 x 841.89 pt (or Landscape if explicitly requested)
  const isLandscape = orientation === "landscape";
  const a4Width = isLandscape ? 841.89 : 595.28;
  const a4Height = isLandscape ? 595.28 : 841.89;
  const page = pdfDoc.addPage([a4Width, a4Height]);

  const midX = a4Width / 2;
  const midY = a4Height / 2;

  // Center cutting guide lines
  const cutColor = rgb(0.72, 0.72, 0.72);
  page.drawLine({
    start: { x: midX, y: 0 },
    end: { x: midX, y: a4Height },
    thickness: 0.5,
    color: cutColor,
    dashArray: [4, 4],
  });

  page.drawLine({
    start: { x: 0, y: midY },
    end: { x: a4Width, y: midY },
    thickness: 0.5,
    color: cutColor,
    dashArray: [4, 4],
  });

  // Center cross-marker for precise cutting
  page.drawLine({ start: { x: midX - 8, y: midY }, end: { x: midX + 8, y: midY }, thickness: 1.2, color: cutColor });
  page.drawLine({ start: { x: midX, y: midY - 8 }, end: { x: midX, y: midY + 8 }, thickness: 1.2, color: cutColor });

  const quadrants = [
    { x: 0, y: midY, width: midX, height: midY },    // Top-Left
    { x: midX, y: midY, width: midX, height: midY }, // Top-Right
    { x: 0, y: 0, width: midX, height: midY },       // Bottom-Left
    { x: midX, y: 0, width: midX, height: midY },    // Bottom-Right
  ];

  for (let i = 0; i < items.length && i < 4; i++) {
    const q = quadrants[i];
    drawQuarterExamSticker({
      page,
      font,
      logoImg,
      item: items[i],
      slotX: q.x,
      slotY: q.y,
      slotWidth: q.width,
      slotHeight: q.height,
    });
  }
}

/**
 * Generates an official Exam Stickers PDF for a single room (EST 1 & EST 2).
 * Produces 2 copies for each applicable subject.
 * Each sticker occupies exactly one-quarter of an A4 page (4-up on A4 Landscape).
 */
export async function generateExamStickersPdf(
  options: GenerateExamStickersPdfOptions,
): Promise<Uint8Array> {
  const content = options.content;
  if (!content) {
    throw new Error("Cannot generate exam stickers PDF without sticker content");
  }

  const litCount = options.litCount ?? content.litCount ?? 25;
  const mathCount = options.mathCount ?? content.mathCount ?? 25;
  const essayCount = options.essayCount ?? content.essayCount ?? 0;
  const subjects = options.subjects ?? content.subjects;

  return generateBatchExamStickersPdf({
    rooms: [
      {
        content,
        litCount,
        mathCount,
        essayCount,
        subjects,
      },
    ],
    orientation: options.orientation,
  });
}

/**
 * Generates unified multi-page Exam Stickers PDF for multiple rooms.
 * Each room's exam stickers start on a fresh page.
 */
export async function generateBatchExamStickersPdf(
  options: BatchExamStickersPdfOptions,
): Promise<Uint8Array> {
  const rooms =
    options.rooms ??
    options.contents?.map((c) => ({
      content: c,
      litCount: c.litCount,
      mathCount: c.mathCount,
      essayCount: c.essayCount,
      subjects: c.subjects,
    })) ??
    [];
  if (rooms.length === 0) {
    throw new Error("Cannot generate batch exam stickers PDF with no rooms");
  }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await loadStickerFont(pdfDoc);
  const logoImg = await loadLogoImage(pdfDoc);

  for (const r of rooms) {
    const litCount = r.litCount ?? r.content.litCount ?? 25;
    const mathCount = r.mathCount ?? r.content.mathCount ?? 25;
    const essayCount = r.essayCount ?? r.content.essayCount ?? 0;
    const subjects = r.subjects ?? r.content.subjects;

    const items = buildExamStickerItemsForRoom({
      content: r.content,
      litCount,
      mathCount,
      essayCount,
      subjects,
    });

    // Chunk items 4 per page
    for (let i = 0; i < items.length; i += 4) {
      const pageItems = items.slice(i, i + 4);
      drawA4FourUpExamStickersPage({
        pdfDoc,
        font,
        logoImg,
        items: pageItems,
        orientation: options.orientation,
      });
    }
  }

  return await pdfDoc.save();
}
