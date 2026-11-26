import {
  parseSchoolFolderName,
  stripGovernorateFromName,
} from "./est-reference-data";
import { isFloorFolderName } from "./register-utils";
import { getRoomExamCounts, type RoomSubjectCount } from "./est-room-data";

export type StickerLevel = "root" | "governorate" | "center" | "building" | "building_head" | "floor" | "room" | "custom";

export interface StickerFieldItem {
  key: "exam" | "governorate" | "center" | "building" | "floor" | "room";
  label: string;       // e.g. "Center", "Building", "Floor", "Room"
  labelAr: string;     // e.g. "السنتر", "المبنى", "الدور", "القاعة"
  value: string;
}

export interface StickerSubfolderInfo {
  childCount?: number;
  childLabel?: string;
  childNames?: string[];
  childFiles?: Array<{ name: string }> | string[];
  totalRooms?: number;
  totalStudents?: number;
  litCount?: number;
  mathCount?: number;
  essayCount?: number;
  hasEssay?: boolean;
  subjects?: RoomSubjectCount[];
  breakdownText?: string;
  examDate?: string;
  examDay?: string;
}

export interface StickerContent {
  level: StickerLevel;
  lines: string[];
  rawLines: string[];
  cleanChain: string[];
  examName: string;
  governorate?: string;
  center?: string;
  building?: string;
  floor?: string;
  room?: string;
  fields: StickerFieldItem[];
  isHead?: boolean;
  isExamDossier?: boolean;
  isFloorBag?: boolean;
  // Dynamic subfolder counts
  childCount?: number;
  childLabel?: string;
  childNames?: string[];
  floorDetails?: Array<{ floor: string; roomCount: number; studentCount?: number }>;
  totalRooms?: number;
  // Room candidate counts & breakdown (EST 1 & EST 2)
  examType?: "EST 1" | "EST 2" | "EST";
  subjects?: RoomSubjectCount[];
  breakdownText?: string;
  totalStudents?: number;
  litCount?: number;
  mathCount?: number;
  essayCount?: number;
  hasEssay?: boolean;
  examDate?: string;
  examDay?: string;
}

/**
 * Builds the structured content and lines required for an EST hierarchy sticker:
 *
 * Each level contains clear labels:
 * - Center : [Center Name]
 * - Building : [Building Name]
 * - Floor : [Floor]
 * - Room : [Room Number]
 * - Governorate : [Governorate Name]
 *
 * With the official EST Logo at the top of the sticker.
 */
