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

      // Check for seedDefault request
      if (body.seedDefault) {
        const sampleData = (await import("@/lib/assets/est2-december-sample.json")).default;
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(sampleData);
        XLSX.utils.book_append_sheet(wb, ws, "EST II subjects");
        const parsed = parseEstExcelWorkbook(wb, "EST II subjects December 2026.xlsx");

        sheetData = parsed.rows;
        summaryStats = parsed.stats;
        examType = "EST 2";
        cycleName = "December 2026";
        name = "EST 2 - December 2026";
        roundDay = "Saturday";
        roundDate = new Date("2026-12-12T00:00:00Z");
        fileName = "EST II subjects December 2026.xlsx";
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
