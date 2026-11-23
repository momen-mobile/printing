import { NextResponse } from "next/server";
import { requireSession, enforceRateLimit, jsonError } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { ensureEstExamRoundTable } from "@/lib/est-rounds";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  props: { params: Promise<{ roundId: string }> },
) {
  try {
    await requireSession(request);
    enforceRateLimit(request, "est-rounds:get", 120, 60_000);
    await ensureEstExamRoundTable();

    const params = await props.params;
    const { roundId } = params;

    const round = await prisma.estExamRound.findUnique({
      where: { id: roundId },
    });

    if (!round) {
      return NextResponse.json({ error: "EST round not found" }, { status: 404 });
    }

    return NextResponse.json({ round });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  props: { params: Promise<{ roundId: string }> },
) {
  try {
    await requireSession(request, { mutating: true });
    enforceRateLimit(request, "est-rounds:update", 60, 60_000);
    await ensureEstExamRoundTable();

    const params = await props.params;
    const { roundId } = params;
    const body = await request.json().catch(() => ({}));

    const dataToUpdate: any = {};
    if (typeof body.name === "string" && body.name.trim()) {
      dataToUpdate.name = body.name.trim();
    }
    if (typeof body.examType === "string" && body.examType.trim()) {
      dataToUpdate.examType = body.examType.trim();
    }
    if (body.roundDate) {
      dataToUpdate.roundDate = new Date(body.roundDate);
    }
    if (typeof body.roundDay === "string" && body.roundDay.trim()) {
      dataToUpdate.roundDay = body.roundDay.trim();
    }
    if (typeof body.cycleName === "string" && body.cycleName.trim()) {
      dataToUpdate.cycleName = body.cycleName.trim();
    }
    if (typeof body.status === "string" && body.status.trim()) {
      dataToUpdate.status = body.status.trim();
    }

    const updated = await prisma.estExamRound.update({
      where: { id: roundId },
      data: dataToUpdate,
    });

    return NextResponse.json({ success: true, round: updated });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  props: { params: Promise<{ roundId: string }> },
) {
  try {
    await requireSession(request, { mutating: true });
    enforceRateLimit(request, "est-rounds:delete", 60, 60_000);
    await ensureEstExamRoundTable();

    const params = await props.params;
    const { roundId } = params;

    await prisma.estExamRound.delete({
      where: { id: roundId },
    });

    return NextResponse.json({ success: true, message: "Round deleted successfully" });
  } catch (error) {
    return jsonError(error);
  }
}
