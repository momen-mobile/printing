import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { requireSession, enforceRateLimit, jsonError } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { ensureEstExamRoundTable, type EstRoundRow } from "@/lib/est-rounds";
import {
  generateBatchStickerPdf,
  generateBatchExamStickersPdf,
  isSchoolCenter,
  expandSubjectName,
  getSubjectSortKey,
} from "@/lib/stickers/sticker-pdf";
import {
  generateBatchFloorSubjectBagsPdf,
  generateBuildingCleanSkinBagsPdf,
  generateBuildingHeadBagPlacardsPdf,
  generateFloorSeniorBagPlacardsPdf,
  type BuildingCleanSkinBagOption,
  type BuildingHeadBagPlacardOption,
  type FloorSeniorBagPlacardOption,
  type FloorExamStickersOptions,
  type FloorSubjectPlacardData,
  type FloorRoomSubjectData,
} from "@/lib/stickers/floor-exam-stickers-pdf";
import {
  generateBuildingCartonStickerPdf,
  generateBatchBuildingCartonStickersPdf,
  generateExamBagChecklistPdf,
  generateMasterBuildingManifestPdf,
  generateCleanSkinMasterPdf,
  generateCleanSkinDispatchLogPdf,
  generateCleanSkinSubjectStickersPdf,
  generateCartonDriverManifestPdf,
  type LogisticsStickerOptions,
  type FloorRoomsData,
  type RoomDetail,
} from "@/lib/stickers/logistics-stickers-pdf";
import { getFloorSortWeight } from "@/lib/stickers/est-reference-data";
import type { StickerContent, StickerFieldItem } from "@/lib/stickers/sticker-content";
import type { RoomSubjectCount } from "@/lib/stickers/est-room-data";

export const dynamic = "force-dynamic";

function formatEnglishDate(date: Date | null): string {
  if (!date) return "";
  try {
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return "";
  }
}

