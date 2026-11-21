"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Boxes,
  Plus,
  Pencil,
  Trash2,
  Printer,
  Eye,
  RotateCcw,
  Search,
  Download,
  Building2,
  School,
  MapPin,
  Calendar,
  Lock,
  Layers,
  DoorOpen,
  Users,
  CheckCircle2,
  X,
  FileSpreadsheet,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { useI18n } from "@/components/locale-provider";
import { StickerPreviewModal } from "@/components/sticker-preview-modal";
import type { LogisticsStickerOptions, FloorRoomsData } from "@/lib/stickers/logistics-stickers-pdf";

export interface ManualCartonRow {
  id: string;
  boxNumber: number;
  totalBoxes: number;
  cycleName: string;
  examType: "EST 1" | "EST 2";
  governorate: string;
  centerName: string;
  buildingName: string;
  floorsSummary: string;
  roomsSummary: string;
  totalRooms: number;
  totalStudents: number;
  securitySeal: string;
  notes?: string;
}

const STORAGE_KEY = "est_manual_cartons_sheet_v3";

const DEFAULT_SEED_ROWS: ManualCartonRow[] = [
  // --- EST 1 Known Alexandria & Official Centers ---
  {
    id: "seed-e1-1",
    boxNumber: 1,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 1",
    governorate: "Alexandria",
    centerName: "Taymour English School",
    buildingName: "Taymour English School",
    floorsSummary: "3 Floors (Ground, 1st, 2nd)",
    roomsSummary: "R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11",
    totalRooms: 11,
    totalStudents: 0,
    securitySeal: "SEAL-ALX-E1-01",
    notes: "Alexandria School",
  },
  {
    id: "seed-e1-2",
    boxNumber: 2,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 1",
    governorate: "Alexandria",
    centerName: "Pioneers International School",
    buildingName: "Pioneers International School",
    floorsSummary: "1 Floor (1st Floor)",
    roomsSummary: "R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12",
    totalRooms: 12,
    totalStudents: 0,
    securitySeal: "SEAL-ALX-E1-02",
    notes: "Alexandria School",
  },
  {
    id: "seed-e1-3",
    boxNumber: 3,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 1",
    governorate: "Alexandria",
    centerName: "Future International School",
    buildingName: "Future International School",
    floorsSummary: "1 Floor (Ground Floor)",
    roomsSummary: "R1, R2, R3, R4, R5, R6, R7, R8",
    totalRooms: 8,
    totalStudents: 0,
    securitySeal: "SEAL-ALX-E1-03",
    notes: "Alexandria School",
  },
  {
    id: "seed-e1-4",
    boxNumber: 4,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 1",
    governorate: "Alexandria",
    centerName: "Arab Academy Abu Qir",
    buildingName: "Pharmacy",
    floorsSummary: "4 Floors (Ground, 1st, 2nd, 3rd)",
    roomsSummary: "P101, P102, P103, P104, P201, P202, P203, P204, P301, P302, P303, P304, P305",
    totalRooms: 13,
    totalStudents: 0,
    securitySeal: "SEAL-ALX-E1-04",
    notes: "Faculty of Pharmacy",
  },
  {
    id: "seed-e1-5",
    boxNumber: 5,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 1",
    governorate: "Alexandria",
    centerName: "Arab Academy Abu Qir",
    buildingName: "Eng. Building B",
    floorsSummary: "3 Floors (1st, 2nd, 3rd)",
    roomsSummary: "B201, B202, B203, B204, B205, B301, B302, B303, B304",
    totalRooms: 9,
    totalStudents: 0,
    securitySeal: "SEAL-ALX-E1-05",
    notes: "Engineering Building B",
  },
  {
    id: "seed-e1-6",
    boxNumber: 6,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 1",
    governorate: "Cairo",
    centerName: "BUC Badr University",
    buildingName: "Main Building",
    floorsSummary: "2 Floors",
    roomsSummary: "M101, M102, M103, M104, M105, M201, M202, M203, M204, M205",
    totalRooms: 10,
    totalStudents: 0,
    securitySeal: "SEAL-CAI-E1-01",
    notes: "Cairo Main Center",
  },
  {
    id: "seed-e1-7",
    boxNumber: 7,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 1",
    governorate: "Giza",
    centerName: "Green Heights Int. School",
    buildingName: "Green Heights",
    floorsSummary: "2 Floors",
    roomsSummary: "GH1, GH2, GH3, GH4, GH5, GH6, GH7, GH8",
    totalRooms: 8,
    totalStudents: 0,
    securitySeal: "SEAL-GIZ-E1-01",
    notes: "Giza Center",
  },

  // --- EST 2 Known Alexandria & Official Centers ---
  {
    id: "seed-e2-1",
    boxNumber: 1,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 2",
    governorate: "Alexandria",
    centerName: "Taymour English School",
    buildingName: "Taymour English School",
    floorsSummary: "3 Floors (Ground, 1st, 2nd)",
    roomsSummary: "R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11",
    totalRooms: 11,
    totalStudents: 0,
    securitySeal: "SEAL-ALX-E2-01",
    notes: "Alexandria School - EST 2",
  },
  {
    id: "seed-e2-2",
    boxNumber: 2,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 2",
    governorate: "Alexandria",
    centerName: "Pioneers International School",
    buildingName: "Pioneers International School",
    floorsSummary: "1 Floor (1st Floor)",
    roomsSummary: "R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12",
    totalRooms: 12,
    totalStudents: 0,
    securitySeal: "SEAL-ALX-E2-02",
    notes: "Alexandria School - EST 2",
  },
  {
    id: "seed-e2-3",
    boxNumber: 3,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 2",
    governorate: "Alexandria",
    centerName: "Future International School",
    buildingName: "Future International School",
    floorsSummary: "1 Floor (Ground Floor)",
    roomsSummary: "R1, R2, R3, R4, R5, R6, R7, R8",
    totalRooms: 8,
    totalStudents: 0,
    securitySeal: "SEAL-ALX-E2-03",
    notes: "Alexandria School - EST 2",
  },
  {
    id: "seed-e2-4",
    boxNumber: 4,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 2",
    governorate: "Alexandria",
    centerName: "Arab Academy Abu Qir",
    buildingName: "Pharmacy",
    floorsSummary: "4 Floors (Ground, 1st, 2nd, 3rd)",
    roomsSummary: "P101, P102, P103, P104, P201, P202, P203, P204, P301, P302, P303, P304, P305",
    totalRooms: 13,
    totalStudents: 0,
    securitySeal: "SEAL-ALX-E2-04",
    notes: "Faculty of Pharmacy - EST 2",
  },
  {
    id: "seed-e2-5",
    boxNumber: 5,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 2",
    governorate: "Alexandria",
    centerName: "Arab Academy Abu Qir",
    buildingName: "Eng. Building B",
    floorsSummary: "3 Floors (1st, 2nd, 3rd)",
    roomsSummary: "B201, B202, B203, B204, B205, B301, B302, B303, B304",
    totalRooms: 9,
    totalStudents: 0,
    securitySeal: "SEAL-ALX-E2-05",
    notes: "Engineering Building B - EST 2",
  },
  {
    id: "seed-e2-6",
    boxNumber: 6,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 2",
    governorate: "Cairo",
    centerName: "BUC Badr University",
    buildingName: "Main Building",
    floorsSummary: "2 Floors",
    roomsSummary: "M101, M102, M103, M104, M105, M201, M202, M203, M204, M205",
    totalRooms: 10,
    totalStudents: 0,
    securitySeal: "SEAL-CAI-E2-01",
    notes: "Cairo Main Center - EST 2",
  },
  {
    id: "seed-e2-7",
    boxNumber: 7,
    totalBoxes: 1,
    cycleName: "December 2026",
    examType: "EST 2",
    governorate: "Giza",
    centerName: "Green Heights Int. School",
    buildingName: "Green Heights",
    floorsSummary: "2 Floors",
    roomsSummary: "GH1, GH2, GH3, GH4, GH5, GH6, GH7, GH8",
    totalRooms: 8,
    totalStudents: 0,
    securitySeal: "SEAL-GIZ-E2-01",
    notes: "Giza Center - EST 2",
  },
];

