import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession, enforceRateLimit, jsonError } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { OWNER_ID } from "@/lib/auth";
import {
  ensureEstExamRoundTable,
  parseEstExcelWorkbook,
  type EstRoundRow,
  type EstRoundSummaryStats,
} from "@/lib/est-rounds";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireSession(request);
    enforceRateLimit(request, "est-rounds:list", 120, 60_000);
    await ensureEstExamRoundTable();

    const rounds = await prisma.estExamRound.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        examType: true,
        roundDate: true,
        roundDay: true,
        cycleName: true,
        fileName: true,
        summaryStats: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ rounds });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession(request, { mutating: true });
    enforceRateLimit(request, "est-rounds:create", 60, 60_000);
    await ensureEstExamRoundTable();

    const contentType = request.headers.get("content-type") || "";

    let name = "";
    let examType = "";
    let roundDate: Date | null = null;
    let roundDay = "";
    let cycleName = "";
    let fileName = "";
    let sheetData: EstRoundRow[] = [];
    let summaryStats: EstRoundSummaryStats | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No Excel file provided" }, { status: 400 });
      }

      fileName = file.name;
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
      const parsed = parseEstExcelWorkbook(workbook, file.name);

      sheetData = parsed.rows;
      summaryStats = parsed.stats;
      examType = (formData.get("examType") as string) || parsed.examType;

      const formName = (formData.get("name") as string)?.trim();
      const formCycle = (formData.get("cycleName") as string)?.trim();
      const formDay = (formData.get("roundDay") as string)?.trim();
      const formDate = (formData.get("roundDate") as string)?.trim();

      cycleName = formCycle || "December 2026";

      if (examType === "EST 2") {
        name = formName || `EST 2 - ${cycleName}`;
        roundDay = formDay || "Saturday";
        roundDate = formDate ? new Date(formDate) : new Date("2026-12-12T00:00:00Z");
      } else {
        name = formName || `EST 1 - ${cycleName}`;
        roundDay = formDay || "Friday";
        roundDate = formDate ? new Date(formDate) : new Date("2026-12-11T00:00:00Z");
      }
    } else {
      const body = await request.json().catch(() => ({}));

      // Check for seedDefault request (Seeds official December 2026 for EST 1 and EST 2)
      if (body.seedDefault) {
        const fs = await import("fs");
        const path = await import("path");
        const localPath = path.join(process.cwd(), "src/lib/assets/Stats-per-Room.xlsx");
        const filePath = fs.existsSync(localPath)
          ? localPath
          : "//192.168.1.230/Dev/printing/Stats per Room.xlsx";

        const { extractFloorAndRoom } = await import("@/lib/est-rounds");
        const buf = fs.readFileSync(filePath);
        const wb = XLSX.read(buf, { type: "buffer" });
        const sheet = wb.Sheets["02-Stats per Room"] || wb.Sheets[wb.SheetNames[0]];
        const rawData: any[] = XLSX.utils.sheet_to_json(sheet);

        const est1Rows: EstRoundRow[] = [];
        const est2Rows: EstRoundRow[] = [];
        let lastGov = "Alexandria";

        for (let i = 0; i < rawData.length; i++) {
          const r = rawData[i];
          const rawGov = String(r["Governorate AR"] || "").trim();
          if (rawGov && !/^total$/i.test(rawGov)) lastGov = rawGov;

          const center = String(r["Center"] || "").trim();
          const building = String(r["Building"] || "").trim();
          const rawRoom = String(r["Room"] || "").trim();
          if (!center || !rawRoom || /^total$/i.test(center) || /^total$/i.test(rawGov)) continue;

          const gov = lastGov;
          const { floor, room } = extractFloorAndRoom(rawRoom, center);

          const est1Students = Number(r["Students EST I"]) || 0;
          const est2Students = Number(r["Students EST II"]) || 0;
          const withoutEssay = Number(r["Students without Essay"]) || 0;
          const withEssay = Number(r["Students with Essay"]) || 0;
          const m1 = Number(r["Students Math 1"]) || 0;
          const bio = Number(r["Students Biology"]) || 0;
          const phy = Number(r["Students Physics"]) || 0;
          const chem = Number(r["Students Chemistry"]) || 0;
          const m2 = Number(r["Students Math 2"]) || 0;

          const est1SubjParts: string[] = [];
          if (est1Students > 0) {
            est1SubjParts.push(`Literacy: ${est1Students}`, `Math: ${est1Students}`);
            if (withEssay > 0) est1SubjParts.push(`Essay: ${withEssay}`);
          }
          const est1SubjectsText = est1SubjParts.join("  |  ");

          const est2SubjParts: string[] = [];
          if (m1 > 0) est2SubjParts.push(`Math 1: ${m1}`);
          if (m2 > 0) est2SubjParts.push(`Math 2: ${m2}`);
          if (bio > 0) est2SubjParts.push(`Biology: ${bio}`);
          if (chem > 0) est2SubjParts.push(`Chemistry: ${chem}`);
          if (phy > 0) est2SubjParts.push(`Physics: ${phy}`);
          const est2SubjectsText = est2SubjParts.join("  |  ");

          if (est1Students > 0) {
            const breakdown: string[] = [`Literacy: ${est1Students}`, `Math: ${est1Students}`];
            if (withEssay > 0) breakdown.push(`Essay: ${withEssay}`);

            est1Rows.push({
              id: `est1-row-${est1Rows.length + 1}`,
              index: est1Rows.length + 1,
              governorate: gov,
              center,
              building: building || center,
              floor,
              room,
              rawRoom,
              subjects: { LIT: est1Students, MATH: est1Students, ESSAY: withEssay },
              totalStudents: est1Students,
              breakdownText: breakdown.join("  |  "),
              est1Count: est1Students,
              est1Subjects: est1SubjectsText,
              est2Count: est2Students,
              est2Subjects: est2SubjectsText,
            } as any);
          }

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
              building: building || center,
              floor,
              room,
              rawRoom,
              subjects: { MATH1: m1, MATH2: m2, BIO: bio, CHEM: chem, PHY: phy },
              totalStudents,
              breakdownText: breakdown.join("  |  "),
              est1Count: est1Students,
              est1Subjects: est1SubjectsText,
              est2Count: totalStudents,
              est2Subjects: est2SubjectsText,
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

          return {
            totalGovernorates: govs.size,
            totalCenters: centers.size,
            totalFloors: floors.size,
            totalRooms: rows.length,
            totalStudents: rows.reduce((s, r) => s + r.totalStudents, 0),
            subjectTotals,
            governoratesList: Array.from(govs),
            centersList: Array.from(centers),
          };
        };

        const est1Stats = calcStats(est1Rows);
        const est2Stats = calcStats(est2Rows);

        // Upsert EST 1
        const existingEst1 = await prisma.estExamRound.findFirst({ where: { name: "EST 1 - December 2026" } });
        const round1 = existingEst1
          ? await prisma.estExamRound.update({
              where: { id: existingEst1.id },
              data: {
                examType: "EST 1",
                roundDate: new Date("2026-12-11T00:00:00Z"),
                roundDay: "Friday",
                cycleName: "December 2026",
                fileName: "Stats per Room.xlsx",
                sheetData: est1Rows as any,
                summaryStats: est1Stats as any,
              },
            })
          : await prisma.estExamRound.create({
              data: {
                userId: OWNER_ID,
                name: "EST 1 - December 2026",
                examType: "EST 1",
                roundDate: new Date("2026-12-11T00:00:00Z"),
                roundDay: "Friday",
                cycleName: "December 2026",
                fileName: "Stats per Room.xlsx",
                sheetData: est1Rows as any,
                summaryStats: est1Stats as any,
                status: "active",
              },
            });

        // Upsert EST 2
        const existingEst2 = await prisma.estExamRound.findFirst({ where: { name: "EST 2 - December 2026" } });
        const round2 = existingEst2
          ? await prisma.estExamRound.update({
              where: { id: existingEst2.id },
              data: {
                examType: "EST 2",
                roundDate: new Date("2026-12-12T00:00:00Z"),
                roundDay: "Saturday",
                cycleName: "December 2026",
                fileName: "Stats per Room.xlsx",
                sheetData: est2Rows as any,
                summaryStats: est2Stats as any,
              },
            })
          : await prisma.estExamRound.create({
              data: {
                userId: OWNER_ID,
                name: "EST 2 - December 2026",
                examType: "EST 2",
                roundDate: new Date("2026-12-12T00:00:00Z"),
                roundDay: "Saturday",
                cycleName: "December 2026",
                fileName: "Stats per Room.xlsx",
                sheetData: est2Rows as any,
                summaryStats: est2Stats as any,
                status: "active",
              },
            });

        return NextResponse.json({
          success: true,
          round: round2 || round1,
          rounds: [round1, round2],
          message: "Successfully seeded official EST 1 and EST 2 December 2026 rounds.",
        });
      } else {
        if (!Array.isArray(body.sheetData) || body.sheetData.length === 0) {
          return NextResponse.json({ error: "No sheetData provided" }, { status: 400 });
        }

        sheetData = body.sheetData;
        summaryStats = body.summaryStats || null;
        examType = body.examType || "EST 2";
        cycleName = body.cycleName || "December 2026";
        name = body.name || `${examType} - ${cycleName}`;
        roundDay = body.roundDay || (examType === "EST 2" ? "Saturday" : "Friday");
        roundDate = body.roundDate ? new Date(body.roundDate) : new Date(examType === "EST 2" ? "2026-12-12T00:00:00Z" : "2026-12-11T00:00:00Z");
        fileName = body.fileName || `${name}.xlsx`;
      }
    }

    const round = await prisma.estExamRound.create({
      data: {
        userId: OWNER_ID,
        name,
        examType,
        roundDate,
        roundDay,
        cycleName,
        fileName,
        sheetData: sheetData as any,
        summaryStats: summaryStats as any,
        status: "active",
      },
    });

    return NextResponse.json({
      success: true,
      round,
      message: `Successfully created round "${name}" with ${sheetData.length} rooms.`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
