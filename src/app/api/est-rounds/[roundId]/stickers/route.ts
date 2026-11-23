import { NextResponse } from "next/server";
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
  type FloorExamStickersOptions,
  type FloorSubjectPlacardData,
  type FloorRoomSubjectData,
} from "@/lib/stickers/floor-exam-stickers-pdf";
import type { StickerContent } from "@/lib/stickers/sticker-content";
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
          `${isSchool ? "School" : "Center"} : ${row.center}`,
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
        building: "",
        floor: row.floor,
        room: row.room,
        fields: [
          { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: row.governorate },
          { key: "center", label: isSchool ? "School" : "Center", labelAr: isSchool ? "المدرسة" : "السنتر", value: row.center },
          { key: "floor", label: "Floor", labelAr: "الدور", value: row.floor },
          { key: "room", label: "Room", labelAr: "القاعة", value: row.room },
        ],
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
      // Group target rows by governorate + center + floor
      const floorGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const key = `${r.governorate}::${r.center}::${r.floor}`;
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

        floorContents.push({
          level: "floor",
          lines: [
            round.name,
            `Governorate : ${first.governorate}`,
            `${isSchool ? "School" : "Center"} : ${first.center}`,
            `Floor : ${first.floor}`,
            `Total Rooms : ${rows.length}`,
          ],
          rawLines: ["EST", first.governorate, first.center, first.floor],
          cleanChain: ["EST", first.governorate, first.center, first.floor],
          examName: round.name || round.examType,
          examType: round.examType as "EST 1" | "EST 2",
          examDate: roundDateStr,
          examDay: roundDayStr,
          governorate: first.governorate,
          center: first.center,
          building: "",
          floor: first.floor,
          childCount: rows.length,
          childLabel: "Rooms",
          childNames: floorRooms,
          totalStudents,
          fields: [
            { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: first.governorate },
            { key: "center", label: isSchool ? "School" : "Center", labelAr: isSchool ? "المدرسة" : "السنتر", value: first.center },
            { key: "floor", label: "Floor", labelAr: "الدور", value: first.floor },
          ],
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

    // 3. BUILDING / SCHOOL PLACARDS (Full-Page A4 Landscape)
    if (type === "building_placards") {
      const centerGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const key = `${r.governorate}::${r.center}`;
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

        buildingContents.push({
          level: "building",
          lines: [
            round.name,
            `Governorate : ${first.governorate}`,
            `${isSchool ? "School" : "Center"} : ${first.center}`,
            `Total Floors : ${uniqueFloors.length}`,
            `Total Rooms : ${rows.length}`,
          ],
          rawLines: ["EST", first.governorate, first.center],
          cleanChain: ["EST", first.governorate, first.center],
          examName: round.name || round.examType,
          examType: round.examType as "EST 1" | "EST 2",
          examDate: roundDateStr,
          examDay: roundDayStr,
          governorate: first.governorate,
          center: first.center,
          building: "",
          childCount: uniqueFloors.length,
          childLabel: "Floors",
          childNames: uniqueFloors,
          totalRooms: rows.length,
          totalStudents,
          fields: [
            { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: first.governorate },
            { key: "center", label: isSchool ? "School" : "Center", labelAr: isSchool ? "المدرسة" : "السنتر", value: first.center },
          ],
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
        const key = `${r.governorate}::${r.center}`;
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

        headContents.push({
          level: "building_head",
          isHead: true,
          lines: [
            round.name,
            `Governorate : ${first.governorate}`,
            `${isSchool ? "School" : "Center"} : ${first.center}`,
            `Total Floors : ${uniqueFloors.length}`,
            `Total Rooms : ${rows.length}`,
          ],
          rawLines: ["EST", first.governorate, first.center, first.center],
          cleanChain: ["EST", first.governorate, first.center, first.center],
          examName: round.name || round.examType,
          examType: round.examType as "EST 1" | "EST 2",
          examDate: roundDateStr,
          examDay: roundDayStr,
          governorate: first.governorate,
          center: first.center,
          building: "",
          childCount: uniqueFloors.length,
          childLabel: "Floors",
          childNames: uniqueFloors,
          totalRooms: rows.length,
          totalStudents,
          fields: [
            { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: first.governorate },
            { key: "center", label: isSchool ? "School" : "Center", labelAr: isSchool ? "المدرسة" : "السنتر", value: first.center },
          ],
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

    // 5. MASTER BUNDLE: Buildings + Heads + Floors + Rooms
    if (type === "bundle") {
      const allBundleContents: StickerContent[] = [];

      // A) Buildings
      const centerGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const key = `${r.governorate}::${r.center}`;
        const existing = centerGroups.get(key) || [];
        existing.push(r);
        centerGroups.set(key, existing);
      }

      for (const [_, rows] of centerGroups.entries()) {
        const first = rows[0];
        const uniqueFloors = Array.from(new Set(rows.map((r) => r.floor)));
        const totalStudents = rows.reduce((sum, r) => sum + r.totalStudents, 0);

        allBundleContents.push({
          level: "building",
          lines: [round.name, `Governorate : ${first.governorate}`, `Center : ${first.center}`],
          rawLines: ["EST", first.governorate, first.center, first.center],
          cleanChain: ["EST", first.governorate, first.center, first.center],
          examName: round.name || round.examType,
          examType: round.examType as "EST 1" | "EST 2",
          examDate: roundDateStr,
          examDay: roundDayStr,
          governorate: first.governorate,
          center: first.center,
          building: "",
          childCount: uniqueFloors.length,
          childLabel: "Floors",
          childNames: uniqueFloors,
          totalRooms: rows.length,
          totalStudents,
          fields: [
            { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: first.governorate },
            { key: "center", label: "Center", labelAr: "السنتر", value: first.center },
            { key: "building", label: "Building", labelAr: "المبنى", value: first.center },
          ],
        });

        // Building Head
        allBundleContents.push({
          level: "building_head",
          isHead: true,
          lines: [round.name, `Center : ${first.center}`],
          rawLines: ["EST", first.governorate, first.center, first.center],
          cleanChain: ["EST", first.governorate, first.center, first.center],
          examName: round.name || round.examType,
          examType: round.examType as "EST 1" | "EST 2",
          examDate: roundDateStr,
          examDay: roundDayStr,
          governorate: first.governorate,
          center: first.center,
          building: "",
          fields: [
            { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: first.governorate },
            { key: "center", label: "Center", labelAr: "السنتر", value: first.center },
          ],
        });
      }

      // B) Floors
      const floorGroups = new Map<string, EstRoundRow[]>();
      for (const r of targetRows) {
        const key = `${r.governorate}::${r.center}::${r.floor}`;
        const existing = floorGroups.get(key) || [];
        existing.push(r);
        floorGroups.set(key, existing);
      }

      for (const [_, rows] of floorGroups.entries()) {
        const first = rows[0];
        allBundleContents.push({
          level: "floor",
          lines: [round.name, `Floor : ${first.floor}`],
          rawLines: ["EST", first.governorate, first.center, first.floor],
          cleanChain: ["EST", first.governorate, first.center, first.floor],
          examName: round.name || round.examType,
          examType: round.examType as "EST 1" | "EST 2",
          examDate: roundDateStr,
          examDay: roundDayStr,
          governorate: first.governorate,
          center: first.center,
          building: "",
          floor: first.floor,
          childCount: rows.length,
          childLabel: "Rooms",
          childNames: rows.map((r) => r.room),
          totalStudents: rows.reduce((s, r) => s + r.totalStudents, 0),
          fields: [
            { key: "governorate", label: "Governorate", labelAr: "المحافظة", value: first.governorate },
            { key: "center", label: "Center", labelAr: "السنتر", value: first.center },
            { key: "floor", label: "Floor", labelAr: "الدور", value: first.floor },
          ],
        });
      }

      // C) Rooms
      for (const r of targetRows) {
        allBundleContents.push(buildRoomStickerContent(r));
      }

      const pdfBytes = await generateBatchStickerPdf({
        contents: allBundleContents,
        paperMode: "a4",
        orientation,
      });

      const safeFilename = `${round.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_Complete_Logistics_Bundle.pdf`;

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

    // 6. DEFAULT: ROOM PLACARDS (A4 4-Up 2x2 grid)
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

