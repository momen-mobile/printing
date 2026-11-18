import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, enforceRateLimit, jsonError, parseJson } from "@/lib/api-utils";
import { getConnection, getDriveContextWithRoot } from "@/lib/auth";
import { buildBreadcrumbs, getFileMeta, getFolderDescendants } from "@/lib/drive";
import {
  classifyChildLabel,
  countRoomFolders,
  inferSecondLevelIsSchool,
  listStickerChildren,
} from "@/lib/stickers/drive-hierarchy";
import { getDemoBreadcrumbs, getDemoDescendants, isDemoEnabled } from "@/lib/demo";
import { getSettings } from "@/lib/settings";
import { buildStickerContent, type StickerContent, type StickerSubfolderInfo } from "@/lib/stickers/sticker-content";
import { generateBatchStickerPdf, generateBatchExamStickersPdf } from "@/lib/stickers/sticker-pdf";
import { getRoomExamCounts, type RoomSubjectCount } from "@/lib/stickers/est-room-data";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const batchStickersSchema = z.object({
  folderIds: z.array(z.string().min(1)).min(1).max(200),
  type: z.enum(["regular", "exam", "head", "exam_dossier", "floor_bag"]).optional().default("regular"),
  includeChildren: z.boolean().optional().default(false),
  paperMode: z.enum(["custom", "a4"]).optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  widthMm: z.number().min(30).max(300).optional(),
  heightMm: z.number().min(20).max(200).optional(),
  knownFiles: z.record(z.string(), z.array(z.string())).optional(),
});

