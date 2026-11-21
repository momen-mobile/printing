import { NextResponse } from "next/server";
import { requireSession, enforceRateLimit, jsonError } from "@/lib/api-utils";
import { getConnection, getDriveContextWithRoot } from "@/lib/auth";
import { buildBreadcrumbs, getFileMeta } from "@/lib/drive";
import { getDemoBreadcrumbs, getDemoDescendants, isDemoEnabled } from "@/lib/demo";
import { getFloorSortWeight } from "@/lib/stickers/est-reference-data";
import { parseEstRoomFileName } from "@/lib/stickers/est-room-data";
import { listStickerChildren } from "@/lib/stickers/drive-hierarchy";
import { isRoomFolderName } from "@/lib/stickers/register-utils";
import {
  generateBuildingCartonStickerPdf,
  generateBatchBuildingCartonStickersPdf,
  generateExamBagChecklistPdf,
  generateCleanSkinMasterPdf,
  generateMasterBuildingManifestPdf,
  generateCleanSkinDispatchLogPdf,
  generateCleanSkinSubjectStickersPdf,
  generateCompleteLogisticsBundlePdf,
  normalizeFloorsData,
  type LogisticsStickerOptions,
  type FloorRoomsData,
} from "@/lib/stickers/logistics-stickers-pdf";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