export function buildStickerContent(
  rawChain: Array<{ name?: string | null } | string>,
  subfolderInfo?: StickerSubfolderInfo,
  hints?: { isSchool?: boolean },
): StickerContent {
  let chain = (rawChain || [])
    .map((item) => (typeof item === "string" ? item : item?.name ?? ""))
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  if (chain.length === 0) {
    throw new Error("Cannot generate sticker for empty folder hierarchy");
  }

  // Drop generic root folder names if they appear at the top
  const GENERIC_ROOTS =
    /^(root|my drive|drive|demo drive|google drive|file manager app|december\s*2026|october\s*2026|november\s*2026|est\s*numbers.*|\b(oct|nov|dec|jan|feb|mar|apr|may|jun|jul|aug|sep)\s*\d{4}\b)$/i;

  // Find index of the EST root folder (e.g. "EST 1", "EST 2", "EST - 1", "EST I", "EST")
  const isEstRoot = (name: string) =>
    /^EST(\s*[-_]?\s*([0-9]+|[IVXLCDM]+|[A-Za-z0-9\s,._-]+))?$/i.test(name.trim());
  const estIndex = chain.findIndex((name) => isEstRoot(name));

  // If an EST root ancestor exists, slice from it downwards
  let relevantChain = estIndex >= 0 ? chain.slice(estIndex) : chain.filter((c) => !GENERIC_ROOTS.test(c));
  if (relevantChain.length === 0) {
    relevantChain = chain;
  }

  const examName = isEstRoot(relevantChain[0]) ? relevantChain[0] : "EST 1";

  // Case A: The selected folder itself is the EST root folder (e.g. EST 1)
  if (isEstRoot(relevantChain[0]) && relevantChain.length === 1) {
    return {
      level: "root",
      lines: ["EST", examName],
      rawLines: ["EST", examName],
      cleanChain: relevantChain,
      examName,
      fields: [{ key: "exam", label: "Exam", labelAr: "الاختبار", value: examName }],
    };
  }

  // If chain starts with EST folder, location levels start after it
  const locationChain = isEstRoot(relevantChain[0]) ? relevantChain.slice(1) : relevantChain;

  let level: StickerLevel = "custom";
  let governorate: string | undefined;
  let center: string | undefined;
  let building: string | undefined;
  let floor: string | undefined;
  let room: string | undefined;

  const isSchoolsGrouping = locationChain.length > 0 && /^schools$/i.test(locationChain[0]);

  if (isSchoolsGrouping) {
    const schoolChain = locationChain.slice(1);
    if (schoolChain.length === 0) {
      level = "root";
    } else if (schoolChain.length === 1) {
      // e.g. Schools / Al Alamiya Modern School - International (Qalyubia)
      level = "building";
      const parsed = parseSchoolFolderName(schoolChain[0]);
      building = parsed.schoolName || schoolChain[0];
      center = parsed.schoolName || schoolChain[0];
      governorate = parsed.governorate;
    } else if (schoolChain.length === 2) {
      // e.g. Schools / Al Alamiya... / 4th Floor
      level = "floor";
      const parsed = parseSchoolFolderName(schoolChain[0]);
      building = parsed.schoolName || schoolChain[0];
      center = parsed.schoolName || schoolChain[0];
      governorate = parsed.governorate;
      floor = schoolChain[1];
    } else if (schoolChain.length >= 3) {
      // e.g. Schools / Al Alamiya... / 4th Floor / G5-C
      level = "room";
      const parsed = parseSchoolFolderName(schoolChain[0]);
      building = parsed.schoolName || schoolChain[0];
      center = parsed.schoolName || schoolChain[0];
      governorate = parsed.governorate;
      floor = schoolChain[1];
      room = schoolChain[2];
    }
  } else if (locationChain.length === 1) {
    level = "governorate";
    governorate = locationChain[0];
  } else {
    // locationChain has at least 2 items: [Governorate, SecondLevel, ...]
    governorate = locationChain[0];
    const secondLevel = locationChain[1];
    const thirdLevel = locationChain[2];
    const fourthLevel = locationChain[3];
    const fifthLevel = locationChain[4];

    const norm = (s?: string) => (s || "").trim().toLowerCase();
    const isRepeatedSchoolName =
      Boolean(thirdLevel) && norm(secondLevel) === norm(thirdLevel);

    const isCenterWithDistinctBuildings =
      /abu\s*qir|أبو\s*قير|sheraton|شيراتون|university|جامعة/i.test(secondLevel) &&
      Boolean(thirdLevel) &&
      !isFloorFolderName(thirdLevel) &&
      !isRepeatedSchoolName;

    // Check if secondLevel is a school:
    // 1. Repeated folder name: "Taymour English School" / "Taymour English School"
    // 2. hints.isSchool is true
    // 3. thirdLevel is a Floor directly
    // 4. Name contains school keywords and is NOT a known multi-building center
    const isSchool =
      isRepeatedSchoolName ||
      hints?.isSchool === true ||
      (thirdLevel ? isFloorFolderName(thirdLevel) : false) ||
      (!isCenterWithDistinctBuildings && /school|مدرسة|مدارس/i.test(secondLevel));

    if (isSchool) {
      // School name is both the test center and the building
      const parsed = parseSchoolFolderName(secondLevel);
      const cleanSchoolName = parsed.schoolName || stripGovernorateFromName(secondLevel);
      center = cleanSchoolName;
      building = cleanSchoolName;
      if (!governorate && parsed.governorate) {
        governorate = parsed.governorate;
      }

      if (isRepeatedSchoolName) {
        // Repeated folder hierarchy:
        // [Gov, School, School, Floor?, Room?]
        if (locationChain.length === 2 || locationChain.length === 3) {
          level = "building";
        } else if (locationChain.length === 4) {
          level = "floor";
          floor = fourthLevel;
        } else if (locationChain.length >= 5) {
          level = "room";
          floor = fourthLevel;
          room = fifthLevel;
        }
      } else {
        // Flattened school hierarchy:
        // [Gov, School, Floor?, Room?]
        if (locationChain.length === 2) {
          level = "building";
        } else if (locationChain.length === 3) {
          level = "floor";
          floor = thirdLevel;
        } else if (locationChain.length >= 4) {
          level = "room";
          floor = thirdLevel;
          room = fourthLevel;
        }
      }
    } else {
      // University / Multi-building center (Governorate -> Center -> Building -> Floor -> Room)
      center = secondLevel;

      if (locationChain.length === 2) {
        level = "center";
      } else if (locationChain.length === 3) {
        level = "building";
        building = thirdLevel;
      } else if (locationChain.length === 4) {
        level = "floor";
        building = thirdLevel;
        floor = fourthLevel;
      } else if (locationChain.length >= 5) {
        level = "room";
        building = thirdLevel;
        floor = fourthLevel;
        room = fifthLevel;
      }
    }
  }

  const fields: StickerFieldItem[] = [];
  if (governorate) {
    fields.push({ key: "governorate", label: "Governorate", labelAr: "المحافظة", value: governorate });
  }
  if (center) {
    fields.push({ key: "center", label: "Center", labelAr: "السنتر", value: center });
  }
  if (building) {
    fields.push({ key: "building", label: "Building", labelAr: "المبنى", value: building });
  }
  if (floor) {
    fields.push({ key: "floor", label: "Floor", labelAr: "الدور", value: floor });
  }
  if (room) {
    fields.push({ key: "room", label: "Room", labelAr: "القاعة", value: room });
  }

  // Labeled lines with clean format: "Center : Abu Qir", "Floor : 2nd Floor", etc.
  const lines = ["EST", ...fields.map((f) => `${f.label} : ${f.value}`)];
  const rawLines = ["EST", ...locationChain];

  // All structural counts come from the live folder listing supplied by the
  // caller. Never fall back to hard-coded reference/demo data.
  const childCount = subfolderInfo?.childCount ?? 0;
  const childLabel = subfolderInfo?.childLabel ?? "";
  const childNames = subfolderInfo?.childNames ?? [];
  const totalRooms = subfolderInfo?.totalRooms ?? 0;

  let totalStudents = subfolderInfo?.totalStudents;
  let litCount = subfolderInfo?.litCount;
  let mathCount = subfolderInfo?.mathCount;
  let essayCount = subfolderInfo?.essayCount;
  let hasEssay = subfolderInfo?.hasEssay;
  let examDate = subfolderInfo?.examDate;
  let examDay = subfolderInfo?.examDay;
  let subjects = subfolderInfo?.subjects;
  let breakdownText = subfolderInfo?.breakdownText;
  let examType: "EST 1" | "EST 2" | "EST" | undefined;

  if (level === "room" && room) {
    if (typeof totalStudents !== "number" || !subjects || subjects.length === 0) {
      const folderFiles = subfolderInfo?.childFiles?.map((f) =>
        typeof f === "string" ? { name: f } : f
      );
      const counts = getRoomExamCounts({
        room,
        building,
        center,
        governorate,
        floor,
        folderFiles,
        examName,
      });
      totalStudents = counts.totalStudents;
      litCount = counts.litCount;
      mathCount = counts.mathCount;
      essayCount = counts.essayCount;
      hasEssay = counts.hasEssay;
      subjects = counts.subjects;
      breakdownText = counts.breakdownText;
      examType = counts.examType;
    }
  }

  return {
    level,
    lines,
    rawLines,
    cleanChain: relevantChain,
    examName,
    governorate,
    center,
    building,
    floor,
    room,
    fields,
    childCount,
    childLabel,
    childNames,
    totalRooms,
    examType,
    subjects,
    breakdownText,
    totalStudents,
    litCount,
    mathCount,
    essayCount,
    hasEssay,
    examDate,
    examDay,
  };
}