export async function POST(
  request: Request,
  props: { params: Promise<{ roundId: string }> },
) {
  try {
    await requireSession(request);
    enforceRateLimit(request, "est-rounds:stickers", 60, 60_000);
    await ensureEstExamRoundTable();

    const params = await props.params;
    const { roundId } = params;
    const body = await request.json().catch(() => ({}));

    const round = await prisma.estExamRound.findUnique({
      where: { id: roundId },
    });

    if (!round) {
      return NextResponse.json({ error: "EST round not found" }, { status: 404 });
    }

    const allRows: EstRoundRow[] = Array.isArray(round.sheetData)
      ? (round.sheetData as unknown as EstRoundRow[])
      : [];

    if (allRows.length === 0) {
      return NextResponse.json({ error: "Round contains no rooms to print" }, { status: 400 });
    }

    // Filter by selectedRowIds if specified, otherwise include all rows
    const selectedIds = Array.isArray(body.selectedRowIds) && body.selectedRowIds.length > 0
      ? new Set<string>(body.selectedRowIds)
      : null;

    const targetRows = selectedIds
      ? allRows.filter((r) => selectedIds.has(r.id))
      : allRows;

    if (targetRows.length === 0) {
      return NextResponse.json({ error: "No matching rooms selected" }, { status: 400 });
    }

    const type = typeof body.type === "string" ? body.type : "room_placards";
    const orientation = body.orientation === "landscape" ? "landscape" : "portrait";
    const paperMode = body.paperMode === "custom" ? "custom" : "a4";
    const widthMm = Number(body.widthMm) || 100;
    const heightMm = Number(body.heightMm) || 50;

    const roundDateStr = formatEnglishDate(round.roundDate);
    const roundDayStr = round.roundDay || (round.examType === "EST 2" ? "Saturday" : "Friday");
    const examPrefix = round.examType === "EST 2" ? "EST II" : "EST I";

    // Helper to build Room StickerContent
    const buildRoomStickerContent = (row: EstRoundRow): StickerContent => {
      const isSchool = isSchoolCenter(row.center);
      const roomSubjects: RoomSubjectCount[] = Object.entries(row.subjects || {})
        .filter(([_, count]) => count > 0)
        .sort(([codeA], [codeB]) => getSubjectSortKey(codeA) - getSubjectSortKey(codeB))
        .map(([code, count]) => {
          let name = code;
          if (code === "MATH1") name = "Math 1";
          else if (code === "MATH2") name = "Math 2";
          else if (code === "BIO") name = "Biology";
          else if (code === "CHEM") name = "Chemistry";
          else if (code === "PHY") name = "Physics";
          else if (code === "LIT") name = "Literacy";
          else if (code === "MATH") name = "Math";
          else if (code === "ESSAY") name = "Essay";

          return {
            code,
            name,
            displayName: `${examPrefix} – ${name}`,
            count,
            copies: 2,
          };
        });

      return {
        level: "room",
        lines: [
          round.name,
          `Governorate : ${row.governorate}`,
          `Test Center : ${row.center}`,
          `Floor : ${row.floor}`,
          `Room : ${row.room}`,
        ],
        rawLines: ["EST", row.governorate, row.center, row.floor, row.room],
        cleanChain: ["EST", row.governorate, row.center, row.floor, row.room],
        examName: round.name || round.examType,
        examType: round.examType as "EST 1" | "EST 2",
        examDate: roundDateStr,
        examDay: roundDayStr,
        governorate: row.governorate,
        center: row.center,
        building: (row as any).building || row.center,
        floor: row.floor,
        room: row.room,
        fields: [
          { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: row.governorate },
          { key: "center", label: "Test Center", labelAr: "السنتر", value: row.center },
          ...((row as any).building && (row as any).building !== row.center ? [{ key: "building" as const, label: "Building", labelAr: "المبنى", value: (row as any).building }] : []),
          { key: "floor", label: "Floor", labelAr: "الدور", value: row.floor },
          { key: "room", label: "Room", labelAr: "القاعة", value: row.room },
        ] as StickerFieldItem[],
        subjects: roomSubjects,
        totalStudents: row.totalStudents,
        breakdownText: row.breakdownText,
      };
    };

    // 1. SUBJECT EXAM STICKERS (Quarter-A4, 2 Copies per subject)
    if (type === "exam_stickers") {
      const roomContents = targetRows.map((r) => {
        const roomContent = buildRoomStickerContent(r);
        return {
          content: roomContent,
          litCount: r.subjects?.LIT || 0,
          mathCount: r.subjects?.MATH || r.subjects?.MATH1 || 0,
          essayCount: r.subjects?.ESSAY || 0,
          subjects: roomContent.subjects,
        };
      });

      const pdfBytes = await generateBatchExamStickersPdf({
        rooms: roomContents,
        orientation,
      });

      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Exam_Stickers_${targetRows.length}_Rooms.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 2. FLOOR PLACARDS (Senior Supervisor Dossiers - Quarter-A4 4-Up)
    if (type === "floor_placards") {
      // Group target rows by governorate + center + building + floor
      const floorGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const bld = (r as any).building || r.center;
        const key = `${r.governorate}::${r.center}::${bld}::${r.floor}`;
        const existing = floorGroups.get(key) || [];
        existing.push(r);
        floorGroups.set(key, existing);
      }

      const floorContents: StickerContent[] = [];
      for (const [_, rows] of floorGroups.entries()) {
        const first = rows[0];
        const isSchool = isSchoolCenter(first.center);
        const floorRooms = rows.map((r) => r.room);
        const totalStudents = rows.reduce((sum, r) => sum + r.totalStudents, 0);
        const isCampus = (first as any).building && (first as any).building.toLowerCase() !== first.center.toLowerCase();

        floorContents.push({
          level: "floor",
          lines: [
            round.name,
            `Governorate : ${first.governorate}`,
            `Test Center : ${first.center}`,
            isCampus ? `Building : ${(first as any).building}` : null,
            `Floor : ${first.floor}`,
            `Total Rooms : ${rows.length}`,
          ].filter(Boolean) as string[],
          rawLines: ["EST", first.governorate, first.center, first.floor],
          cleanChain: ["EST", first.governorate, first.center, first.floor],
          examName: round.name || round.examType,
          examType: round.examType as "EST 1" | "EST 2",
          examDate: roundDateStr,
          examDay: roundDayStr,
          governorate: first.governorate,
          center: first.center,
          building: (first as any).building || first.center,
          floor: first.floor,
          childCount: rows.length,
          childLabel: "Rooms",
          childNames: floorRooms,
          totalStudents,
          fields: [
            { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: first.governorate },
            { key: "center", label: "Test Center", labelAr: "السنتر", value: first.center },
            ...(isCampus ? [{ key: "building" as const, label: "Building", labelAr: "المبنى", value: (first as any).building }] : []),
            { key: "floor", label: "Floor", labelAr: "الدور", value: first.floor },
          ] as StickerFieldItem[],
        });
      }

      const pdfBytes = await generateBatchStickerPdf({
        contents: floorContents,
        paperMode,
        orientation,
        widthMm,
        heightMm,
      });

      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Floor_Dossiers.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 2b. FLOOR SENIOR BAG PLACARDS (A4 Landscape Placard for Senior's Floor Bag)
    if (type === "floor_senior_bag_placards") {
      const floorGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const bld = (r as any).building || r.center;
        const key = `${r.governorate}::${r.center}::${bld}::${r.floor}`;
        const existing = floorGroups.get(key) || [];
        existing.push(r);
        floorGroups.set(key, existing);
      }

      const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(round.name || "") || round.examType === "EST 2";
      const batches: FloorSeniorBagPlacardOption[] = [];

      for (const [_, rows] of floorGroups.entries()) {
        const first = rows[0];
        const bld = (first as any).building || first.center;
        const floorRooms = rows.map((r) => r.room);
        const totalStudents = rows.reduce((sum, r) => sum + r.totalStudents, 0);

        batches.push({
          governorate: first.governorate,
          center: first.center,
          building: bld,
          floor: first.floor,
          examName: round.name || round.examType,
          examType: isEst2 ? "EST 2" : "EST 1",
          date: [roundDayStr, roundDateStr].filter(Boolean).join(", "),
          totalRooms: rows.length,
          totalStudents,
          roomNames: floorRooms,
        });
      }

      const pdfBytes = await generateFloorSeniorBagPlacardsPdf(batches);
      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Floor_Senior_Bag_Placards.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 2.5 FLOOR SUBJECT BAG PLACARDS (Dedicated A4 Landscape Placard per subject per floor)
    if (type === "floor_subject_bags") {
      const floorGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const key = `${r.governorate}::${r.center}::${r.floor}`;
        const existing = floorGroups.get(key) || [];
        existing.push(r);
        floorGroups.set(key, existing);
      }

      const floorBatches: FloorExamStickersOptions[] = [];
      for (const [_, rows] of floorGroups.entries()) {
        const first = rows[0];
        const isSchool = isSchoolCenter(first.center);

        // Collect all subjects that have candidates on this floor
        const subjectMap = new Map<string, {
          name: string;
          rooms: FloorRoomSubjectData[];
          totalCandidates: number;
        }>();

        for (const r of rows) {
          for (const [code, count] of Object.entries(r.subjects || {})) {
            if (count > 0) {
              const existing = subjectMap.get(code) || {
                name: expandSubjectName(code),
                rooms: [],
                totalCandidates: 0,
              };
              existing.rooms.push({
                roomName: r.room,
                candidateCount: count,
              });
              existing.totalCandidates += count;
              subjectMap.set(code, existing);
            }
          }
        }

        if (subjectMap.size === 0) {
          const totalStud = rows.reduce((s, r) => s + r.totalStudents, 0);
          subjectMap.set("EXAM", {
            name: round.examType === "EST 2" ? "EST II Subjects" : "EST I Subjects",
            rooms: rows.map((r) => ({ roomName: r.room, candidateCount: r.totalStudents })),
            totalCandidates: totalStud,
          });
        }

        const floorSubjectsList: FloorSubjectPlacardData[] = Array.from(subjectMap.entries())
          .sort(([codeA], [codeB]) => getSubjectSortKey(codeA) - getSubjectSortKey(codeB))
          .map(([code, data]) => ({
            subjectCode: code,
            subjectName: data.name,
            examType: round.examType as "EST 1" | "EST 2",
            totalRooms: data.rooms.length,
            totalCandidates: data.totalCandidates,
            rooms: data.rooms,
          }));

        floorBatches.push({
          floorName: first.floor,
          examName: round.name || round.examType,
          governorate: first.governorate,
          center: first.center,
          building: "",
          date: [roundDayStr, roundDateStr].filter(Boolean).join(", "),
          subjects: floorSubjectsList,
        });
      }

      const pdfBytes = await generateBatchFloorSubjectBagsPdf(floorBatches);

      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Floor_Subject_Bags.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 2.6 BUILDING CLEAN SKIN BAG PLACARDS (A4 Landscape Placard per Building per Subject)
    if (type === "clean_skin_bags") {
      const buildingGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const bld = (r as any).building || r.center;
        const key = `${r.governorate}::${r.center}::${bld}`;
        const existing = buildingGroups.get(key) || [];
        existing.push(r);
        buildingGroups.set(key, existing);
      }

      const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(round.name || "") || round.examType === "EST 2";

      const buildingBatches: BuildingCleanSkinBagOption[] = [];

      for (const [_, rows] of buildingGroups.entries()) {
        const first = rows[0];
        const bld = (first as any).building || first.center;

        const presentCodes = new Set<string>();
        for (const r of rows) {
          for (const [code, count] of Object.entries(r.subjects || {})) {
            if (count > 0) presentCodes.add(code.toUpperCase());
          }
        }

        let subjects: Array<{ code: string; name: string }> = [];

        if (isEst2) {
          const defaultEst2 = [
            { code: "MATH1", name: "Math 1" },
            { code: "MATH2", name: "Math 2" },
            { code: "BIO", name: "Biology" },
            { code: "CHEM", name: "Chemistry" },
            { code: "PHY", name: "Physics" },
          ];
          subjects = presentCodes.size > 0
            ? defaultEst2.filter((s) => presentCodes.has(s.code))
            : defaultEst2;
          if (subjects.length === 0) subjects = defaultEst2;
        } else {
          const defaultEst1 = [
            { code: "LIT", name: "Literacy" },
            { code: "MATH", name: "Math" },
          ];
          if (presentCodes.has("ESSAY") || rows.some((r) => ((r as any).essayCount && (r as any).essayCount > 0))) {
            defaultEst1.push({ code: "ESSAY", name: "Essay" });
          }
          subjects = defaultEst1;
        }

        buildingBatches.push({
          governorate: first.governorate,
          center: first.center,
          building: bld,
          examName: round.name || round.examType,
          examType: isEst2 ? "EST 2" : "EST 1",
          date: [roundDayStr, roundDateStr].filter(Boolean).join(", "),
          subjects,
        });
      }

      const pdfBytes = await generateBuildingCleanSkinBagsPdf(buildingBatches);
      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Clean_Skin_Building_Bags.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 3. BUILDING / SCHOOL PLACARDS (Full-Page A4 Landscape)
    if (type === "building_placards") {
      const centerGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const bld = (r as any).building || r.center;
        const key = `${r.governorate}::${r.center}::${bld}`;
        const existing = centerGroups.get(key) || [];
        existing.push(r);
        centerGroups.set(key, existing);
      }

      const buildingContents: StickerContent[] = [];
      for (const [_, rows] of centerGroups.entries()) {
        const first = rows[0];
        const isSchool = isSchoolCenter(first.center);
        const uniqueFloors = Array.from(new Set(rows.map((r) => r.floor)));
        const totalStudents = rows.reduce((sum, r) => sum + r.totalStudents, 0);
        const isCampus = (first as any).building && (first as any).building.toLowerCase() !== first.center.toLowerCase();

        buildingContents.push({
          level: "building",
          lines: [
            round.name,
            `Governorate : ${first.governorate}`,
            `Test Center : ${first.center}`,
            isCampus ? `Building : ${(first as any).building}` : null,
            `Total Floors : ${uniqueFloors.length}`,
            `Total Rooms : ${rows.length}`,
          ].filter(Boolean) as string[],
          rawLines: ["EST", first.governorate, first.center],
          cleanChain: ["EST", first.governorate, first.center],
          examName: round.name || round.examType,
          examType: round.examType as "EST 1" | "EST 2",
          examDate: roundDateStr,
          examDay: roundDayStr,
          governorate: first.governorate,
          center: first.center,
          building: (first as any).building || first.center,
          childCount: uniqueFloors.length,
          childLabel: "Floors",
          childNames: uniqueFloors,
          totalRooms: rows.length,
          totalStudents,
          fields: [
            { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: first.governorate },
            { key: "center", label: "Test Center", labelAr: "السنتر", value: first.center },
            ...(isCampus ? [{ key: "building" as const, label: "Building", labelAr: "المبنى", value: (first as any).building }] : []),
          ] as StickerFieldItem[],
        });
      }

      const pdfBytes = await generateBatchStickerPdf({
        contents: buildingContents,
        paperMode: "a4",
        orientation: "landscape", // A4 Landscape per user specification!
      });

      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Building_Placards.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 4. BUILDING HEAD PLACARDS (Quarter-A4 4-Up)
    if (type === "head_placards") {
      const centerGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const bld = (r as any).building || r.center;
        const key = `${r.governorate}::${r.center}::${bld}`;
        const existing = centerGroups.get(key) || [];
        existing.push(r);
        centerGroups.set(key, existing);
      }

      const headContents: StickerContent[] = [];
      for (const [_, rows] of centerGroups.entries()) {
        const first = rows[0];
        const isSchool = isSchoolCenter(first.center);
        const uniqueFloors = Array.from(new Set(rows.map((r) => r.floor)));
        const totalStudents = rows.reduce((sum, r) => sum + r.totalStudents, 0);
        const isCampus = (first as any).building && (first as any).building.toLowerCase() !== first.center.toLowerCase();

        headContents.push({
          level: "building_head",
          isHead: true,
          lines: [
            round.name,
            `Governorate : ${first.governorate}`,
            `Test Center : ${first.center}`,
            isCampus ? `Building : ${(first as any).building}` : null,
            `Total Floors : ${uniqueFloors.length}`,
            `Total Rooms : ${rows.length}`,
          ].filter(Boolean) as string[],
          rawLines: ["EST", first.governorate, first.center, first.center],
          cleanChain: ["EST", first.governorate, first.center, first.center],
          examName: round.name || round.examType,
          examType: round.examType as "EST 1" | "EST 2",
          examDate: roundDateStr,
          examDay: roundDayStr,
          governorate: first.governorate,
          center: first.center,
          building: (first as any).building || first.center,
          childCount: uniqueFloors.length,
          childLabel: "Floors",
          childNames: uniqueFloors,
          totalRooms: rows.length,
          totalStudents,
          fields: [
            { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: first.governorate },
            { key: "center", label: "Test Center", labelAr: "السنتر", value: first.center },
            ...(isCampus ? [{ key: "building" as const, label: "Building", labelAr: "المبنى", value: (first as any).building }] : []),
          ] as StickerFieldItem[],
        });
      }

      const pdfBytes = await generateBatchStickerPdf({
        contents: headContents,
        paperMode: "a4",
        orientation: "portrait",
      });

      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Building_Head_Dossiers.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 5. BUILDING HEAD BAG PLACARDS (A4 Landscape Placard for Head Bag with enclosed supplies list)
    if (type === "head_bag_placards" || type === "bundle") {
      const centerGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const bld = (r as any).building || r.center;
        const key = `${r.governorate}::${r.center}::${bld}`;
        const existing = centerGroups.get(key) || [];
        existing.push(r);
        centerGroups.set(key, existing);
      }

      const isEst2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(round.name || "") || round.examType === "EST 2";

      const buildingBatches: BuildingHeadBagPlacardOption[] = [];

      for (const [_, rows] of centerGroups.entries()) {
        const first = rows[0];
        const bld = (first as any).building || first.center;
        const uniqueFloors = Array.from(new Set(rows.map((r) => r.floor)));
        const totalStudents = rows.reduce((sum, r) => sum + r.totalStudents, 0);

        buildingBatches.push({
          governorate: first.governorate,
          center: first.center,
          building: bld,
          examName: round.name || round.examType,
          examType: isEst2 ? "EST 2" : "EST 1",
          date: [roundDayStr, roundDateStr].filter(Boolean).join(", "),
          totalFloors: uniqueFloors.length,
          totalRooms: rows.length,
          totalStudents,
          floorNames: uniqueFloors,
        });
      }

      const pdfBytes = await generateBuildingHeadBagPlacardsPdf(buildingBatches);
      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Building_Head_Bag_Placards.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // Helper to build LogisticsStickerOptions for each building & center in targetRows (Sequentially Numbered)
    const buildCenterLogisticsOptions = (): LogisticsStickerOptions[] => {
      const centerGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const bld = (r as any).building || r.center;
        const key = `${r.governorate}::${r.center}::${bld}`;
        const existing = centerGroups.get(key) || [];
        existing.push(r);
        centerGroups.set(key, existing);
      }

      const optionsList: LogisticsStickerOptions[] = [];
      const centerEntries = Array.from(centerGroups.entries());
      const totalCenters = centerEntries.length;

      for (let idx = 0; idx < totalCenters; idx++) {
        const [_, cRows] = centerEntries[idx];
        const first = cRows[0];
        const centerName = first.center;
        const buildingName = (first as any).building || first.center;
        const govName = first.governorate;

        const centerRows = targetRows.filter((r) => r.center === centerName);
        const centerTotalRooms = centerRows.length;
        const centerTotalStudents = centerRows.reduce((s, r) => s + r.totalStudents, 0);
        const centerSubjectsMap: Record<string, number> = {};
        for (const cr of centerRows) {
          for (const [code, count] of Object.entries(cr.subjects || {})) {
            centerSubjectsMap[code] = (centerSubjectsMap[code] || 0) + (count as number);
          }
        }

        const floorMap = new Map<string, EstRoundRow[]>();
        for (const r of cRows) {
          const flKey = r.floor || "1st Floor";
          const existing = floorMap.get(flKey) || [];
          existing.push(r);
          floorMap.set(flKey, existing);
        }

        const floors: FloorRoomsData[] = Array.from(floorMap.entries())
          .sort(([flA], [flB]) => getFloorSortWeight(flA) - getFloorSortWeight(flB))
          .map(([flName, fRows]) => {
            const sortedFRows = fRows.sort((a, b) =>
              a.room.localeCompare(b.room, undefined, { numeric: true }),
            );

            const rooms: RoomDetail[] = sortedFRows.map((r: any) => {
              const isCurrentEst1 = round.examType !== "EST 2";
              const e1Count = r.est1Count ?? (isCurrentEst1 ? r.totalStudents : 0);
              const e2Count = r.est2Count ?? (!isCurrentEst1 ? r.totalStudents : 0);

              return {
                room: r.room,
                studentCount: r.totalStudents,
                subjectsText: r.breakdownText,
                est1Count: e1Count,
                est1Subjects: r.est1Subjects || (isCurrentEst1 ? r.breakdownText : ""),
                est2Count: e2Count,
                est2Subjects: r.est2Subjects || (!isCurrentEst1 ? r.breakdownText : ""),
                subjectsMap: r.subjects || {},
                subjects: r.subjects || {},
              };
            });

            const totalStudents = rooms.reduce((s, rm) => s + (rm.studentCount || 0), 0);
            const est1Students = rooms.reduce((s, rm) => s + (rm.est1Count || 0), 0);
            const est2Students = rooms.reduce((s, rm) => s + (rm.est2Count || 0), 0);

            return {
              floor: flName,
              rooms,
              totalStudents,
              est1Students,
              est2Students,
            };
          });

        const totalRooms = cRows.length;
        const totalStudents = cRows.reduce((s, r) => s + r.totalStudents, 0);
        const est1Total = cRows.reduce((s, r: any) => s + (r.est1Count ?? (round.examType !== "EST 2" ? r.totalStudents : 0)), 0);
        const est2Total = cRows.reduce((s, r: any) => s + (r.est2Count ?? (round.examType === "EST 2" ? r.totalStudents : 0)), 0);
        const roomNames = cRows.map((r) => r.room);

        optionsList.push({
          examName: round.name || round.examType,
          governorate: govName,
          center: centerName,
          building: buildingName,
          date: round.cycleName || "December 2026",
          roundDay: roundDayStr,
          roundDateStr,
          totalRooms,
          totalStudents,
          centerTotalRooms,
          centerTotalStudents,
          centerSubjectsMap,
          roomNames,
          floors,
          boxNumber: idx + 1,
          totalBoxes: totalCenters,
          securitySeal: body.securitySeal || undefined,
          notes: body.notes || undefined,
          est1Total,
          est2Total,
        });
      }

      return optionsList;
    };

    // Helper to build Combined Options across both EST 1 and EST 2 in this cycle
    const buildCombinedCenterOptions = async (): Promise<LogisticsStickerOptions[]> => {
      const cycleRounds = await prisma.estExamRound.findMany({
        where: {
          OR: [
            { cycleName: round.cycleName || "December 2026" },
            { name: { contains: "December 2026", mode: "insensitive" } },
          ],
        },
      });

      const allCycleRows: any[] = [];
      for (const cr of cycleRounds) {
        const rows = Array.isArray(cr.sheetData) ? (cr.sheetData as unknown as any[]) : [];
        rows.forEach((row) => allCycleRows.push({ ...row, sourceExam: cr.examType }));
      }

      const sourceRows = allCycleRows.length > 0 ? allCycleRows : (targetRows as any[]);

      // Group by Building, Center, and Governorate
      const centerGroups = new Map<string, any[]>();
      for (const r of sourceRows) {
        const bld = r.building || r.center;
        const key = `${r.governorate}::${r.center}::${bld}`;
        const existing = centerGroups.get(key) || [];
        existing.push(r);
        centerGroups.set(key, existing);
      }

      const combinedList: LogisticsStickerOptions[] = [];
      const centerEntries = Array.from(centerGroups.entries());
      const totalCenters = centerEntries.length;

      for (let idx = 0; idx < totalCenters; idx++) {
        const [_, cRows] = centerEntries[idx];
        const first = cRows[0];
        const centerName = first.center;
        const buildingName = (first as any).building || first.center;
        const govName = first.governorate;

        const centerRows = targetRows.filter((r) => r.center === centerName);
        const centerTotalRooms = centerRows.length;
        const centerTotalStudents = centerRows.reduce((s, r) => s + r.totalStudents, 0);
        const centerSubjectsMap: Record<string, number> = {};
        for (const cr of centerRows) {
          for (const [code, count] of Object.entries(cr.subjects || {})) {
            centerSubjectsMap[code] = (centerSubjectsMap[code] || 0) + (count as number);
          }
        }

        const floorMap = new Map<string, Map<string, any>>();
        for (const r of cRows) {
          const flKey = r.floor || "1st Floor";
          if (!floorMap.has(flKey)) {
            floorMap.set(flKey, new Map());
          }
          const rMap = floorMap.get(flKey)!;
          const roomKey = (r.room || "").toLowerCase().trim();

          const existingRoom = rMap.get(roomKey);
          const isEst1Row = r.sourceExam === "EST 1" || (!r.sourceExam && r.est1Count);
          const isEst2Row = r.sourceExam === "EST 2" || (!r.sourceExam && r.est2Count);

          const rowE1 = r.est1Count ?? (isEst1Row ? r.totalStudents : 0);
          const rowE2 = r.est2Count ?? (isEst2Row ? r.totalStudents : 0);

          if (!existingRoom) {
            rMap.set(roomKey, {
              room: r.room,
              studentCount: rowE1 + rowE2,
              est1Count: rowE1,
              est2Count: rowE2,
              subjectsText: r.breakdownText,
              est1Subjects: isEst1Row ? r.breakdownText : r.est1Subjects,
              est2Subjects: isEst2Row ? r.breakdownText : r.est2Subjects,
            });
          } else {
            if (rowE1 > 0 && (existingRoom.est1Count === 0 || !existingRoom.est1Count)) {
              existingRoom.est1Count = rowE1;
              existingRoom.est1Subjects = r.breakdownText;
            }
            if (rowE2 > 0 && (existingRoom.est2Count === 0 || !existingRoom.est2Count)) {
              existingRoom.est2Count = rowE2;
              existingRoom.est2Subjects = r.breakdownText;
            }
            existingRoom.studentCount = (existingRoom.est1Count || 0) + (existingRoom.est2Count || 0);
          }
        }

        const floors: FloorRoomsData[] = Array.from(floorMap.entries())
          .sort(([flA], [flB]) => getFloorSortWeight(flA) - getFloorSortWeight(flB))
          .map(([flName, rMap]) => {
            const rooms: RoomDetail[] = Array.from(rMap.values()).sort((a, b) =>
              (a.room || "").localeCompare(b.room || "", undefined, { numeric: true }),
            );
            const totalStudents = rooms.reduce((s, rm) => s + (rm.studentCount || 0), 0);
            const est1Students = rooms.reduce((s, rm) => s + (rm.est1Count || 0), 0);
            const est2Students = rooms.reduce((s, rm) => s + (rm.est2Count || 0), 0);

            return {
              floor: flName,
              rooms,
              totalStudents,
              est1Students,
              est2Students,
            };
          });

        const allRooms = floors.flatMap((f) => f.rooms);
        const totalRooms = allRooms.length;
        const est1Total = floors.reduce((s, f) => s + (f.est1Students || 0), 0);
        const est2Total = floors.reduce((s, f) => s + (f.est2Students || 0), 0);
        const totalStudents = est1Total + est2Total;

        combinedList.push({
          examName: "EST I & EST II Combined",
          governorate: govName,
          center: centerName,
          building: buildingName,
          date: round.cycleName || "December 2026",
          totalRooms,
          totalStudents,
          roomNames: allRooms.map((r: any) => (typeof r === "string" ? r : r.room)),
          floors,
          boxNumber: idx + 1,
          totalBoxes: totalCenters,
          isCombined: true,
          est1Total,
          est2Total,
        });
      }

      return combinedList;
    };

    // 6. MASTER BUILDING CARTON PLACARD (A4 Landscape, Sequentially Numbered)
    if (type === "carton") {
      const cartons = buildCenterLogisticsOptions();
      const pdfBytes =
        cartons.length === 1
          ? await generateBuildingCartonStickerPdf(cartons[0])
          : await generateBatchBuildingCartonStickersPdf(cartons);

      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Building_Cartons_${cartons.length}_Centers.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 6b. DRIVER DELIVERY MANIFEST SHEET FOR CARTONS
    if (type === "carton_driver_manifest") {
      const cartons = buildCenterLogisticsOptions();
      const pdfBytes = await generateCartonDriverManifestPdf(cartons, {
        isCombined: false,
        cycleName: round.cycleName || "December 2026",
        date: [roundDayStr, roundDateStr].filter(Boolean).join(", ") || round.cycleName || "December 2026",
      });

      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Driver_Delivery_Manifest_${cartons.length}_Cartons.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 6c. COMBINED CARTON PLACARD (EST 1 + EST 2 Together in 1 Carton)
    if (type === "combined_carton") {
      const combinedCartons = await buildCombinedCenterOptions();
      const pdfBytes =
        combinedCartons.length === 1
          ? await generateBuildingCartonStickerPdf(combinedCartons[0])
          : await generateBatchBuildingCartonStickersPdf(combinedCartons);

      const safeFilename = `EST_Combined_Cartons_${round.cycleName?.replace(/[^a-zA-Z0-9_-]/g, "_") || "Dec_2026"}_${combinedCartons.length}_Centers.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 6d. COMBINED DRIVER DELIVERY MANIFEST
    if (type === "combined_driver_manifest") {
      const combinedCartons = await buildCombinedCenterOptions();
      const pdfBytes = await generateCartonDriverManifestPdf(combinedCartons, {
        isCombined: true,
        cycleName: round.cycleName || "December 2026",
        date: round.cycleName || "December 2026",
      });

      const safeFilename = `EST_Combined_Driver_Delivery_Manifest_${round.cycleName?.replace(/[^a-zA-Z0-9_-]/g, "_") || "Dec_2026"}_${combinedCartons.length}_Cartons.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 7. TRANSIT BAG EXAM CHECKLIST (A4 Portrait)
    if (type === "bag") {
      const centers = buildCenterLogisticsOptions();
      const mergedDoc = await PDFDocument.create();

      for (const opt of centers) {
        const bytes = await generateExamBagChecklistPdf(opt);
        const doc = await PDFDocument.load(bytes);
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => mergedDoc.addPage(p));
      }

      const pdfBytes = await mergedDoc.save();
      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Transit_Bag_Checklists_${centers.length}_Centers.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 8. MASTER CENTER & BUILDING MANIFEST (Single-Page Blueprint)
    if (type === "manifest") {
      const centers = buildCenterLogisticsOptions();
      const mergedDoc = await PDFDocument.create();

      for (const opt of centers) {
        const bytes = await generateMasterBuildingManifestPdf(opt);
        const doc = await PDFDocument.load(bytes);
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => mergedDoc.addPage(p));
      }

      const pdfBytes = await mergedDoc.save();
      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Master_Manifest_${centers.length}_Centers.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 9. CLEAN SKIN MASTER PACKET (2 Pages: Manifest + Incident Log)
    if (type === "clean_skin_master") {
      const centers = buildCenterLogisticsOptions();
      const mergedDoc = await PDFDocument.create();

      for (const opt of centers) {
        const bytes = await generateCleanSkinMasterPdf(opt);
        const doc = await PDFDocument.load(bytes);
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => mergedDoc.addPage(p));
      }

      const pdfBytes = await mergedDoc.save();
      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Clean_Skin_Emergency_Packet_${centers.length}_Centers.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 10. CLEAN SKIN DISPATCH LOG SHEET (Single Page)
    if (type === "clean_skin_log") {
      const centers = buildCenterLogisticsOptions();
      const mergedDoc = await PDFDocument.create();

      for (const opt of centers) {
        const bytes = await generateCleanSkinDispatchLogPdf(opt);
        const doc = await PDFDocument.load(bytes);
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => mergedDoc.addPage(p));
      }

      const pdfBytes = await mergedDoc.save();
      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Clean_Skin_Incident_Log_${centers.length}_Centers.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 11. CLEAN SKIN SUBJECT STICKERS (Quarter A4 4-Up)
    if (type === "clean_skin_subjects") {
      const centers = buildCenterLogisticsOptions();
      const mergedDoc = await PDFDocument.create();

      for (const opt of centers) {
        const bytes = await generateCleanSkinSubjectStickersPdf(opt);
        const doc = await PDFDocument.load(bytes);
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => mergedDoc.addPage(p));
      }

      const pdfBytes = await mergedDoc.save();
      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Clean_Skin_Subject_Stickers_${centers.length}_Centers.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // 12. DEFAULT: ROOM PLACARDS (A4 4-Up 2x2 grid)
    const roomContents = targetRows.map(buildRoomStickerContent);
    const pdfBytes = await generateBatchStickerPdf({
      contents: roomContents,
      paperMode,
      orientation,
      widthMm,
      heightMm,
    });

    const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Room_Placards_${targetRows.length}_Rooms.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "Content-Length": String(pdfBytes.length),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
        "X-Rooms-Count": String(targetRows.length),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