function isFloorFolderName(name?: string | null): boolean {
  if (!name) return false;
  return (
    /floor|دور|طابق|\b\d+(st|nd|rd|th)\s*floor\b|\bground(\s*floor)?\b|\bأرضي\b|\bbasement\b|\bبدروم\b|\bmezzanine\b|\bميزانين\b/i.test(
      name,
    ) || /^(ground|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s*(floor)?$/i.test(name.trim())
  );
}

export async function GET(request: Request) {
  try {
    await requireSession(request);
    enforceRateLimit(request, "logistics:generate", 120, 60_000);

    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "bundle";
    const folderId = url.searchParams.get("folderId");
    let governorate = url.searchParams.get("governorate") || "";
    let center = url.searchParams.get("center") || "";
    let building = url.searchParams.get("building") || "";
    let examName = url.searchParams.get("examName") || "EST 1";
    let date = url.searchParams.get("date") || "December 2026";
    let totalRooms = Number(url.searchParams.get("totalRooms")) || undefined;
    let totalStudents = Number(url.searchParams.get("totalStudents")) || undefined;
    let roomNames: string[] = [];
    let floors: FloorRoomsData[] = [];

    const roomNamesParam = url.searchParams.get("roomNames");
    if (roomNamesParam) {
      try {
        const parsed = JSON.parse(roomNamesParam);
        if (Array.isArray(parsed)) roomNames = parsed.map(String);
      } catch {
        roomNames = roomNamesParam.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }

    const floorsParam = url.searchParams.get("floors");
    if (floorsParam) {
      try {
        const parsedFloors = JSON.parse(floorsParam);
        if (Array.isArray(parsedFloors)) floors = parsedFloors;
      } catch {}
    }

    // If folderId is provided, resolve hierarchy, child floors, and rooms dynamically from Drive files
    if (folderId) {
      const connection = await getConnection();
      const connected = connection?.connectionStatus === "connected";
      const isDemo = isDemoEnabled() && !connected;

      if (isDemo || folderId.startsWith("demo-")) {
        const demoData = getDemoBreadcrumbs(folderId);
        const crumbs = demoData.breadcrumbs;
        if (crumbs.length > 0) {
          const names = crumbs.map((c) => c.name);
          const estIdx = names.findIndex((n) => /^EST(\s*[-_]?\s*([0-9]+|[IVXLCDM]+))?$/i.test(n));
          const rel = estIdx >= 0 ? names.slice(estIdx) : names;
          if (rel[0]) examName = rel[0];
          if (rel[1]) governorate = rel[1];
          if (rel[2]) center = rel[2];
          if (rel[3]) building = rel[3];
        }

        // Search counterpart exam in Demo data
        const counterpartMap = new Map<string, { studentCount: number; subjectsText: string }>();
        try {
          const estIdx = crumbs.findIndex((c) => /^EST(\s*[-_]?\s*([0-9]+|[IVXLCDM]+))?$/i.test(c.name));
          if (estIdx >= 1) {
            const cycleId = crumbs[estIdx - 1]?.id;
            const curExam = crumbs[estIdx]?.name || "EST 1";
            const isEst1Cur = !/EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(curExam);
            const cpExamName = isEst1Cur ? "EST 2" : "EST 1";
            const subPath = crumbs.slice(estIdx + 1);

            const allDesc = getDemoDescendants([cycleId]);
            const cpExamFolder = allDesc.folders.find(
              (f) => f.parentId === cycleId && f.name.toLowerCase() === cpExamName.toLowerCase(),
            );
            let curParentId = cpExamFolder?.id;
            if (curParentId && subPath.length > 0) {
              for (const seg of subPath) {
                const next = allDesc.folders.find(
                  (f) => f.parentId === curParentId && f.name.toLowerCase() === seg.name.toLowerCase(),
                );
                curParentId = next?.id;
                if (!curParentId) break;
              }
            }

            if (curParentId) {
              const cpFloors = allDesc.folders.filter((f) => f.parentId === curParentId && isFloorFolderName(f.name));
              for (const fl of cpFloors) {
                const cpRooms = allDesc.folders.filter((f) => f.parentId === fl.id);
                for (const rm of cpRooms) {
                  const rKey = rm.name.trim().toLowerCase();
                  if (!counterpartMap.has(rKey)) {
                    const rFiles = allDesc.files.filter((f) => f.parentId === rm.id);
                    let stdCount: number | undefined;
                    let subjText: string | undefined;
                    for (const f of rFiles) {
                      const parsed = parseEstRoomFileName(f.name);
                      if (parsed) {
                        stdCount = parsed.totalStudents;
                        subjText = parsed.breakdownText;
                        break;
                      }
                    }
                    counterpartMap.set(rKey, { studentCount: stdCount || 0, subjectsText: subjText || "" });
                  }
                }
              }
            }
          }
        } catch {}

        try {
          const desc = getDemoDescendants([folderId]);
          const floorFolders = desc.folders.filter(
            (f) => f.parentId === folderId && isFloorFolderName(f.name),
          );

          if (floorFolders.length > 0) {
            // Group duplicate floor folders by name
            const floorGroups = new Map<string, Array<{ id: string; name: string }>>();
            for (const fl of floorFolders) {
              const k = (fl.name || "").trim().toLowerCase();
              const grp = floorGroups.get(k) || [];
              grp.push({ id: fl.id, name: fl.name.trim() });
              floorGroups.set(k, grp);
            }

            floors = Array.from(floorGroups.entries()).map(([_, flList]) => {
              const displayFloorName = flList[0].name;
              const roomsMap = new Map<string, {
                room: string;
                studentCount?: number;
                subjectsText?: string;
                est1Count?: number;
                est1Subjects?: string;
                est2Count?: number;
                est2Subjects?: string;
              }>();

              for (const fl of flList) {
                const roomFolders = desc.folders.filter(
                  (f) =>
                    f.parentId === fl.id &&
                    (isRoomFolderName(f.name) ||
                      /^(\d{1,4}[A-Za-z]?|[A-Za-z]\d{1,4}|room\s*\d+|قاعة\s*\d+)$/i.test(f.name)),
                );

                for (const rf of roomFolders) {
                  const rKey = rf.name.trim().toLowerCase();
                  if (!roomsMap.has(rKey)) {
                    const rFiles = desc.files.filter((file) => file.parentId === rf.id);
                    let stdCount: number | undefined;
                    let subjText: string | undefined;
                    for (const rfFile of rFiles) {
                      const parsed = parseEstRoomFileName(rfFile.name);
                      if (parsed) {
                        stdCount = parsed.totalStudents;
                        subjText = parsed.breakdownText;
                        break;
                      }
                    }

                    const cp = counterpartMap.get(rKey);
                    const isCurEst1 = !/EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(examName);
                    let est1Count = isCurEst1 ? stdCount : cp?.studentCount;
                    let est1Subjects = isCurEst1 ? subjText : cp?.subjectsText;
                    let est2Count = !isCurEst1 ? stdCount : cp?.studentCount;
                    let est2Subjects = !isCurEst1 ? subjText : cp?.subjectsText;

                    roomsMap.set(rKey, {
                      room: rf.name.trim(),
                      studentCount: stdCount,
                      subjectsText: subjText,
                      est1Count,
                      est1Subjects,
                      est2Count,
                      est2Subjects,
                    });
                  }
                }

                // Check direct files in floor
                const directFiles = desc.files.filter((file) => file.parentId === fl.id);
                for (const df of directFiles) {
                  const parsed = parseEstRoomFileName(df.name);
                  const roomName = parsed?.room || df.name.replace(/\.[^/.]+$/, "");
                  const rKey = roomName.trim().toLowerCase();
                  if (!roomsMap.has(rKey)) {
                    const cp = counterpartMap.get(rKey);
                    const isCurEst1 = !/EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(examName);
                    let est1Count = isCurEst1 ? parsed?.totalStudents : cp?.studentCount;
                    let est1Subjects = isCurEst1 ? parsed?.breakdownText : cp?.subjectsText;
                    let est2Count = !isCurEst1 ? parsed?.totalStudents : cp?.studentCount;
                    let est2Subjects = !isCurEst1 ? parsed?.breakdownText : cp?.subjectsText;

                    roomsMap.set(rKey, {
                      room: roomName.trim(),
                      studentCount: parsed?.totalStudents,
                      subjectsText: parsed?.breakdownText,
                      est1Count,
                      est1Subjects,
                      est2Count,
                      est2Subjects,
                    });
                  }
                }
              }

              const sortedRooms = Array.from(roomsMap.values()).sort((a, b) =>
                a.room.localeCompare(b.room, undefined, { numeric: true }),
              );

              return {
                floor: displayFloorName,
                rooms: sortedRooms,
                totalStudents: sortedRooms.reduce((s, r) => s + (r.studentCount || 0), 0),
                est1Students: sortedRooms.reduce((s, r) => s + (r.est1Count || 0), 0),
                est2Students: sortedRooms.reduce((s, r) => s + (r.est2Count || 0), 0),
              };
            });

            floors.sort((a, b) => getFloorSortWeight(a.floor) - getFloorSortWeight(b.floor));
          } else {
            const directRooms = desc.folders.filter(
              (f) =>
                f.parentId === folderId &&
                (isRoomFolderName(f.name) ||
                  /^(\d{1,4}[A-Za-z]?|[A-Za-z]\d{1,4}|room\s*\d+|قاعة\s*\d+)$/i.test(f.name)),
            );
            if (directRooms.length > 0) {
              const rms = directRooms.map((rf) => {
                const rFiles = desc.files.filter((file) => file.parentId === rf.id);
                let stdCount: number | undefined;
                let subjText: string | undefined;
                for (const rfFile of rFiles) {
                  const parsed = parseEstRoomFileName(rfFile.name);
                  if (parsed) {
                    stdCount = parsed.totalStudents;
                    subjText = parsed.breakdownText;
                    break;
                  }
                }
                const rKey = rf.name.trim().toLowerCase();
                const cp = counterpartMap.get(rKey);
                const isCurEst1 = !/EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(examName);
                let est1Count = isCurEst1 ? stdCount : cp?.studentCount;
                let est1Subjects = isCurEst1 ? subjText : cp?.subjectsText;
                let est2Count = !isCurEst1 ? stdCount : cp?.studentCount;
                let est2Subjects = !isCurEst1 ? subjText : cp?.subjectsText;

                return {
                  room: rf.name,
                  studentCount: stdCount,
                  subjectsText: subjText,
                  est1Count,
                  est1Subjects,
                  est2Count,
                  est2Subjects,
                };
              });
              floors = [
                {
                  floor: "General Floor",
                  rooms: rms,
                  totalStudents: rms.reduce((s, r) => s + (r.studentCount || 0), 0),
                  est1Students: rms.reduce((s, r) => s + (r.est1Count || 0), 0),
                  est2Students: rms.reduce((s, r) => s + (r.est2Count || 0), 0),
                },
              ];
            }
          }
        } catch {}
      } else {
        const { drive, rootFolderId } = await getDriveContextWithRoot();
        let resolvedFolderId = folderId;
        try {
          const meta = await getFileMeta(drive, folderId, { resolveShortcut: false });
          if (meta.mimeType === "application/vnd.google-apps.shortcut" && meta.shortcutDetails?.targetId) {
            resolvedFolderId = meta.shortcutDetails.targetId;
          }
        } catch {}

        const data = await buildBreadcrumbs(drive, rootFolderId, resolvedFolderId);
        const crumbs = data.breadcrumbs;
        if (crumbs.length > 0) {
          const names = crumbs.map((c) => c.name || "").filter(Boolean);
          const estIdx = names.findIndex((n) => /^EST(\s*[-_]?\s*([0-9]+|[IVXLCDM]+))?$/i.test(n));
          const rel = estIdx >= 0 ? names.slice(estIdx) : names;
          if (rel[0]) examName = rel[0];
          if (rel[1]) governorate = rel[1];
          if (rel[2]) center = rel[2];
          if (rel[3]) building = rel[3];
        }

        // Search counterpart exam in Live Google Drive (shortcut folders included)
        const counterpartMap = new Map<string, { studentCount: number; subjectsText: string }>();
        try {
          const estIdx = crumbs.findIndex((c) => /^EST(\s*[-_]?\s*([0-9]+|[IVXLCDM]+))?$/i.test(c.name || ""));
          if (estIdx >= 1) {
            const cycleId = crumbs[estIdx - 1]?.id;
            const curExam = crumbs[estIdx]?.name || "EST 1";
            const isEst1Cur = !/EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(curExam);
            const cpExamName = isEst1Cur ? "EST 2" : "EST 1";
            const subPath = crumbs.slice(estIdx + 1).map((c) => (c.name || "").trim());

            if (cycleId) {
              const cycleChildren = await listStickerChildren(drive, cycleId);
              let curParentId: string | undefined = cycleChildren.folders.find(
                (f) => f.name.toLowerCase() === cpExamName.toLowerCase(),
              )?.id;

              if (curParentId) {
                for (const seg of subPath) {
                  const children = await listStickerChildren(drive, curParentId);
                  curParentId = children.folders.find(
                    (f) => f.name.trim().toLowerCase() === seg.toLowerCase(),
                  )?.id;
                  if (!curParentId) break;
                }
              }

              if (curParentId) {
                const cpChildren = await listStickerChildren(drive, curParentId);
                const cpFloors = cpChildren.folders.filter((f) => isFloorFolderName(f.name));
                const cpRooms = cpFloors.length > 0
                  ? (await Promise.all(cpFloors.map((fl) => listStickerChildren(drive, fl.id))))
                      .flatMap((c) => c.folders)
                  : cpChildren.folders;

                await Promise.all(cpRooms.map(async (rm) => {
                  const rKey = rm.name.trim().toLowerCase();
                  if (counterpartMap.has(rKey)) return;
                  let sCount = 0;
                  let sText = "";
                  try {
                    const rmChildren = await listStickerChildren(drive, rm.id);
                    for (const f of rmChildren.files) {
                      const parsed = parseEstRoomFileName(f.name);
                      if (parsed) {
                        sCount = parsed.totalStudents;
                        sText = parsed.breakdownText;
                        break;
                      }
                    }
                  } catch {}
                  counterpartMap.set(rKey, { studentCount: sCount, subjectsText: sText });
                }));
              }
            }
          }
        } catch {}

        // Discover the real floor/room hierarchy under the selected folder.
        try {
          let scanFolderId = folderId;
          let children = await listStickerChildren(drive, scanFolderId);

          // Check if this folder has an inner folder with the exact same name (School pattern: Center -> Building)
          const currentFolderName = crumbs[crumbs.length - 1]?.name || "";
          const norm = (s: string) => (s || "").trim().toLowerCase();
          const innerSameName = children.folders.find((f) => norm(f.name) === norm(currentFolderName));
          if (innerSameName) {
            try {
              const innerChildren = await listStickerChildren(drive, innerSameName.id);
              if (innerChildren.folders.length > 0) {
                scanFolderId = innerSameName.id;
                children = innerChildren;
              }
            } catch {}
          }

          const floorSubs = children.folders.filter((f) => isFloorFolderName(f.name));
          const directRooms = children.folders.filter(
            (f) =>
              isRoomFolderName(f.name) ||
              /^(\d{1,4}[A-Za-z]?|[A-Za-z]\d{1,4}|room\s*\d+|قاعة\s*\d+)$/i.test(f.name || ""),
          );

          interface LiveRoom {
            room: string;
            studentCount?: number;
            subjectsText?: string;
            est1Count?: number;
            est1Subjects?: string;
            est2Count?: number;
            est2Subjects?: string;
          }

          const makeRoom = async (rm: { id: string; name: string }): Promise<LiveRoom> => {
            const rName = rm.name.trim();
            const rKey = rName.toLowerCase();
            let stdCount: number | undefined;
            let subjText: string | undefined;
            try {
              const rmChildren = await listStickerChildren(drive, rm.id);
              for (const f of rmChildren.files) {
                const parsed = parseEstRoomFileName(f.name);
                if (parsed) {
                  stdCount = parsed.totalStudents;
                  subjText = parsed.breakdownText;
                  break;
                }
              }
            } catch {}
            const cp = counterpartMap.get(rKey);
            const isCurEst1 = !/EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(examName);
            return {
              room: rName,
              studentCount: stdCount,
              subjectsText: subjText,
              est1Count: isCurEst1 ? stdCount : cp?.studentCount,
              est1Subjects: isCurEst1 ? subjText : cp?.subjectsText,
              est2Count: isCurEst1 ? cp?.studentCount : stdCount,
              est2Subjects: isCurEst1 ? cp?.subjectsText : subjText,
            };
          };

          if (floorSubs.length > 0) {
            // Merge duplicate floor folders by name.
            const floorGroups = new Map<string, { displayName: string; folders: Array<{ id: string; name: string }> }>();
            for (const fl of floorSubs) {
              const key = fl.name.trim().toLowerCase();
              const group = floorGroups.get(key) || { displayName: fl.name.trim(), folders: [] };
              group.folders.push(fl);
              floorGroups.set(key, group);
            }

            for (const group of floorGroups.values()) {
              const roomsMap = new Map<string, LiveRoom>();

              for (const fl of group.folders) {
                const flChildren = await listStickerChildren(drive, fl.id);
                for (const rm of flChildren.folders) {
                  const key = rm.name.trim().toLowerCase();
                  if (!key || roomsMap.has(key)) continue;
                  roomsMap.set(key, await makeRoom(rm));
                }

                // Registers stored directly inside a floor folder.
                for (const f of flChildren.files) {
                  const parsed = parseEstRoomFileName(f.name);
                  const roomName = (parsed?.room || f.name.replace(/\.[^/.]+$/, "")).trim();
                  const key = roomName.toLowerCase();
                  if (!key || roomsMap.has(key)) continue;
                  const cp = counterpartMap.get(key);
                  const isCurEst1 = !/EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(examName);
                  roomsMap.set(key, {
                    room: roomName,
                    studentCount: parsed?.totalStudents,
                    subjectsText: parsed?.breakdownText,
                    est1Count: isCurEst1 ? parsed?.totalStudents : cp?.studentCount,
                    est1Subjects: isCurEst1 ? parsed?.breakdownText : cp?.subjectsText,
                    est2Count: isCurEst1 ? cp?.studentCount : parsed?.totalStudents,
                    est2Subjects: isCurEst1 ? cp?.subjectsText : parsed?.breakdownText,
                  });
                }
              }

              const sortedRooms = Array.from(roomsMap.values()).sort((a, b) =>
                a.room.localeCompare(b.room, undefined, { numeric: true }),
              );
              if (sortedRooms.length > 0) {
                floors.push({
                  floor: group.displayName,
                  rooms: sortedRooms,
                  totalStudents: sortedRooms.reduce((s, r) => s + (r.studentCount || 0), 0),
                  est1Students: sortedRooms.reduce((s, r) => s + (r.est1Count || 0), 0),
                  est2Students: sortedRooms.reduce((s, r) => s + (r.est2Count || 0), 0),
                });
              }
            }
            floors.sort((a, b) => getFloorSortWeight(a.floor) - getFloorSortWeight(b.floor));
          } else if (directRooms.length > 0) {
            const rooms = await Promise.all(directRooms.map(makeRoom));
            floors.push({
              floor: "General Floor",
              rooms,
              totalStudents: rooms.reduce((s, r) => s + (r.studentCount || 0), 0),
              est1Students: rooms.reduce((s, r) => s + (r.est1Count || 0), 0),
              est2Students: rooms.reduce((s, r) => s + (r.est2Count || 0), 0),
            });
          }
        } catch {}
      }
    }

    // No hard-coded/demo fallback: empty drive data stays empty.

    if (floors.length > 0) {
      totalRooms = floors.reduce((sum, f) => sum + f.rooms.length, 0);
      totalStudents = floors.reduce((sum, f) => sum + (f.totalStudents || 0), 0);
      roomNames = floors.flatMap((f) => f.rooms.map((r) => (typeof r === "string" ? r : r.room)));
    } else {
      totalRooms = totalRooms || (roomNames.length > 0 ? roomNames.length : 0);
      totalStudents = totalStudents || 0;
    }

    const options: LogisticsStickerOptions = {
      examName,
      governorate,
      center,
      building,
      date,
      totalRooms,
      totalStudents,
      roomNames: roomNames.length > 0 ? roomNames : undefined,
      floors: floors.length > 0 ? floors : undefined,
      boxNumber: Number(url.searchParams.get("boxNumber")) || 1,
      totalBoxes: Number(url.searchParams.get("totalBoxes")) || 1,
      securitySeal: url.searchParams.get("securitySeal") || undefined,
      notes: url.searchParams.get("notes") || undefined,
    };

    if (type === "hierarchy") {
      const norm = normalizeFloorsData(options);
      const totalFloorsCount = norm.length;
      const allRooms = norm.flatMap((f) => f.rooms);
      const totalRoomsCount = allRooms.length;
      const est1Total = norm.reduce((s, f) => s + (f.est1Students || 0), 0);
      const est2Total = norm.reduce((s, f) => s + (f.est2Students || 0), 0);
      const grandTotal = est1Total + est2Total;

      return NextResponse.json({
        governorate: options.governorate || governorate,
        center: options.center || center,
        building: options.building || building,
        examName: options.examName || examName,
        date: options.date || date,
        totalFloors: totalFloorsCount,
        totalRooms: totalRoomsCount,
        est1TotalCandidates: est1Total,
        est2TotalCandidates: est2Total,
        grandTotalCandidates: grandTotal,
        floors: norm,
      });
    }

    let pdfBytes: Uint8Array;
    let filename: string;

    switch (type) {
      case "carton":
        pdfBytes = await generateBuildingCartonStickerPdf(options);
        filename = `Carton-${options.building}.pdf`;
        break;
      case "bag":
        pdfBytes = await generateExamBagChecklistPdf(options);
        filename = `Bag-Checklist-${options.building}.pdf`;
        break;
      case "manifest":
        pdfBytes = await generateMasterBuildingManifestPdf(options);
        filename = `Master-Manifest-${options.building}.pdf`;
        break;
      case "clean_skin_log":
        pdfBytes = await generateCleanSkinDispatchLogPdf(options);
        filename = `Clean-Skin-Log-${options.building}.pdf`;
        break;
      case "clean_skin_master":
        pdfBytes = await generateCleanSkinMasterPdf(options);
        filename = `Clean-Skin-Master-${options.building}.pdf`;
        break;
      case "clean_skin_subjects":
        pdfBytes = await generateCleanSkinSubjectStickersPdf(options);
        filename = `Clean-Skin-Subjects-${options.building}.pdf`;
        break;
      case "bundle":
      default:
        pdfBytes = await generateCompleteLogisticsBundlePdf(options);
        filename = `Logistics-Bundle-${options.building}.pdf`;
        break;
    }

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename.replace(/[/\\?%*:|"<>]/g, "_"))}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession(request);
    enforceRateLimit(request, "logistics:generate:post", 120, 60_000);

    const body = await request.json().catch(() => ({}));
    const type = body.type || "batch-carton";

    if (type === "batch-carton") {
      const cartons: LogisticsStickerOptions[] = Array.isArray(body.cartons) ? body.cartons : [];
      if (cartons.length === 0) {
        return NextResponse.json({ error: "No cartons provided for batch print" }, { status: 400 });
      }

      const pdfBytes = await generateBatchBuildingCartonStickersPdf(cartons);
      const filename = `Batch-Cartons-${body.examName || "EST"}-${Date.now()}.pdf`;

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    }

    // Single carton print via POST
    const options: LogisticsStickerOptions = {
      examName: body.examName || "EST 1",
      governorate: body.governorate || "Alexandria",
      center: body.center || "Main Center",
      building: body.building || "Building HQ",
      date: body.date || "December 2026",
      boxNumber: Number(body.boxNumber) || 1,
      totalBoxes: Number(body.totalBoxes) || 1,
      totalRooms: Number(body.totalRooms) || undefined,
      totalStudents: Number(body.totalStudents) || undefined,
      securitySeal: body.securitySeal || undefined,
      floors: Array.isArray(body.floors) ? body.floors : undefined,
      roomNames: Array.isArray(body.roomNames) ? body.roomNames : undefined,
    };

    const pdfBytes = await generateBuildingCartonStickerPdf(options);
    const filename = `Carton-${options.building || "Building"}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename.replace(/[/\\?%*:|"<>]/g, "_"))}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}


