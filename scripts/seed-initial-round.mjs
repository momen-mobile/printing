import { PrismaClient } from "@prisma/client";
import sampleData from "../src/lib/assets/est2-december-sample.json" with { type: "json" };

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

function extractFloorAndRoom(rawRoom) {
  if (!rawRoom) return { floor: "1st Floor", room: "Room" };
  const raw = rawRoom.trim();
  const floorMatch = raw.match(
    /^((?:(?:\d+(?:st|nd|rd|th))\s*floor|ground(?:\s*floor)?|basement|mezzanine))\s*(?:[-_:,]\s*)?(.*)$/i
  );
  if (floorMatch) {
    return {
      floor: normalizeFloorTitle(floorMatch[1].trim()),
      room: floorMatch[2].trim() || raw,
    };
  }
  return { floor: "1st Floor", room: raw };
}

async function main() {
  console.log("Seeding initial EST 2 December 2026 round...");
  
  const rows = [];
  const subjectTotals = { MATH1: 0, BIO: 0, CHEM: 0, MATH2: 0 };
  const uniqueGovs = new Set();
  const uniqueCenters = new Set();
  const uniqueFloors = new Set();

  for (let i = 1; i < sampleData.length; i++) {
    const r = sampleData[i];
    const gov = String(r[0] || "").trim();
    const center = String(r[1] || "").trim();
    const rawRoom = String(r[2] || "").trim();

    if (!gov || !center || gov.toLowerCase() === "total" || center.toLowerCase() === "total") continue;

    const { floor, room } = extractFloorAndRoom(rawRoom);
    const m1 = Number(r[3]) || 0;
    const bio = Number(r[4]) || 0;
    const chem = Number(r[5]) || 0;
    const m2 = Number(r[6]) || 0;

    subjectTotals.MATH1 += m1;
    subjectTotals.BIO += bio;
    subjectTotals.CHEM += chem;
    subjectTotals.MATH2 += m2;

    const subjects = { MATH1: m1, BIO: bio, CHEM: chem, MATH2: m2 };
    const totalStudents = Math.max(m1, bio, chem, m2, 0);

    const breakdownParts = [];
    if (m1 > 0) breakdownParts.push(`Math 1: ${m1}`);
    if (bio > 0) breakdownParts.push(`Biology: ${bio}`);
    if (chem > 0) breakdownParts.push(`Chemistry: ${chem}`);
    if (m2 > 0) breakdownParts.push(`Math 2: ${m2}`);

    uniqueGovs.add(gov);
    uniqueCenters.add(center);
    uniqueFloors.add(`${gov}::${center}::${floor}`);

    rows.push({
      id: `row-${rows.length + 1}`,
      index: rows.length + 1,
      governorate: gov,
      center,
      floor,
      room,
      rawRoom,
      subjects,
      totalStudents,
      breakdownText: breakdownParts.join("  |  "),
    });
  }

  const grandTotalStudents = rows.reduce((s, r) => s + r.totalStudents, 0);
  const stats = {
    totalGovernorates: uniqueGovs.size,
    totalCenters: uniqueCenters.size,
    totalFloors: uniqueFloors.size,
    totalRooms: rows.length,
    totalStudents: grandTotalStudents,
    subjectTotals,
    governoratesList: Array.from(uniqueGovs),
    centersList: Array.from(uniqueCenters),
  };

  const existing = await prisma.estExamRound.findFirst({
    where: { name: "EST 2 - December 2026" },
  });

  if (existing) {
    console.log("Updating existing round...");
    await prisma.estExamRound.update({
      where: { id: existing.id },
      data: {
        examType: "EST 2",
        roundDate: new Date("2026-12-12T00:00:00Z"),
        roundDay: "Saturday",
        cycleName: "December 2026",
        fileName: "EST II subjects December 2026.xlsx",
        sheetData: rows,
        summaryStats: stats,
      },
    });
    console.log("Updated round:", existing.id);
  } else {
    const created = await prisma.estExamRound.create({
      data: {
        name: "EST 2 - December 2026",
        examType: "EST 2",
        roundDate: new Date("2026-12-12T00:00:00Z"),
        roundDay: "Saturday",
        cycleName: "December 2026",
        fileName: "EST II subjects December 2026.xlsx",
        sheetData: rows,
        summaryStats: stats,
        status: "active",
      },
    });
    console.log("Created initial round:", created.id);
  }

  const count = await prisma.estExamRound.count();
  console.log("Total rounds in DB:", count);
  console.log("Parsed Stats:", stats);
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
