import type { drive_v3 } from "googleapis";
import { MIME, escapeDriveQuery } from "../file-utils";
import { isFloorFolderName, isRoomFolderName } from "./register-utils";

/**
 * Helpers that read the real EST folder hierarchy directly from Google Drive.
 *
 * The data may live in another shared drive and be exposed here as shortcuts,
 * so every query must:
 *   1. accept shortcut folders as children, and
 *   2. resolve a shortcut id to its target id before listing its children.
 *
 * No school / center / room names or counts are hard-coded anywhere here.
 */

export interface StickerDriveFolder {
  id: string;
  name: string;
}

export interface StickerDriveChildren {
  folders: StickerDriveFolder[];
  files: Array<{ name: string }>;
}

/** Resolve a (possibly chained) shortcut folder id to the real folder id. */
export async function resolveStickerFolderId(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<string> {
  let id = folderId;
  const seen = new Set<string>();

  for (let depth = 0; depth < 5; depth += 1) {
    if (seen.has(id)) break;
    seen.add(id);

    let file: drive_v3.Schema$File;
    try {
      const res = await drive.files.get({
        fileId: id,
        fields: "id,mimeType,shortcutDetails(targetId,targetMimeType)",
        supportsAllDrives: true,
      });
      file = res.data;
    } catch {
      break;
    }

    if (
      file.mimeType === MIME.shortcut &&
      file.shortcutDetails?.targetId
    ) {
      id = file.shortcutDetails.targetId;
      continue;
    }
    break;
  }

  return id;
}

/**
 * List direct children of a folder, counting shortcuts to folders as folders.
 * Shortcut folder ids are replaced with their target ids so callers can
 * continue traversing into the shared drive.
 */
export async function listStickerChildren(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<StickerDriveChildren> {
  const resolvedId = await resolveStickerFolderId(drive, folderId);
  const folders: StickerDriveFolder[] = [];
  const files: Array<{ name: string }> = [];
  const seenFolderIds = new Set<string>();

  let pageToken: string | undefined = undefined;
  do {
    const res = (await drive.files.list({
      q: `'${escapeDriveQuery(resolvedId)}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id, name, mimeType, shortcutDetails(targetId,targetMimeType))",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })) as { data: drive_v3.Schema$FileList };

    for (const file of res.data.files || []) {
      const name = (file.name || "").trim();
      if (!name) continue;

      const isShortcut = file.mimeType === MIME.shortcut;
      const effectiveMime = isShortcut
        ? file.shortcutDetails?.targetMimeType ?? ""
        : file.mimeType ?? "";

      if (effectiveMime === MIME.folder) {
        const targetId =
          (isShortcut ? file.shortcutDetails?.targetId : file.id) || file.id || "";
        if (targetId && !seenFolderIds.has(targetId)) {
          seenFolderIds.add(targetId);
          folders.push({ id: targetId, name });
        }
      } else {
        files.push({ name });
      }
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return { folders, files };
}

/** Human-readable label for the child level, derived from real child names. */
export function classifyChildLabel(names: string[]): string {
  if (names.some((name) => isFloorFolderName(name))) return "Floors";
  if (names.some((name) => /building|مبنى|faculty|كلية/i.test(name))) return "Buildings";
  if (names.some((name) => isRoomFolderName(name))) return "Rooms";
  return "Subfolders";
}

/**
 * Count room folders from a descendant tree. A room is a leaf folder that is
 * not a structural folder (center/building/floor/schools container).
 */
export function countRoomFolders(
  folders: Array<{ id: string; name: string }>,
  folderTree: Record<string, Array<{ id?: string | null }>>,
): number {
  const parentIds = new Set<string>();
  for (const children of Object.values(folderTree)) {
    for (const child of children) {
      if (child.id) parentIds.add(child.id);
    }
  }

  return folders.filter((folder) => {
    if (parentIds.has(folder.id)) return false; // has subfolders -> not a room
    const name = folder.name.trim();
    if (isFloorFolderName(name)) return false;
    if (/^(schools?|المدارس|مدارس|center|سنتر|مركز|buildings?|مبنى|control|كنترول|admin|إدارة)$/i.test(name)) {
      return false;
    }
    return true;
  }).length;
}

/**
 * Determine whether the folder directly below the city is a school
 * (center == building) or a multi-building test center.
 *
 * Uses only the live breadcrumb names/ids and the live child folders:
 *   - explicit school/college wording, or
 *   - a floor folder as its child, or
 *   - the next ancestor level being a floor folder.
 */
export async function inferSecondLevelIsSchool(
  drive: drive_v3.Drive | null,
  breadcrumbs: Array<{ id?: string; name?: string | null }>,
): Promise<boolean> {
  const isEstRoot = (name: string) =>
    /^EST(\s*[-_]?\s*([0-9]+|[IVXLCDM]+|[A-Za-z0-9\s,._-]+))?$/i.test(name.trim());

  const estIndex = breadcrumbs.findIndex((crumb) => isEstRoot(crumb.name || ""));
  const relevant = estIndex >= 0 ? breadcrumbs.slice(estIndex + 1) : breadcrumbs;
  const second = relevant[1];
  if (!second) return false;

  const name = (second.name || "").trim();
  if (/school|college|division|academy|مدرسة|مدارس/i.test(name)) return true;

  const third = (relevant[2]?.name || "").trim();
  if (third && isFloorFolderName(third)) return true;

  if (drive && second.id) {
    try {
      const { folders } = await listStickerChildren(drive, second.id);
      if (folders.some((folder) => isFloorFolderName(folder.name))) return true;
    } catch {
      // If the live lookup fails, fall back to the name-based decision above.
    }
  }

  return false;
}
