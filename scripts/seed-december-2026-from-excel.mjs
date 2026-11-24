import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import fs from "fs";

const prisma = new PrismaClient();

function normalizeFloorTitle(floorStr) {
  const clean = floorStr.trim();
  if (/^ground$/i.test(clean)) return "Ground";
  if (/^basement$/i.test(clean)) return "Basement";
  if (/^mezzanine$/i.test(clean)) return "Mezzanine";
  const m = clean.match(/^(\d+(?:st|nd|rd|th))\s*(floor)?$/i);
  if (m) {
    return `${m[1]} Floor`;
  }
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function extractFloorAndRoom(rawRoom, center) {
  if (!rawRoom) return { floor: "1st Floor", room: "Room" };
  const raw = String(rawRoom).trim();

  // Explicit floor in text: e.g. '3rd floor 12A', '1st floor Room 1', 'Ground Floor 5'
  const floorMatch = raw.match(
    /^((?:(?:\d+(?:st|nd|rd|th))\s*floor|ground(?:\s*floor)?|basement|mezzanine))\s*(?:[-_:,]\s*)?(.*)$/i,
  );
  if (floorMatch) {
    let fl = floorMatch[1].trim();
    if (/^ground/i.test(fl)) fl = "Ground";
    else if (/^basement/i.test(fl)) fl = "Basement";
    else if (/^mezzanine/i.test(fl)) fl = "Mezzanine";
    else {
      const m = fl.match(/^(\d+(?:st|nd|rd|th))\s*(floor)?$/i);
      if (m) fl = `${m[1]} Floor`;
    }
    return { floor: fl, room: floorMatch[2].trim() || raw };
  }

  // St. Fatima Badr: 4101.. -> 1st Floor, 4106.. -> 2nd Floor, 4114.. -> 3rd Floor
  if (/^410[1-5]$/.test(raw)) return { floor: "1st Floor", room: "Room " + raw };
  if (/^41(?:0[6-9]|1[0-3])$/.test(raw)) return { floor: "2nd Floor", room: "Room " + raw };
  if (/^41(?:1[4-9]|20)$/.test(raw)) return { floor: "3rd Floor", room: "Room " + raw };

  // Pure 3-digit: 202 -> 2nd Floor, 304 -> 3rd Floor, etc.
  const numMatch = raw.match(/^([1-9])(\d{2})$/);
  if (numMatch) {
    const digit = parseInt(numMatch[1], 10);
    const suffix =
      digit === 1
        ? "1st Floor"
        : digit === 2
          ? "2nd Floor"
          : digit === 3
            ? "3rd Floor"
            : digit === 4
              ? "4th Floor"
              : digit === 5
                ? "5th Floor"
                : `${digit}th Floor`;
    return { floor: suffix, room: raw };
  }

  // Future University Business: C1.x Basement, C3.x 1st Floor, C4.x 2nd Floor, C5.x 3rd Floor
  if (/business/i.test(center || "")) {
    if (/^C1\./i.test(raw)) return { floor: "Basement", room: raw };
    if (/^C3\./i.test(raw)) return { floor: "1st Floor", room: raw };
    if (/^C4\./i.test(raw)) return { floor: "2nd Floor", room: raw };
    if (/^C5\./i.test(raw)) return { floor: "3rd Floor", room: raw };
  }

  // Future University Political Sc: F1.x 1st Floor, F2.x 2nd Floor, F3.x 3rd Floor, F4.x 4th Floor
  if (/political/i.test(center || "")) {
    if (/^F1\./i.test(raw)) return { floor: "1st Floor", room: raw };
    if (/^F2\./i.test(raw)) return { floor: "2nd Floor", room: raw };
    if (/^F3\./i.test(raw)) return { floor: "3rd Floor", room: raw };
    if (/^F4\./i.test(raw)) return { floor: "4th Floor", room: raw };
  }

  // Letter + digit: A101 -> 1st Floor, A301 -> 3rd Floor, B005 -> Ground, B102 -> 1st Floor, B201 -> 2nd Floor
  const letterDigitMatch = raw.match(/^[A-Za-z]+([0-9])/);
  if (letterDigitMatch) {
    const digit = parseInt(letterDigitMatch[1], 10);
    let fl = "1st Floor";
    if (digit === 0) fl = "Ground";
    else if (digit === 1) fl = "1st Floor";
    else if (digit === 2) fl = "2nd Floor";
    else if (digit === 3) fl = "3rd Floor";
    else if (digit === 4) fl = "4th Floor";
    else if (digit === 5) fl = "5th Floor";
    else fl = `${digit}th Floor`;
    return { floor: fl, room: raw };
  }

  // Hotep: Seniors -> 3rd Floor, Juniors -> 2nd Floor
  if (/hotep/i.test(center || "")) {
    if (/senior/i.test(raw)) return { floor: "3rd Floor", room: raw };
    if (/junior/i.test(raw)) return { floor: "2nd Floor", room: raw };
  }

  // Rawasy Misr: 2nd Floor
  if (/rawasy/i.test(center || "")) {
    return { floor: "2nd Floor", room: raw };
  }

  return { floor: "1st Floor", room: raw };
}

async function main() {
  const filePath = fs.existsSync("./src/lib/assets/Stats-per-Room.xlsx")
    ? "./src/lib/assets/Stats-per-Room.xlsx"
    : "//192.168.1.230/Dev/printing/Stats per Room.xlsx";
  console.log(`Reading Excel file from ${filePath}...`);

  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets["02-Stats per Room"] || wb.Sheets[wb.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet);

  console.log(`Total rows in Excel sheet: ${rawData.length}`);

  const est1Rows = [];
  const est2Rows = [];

  let lastGov = "Alexandria";

  for (let i = 0; i < rawData.length; i++) {
    const r = rawData[i];
    const rawGov = String(r["Governorate AR"] || "").trim();
    if (rawGov && !/^total$/i.test(rawGov)) {
      lastGov = rawGov;
    }

    const center = String(r["Center"] || "").trim();
    const rawRoom = String(r["Room"] || "").trim();

    // Skip empty or total rows
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
    const doubleRooms = Number(r["Double Rooms"]) || 0;
    const proctorsEst1 = Number(r["Proctors EST I"]) || 0;
    const proctorsEst2 = Number(r["Proctors EST II"]) || 0;
    const maxEst2 = Number(r["Max number for EST II "]) || 0;

    // Cross-exam subjects text for logistics cards
    const est1SubjParts = [];
    if (est1Students > 0) {
      est1SubjParts.push(`Literacy: ${est1Students}`, `Math: ${est1Students}`);
      if (withEssay > 0) est1SubjParts.push(`Essay: ${withEssay}`);
    }
    const est1SubjectsText = est1SubjParts.join("  |  ");

    const est2SubjParts = [];
    if (m1 > 0) est2SubjParts.push(`Math 1: ${m1}`);
    if (m2 > 0) est2SubjParts.push(`Math 2: ${m2}`);
    if (bio > 0) est2SubjParts.push(`Biology: ${bio}`);
    if (chem > 0) est2SubjParts.push(`Chemistry: ${chem}`);
    if (phy > 0) est2SubjParts.push(`Physics: ${phy}`);
    const est2SubjectsText = est2SubjParts.join("  |  ");

    // 1. Check if row belongs to EST 1
    if (est1Students > 0) {
      const breakdown = [];
      breakdown.push(`Literacy: ${est1Students}`, `Math: ${est1Students}`);
      if (withEssay > 0) breakdown.push(`Essay: ${withEssay}`);
      if (withoutEssay > 0 && withEssay > 0) {
        breakdown.push(`(No Essay: ${withoutEssay}, Essay: ${withEssay})`);
      }

      est1Rows.push({
        id: `est1-row-${est1Rows.length + 1}`,
        index: est1Rows.length + 1,
        governorate: gov,
        center,
        floor,
        room,
        rawRoom,
        subjects: {
          LIT: est1Students,
          MATH: est1Students,
          ESSAY: withEssay,
        },
        totalStudents: est1Students,
        breakdownText: breakdown.join("  |  "),
        withoutEssay,
        withEssay,
        doubleRooms,
        proctors: proctorsEst1,
        est1Count: est1Students,
        est1Subjects: est1SubjectsText,
        est2Count: est2Students,
        est2Subjects: est2SubjectsText,
      });
    }

    // 2. Check if row belongs to EST 2
    if (est2Students > 0 || m1 > 0 || m2 > 0 || bio > 0 || chem > 0 || phy > 0) {
      const breakdown = [];
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
        floor,
        room,
        rawRoom,
        subjects: {
          MATH1: m1,
          MATH2: m2,
          BIO: bio,
          CHEM: chem,
          PHY: phy,
        },
        totalStudents,
        breakdownText: breakdown.join("  |  "),
        doubleRooms,
        proctors: proctorsEst2,
        maxNumber: maxEst2,
        est1Count: est1Students,
        est1Subjects: est1SubjectsText,
        est2Count: totalStudents,
        est2Subjects: est2SubjectsText,
      });
    }
  }

  console.log(`Parsed EST 1 rooms: ${est1Rows.length}`);
  console.log(`Parsed EST 2 rooms: ${est2Rows.length}`);

  // Summary stats helper
  const calcStats = (rows) => {
    const govs = new Set();
    const centers = new Set();
    const floors = new Set();
    const subjectTotals = {};

    rows.forEach((r) => {
      govs.add(r.governorate);
      centers.add(r.center);
      floors.add(`${r.governorate}::${r.center}::${r.floor}`);
      Object.entries(r.subjects || {}).forEach(([code, count]) => {
        subjectTotals[code] = (subjectTotals[code] || 0) + count;
      });
    });

    const totalStudents = rows.reduce((s, r) => s + r.totalStudents, 0);

    return {
      totalGovernorates: govs.size,
      totalCenters: centers.size,
      totalFloors: floors.size,
      totalRooms: rows.length,
      totalStudents,
      subjectTotals,
      governoratesList: Array.from(govs),
      centersList: Array.from(centers),
    };
  };

  const est1Stats = calcStats(est1Rows);
  const est2Stats = calcStats(est2Rows);

  console.log("EST 1 Stats:", est1Stats);
  console.log("EST 2 Stats:", est2Stats);

  // 1. Upsert EST 1 - December 2026
  const existingEst1 = await prisma.estExamRound.findFirst({
    where: { name: "EST 1 - December 2026" },
  });

  const est1Data = {
    name: "EST 1 - December 2026",
    examType: "EST 1",
    roundDate: new Date("2026-12-11T00:00:00Z"),
    roundDay: "Friday",
    cycleName: "December 2026",
    fileName: "Stats per Room.xlsx",
    sheetData: est1Rows,
    summaryStats: est1Stats,
    status: "active",
  };

  if (existingEst1) {
    console.log("Updating existing EST 1 round...");
    await prisma.estExamRound.update({
      where: { id: existingEst1.id },
      data: est1Data,
    });
    console.log("Updated EST 1 round ID:", existingEst1.id);
  } else {
    console.log("Creating new EST 1 round...");
    const created = await prisma.estExamRound.create({ data: est1Data });
    console.log("Created EST 1 round ID:", created.id);
  }

  // 2. Upsert EST 2 - December 2026
  const existingEst2 = await prisma.estExamRound.findFirst({
    where: { name: "EST 2 - December 2026" },
  });

  const est2Data = {
    name: "EST 2 - December 2026",
    examType: "EST 2",
    roundDate: new Date("2026-12-12T00:00:00Z"),
    roundDay: "Saturday",
    cycleName: "December 2026",
    fileName: "Stats per Room.xlsx",
    sheetData: est2Rows,
    summaryStats: est2Stats,
    status: "active",
  };

  if (existingEst2) {
    console.log("Updating existing EST 2 round...");
    await prisma.estExamRound.update({
      where: { id: existingEst2.id },
      data: est2Data,
    });
    console.log("Updated EST 2 round ID:", existingEst2.id);
  } else {
    console.log("Creating new EST 2 round...");
    const created = await prisma.estExamRound.create({ data: est2Data });
    console.log("Created EST 2 round ID:", created.id);
  }

  const allRounds = await prisma.estExamRound.findMany({
    select: { id: true, name: true, examType: true, summaryStats: true },
  });
  console.log("All DB Rounds now:", allRounds);
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