export async function POST(request: Request) {
  try {
    await requireSession(request);
    enforceRateLimit(request, "stickers:batch", 60, 60_000);

    const body = await parseJson<z.infer<typeof batchStickersSchema>>(request, batchStickersSchema);
    const settings = await getSettings();

    const paperMode = body.paperMode ?? settings.printing.stickerPaperMode ?? "a4";
    const orientation = body.orientation ?? settings.printing.stickerOrientation ?? "portrait";
    const widthMm = body.widthMm ?? settings.printing.stickerWidthMm ?? 100;
    const heightMm = body.heightMm ?? settings.printing.stickerHeightMm ?? 50;

    const connection = await getConnection();
    const connected = connection?.connectionStatus === "connected";
    const isDemo = isDemoEnabled() && !connected;

    // Collect all unique folder IDs to generate stickers for
    const targetFolderIds = new Set<string>(body.folderIds);
    const isExamStickers = body.type === "exam";

    // If includeChildren is enabled OR if generating exam stickers (exam stickers belong to rooms), expand descendants
    if (body.includeChildren || isExamStickers) {
      if (isDemo || body.folderIds.some((id) => id.startsWith("demo-"))) {
        const desc = getDemoDescendants(body.folderIds);
        for (const f of desc.folders) {
          targetFolderIds.add(f.id);
        }
      } else {
        const { drive } = await getDriveContextWithRoot();
        const desc = await getFolderDescendants(drive, body.folderIds);
        for (const f of desc.folders) {
          targetFolderIds.add(f.id);
        }
      }
    }

    const orderedFolderIds = Array.from(targetFolderIds);
    let demoDesc: ReturnType<typeof getDemoDescendants> | null = null;
    if (isDemo || orderedFolderIds.some((id) => id.startsWith("demo-"))) {
      demoDesc = getDemoDescendants(orderedFolderIds);
    }

    const contents: StickerContent[] = [];

    for (const folderId of orderedFolderIds) {
      let breadcrumbs: Array<{ id?: string; name?: string | null }> = [];
      let driveSubfolderInfo: StickerSubfolderInfo | undefined;
      let folderFiles: Array<{ name: string }> = [];

      if (isDemo || folderId.startsWith("demo-")) {
        const demoData = getDemoBreadcrumbs(folderId);
        breadcrumbs = demoData.breadcrumbs;
        if (breadcrumbs.length === 0 && demoData.currentFolder) {
          breadcrumbs = [demoData.currentFolder];
        }
        if (demoDesc) {
          folderFiles = (demoDesc.folderTree[folderId] || [])
            .filter((item) => !item.isFolder)
            .map((f) => ({ name: f.name }));
        }
      } else {
        const { drive, rootFolderId } = await getDriveContextWithRoot();
        let resolvedFolderId = folderId;
        try {
          const meta = await getFileMeta(drive, folderId, { resolveShortcut: false });
          if (meta.mimeType === "application/vnd.google-apps.shortcut" && meta.shortcutDetails?.targetId) {
            resolvedFolderId = meta.shortcutDetails.targetId;
          }
        } catch (err) {
          console.warn("[stickers/batch] Error reading folder metadata:", err);
        }

        const data = await buildBreadcrumbs(drive, rootFolderId, resolvedFolderId);
        breadcrumbs = data.breadcrumbs;
        if (breadcrumbs.length === 0 && data.currentFolder) {
          breadcrumbs = [data.currentFolder];
        }

        // Read the real hierarchy (shortcut folders included) from Drive.
        try {
          const children = await listStickerChildren(drive, folderId);
          const childNames = children.folders.map((folder) => folder.name);
          const childLabel = classifyChildLabel(childNames);
          let totalRooms = childLabel === "Rooms" ? children.folders.length : 0;
          if (childLabel !== "Rooms") {
            try {
              const desc = await getFolderDescendants(drive, [resolvedFolderId]);
              totalRooms = countRoomFolders(desc.folders, desc.folderTree);
            } catch { }
          }
          driveSubfolderInfo = {
            childCount: children.folders.length,
            childNames,
            childLabel,
            totalRooms,
          };
          folderFiles = children.files;
        } catch (err) {
          console.warn("[stickers/batch] Error reading live folder children:", err);
        }
      }

      if (body.knownFiles?.[folderId]) {
        for (const fn of body.knownFiles[folderId]) {
          if (!folderFiles.some((f) => f.name === fn)) {
            folderFiles.unshift({ name: fn });
          }
        }
      }

      if (breadcrumbs.length > 0) {
        try {
          const isSchool = isDemo
            ? undefined
            : (await inferSecondLevelIsSchool((await getDriveContextWithRoot()).drive, breadcrumbs));
          const content = buildStickerContent(
            breadcrumbs,
            {
              ...driveSubfolderInfo,
              childFiles: folderFiles,
            },
            { isSchool },
          );

          const targetName = breadcrumbs[breadcrumbs.length - 1]?.name || "";
          const targetRoom = content.room || (content.level === "room" ? targetName : undefined);
          if (targetRoom) {
            const counts = getRoomExamCounts({
              room: targetRoom,
              building: content.building,
              center: content.center,
              governorate: content.governorate,
              floor: content.floor,
              folderFiles,
              examName: content.examName,
            });
            content.totalStudents = counts.totalStudents;
            content.litCount = counts.litCount;
            content.mathCount = counts.mathCount;
            content.essayCount = counts.essayCount;
            content.hasEssay = counts.hasEssay;
            content.subjects = counts.subjects;
            content.breakdownText = counts.breakdownText;
            content.examType = counts.examType;
          }

          contents.push(content);
        } catch (err) {
          console.warn(`[stickers/batch] Skipping folder ${folderId}:`, err);
        }
      }
    }

    if (contents.length === 0) {
      throw new AppError("Could not resolve any valid folder hierarchies for stickers", {
        status: 404,
        code: "notFound",
      });
    }

    if (body.type === "exam") {
      const examRooms: Array<{
        content: StickerContent;
        litCount?: number;
        mathCount?: number;
        essayCount?: number;
        subjects?: RoomSubjectCount[];
      }> = [];

      for (const c of contents) {
        if (c.level === "room" || c.room) {
          examRooms.push({
            content: c,
            litCount: c.litCount,
            mathCount: c.mathCount,
            essayCount: c.essayCount,
            subjects: c.subjects,
          });
        }
      }

      // If no strictly-flagged room folders, treat all requested contents as room items
      const targetRooms = examRooms.length > 0 ? examRooms : contents.map((c) => ({
        content: c,
        litCount: c.litCount,
        mathCount: c.mathCount,
        essayCount: c.essayCount,
        subjects: c.subjects,
      }));

      const pdfBytes = await generateBatchExamStickersPdf({
        rooms: targetRooms,
        orientation,
      });

      const safeFilename = `EST-Exam-Stickers-Batch-${targetRooms.length}-Rooms.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Content-Length": String(pdfBytes.length),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
          "X-Stickers-Count": String(targetRooms.length),
        },
      });
    }

    const isHeadStickers = body.type === "head";
    const isExamDossier = body.type === "exam_dossier";
    const isFloorBag = body.type === "floor_bag";
    const targetContents = isHeadStickers
      ? contents.map((c) => ({
        ...c,
        level: "building_head" as const,
        isHead: true,
      }))
      : isExamDossier
        ? contents.map((c) => ({
          ...c,
          level: "building" as const,
          isExamDossier: true,
        }))
        : isFloorBag
          ? contents.map((c) => ({
            ...c,
            level: "floor" as const,
            isFloorBag: true,
          }))
          : contents;

    const pdfBytes = await generateBatchStickerPdf({
      contents: targetContents,
      paperMode: isFloorBag ? "a4" : paperMode,
      orientation: isFloorBag ? "landscape" : orientation,
      widthMm,
      heightMm,
      isFloorBag,
    });

    const safeFilename = isHeadStickers
      ? `EST-Building-Head-Stickers-Batch-${contents.length}-Buildings.pdf`
      : isExamDossier
        ? `EST-Building-Exam-Papers-Batch-${contents.length}-Buildings.pdf`
        : isFloorBag
          ? `EST-Floor-Large-Bag-Stickers-Batch-${contents.length}-Floors.pdf`
          : `EST-Stickers-Batch-${contents.length}-Folders.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "Content-Length": String(pdfBytes.length),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
        "X-Stickers-Count": String(contents.length),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

