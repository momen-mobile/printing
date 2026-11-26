import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  generateBuildingCartonStickerPdf,
  generateBatchBuildingCartonStickersPdf,
  generateExamBagChecklistPdf,
  generateCleanSkinMasterPdf,
  generateMasterBuildingManifestPdf,
  generateCleanSkinDispatchLogPdf,
  generateCleanSkinSubjectStickersPdf,
  generateCompleteLogisticsBundlePdf,
  generateCenterDossierStickersPdf,
  normalizeFloorsData,
  splitCenterAndBuilding,
} from "../logistics-stickers-pdf";

describe("Logistics Stickers PDF Generator", () => {
  const baseData = {
    governorate: "Cairo",
    center: "Al-Salam Center",
    building: "Building A",
    examName: "EST I",
    date: "2026-12-15",
    totalRooms: 12,
    totalStudents: 360,
    roomNames: ["Room 101", "Room 102", "Room 103", "Room 104"],
    boxNumber: 1,
    totalBoxes: 3,
    securitySeal: "SEAL-987654",
  };

  it("merges duplicate floors and deduplicates rooms in normalizeFloorsData", () => {
    // Simulated duplicate input from multiple Drive folders
    const duplicatedFloors = [
      {
        floor: "3rd Floor",
        rooms: ["AD3A", "AD4A", "AD5A", "AD6A", "AD7A", "AD8A", "AD9A"],
      },
      {
        floor: "4th Floor",
        rooms: ["AD10A", "AD10C", "AD10D", "AD11A", "AD11B", "AD11C", "AD12A", "AD12B"],
      },
      {
        // Duplicate 4th Floor in reverse order
        floor: "4th Floor",
        rooms: ["AD12B", "AD12A", "AD11C", "AD11B", "AD11A", "AD10D", "AD10C", "AD10A"],
      },
      {
        // Duplicate 3rd Floor in reverse order
        floor: "3rd Floor",
        rooms: ["AD9A", "AD8A", "AD7A", "AD6A", "AD5A", "AD4A", "AD3A"],
      },
    ];

    const normalized = normalizeFloorsData({
      ...baseData,
      building: "Tiba Modern International Schools (Dakahlia)",
      floors: duplicatedFloors,
    });

    // Must be exactly 2 unique floors! NOT 4 floors!
    expect(normalized).toHaveLength(2);
    expect(normalized[0].floor).toBe("3rd Floor");
    expect(normalized[1].floor).toBe("4th Floor");

    // 3rd floor must have exactly 7 rooms in natural ascending order
    expect(normalized[0].rooms).toHaveLength(7);
    expect(normalized[0].rooms.map((r) => (typeof r === "string" ? r : r.room))).toEqual([
      "AD3A",
      "AD4A",
      "AD5A",
      "AD6A",
      "AD7A",
      "AD8A",
      "AD9A",
    ]);
    // With no files uploaded yet, student counts must strictly be 0 (no fake 25s)
    expect(normalized[0].totalStudents).toBe(0);

    // 4th floor must have exactly 8 rooms in natural ascending order
    expect(normalized[1].rooms).toHaveLength(8);
    expect(normalized[1].rooms.map((r) => (typeof r === "string" ? r : r.room))).toEqual([
      "AD10A",
      "AD10C",
      "AD10D",
      "AD11A",
      "AD11B",
      "AD11C",
      "AD12A",
      "AD12B",
    ]);
    expect(normalized[1].totalStudents).toBe(0);

    // Total rooms: 15, Total candidates: 0 pending upload (NOT fake 375 or 750)
    const totalRooms = normalized.reduce((sum, f) => sum + f.rooms.length, 0);
    const totalStudents = normalized.reduce((sum, f) => sum + f.totalStudents, 0);
    expect(totalRooms).toBe(15);
    expect(totalStudents).toBe(0);
  });

  it("never invents floors/rooms from a hard-coded school list", () => {
    const normalized = normalizeFloorsData({
      ...baseData,
      building: "Tiba Modern International Schools (Dakahlia)",
    });

    // Only the live room names supplied in the request are used.
    expect(normalized.reduce((s, f) => s + f.rooms.length, 0)).toBe(4);
    // Zero candidates until real register files are uploaded.
    expect(normalized.reduce((s, f) => s + f.totalStudents, 0)).toBe(0);
  });

  it("generates Building Carton Sticker PDF (A4 Landscape)", async () => {
    const pdfBytes = await generateBuildingCartonStickerPdf(baseData);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });

  it("generates Batch Building Carton Stickers PDF with 1 page per building carton", async () => {
    const cartons = [
      { ...baseData, building: "Taymour English School", boxNumber: 1 },
      { ...baseData, building: "Pioneers International School", boxNumber: 2 },
      { ...baseData, building: "Future International School", boxNumber: 3 },
    ];
    const pdfBytes = await generateBatchBuildingCartonStickersPdf(cartons);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    expect(pdfDoc.getPageCount()).toBe(3);
  });

  it("returns empty array and invents zero rooms when no rooms or floors provided", () => {
    const normalized = normalizeFloorsData({
      governorate: "Alexandria",
      center: "Empty Center",
      building: "Empty Building",
    });
    expect(normalized).toEqual([]);
  });

  it("generates Building Carton Sticker PDF with explicit floors and rooms directory", async () => {
    const pdfBytes = await generateBuildingCartonStickerPdf({
      ...baseData,
      building: "Pharmacy",
      floors: [
        {
          floor: "2nd Floor",
          rooms: [
            { room: "204", studentCount: 30 },
            { room: "205", studentCount: 25 },
            { room: "219", studentCount: 25 },
          ],
          totalStudents: 80,
        },
        {
          floor: "3rd Floor",
          rooms: [
            { room: "304", studentCount: 25 },
            { room: "305", studentCount: 25 },
          ],
          totalStudents: 50,
        },
      ],
    });
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });

  it("generates Exam Bag Checklist PDF (A4 Portrait)", async () => {
    const pdfBytes = await generateExamBagChecklistPdf(baseData);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });

  it("generates Clean Skin Master Packet as a 2-page PDF (Page 1: Manifest, Page 2: Dispatch Log)", async () => {
    const pdfBytes = await generateCleanSkinMasterPdf(baseData);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("generates standalone Master Center & Building Manifest PDF (Strictly 1 Page)", async () => {
    const pdfBytes = await generateMasterBuildingManifestPdf({
      ...baseData,
      building: "Tiba Modern International Schools (Dakahlia)",
    });
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("generates official EST II Master Manifest matching Director's layout with subject checkboxes and packing signatures", async () => {
    const est2PdfBytes = await generateMasterBuildingManifestPdf({
      examName: "EST 2 - December 2025",
      center: "Sheraton",
      building: "Logistics",
      date: "December 2025",
      roundDay: "Saturday",
      roundDateStr: "December 6, 2025",
      centerTotalRooms: 27,
      centerTotalStudents: 786,
      centerSubjectsMap: { MATH1: 471, BIO: 637, PHY: 9, MATH2: 29 },
      floors: [
        {
          floor: "2nd Floor",
          rooms: [
            { room: "201A", studentCount: 24, subjectsMap: { MATH1: 24, BIO: 24 } },
            { room: "202A", studentCount: 25, subjectsMap: { MATH1: 25, BIO: 25 } },
            { room: "203A", studentCount: 32, subjectsMap: { MATH1: 25, BIO: 15 } },
          ],
        },
        {
          floor: "3rd Floor",
          rooms: [
            { room: "302A", studentCount: 49, subjectsMap: { MATH1: 25, BIO: 24 } },
            { room: "304A", studentCount: 31, subjectsMap: { MATH1: 6, BIO: 25 } },
          ],
        },
      ],
    });

    expect(est2PdfBytes).toBeInstanceOf(Uint8Array);
    expect(est2PdfBytes.length).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(est2PdfBytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    // A4 Landscape per Director requirement: 841.89 x 595.28 pt
    expect(page.getWidth()).toBeCloseTo(841.89, 1);
    expect(page.getHeight()).toBeCloseTo(595.28, 1);
  });

  it("moves last floor to page 2 when page 1 is full (floor-aware pagination)", async () => {
    // 1st Floor (7 rooms), 2nd Floor (6 rooms), 3rd Floor (4 rooms)
    // Total rows = Center (1) + Building (1) + Floor1 (8) + Floor2 (7) + Floor3 (5) = 22 rows.
    // Instead of stuffing 22 rows onto Page 1, it cleanly moves Floor 3 to Page 2!
    const makeRooms = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, i) => ({
        room: `${prefix}${100 + i}`,
        studentCount: 20,
        subjectsMap: { LIT: 20, MATH: 20 },
      }));

    const pdfBytes = await generateMasterBuildingManifestPdf({
      examName: "EST I",
      governorate: "Cairo",
      center: "Arab Academy Sheraton",
      building: "Engineering Building B",
      roundDay: "Friday",
      roundDateStr: "December 11, 2026",
      floors: [
        { floor: "1st Floor", rooms: makeRooms(7, "B") },
        { floor: "2nd Floor", rooms: makeRooms(6, "B") },
        { floor: "3rd Floor", rooms: makeRooms(4, "B") },
      ],
    });

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("generates standalone Clean Skin Dispatch Log PDF (Strictly 1 Page)", async () => {
    const pdfBytes = await generateCleanSkinDispatchLogPdf(baseData);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("correctly separates center and building without duplicate repetition", () => {
    // Repeated center name in building
    const res1 = splitCenterAndBuilding(
      "Arab Academy Abu Qir",
      "Arab Academy Abu Qir Faculty of Engineering",
    );
    expect(res1.center).toBe("Arab Academy Abu Qir");
    expect(res1.building).toBe("Faculty of Engineering");
    expect(res1.isCampus).toBe(true);

    // Identical center and building with faculty
    const res2 = splitCenterAndBuilding(
      "Arab Academy Abu Qir Faculty of Engineering",
      "Arab Academy Abu Qir Faculty of Engineering",
    );
    expect(res2.center).toBe("Arab Academy Abu Qir");
    expect(res2.building).toBe("Faculty of Engineering");
    expect(res2.isCampus).toBe(true);

    // Standalone single school (venue name preserves 'School', label in UI/PDF is 'Test Center')
    const res3 = splitCenterAndBuilding(
      "Future International School",
      "Future International School",
    );
    expect(res3.center).toBe("Future International School");
    expect(res3.building).toBe("");
    expect(res3.isCampus).toBe(false);

    // Distinct campus building
    const res4 = splitCenterAndBuilding("Arab Academy Abu Qir", "Eng. Building B");
    expect(res4.center).toBe("Arab Academy Abu Qir");
    expect(res4.building).toBe("Eng. Building B");
    expect(res4.isCampus).toBe(true);
  });

  it("generates Clean Skin Quarter-A4 Subject Stickers PDF (EST I)", async () => {
    const pdfBytes = await generateCleanSkinSubjectStickersPdf({
      ...baseData,
      examName: "EST I",
    });
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });

  it("generates Clean Skin Quarter-A4 Subject Stickers PDF (EST II)", async () => {
    const pdfBytes = await generateCleanSkinSubjectStickersPdf({
      ...baseData,
      examName: "EST II",
    });
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });

  it("generates Complete Logistics Bundle PDF", async () => {
    const pdfBytes = await generateCompleteLogisticsBundlePdf(baseData);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(5000);
  });
});

import { extractLogisticsHierarchy } from "../register-utils";

describe("extractLogisticsHierarchy", () => {
  it("resolves full location hierarchy when inside room 200 in Menofia / Al Ryada University", () => {
    const breadcrumbs = [
      { id: "root", name: "File Manager App" },
      { id: "sess-1", name: "December 2026" },
      { id: "exam-1", name: "EST 1" },
      { id: "gov-1", name: "Menofia" },
      { id: "cnt-1", name: "Al Ryada University" },
      { id: "bld-1", name: "Science And Technology" },
      { id: "fl-1", name: "floor1" },
    ];
    const currentFolder = { id: "rm-200", name: "room 200" };

    const result = extractLogisticsHierarchy({ breadcrumbs, currentFolder });
    expect(result.cycle).toBe("December 2026");
    expect(result.exam).toBe("EST 1");
    expect(result.governorate).toBe("Menofia");
    expect(result.center).toBe("Al Ryada University");
    expect(result.building).toBe("Science And Technology");
    expect(result.buildingFolderId).toBe("bld-1");
  });

  it("resolves hierarchy when directly inside building folder", () => {
    const breadcrumbs = [
      { id: "root", name: "File Manager App" },
      { id: "sess-1", name: "December 2026" },
      { id: "exam-1", name: "EST 1" },
      { id: "gov-1", name: "Menofia" },
      { id: "cnt-1", name: "Al Ryada University" },
    ];
    const currentFolder = { id: "bld-1", name: "Science And Technology" };

    const result = extractLogisticsHierarchy({ breadcrumbs, currentFolder });
    expect(result.cycle).toBe("December 2026");
    expect(result.exam).toBe("EST 1");
    expect(result.governorate).toBe("Menofia");
    expect(result.center).toBe("Al Ryada University");
    expect(result.building).toBe("Science And Technology");
    expect(result.buildingFolderId).toBe("bld-1");
  });

  it("resolves hierarchy when in Schools branch", () => {
    const breadcrumbs = [
      { id: "root", name: "File Manager App" },
      { id: "sess-1", name: "December 2026" },
      { id: "exam-1", name: "EST 1" },
      { id: "sch-root", name: "Schools" },
      { id: "sch-1", name: "Taymour English School (Alexandria)" },
    ];
    const currentFolder = { id: "fl-1", name: "1st Floor" };

    const result = extractLogisticsHierarchy({ breadcrumbs, currentFolder });
    expect(result.cycle).toBe("December 2026");
    expect(result.exam).toBe("EST 1");
    expect(result.governorate).toBe("Schools");
    expect(result.center).toBe("Taymour English School (Alexandria)");
    expect(result.building).toBe("Taymour English School (Alexandria)");
    expect(result.buildingFolderId).toBe("sch-1");
  });

  it("generates Quarter A4 Center Dossier Stickers with EST 1 + EST 2 combined summary", async () => {
    const mockDossiers = [
      {
        center: "Taymour English School",
        governorate: "Alexandria",
        cycleName: "December 2026",
        est1: {
          isActive: true,
          examTitle: "EST 1",
          dayAndDate: "Friday, Dec 11",
          totalBuildings: 1,
          totalRooms: 11,
          totalStudents: 164,
          buildings: [
            {
              buildingName: "Taymour English School",
              floors: ["1st floor", "3rd Floor", "4th Floor"],
              roomCount: 11,
              studentCount: 164,
            },
          ],
        },
        est2: {
          isActive: true,
          examTitle: "EST 2",
          dayAndDate: "Saturday, Dec 12",
          totalBuildings: 1,
          totalRooms: 7,
          totalStudents: 178,
          buildings: [
            {
              buildingName: "Taymour English School",
              floors: ["3rd Floor", "4th Floor"],
              roomCount: 7,
              studentCount: 178,
            },
          ],
        },
      },
      {
        center: "Arab Academy Abu Qir",
        governorate: "Alexandria",
        cycleName: "December 2026",
        est1: {
          isActive: true,
          examTitle: "EST 1",
          dayAndDate: "Friday, Dec 11",
          totalBuildings: 2,
          totalRooms: 20,
          totalStudents: 391,
          buildings: [
            {
              buildingName: "Eng. Building B",
              floors: ["2nd Floor", "3rd Floor", "4th Floor", "5th Floor"],
              roomCount: 12,
              studentCount: 240,
            },
            {
              buildingName: "Pharmacy",
              floors: ["2nd Floor", "3rd Floor"],
              roomCount: 8,
              studentCount: 151,
            },
          ],
        },
        est2: {
          isActive: false,
          examTitle: "EST 2",
          dayAndDate: "Saturday, Dec 12",
          totalBuildings: 0,
          totalRooms: 0,
          totalStudents: 0,
          buildings: [],
        },
      },
    ];

    const pdfBytes = await generateCenterDossierStickersPdf(mockDossiers);
    const doc = await PDFDocument.load(pdfBytes);

    // 2 dossiers fit in 1 page (4 quadrants per page)
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });

  it("handles 5 dossiers across 2 pages with 4 per page chunking", async () => {
    const mockSingle = {
      center: "Center A",
      governorate: "Cairo",
      cycleName: "December 2026",
      est1: {
        isActive: true,
        examTitle: "EST 1",
        totalBuildings: 1,
        totalRooms: 5,
        totalStudents: 100,
        buildings: [
          {
            buildingName: "Main Building",
            floors: ["1st Floor"],
            roomCount: 5,
            studentCount: 100,
          },
        ],
      },
      est2: {
        isActive: false,
        examTitle: "EST 2",
        totalBuildings: 0,
        totalRooms: 0,
        totalStudents: 0,
        buildings: [],
      },
    };

    const pdfBytes = await generateCenterDossierStickersPdf([
      { ...mockSingle, center: "Center 1" },
      { ...mockSingle, center: "Center 2" },
      { ...mockSingle, center: "Center 3" },
      { ...mockSingle, center: "Center 4" },
      { ...mockSingle, center: "Center 5" },
    ]);

    const doc = await PDFDocument.load(pdfBytes);
    // 5 dossiers chunked 4 per page -> 2 pages
    expect(doc.getPageCount()).toBe(2);
  });
});


