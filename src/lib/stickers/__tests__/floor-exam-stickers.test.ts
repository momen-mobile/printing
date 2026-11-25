import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  generateFloorExamStickersPdf,
  generateBuildingCleanSkinBagsPdf,
  generateBuildingHeadBagPlacardsPdf,
  generateFloorSeniorBagPlacardsPdf,
  getSubjectBagCopies,
  type FloorSubjectPlacardData,
} from "../floor-exam-stickers-pdf";

describe("generateFloorExamStickersPdf", () => {
  it("generates an official A4 Landscape floor subject bag placard with 1 page per subject", async () => {
    const subjects: FloorSubjectPlacardData[] = [
      {
        subjectCode: "LIT",
        subjectName: "Literacy 1",
        examType: "EST 1",
        totalRooms: 3,
        totalCandidates: 75,
        rooms: [
          { roomName: "Room 101", candidateCount: 25 },
          { roomName: "Room 102", candidateCount: 25 },
          { roomName: "Room 103", candidateCount: 25 },
        ],
      },
      {
        subjectCode: "MATH",
        subjectName: "Math",
        examType: "EST 1",
        totalRooms: 3,
        totalCandidates: 75,
        rooms: [
          { roomName: "Room 101", candidateCount: 25 },
          { roomName: "Room 102", candidateCount: 25 },
          { roomName: "Room 103", candidateCount: 25 },
        ],
      },
    ];

    const pdfBytes = await generateFloorExamStickersPdf({
      floorName: "3rd Floor",
      examName: "EST 1",
      governorate: "Qalyubia",
      center: "Al Alamiya Modern School",
      building: "Main Building",
      date: "December 2026",
      subjects,
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(2); // 1 page for Literacy, 1 page for Math

    const page1 = doc.getPage(0);
    const { width, height } = page1.getSize();
    // A4 Landscape: 841.89 x 595.28 pt
    expect(width).toBeCloseTo(841.89, 1);
    expect(height).toBeCloseTo(595.28, 1);
  });

  it("handles single subject with many rooms gracefully", async () => {
    const rooms = Array.from({ length: 12 }, (_, i) => ({
      roomName: `AD${i + 1}A`,
      candidateCount: 25,
    }));

    const subjects: FloorSubjectPlacardData[] = [
      {
        subjectCode: "MATH1",
        subjectName: "Math 1",
        examType: "EST 2",
        totalRooms: rooms.length,
        totalCandidates: 300,
        rooms,
      },
    ];

    const pdfBytes = await generateFloorExamStickersPdf({
      floorName: "4th Floor",
      examName: "EST 2",
      governorate: "Cairo",
      center: "Integrated Thebes",
      building: "Main Campus",
      date: "December 2026",
      subjects,
    });

    const doc = await PDFDocument.load(pdfBytes);
    // 12 rooms > 10 rooms => generates 3 bag copies
    expect(doc.getPageCount()).toBe(3);
  });

  it("calculates correct bag copy counts based on room thresholds", () => {
    expect(getSubjectBagCopies(1)).toBe(1);
    expect(getSubjectBagCopies(6)).toBe(1);
    expect(getSubjectBagCopies(7)).toBe(2);
    expect(getSubjectBagCopies(10)).toBe(2);
    expect(getSubjectBagCopies(11)).toBe(3);
    expect(getSubjectBagCopies(15)).toBe(3);
    expect(getSubjectBagCopies(20)).toBe(4);
  });

  it("generates Building Clean Skin Bag Placards in A4 Landscape with all subjects combined for the complete building", async () => {
    const pdfBytes = await generateBuildingCleanSkinBagsPdf([
      {
        governorate: "Alexandria",
        center: "Future University",
        building: "Business",
        examName: "EST 1",
        examType: "EST 1",
        date: "Friday, December 11, 2026",
        subjects: [
          { code: "LIT", name: "Literacy" },
          { code: "MATH", name: "Math" },
        ],
      },
    ]);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1); // Exactly 1 placard per building with all subjects combined

    const page1 = doc.getPage(0);
    const { width, height } = page1.getSize();
    expect(width).toBeCloseTo(841.89, 1);
    expect(height).toBeCloseTo(595.28, 1);
  });

  it("generates Building Head Bag Placards in A4 Landscape with enclosed files list", async () => {
    const pdfBytes = await generateBuildingHeadBagPlacardsPdf([
      {
        governorate: "Cairo",
        center: "Future University",
        building: "Business",
        examName: "EST 1",
        examType: "EST 1",
        date: "Friday, December 11, 2026",
        totalFloors: 3,
        totalRooms: 12,
        totalStudents: 300,
      },
    ]);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);

    const page1 = doc.getPage(0);
    const { width, height } = page1.getSize();
    expect(width).toBeCloseTo(841.89, 1);
    expect(height).toBeCloseTo(595.28, 1);
  });

  it("generates Floor Senior Bag Placards in A4 Landscape with assigned rooms and supervisor supplies list", async () => {
    const pdfBytes = await generateFloorSeniorBagPlacardsPdf([
      {
        governorate: "Alexandria",
        center: "Future University",
        building: "Business",
        floor: "3rd Floor",
        examName: "EST 1",
        examType: "EST 1",
        date: "Friday, December 11, 2026",
        totalRooms: 4,
        totalStudents: 100,
        roomNames: ["Room 301", "Room 302", "Room 303", "Room 304"],
      },
    ]);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);

    const page1 = doc.getPage(0);
    const { width, height } = page1.getSize();
    expect(width).toBeCloseTo(841.89, 1);
    expect(height).toBeCloseTo(595.28, 1);
  });
});