interface ManualCartonsSheetProps {
  currentDriveBuilding?: {
    examName?: string;
    governorate?: string;
    center?: string;
    building?: string;
    sessionName?: string;
    totalRooms?: number;
    totalStudents?: number;
    floors?: FloorRoomsData[];
  };
}

export function ManualCartonsSheet({ currentDriveBuilding }: ManualCartonsSheetProps) {
  const { locale } = useI18n();
  const isAr = locale === "ar";

  // Data Rows
  const [rows, setRows] = useState<ManualCartonRow[]>([]);
  const [activeTab, setActiveTab] = useState<"ALL" | "EST 1" | "EST 2">("EST 1");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal State for Add / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<ManualCartonRow | null>(null);

  // Form State
  const [formBoxNumber, setFormBoxNumber] = useState<number>(1);
  const [formTotalBoxes, setFormTotalBoxes] = useState<number>(1);
  const [formCycleName, setFormCycleName] = useState<string>("December 2026");
  const [formExamType, setFormExamType] = useState<"EST 1" | "EST 2">("EST 1");
  const [formGovernorate, setFormGovernorate] = useState<string>("Alexandria");
  const [formCenterName, setFormCenterName] = useState<string>("");
  const [formBuildingName, setFormBuildingName] = useState<string>("");
  const [formFloorsSummary, setFormFloorsSummary] = useState<string>("");
  const [formRoomsSummary, setFormRoomsSummary] = useState<string>("");
  const [formTotalRooms, setFormTotalRooms] = useState<number>(0);
  const [formTotalStudents, setFormTotalStudents] = useState<number>(0);
  const [formSecuritySeal, setFormSecuritySeal] = useState<string>("");
  const [formNotes, setFormNotes] = useState<string>("");

  // Loading & Preview State
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<{
    open: boolean;
    url: string | null;
    title: string;
  }>({
    open: false,
    url: null,
    title: "",
  });

  // Load from LocalStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRows(parsed);
          return;
        }
      }
    } catch {}
    setRows(DEFAULT_SEED_ROWS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SEED_ROWS));
    } catch {}
  }, []);

  // Save to LocalStorage
  const persistRows = useCallback((newRows: ManualCartonRow[]) => {
    setRows(newRows);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newRows));
    } catch {}
  }, []);

  // Filtered Rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      // Tab filter
      if (activeTab === "EST 1" && r.examType !== "EST 1") return false;
      if (activeTab === "EST 2" && r.examType !== "EST 2") return false;

      // Search filter
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          r.centerName.toLowerCase().includes(q) ||
          r.buildingName.toLowerCase().includes(q) ||
          r.governorate.toLowerCase().includes(q) ||
          r.cycleName.toLowerCase().includes(q) ||
          r.securitySeal.toLowerCase().includes(q) ||
          String(r.boxNumber).includes(q) ||
          r.roomsSummary.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [rows, activeTab, searchTerm]);

  // Counts
  const est1Count = useMemo(() => rows.filter((r) => r.examType === "EST 1").length, [rows]);
  const est2Count = useMemo(() => rows.filter((r) => r.examType === "EST 2").length, [rows]);

  // Handle Add New Row Open
  const handleOpenAdd = () => {
    setEditingRow(null);
    const nextBox =
      activeTab === "EST 2"
        ? rows.filter((r) => r.examType === "EST 2").length + 1
        : rows.filter((r) => r.examType === "EST 1").length + 1;

    setFormBoxNumber(nextBox);
    setFormTotalBoxes(1);
    setFormCycleName("December 2026");
    setFormExamType(activeTab === "EST 2" ? "EST 2" : "EST 1");
    setFormGovernorate("Alexandria");
    setFormCenterName("");
    setFormBuildingName("");
    setFormFloorsSummary("");
    setFormRoomsSummary("");
    setFormTotalRooms(0);
    setFormTotalStudents(0);
    setFormSecuritySeal(`SEAL-${Date.now().toString().slice(-4)}`);
    setFormNotes("");
    setIsModalOpen(true);
  };

  // Handle Edit Row Open
  const handleOpenEdit = (row: ManualCartonRow) => {
    setEditingRow(row);
    setFormBoxNumber(row.boxNumber);
    setFormTotalBoxes(row.totalBoxes || 1);
    setFormCycleName(row.cycleName || "December 2026");
    setFormExamType(row.examType);
    setFormGovernorate(row.governorate);
    setFormCenterName(row.centerName);
    setFormBuildingName(row.buildingName);
    setFormFloorsSummary(row.floorsSummary);
    setFormRoomsSummary(row.roomsSummary);
    setFormTotalRooms(row.totalRooms);
    setFormTotalStudents(row.totalStudents);
    setFormSecuritySeal(row.securitySeal);
    setFormNotes(row.notes || "");
    setIsModalOpen(true);
  };

  // Save Modal (Create or Update)
  const handleSaveModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCenterName.trim() || !formBuildingName.trim()) {
      toast.error(isAr ? "يرجى كتابة اسم السنتر والمبنى" : "Please specify Center and Building names");
      return;
    }

    if (editingRow) {
      // Update
      const updated = rows.map((r) =>
        r.id === editingRow.id
          ? {
              ...r,
              boxNumber: Number(formBoxNumber) || 1,
              totalBoxes: Number(formTotalBoxes) || 1,
              cycleName: formCycleName.trim() || "December 2026",
              examType: formExamType,
              governorate: formGovernorate.trim(),
              centerName: formCenterName.trim(),
              buildingName: formBuildingName.trim(),
              floorsSummary: formFloorsSummary.trim(),
              roomsSummary: formRoomsSummary.trim(),
              totalRooms: Number(formTotalRooms) || 0,
              totalStudents: Number(formTotalStudents) || 0,
              securitySeal: formSecuritySeal.trim(),
              notes: formNotes.trim(),
            }
          : r,
      );
      persistRows(updated);
      toast.success(isAr ? "تم تحديث بيانات الكرتونة بنجاح" : "Carton row updated successfully");
    } else {
      // Create
      const newRow: ManualCartonRow = {
        id: `carton-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        boxNumber: Number(formBoxNumber) || 1,
        totalBoxes: Number(formTotalBoxes) || 1,
        cycleName: formCycleName.trim() || "December 2026",
        examType: formExamType,
        governorate: formGovernorate.trim() || "Alexandria",
        centerName: formCenterName.trim(),
        buildingName: formBuildingName.trim(),
        floorsSummary: formFloorsSummary.trim(),
        roomsSummary: formRoomsSummary.trim(),
        totalRooms: Number(formTotalRooms) || 0,
        totalStudents: Number(formTotalStudents) || 0,
        securitySeal: formSecuritySeal.trim(),
        notes: formNotes.trim(),
      };
      persistRows([newRow, ...rows]);
      toast.success(isAr ? "تمت إضافة الكرتونة بنجاح" : "New carton added successfully");
    }
    setIsModalOpen(false);
  };

  // Delete Row
  const handleDeleteRow = (id: string) => {
    if (confirm(isAr ? "هل أنت متأكد من حذف هذه الكرتونة من الشيت؟" : "Delete this carton from sheet?")) {
      const remaining = rows.filter((r) => r.id !== id);
      persistRows(remaining);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.success(isAr ? "تم حذف الكرتونة" : "Carton deleted");
    }
  };

  // Reset to Default Seed
  const handleResetDefaults = () => {
    if (
      confirm(
        isAr
          ? "هل تريد إعادة ضبط الشيت للبيانات الافتراضية الرسمية (ديسمبر 2026)؟"
          : "Reset sheet to default official records for December 2026?",
      )
    ) {
      persistRows(DEFAULT_SEED_ROWS);
      toast.success(isAr ? "تمت إعادة ضبط البيانات الافتراضية" : "Reset to default records");
    }
  };

  // Import Live Drive building
  const handleImportDriveBuilding = () => {
    if (!currentDriveBuilding || !currentDriveBuilding.building) {
      toast.error(isAr ? "لا يوجد مبنى محدد حالياً في درايف" : "No Drive building currently selected");
      return;
    }

    const isE2 = /EST\s*[-_]?\s*2\b|EST\s*II\b/i.test(currentDriveBuilding.examName || "");
    const examType: "EST 1" | "EST 2" = isE2 ? "EST 2" : "EST 1";
    const existingCount = rows.filter((r) => r.examType === examType).length;

    const floors = currentDriveBuilding.floors || [];
    const flSummary = floors.length > 0 ? `${floors.length} Floors` : "";
    const rmList = floors.flatMap((fl) => fl.rooms.map((r) => (typeof r === "string" ? r : r.room)));
    const rmSummary = rmList.join(", ");

    const newRow: ManualCartonRow = {
      id: `imported-${Date.now()}`,
      boxNumber: existingCount + 1,
      totalBoxes: 1,
      cycleName: currentDriveBuilding.sessionName || "December 2026",
      examType,
      governorate: currentDriveBuilding.governorate || "Alexandria",
      centerName: currentDriveBuilding.center || currentDriveBuilding.building,
      buildingName: currentDriveBuilding.building,
      floorsSummary: flSummary,
      roomsSummary: rmSummary,
      totalRooms: currentDriveBuilding.totalRooms || rmList.length || 0,
      totalStudents: currentDriveBuilding.totalStudents || 0,
      securitySeal: `SEAL-${Date.now().toString().slice(-4)}`,
      notes: "Imported from Live Drive",
    };

    persistRows([newRow, ...rows]);
    toast.success(
      isAr
        ? `تم استيراد ${newRow.buildingName} إلى شيت ${newRow.examType}`
        : `Imported ${newRow.buildingName} into ${newRow.examType} sheet`,
    );
  };

  // Convert row to LogisticsStickerOptions
  const rowToStickerOption = (row: ManualCartonRow): LogisticsStickerOptions => {
    // Parse room names from summary
    const roomNames = row.roomsSummary
      ? row.roomsSummary
          .split(/[,;\n]+/)
          .map((s) => s.trim().replace(/^قاعة\s*|^room\s*/i, ""))
          .filter(Boolean)
      : [];

    // Parse structured floors if available in floorsSummary
    let floors: FloorRoomsData[] | undefined;
    if (row.floorsSummary && row.floorsSummary.includes("(") && row.floorsSummary.includes(")")) {
      const match = row.floorsSummary.match(/\(([^)]+)\)/);
      if (match) {
        const floorNames = match[1].split(/[,;/]+/).map((s) => s.trim()).filter(Boolean);
        if (floorNames.length > 0 && roomNames.length > 0) {
          const perFloor = Math.ceil(roomNames.length / floorNames.length);
          floors = floorNames.map((fn, idx) => {
            const start = idx * perFloor;
            const end = Math.min(start + perFloor, roomNames.length);
            const flRooms = roomNames.slice(start, end);
            const cleanFn = fn.toLowerCase().includes("floor") ? fn : `${fn} Floor`;
            return {
              floor: cleanFn,
              rooms: flRooms,
              totalStudents: 0,
            };
          });
        }
      }
    }

    return {
      examName: row.examType,
      governorate: row.governorate,
      center: row.centerName,
      building: row.buildingName,
      date: row.cycleName || "December 2026",
      boxNumber: row.boxNumber,
      totalBoxes: row.totalBoxes || 1,
      totalRooms: row.totalRooms || roomNames.length,
      totalStudents: row.totalStudents,
      securitySeal: row.securitySeal,
      floors,
      roomNames: roomNames.length > 0 ? roomNames : undefined,
    };
  };

  // Single Print or Preview
  const handleSinglePrint = async (row: ManualCartonRow, mode: "show" | "print") => {
    const key = `carton-${row.id}-${mode}`;
    setBusyAction(key);
    const toastId = toast.loading(
      mode === "show"
        ? isAr
          ? "جاري تجهيز معاينة ستيكر الكرتونة..."
          : "Generating carton preview..."
        : isAr
        ? "جاري إرسال ستيكر الكرتونة للطباعة..."
        : "Sending carton to printer...",
    );

    try {
      const opt = rowToStickerOption(row);
      const res = await fetch("/api/stickers/logistics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "carton", ...opt }),
      });

      if (!res.ok) throw new Error("Failed to generate carton PDF");

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      toast.dismiss(toastId);

      if (mode === "show") {
        setPreviewState({
          open: true,
          url: objectUrl,
          title: `${isAr ? "كرتونة" : "Carton"} ${row.buildingName} (${row.examType} - Box #${row.boxNumber})`,
        });
      } else {
        const printWindow = window.open(objectUrl, "_blank");
        if (printWindow) {
          printWindow.focus();
          printWindow.onload = () => printWindow.print();
        }
        toast.success(isAr ? "تم إرسال الملف للطباعة" : "Sent to printer");
      }
    } catch (err: unknown) {
      toast.dismiss(toastId);
      const msg = err instanceof Error ? err.message : "Error generating carton";
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  };

  // Batch Print All / Filtered / Selected
  const handleBatchPrint = async (rowsToPrint: ManualCartonRow[], batchTitle: string) => {
    if (rowsToPrint.length === 0) {
      toast.error(isAr ? "لا توجد كراتين محددة للطباعة" : "No cartons selected for batch printing");
      return;
    }

    const key = `batch-${Date.now()}`;
    setBusyAction(key);
    const toastId = toast.loading(
      isAr
        ? `جاري تجهيز ${rowsToPrint.length} كرتونة في ملف PDF مجمع...`
        : `Generating batch PDF for ${rowsToPrint.length} cartons...`,
    );

    try {
      const cartonsPayload = rowsToPrint.map((r) => rowToStickerOption(r));
      const res = await fetch("/api/stickers/logistics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "batch-carton",
          cartons: cartonsPayload,
          examName: activeTab === "EST 2" ? "EST 2" : "EST 1",
        }),
      });

      if (!res.ok) throw new Error("Failed to generate batch cartons PDF");

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      toast.dismiss(toastId);

      setPreviewState({
        open: true,
        url: objectUrl,
        title: batchTitle,
      });
      toast.success(
        isAr
          ? `تم إنشاء ملف الطباعة المجمع (${rowsToPrint.length} كرتونة)`
          : `Generated batch PDF (${rowsToPrint.length} cartons)`,
      );
    } catch (err: unknown) {
      toast.dismiss(toastId);
      const msg = err instanceof Error ? err.message : "Error generating batch PDF";
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  };

  // Export Table to CSV
  const handleExportCsv = () => {
    const headers = [
      "Box Number",
      "Total Boxes",
      "Cycle Name",
      "Exam Type",
      "Governorate",
      "Center Name",
      "Building Name",
      "Floors Summary",
      "Rooms Summary",
      "Total Rooms",
      "Total Students",
      "Security Seal",
      "Notes",
    ];

    const csvRows = rows.map((r) => [
      r.boxNumber,
      r.totalBoxes,
      `"${r.cycleName}"`,
      r.examType,
      `"${r.governorate}"`,
      `"${r.centerName}"`,
      `"${r.buildingName}"`,
      `"${r.floorsSummary}"`,
      `"${r.roomsSummary}"`,
      r.totalRooms,
      r.totalStudents,
      `"${r.securitySeal}"`,
      `"${r.notes || ""}"`,
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...csvRows.map((e) => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `EST-Cartons-Sheet-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(isAr ? "تم تصدير ملف CSV بنجاح" : "Exported CSV successfully");
  };

  // Toggle selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRows.map((r) => r.id)));
    }
  };

  return (
    <div className="space-y-4">
      {/* Table Header & Controls Bar */}
      <div className="card p-4 sm:p-5 border border-border shadow-xs bg-surface-soft/40 backdrop-blur-xs space-y-4">
        {/* Row 1: Section Title & Action Buttons */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                <FileSpreadsheet className="size-3.5" />
                {isAr ? "شيت كراتين الشحن والمباني (يدوي وقابل للتعديل)" : "Manual Carton & Packaging Register"}
              </span>
              <span className="text-xs font-bold text-muted">
                {isAr ? "الدورة: ديسمبر 2026" : "Cycle: December 2026"}
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-foreground flex items-center gap-2">
              <Boxes className="size-5 text-amber-600 dark:text-amber-400" />
              <span>
                {isAr
                  ? "سجل كراتين الشحن وطباعة الاستيكرات الخارجية للمباني"
                  : "Building Cartons Dispatch Sheet & Master Placards"}
              </span>
            </h2>
            <p className="text-xs text-muted mt-0.5 max-w-2xl">
              {isAr
                ? "جدول تفاعلي بنمط الإكسيل لإدارة كراتين المدارس والمباني، وتعديل رقم البوكس والقاعات والطلاب، وطباعة الاستيكرات مجمعة أو منفردة."
                : "Excel-style interactive register to manage building cartons, edit box numbers, rooms, and candidate counts, and batch print master placards."}
            </p>
          </div>

          {/* Action Buttons: Add, Batch Print, Export */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Add New Row */}
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="size-3.5" />
              <span>{isAr ? "إضافة كرتونة / مبنى" : "Add Carton"}</span>
            </button>

            {/* Batch Print All in current tab */}
            <button
              type="button"
              onClick={() =>
                handleBatchPrint(
                  filteredRows,
                  activeTab === "ALL"
                    ? isAr ? "طباعة جميع كراتين الشيت (الكل)" : "Batch All Cartons"
                    : isAr ? `طباعة جميع كراتين ${activeTab}` : `Batch ${activeTab} Cartons`,
                )
              }
              disabled={Boolean(busyAction) || filteredRows.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white text-xs font-bold shadow-xs transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {busyAction?.startsWith("batch-") ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Printer className="size-3.5" />
              )}
              <span>
                {isAr
                  ? `طباعة كراتين ${activeTab} (${filteredRows.length}) 🖨️`
                  : `Print ${activeTab} Cartons (${filteredRows.length}) 🖨️`}
              </span>
            </button>

            {/* Batch Print Selected if any */}
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  const selectedRows = rows.filter((r) => selectedIds.has(r.id));
                  handleBatchPrint(
                    selectedRows,
                    isAr ? `طباعة الكراتين المحددة (${selectedRows.length})` : `Print Selected (${selectedRows.length})`,
                  );
                }}
                disabled={Boolean(busyAction)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
              >
                <CheckCircle2 className="size-3.5" />
                <span>
                  {isAr ? `طباعة المحدد (${selectedIds.size})` : `Print Selected (${selectedIds.size})`}
                </span>
              </button>
            )}

            {/* Import from Drive */}
            {currentDriveBuilding?.building && (
              <button
                type="button"
                onClick={handleImportDriveBuilding}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-surface-soft hover:bg-surface-strong text-foreground border border-border text-xs font-bold transition-all cursor-pointer"
                title={isAr ? "استيراد المبنى المعروض حالياً من درايف إلى هذا الشيت" : "Import current Drive building"}
              >
                <Sparkles className="size-3.5 text-indigo-500" />
                <span>{isAr ? "استيراد الحالي من درايف" : "Import Drive"}</span>
              </button>
            )}

            {/* Export CSV */}
            <button
              type="button"
              onClick={handleExportCsv}
              className="p-2 rounded-xl bg-surface-soft hover:bg-surface-strong text-muted hover:text-foreground border border-border transition-all cursor-pointer"
              title={isAr ? "تصدير إلى CSV" : "Export CSV"}
            >
              <Download className="size-4" />
            </button>

            {/* Reset to defaults */}
            <button
              type="button"
              onClick={handleResetDefaults}
              className="p-2 rounded-xl bg-surface-soft hover:bg-surface-strong text-muted hover:text-foreground border border-border transition-all cursor-pointer"
              title={isAr ? "إعادة ضبط للقائمة الافتراضية الرسمية" : "Reset to defaults"}
            >
              <RotateCcw className="size-4" />
            </button>
          </div>
        </div>

        {/* Row 2: Tabs (EST 1 / EST 2 / ALL) & Search Input */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-border/60">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-surface border border-border/80 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab("EST 1")}
              className={cn(
                "px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5",
                activeTab === "EST 1"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-muted hover:text-foreground hover:bg-surface-soft",
              )}
            >
              <span>🔵 EST 1</span>
              <span
                className={cn(
                  "px-1.5 py-0.2 rounded-full text-[10px]",
                  activeTab === "EST 1" ? "bg-white/20 text-white" : "bg-surface-soft text-muted",
                )}
              >
                {est1Count}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("EST 2")}
              className={cn(
                "px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5",
                activeTab === "EST 2"
                  ? "bg-purple-600 text-white shadow-xs"
                  : "text-muted hover:text-foreground hover:bg-surface-soft",
              )}
            >
              <span>🟣 EST 2</span>
              <span
                className={cn(
                  "px-1.5 py-0.2 rounded-full text-[10px]",
                  activeTab === "EST 2" ? "bg-white/20 text-white" : "bg-surface-soft text-muted",
                )}
              >
                {est2Count}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("ALL")}
              className={cn(
                "px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5",
                activeTab === "ALL"
                  ? "bg-foreground text-background shadow-xs"
                  : "text-muted hover:text-foreground hover:bg-surface-soft",
              )}
            >
              <span>📋 {isAr ? "الكل" : "All"}</span>
              <span
                className={cn(
                  "px-1.5 py-0.2 rounded-full text-[10px]",
                  activeTab === "ALL" ? "bg-background/20 text-background" : "bg-surface-soft text-muted",
                )}
              >
                {rows.length}
              </span>
            </button>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute right-3 rtl:right-3 ltr:left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={isAr ? "بحث بالمبنى، السنتر، البوكس..." : "Search carton, building..."}
              className="w-full h-9 rtl:pr-8 rtl:pl-3 ltr:pl-8 ltr:pr-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
        </div>
      </div>

      {/* Excel-style Table View */}
      <div className="card overflow-hidden border border-border/80 shadow-xs bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right rtl:text-right ltr:text-left border-collapse">
            <thead>
              <tr className="bg-surface-soft/80 border-b border-border/80 text-muted font-extrabold uppercase text-[11px] tracking-wider select-none">
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filteredRows.length > 0 && selectedIds.size === filteredRows.length}
                    onChange={toggleSelectAll}
                    className="size-3.5 rounded border-border text-indigo-600 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-3 w-16 text-center">{isAr ? "البوكس" : "Box #"}</th>
                <th className="py-3 px-3 w-28">{isAr ? "الدورة" : "Cycle"}</th>
                <th className="py-3 px-3 w-20 text-center">{isAr ? "الامتحان" : "Exam"}</th>
                <th className="py-3 px-3 w-28">{isAr ? "المحافظة" : "Governorate"}</th>
                <th className="py-3 px-3 min-w-[160px]">{isAr ? "السنتر / المدرسة" : "Center / School"}</th>
                <th className="py-3 px-3 min-w-[140px]">{isAr ? "المبنى" : "Building"}</th>
                <th className="py-3 px-3 min-w-[180px]">{isAr ? "الأدوار والقاعات" : "Floors & Rooms"}</th>
                <th className="py-3 px-3 w-16 text-center">{isAr ? "القاعات" : "Rooms"}</th>
                <th className="py-3 px-3 w-16 text-center">{isAr ? "الطلاب" : "Students"}</th>
                <th className="py-3 px-3 w-28 text-center">{isAr ? "كود القفل" : "Seal"}</th>
                <th className="py-3 px-3 w-36 text-center">{isAr ? "الطباعة والتحكم" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-medium">
              {filteredRows.length > 0 ? (
                filteredRows.map((row) => {
                  const isSelected = selectedIds.has(row.id);
                  const isE2 = row.examType === "EST 2";

                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "hover:bg-surface-soft/50 transition-colors group",
                        isSelected && "bg-indigo-500/[0.04]",
                      )}
                    >
                      {/* Checkbox */}
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(row.id)}
                          className="size-3.5 rounded border-border text-indigo-600 cursor-pointer"
                        />
                      </td>

                      {/* Box Number */}
                      <td className="py-2.5 px-3 text-center">
                        <span className="inline-flex items-center justify-center size-6 rounded-lg bg-surface-soft border border-border font-extrabold text-foreground font-mono">
                          {row.boxNumber}
                        </span>
                      </td>

                      {/* Cycle Name */}
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-foreground flex items-center gap-1">
                          <Calendar className="size-3 text-amber-500" />
                          <span>{row.cycleName}</span>
                        </span>
                      </td>

                      {/* Exam Type Badge */}
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-md text-[10.5px] font-bold font-mono",
                            isE2
                              ? "bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20"
                              : "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20",
                          )}
                        >
                          {row.examType}
                        </span>
                      </td>

                      {/* Governorate */}
                      <td className="py-2.5 px-3 text-muted">
                        <span className="flex items-center gap-1 font-semibold">
                          <MapPin className="size-3 text-rose-500" />
                          <span>{row.governorate}</span>
                        </span>
                      </td>

                      {/* Center / School Name */}
                      <td className="py-2.5 px-3">
                        <span className="font-extrabold text-foreground flex items-center gap-1.5">
                          <School className="size-3.5 text-emerald-600" />
                          <span>{row.centerName}</span>
                        </span>
                      </td>

                      {/* Building Name */}
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-foreground flex items-center gap-1.5">
                          <Building2 className="size-3.5 text-purple-600" />
                          <span>{row.buildingName}</span>
                        </span>
                      </td>

                      {/* Floors & Rooms Summary */}
                      <td className="py-2.5 px-3 text-muted text-[11px]">
                        <div className="max-w-xs truncate" title={`${row.floorsSummary} | ${row.roomsSummary}`}>
                          {row.floorsSummary && (
                            <span className="font-bold text-foreground">{row.floorsSummary} • </span>
                          )}
                          <span>{row.roomsSummary || (isAr ? "في انتظار إضافة القاعات" : "Pending rooms")}</span>
                        </div>
                      </td>

                      {/* Total Rooms */}
                      <td className="py-2.5 px-3 text-center font-bold text-foreground font-mono">
                        {row.totalRooms}
                      </td>

                      {/* Total Students */}
                      <td className="py-2.5 px-3 text-center font-bold font-mono">
                        {row.totalStudents > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400">{row.totalStudents}</span>
                        ) : (
                          <span className="text-muted/60 text-[11px]">0</span>
                        )}
                      </td>

                      {/* Security Seal */}
                      <td className="py-2.5 px-3 text-center font-mono text-[11px] text-muted">
                        <span className="px-1.5 py-0.5 rounded bg-surface-soft border border-border">
                          {row.securitySeal || "---"}
                        </span>
                      </td>

                      {/* Actions: Single Print, Preview, Edit, Delete */}
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Preview PDF */}
                          <button
                            type="button"
                            onClick={() => handleSinglePrint(row, "show")}
                            disabled={Boolean(busyAction)}
                            className="p-1.5 rounded-lg bg-surface-soft hover:bg-surface-strong text-muted hover:text-foreground border border-border transition-all cursor-pointer"
                            title={isAr ? "معاينة ستيكر كرتونة المبنى" : "Preview Carton Placard"}
                          >
                            <Eye className="size-3.5" />
                          </button>

                          {/* Print Single Placard */}
                          <button
                            type="button"
                            onClick={() => handleSinglePrint(row, "print")}
                            disabled={Boolean(busyAction)}
                            className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-all cursor-pointer shadow-xs"
                            title={isAr ? "طباعة ستيكر كرتونة المبنى A4" : "Print Carton Placard A4"}
                          >
                            <Printer className="size-3.5" />
                          </button>

                          {/* Edit Row */}
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(row)}
                            className="p-1.5 rounded-lg bg-surface-soft hover:bg-surface-strong text-muted hover:text-foreground border border-border transition-all cursor-pointer"
                            title={isAr ? "تعديل بيانات الكرتونة" : "Edit row"}
                          >
                            <Pencil className="size-3.5 text-blue-500" />
                          </button>

                          {/* Delete Row */}
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(row.id)}
                            className="p-1.5 rounded-lg bg-surface-soft hover:bg-red-500/10 text-muted hover:text-red-600 border border-border transition-all cursor-pointer"
                            title={isAr ? "حذف الكرتونة" : "Delete row"}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-muted text-xs">
                    {isAr
                      ? "لا توجد كراتين مطابقة للبحث أو الفلتر حالياً"
                      : "No cartons matching the active filter or search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-surface-soft/60 border-t border-border/80 text-xs text-muted font-semibold">
          <div className="flex items-center gap-3">
            <span>
              {isAr ? "عدد الكراتين المعروضة:" : "Cartons in view:"}{" "}
              <strong className="text-foreground">{filteredRows.length}</strong>
            </span>
            <span>•</span>
            <span>
              {isAr ? "إجمالي القاعات:" : "Total Rooms:"}{" "}
              <strong className="text-foreground">
                {filteredRows.reduce((sum, r) => sum + (r.totalRooms || 0), 0)}
              </strong>
            </span>
            <span>•</span>
            <span>
              {isAr ? "إجمالي الطلاب:" : "Total Candidates:"}{" "}
              <strong className="text-foreground">
                {filteredRows.reduce((sum, r) => sum + (r.totalStudents || 0), 0)}
              </strong>
            </span>
          </div>

          <div className="text-[11px] text-muted">
            {isAr
              ? "✨ جميع التعديلات تحفظ تلقائياً في المتصفح"
              : "✨ All edits persist automatically in your browser"}
          </div>
        </div>
      </div>

      {/* Modal for Add / Edit Row */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <Boxes className="size-5 text-indigo-600 dark:text-indigo-400" />
                <span>
                  {editingRow
                    ? isAr
                      ? "تعديل تفاصيل كرتونة المبنى"
                      : "Edit Building Carton Details"
                    : isAr
                    ? "إضافة كرتونة مبنى جديدة"
                    : "Add New Building Carton"}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-muted hover:text-foreground cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Box Number */}
                <div>
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "رقم البوكس (Box Number)" : "Box Number"}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={formBoxNumber}
                    onChange={(e) => setFormBoxNumber(Number(e.target.value))}
                    required
                    className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>

                {/* Exam Type */}
                <div>
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "نوع الامتحان (Exam Type)" : "Exam Type"}
                  </label>
                  <select
                    value={formExamType}
                    onChange={(e) => setFormExamType(e.target.value as "EST 1" | "EST 2")}
                    className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                  >
                    <option value="EST 1">EST 1</option>
                    <option value="EST 2">EST 2</option>
                  </select>
                </div>

                {/* Cycle Name */}
                <div>
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "اسم الدورة (Cycle Name)" : "Cycle Name"}
                  </label>
                  <input
                    type="text"
                    value={formCycleName}
                    onChange={(e) => setFormCycleName(e.target.value)}
                    required
                    placeholder="December 2026"
                    className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>

                {/* Governorate */}
                <div>
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "المحافظة (Governorate)" : "Governorate"}
                  </label>
                  <input
                    type="text"
                    value={formGovernorate}
                    onChange={(e) => setFormGovernorate(e.target.value)}
                    required
                    placeholder="Alexandria"
                    className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>

                {/* Center Name */}
                <div>
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "السنتر أو المدرسة (Center/School)" : "Center / School"}
                  </label>
                  <input
                    type="text"
                    value={formCenterName}
                    onChange={(e) => setFormCenterName(e.target.value)}
                    required
                    placeholder="Taymour English School"
                    className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>

                {/* Building Name */}
                <div>
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "المبنى (Building)" : "Building"}
                  </label>
                  <input
                    type="text"
                    value={formBuildingName}
                    onChange={(e) => setFormBuildingName(e.target.value)}
                    required
                    placeholder="Pharmacy / Building HQ"
                    className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>

                {/* Total Rooms */}
                <div>
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "عدد القاعات (Total Rooms)" : "Total Rooms"}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formTotalRooms}
                    onChange={(e) => setFormTotalRooms(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>

                {/* Total Students */}
                <div>
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "إجمالي الطلاب (Total Students)" : "Total Students"}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formTotalStudents}
                    onChange={(e) => setFormTotalStudents(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>

                {/* Security Seal */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "كود القفل الأمني (Security Seal)" : "Security Seal"}
                  </label>
                  <input
                    type="text"
                    value={formSecuritySeal}
                    onChange={(e) => setFormSecuritySeal(e.target.value)}
                    placeholder="SEAL-ALX-01"
                    className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>

                {/* Floors Summary */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "الأدوار (Floors Summary)" : "Floors Summary"}
                  </label>
                  <input
                    type="text"
                    value={formFloorsSummary}
                    onChange={(e) => setFormFloorsSummary(e.target.value)}
                    placeholder="3 Floors (Ground, 1st, 2nd)"
                    className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>

                {/* Rooms Summary */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-muted mb-1">
                    {isAr ? "القاعات (Rooms List, separated by commas)" : "Rooms List (comma-separated)"}
                  </label>
                  <textarea
                    rows={2}
                    value={formRoomsSummary}
                    onChange={(e) => setFormRoomsSummary(e.target.value)}
                    placeholder="R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11"
                    className="w-full p-2.5 rounded-xl border border-border bg-surface text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 resize-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/80">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-surface-soft hover:bg-surface-strong text-foreground text-xs font-bold border border-border cursor-pointer"
                >
                  {isAr ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  {editingRow
                    ? isAr
                      ? "حفظ التعديلات"
                      : "Save Changes"
                    : isAr
                    ? "إضافة الكرتونة"
                    : "Add Carton"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for PDF Preview */}
      <StickerPreviewModal
        open={previewState.open}
        onClose={() => setPreviewState({ open: false, url: null, title: "" })}
        pdfUrl={previewState.url}
        title={previewState.title}
      />
    </div>
  );
}

