"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  Boxes,
  Building,
  Building2,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderArchive,
  FolderPlus,
  GraduationCap,
  Layers,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Square,
  Tag,
  Trash2,
  Truck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button, ConfirmDialog, Input } from "@/components/ui";
import { useI18n } from "@/components/locale-provider";
import { cn } from "@/lib/cn";
import { StickerPreviewModal } from "@/components/sticker-preview-modal";
import type { EstRoundRow, EstRoundSummaryStats } from "@/lib/est-rounds";
import { getSubjectSortKey } from "@/lib/stickers/est-room-data";

interface ServerRound {
  id: string;
  name: string;
  examType: string;
  roundDate: string | null;
  roundDay: string | null;
  cycleName: string | null;
  fileName: string | null;
  summaryStats: EstRoundSummaryStats | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  sheetData?: EstRoundRow[];
}

export default function EstRoundsPage() {
  const { locale } = useI18n();
  const isAr = locale === "ar";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rounds, setRounds] = useState<ServerRound[]>([]);
  const [loadingRounds, setLoadingRounds] = useState<boolean>(true);
  const [activeRoundId, setActiveRoundId] = useState<string | null>(null);
  const [activeRound, setActiveRound] = useState<ServerRound | null>(null);
  const [loadingActiveRound, setLoadingActiveRound] = useState<boolean>(false);

  // Uploading state
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isSeedingDefault, setIsSeedingDefault] = useState<boolean>(false);

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedGov, setSelectedGov] = useState<string>("all");
  const [selectedCenter, setSelectedCenter] = useState<string>("all");
  const [subjectShortcut, setSubjectShortcut] = useState<string>("all");

  // Selection
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // Reset selection & subject shortcuts when switching rounds
  useEffect(() => {
    setSelectedRowIds(new Set());
    setSubjectShortcut("all");
  }, [activeRoundId]);

  // Collapsed sections
  const [collapsedGovs, setCollapsedGovs] = useState<Set<string>>(new Set());
  const [collapsedCenters, setCollapsedCenters] = useState<Set<string>>(new Set());

  // PDF Preview & Print
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeActionType, setActiveActionType] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");

  // Delete round dialog
  const [roundToDelete, setRoundToDelete] = useState<ServerRound | null>(null);
  const [deletingRound, setDeletingRound] = useState<boolean>(false);

  // Section 3 collapsed state (closed by default per manager request)
  const [isSection3Open, setIsSection3Open] = useState<boolean>(false);

  // Fetch list of rounds from database
  const fetchRounds = useCallback(async (opts?: { autoSelectFirst?: boolean; selectRoundId?: string }) => {
    try {
      setLoadingRounds(true);
      const res = await fetch("/api/est-rounds", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("[est-rounds] Failed loading rounds", data);
        return;
      }

      const list: ServerRound[] = Array.isArray(data.rounds) ? data.rounds : [];
      setRounds(list);

      if (opts?.selectRoundId) {
        setActiveRoundId(opts.selectRoundId);
      } else if (opts?.autoSelectFirst && list.length > 0) {
        setActiveRoundId(list[0].id);
      }
    } catch (err) {
      console.warn("[est-rounds] Error fetching rounds:", err);
    } finally {
      setLoadingRounds(false);
    }
  }, []);

  // Load single round data with sheetData
  const loadRound = useCallback(async (roundId: string) => {
    try {
      setLoadingActiveRound(true);
      const res = await fetch(`/api/est-rounds/${roundId}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load round details");
      }
      setActiveRound(data.round as ServerRound);
      setSelectedRowIds(new Set()); // Reset selections on round change
    } catch (err: any) {
      toast.error(err?.message || (isAr ? "فشل تحميل تفاصيل الدورة" : "Failed to load round details"));
    } finally {
      setLoadingActiveRound(false);
    }
  }, [isAr]);

  // Initial fetch
  useEffect(() => {
    void fetchRounds({ autoSelectFirst: true });
  }, [fetchRounds]);

  // On activeRoundId change
  useEffect(() => {
    if (activeRoundId) {
      void loadRound(activeRoundId);
    } else {
      setActiveRound(null);
    }
  }, [activeRoundId, loadRound]);

  // Handle uploading Excel file
  const handleFileUpload = useCallback(async (file: File) => {
    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/est-rounds", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to upload and parse Excel sheet");
      }

      if (data.isCombined) {
        toast.success(
          isAr
            ? "تم رفع ومعالجة الشيت الموحد بنجاح وتقسيمه تلقائياً إلى دورتي EST 1 و EST 2!"
            : "Successfully imported unified master sheet, split into EST 1 and EST 2!",
        );
      } else {
        toast.success(
          isAr
            ? `تم رفع ومعالجة شيت الدورة بنجاح (${data.round?.name || "EST Round"})`
            : `Successfully imported EST round (${data.round?.name || "EST Round"})`,
        );
      }

      await fetchRounds({ selectRoundId: data.round?.id });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      toast.error(err?.message || (isAr ? "فشل رفع الملف" : "Failed to upload file"));
    } finally {
      setIsUploading(false);
    }
  }, [fetchRounds, isAr]);

  // Quick Seed Default EST 2 December 2026 data
  const handleSeedDefaultEst2 = useCallback(async () => {
    try {
      setIsSeedingDefault(true);
      const res = await fetch("/api/est-rounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedDefault: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to seed default round");
      }

      toast.success(
        isAr
          ? "تم تحميل دورات ديسمبر 2026 (EST 1 و EST 2) المعتمدة بنجاح!"
          : "Successfully loaded official December 2026 rounds (EST 1 & EST 2)!",
      );

      await fetchRounds({ selectRoundId: data.round?.id });
    } catch (err: any) {
      toast.error(err?.message || (isAr ? "فشل تحميل البيانات" : "Failed to load default round"));
    } finally {
      setIsSeedingDefault(false);
    }
  }, [fetchRounds, isAr]);

  // Delete round
  const handleDeleteRound = useCallback(async (roundId: string) => {
    try {
      setDeletingRound(true);
      const res = await fetch(`/api/est-rounds/${roundId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete round");

      toast.success(isAr ? "تم حذف الدورة بنجاح" : "Round deleted successfully");
      setRoundToDelete(null);
      if (activeRoundId === roundId) {
        setActiveRoundId(null);
        setActiveRound(null);
      }
      await fetchRounds({ autoSelectFirst: true });
    } catch (err: any) {
      toast.error(err?.message || (isAr ? "فشل حذف الدورة" : "Failed to delete round"));
    } finally {
      setDeletingRound(false);
    }
  }, [activeRoundId, fetchRounds, isAr]);

  // Rows from active round
  const sheetRows: EstRoundRow[] = useMemo(() => {
    return Array.isArray(activeRound?.sheetData) ? (activeRound!.sheetData as EstRoundRow[]) : [];
  }, [activeRound]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    let list = sheetRows;

    if (selectedGov !== "all") {
      list = list.filter((r) => r.governorate.toLowerCase() === selectedGov.toLowerCase());
    }

    if (selectedCenter !== "all") {
      list = list.filter((r) => r.center.toLowerCase() === selectedCenter.toLowerCase());
    }

    // Quick Subject Filter Shortcuts
    if (subjectShortcut === "essay") {
      list = list.filter((r) => (r.subjects?.ESSAY || (r as any).withEssay || 0) > 0);
    } else if (subjectShortcut === "no_essay") {
      list = list.filter((r) => !r.subjects?.ESSAY && !(r as any).withEssay);
    } else if (subjectShortcut === "lit_math") {
      list = list.filter((r) => (r.subjects?.LIT || 0) > 0 || (r.subjects?.MATH || 0) > 0);
    } else if (subjectShortcut === "math1") {
      list = list.filter((r) => (r.subjects?.MATH1 || 0) > 0);
    } else if (subjectShortcut === "math2") {
      list = list.filter((r) => (r.subjects?.MATH2 || 0) > 0);
    } else if (subjectShortcut === "bio") {
      list = list.filter((r) => (r.subjects?.BIO || 0) > 0);
    } else if (subjectShortcut === "chem") {
      list = list.filter((r) => (r.subjects?.CHEM || 0) > 0);
    } else if (subjectShortcut === "phy") {
      list = list.filter((r) => (r.subjects?.PHY || 0) > 0);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.governorate.toLowerCase().includes(q) ||
          r.center.toLowerCase().includes(q) ||
          ((r as any).building && (r as any).building.toLowerCase().includes(q)) ||
          r.floor.toLowerCase().includes(q) ||
          r.room.toLowerCase().includes(q) ||
          r.rawRoom.toLowerCase().includes(q) ||
          (r.breakdownText && r.breakdownText.toLowerCase().includes(q)),
      );
    }

    return list;
  }, [sheetRows, selectedGov, selectedCenter, subjectShortcut, searchQuery]);

  // Counts for Subject Shortcuts
  const shortcutCounts = useMemo(() => {
    const isEst2 = activeRound?.examType === "EST 2";
    if (isEst2) {
      return {
        all: sheetRows.length,
        math2: sheetRows.filter((r) => (r.subjects?.MATH2 || 0) > 0).length,
        chem: sheetRows.filter((r) => (r.subjects?.CHEM || 0) > 0).length,
        bio: sheetRows.filter((r) => (r.subjects?.BIO || 0) > 0).length,
        phy: sheetRows.filter((r) => (r.subjects?.PHY || 0) > 0).length,
        math1: sheetRows.filter((r) => (r.subjects?.MATH1 || 0) > 0).length,
        essay: 0,
        no_essay: 0,
        lit_math: 0,
      };
    }
    return {
      all: sheetRows.length,
      essay: sheetRows.filter((r) => (r.subjects?.ESSAY || (r as any).withEssay || 0) > 0).length,
      no_essay: sheetRows.filter((r) => !(r.subjects?.ESSAY || (r as any).withEssay)).length,
      lit_math: sheetRows.filter((r) => (r.subjects?.LIT || 0) > 0).length,
      math2: 0,
      chem: 0,
      bio: 0,
      phy: 0,
      math1: 0,
    };
  }, [sheetRows, activeRound?.examType]);

  // Unique Governorates & Centers for dropdowns
  const availableGovs = useMemo(() => {
    const set = new Set<string>();
    sheetRows.forEach((r) => set.add(r.governorate));
    return Array.from(set).sort();
  }, [sheetRows]);

  const availableCenters = useMemo(() => {
    const set = new Set<string>();
    sheetRows.forEach((r) => {
      if (selectedGov === "all" || r.governorate.toLowerCase() === selectedGov.toLowerCase()) {
        set.add(r.center);
      }
    });
    return Array.from(set).sort();
  }, [sheetRows, selectedGov]);

  // Grouped rows: Governorate -> Center -> Rows
  const groupedData = useMemo(() => {
    const map = new Map<string, Map<string, EstRoundRow[]>>();

    for (const r of filteredRows) {
      if (!map.has(r.governorate)) {
        map.set(r.governorate, new Map());
      }
      const centerMap = map.get(r.governorate)!;
      if (!centerMap.has(r.center)) {
        centerMap.set(r.center, []);
      }
      centerMap.get(r.center)!.push(r);
    }

    return map;
  }, [filteredRows]);

  // Dynamic Subject Columns for Table
  const subjectColumns = useMemo(() => {
    const codes = new Set<string>();
    sheetRows.forEach((r) => {
      Object.keys(r.subjects || {}).forEach((code) => codes.add(code));
    });

    const isEst2 = activeRound?.examType === "EST 2" || codes.has("MATH1") || codes.has("BIO");
    const priority = isEst2
      ? ["MATH1", "MATH2", "BIO", "CHEM", "PHY"]
      : ["LIT", "MATH", "ESSAY"];

    const sorted = Array.from(codes).sort((a, b) => {
      const diff = getSubjectSortKey(a) - getSubjectSortKey(b);
      if (diff !== 0) return diff;
      const idxA = priority.indexOf(a);
      const idxB = priority.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    return sorted.map((code) => {
      let label = code;
      if (code === "MATH1") label = "Math 1";
      else if (code === "MATH2") label = "Math 2";
      else if (code === "BIO") label = "Biology";
      else if (code === "CHEM") label = "Chemistry";
      else if (code === "PHY") label = "Physics";
      else if (code === "LIT") label = "Literacy";
      else if (code === "MATH") label = "Math";
      else if (code === "ESSAY") label = "Essay";
      return { code, label };
    });
  }, [sheetRows, activeRound]);

  // Selection handlers
  const toggleSelectRow = useCallback((id: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedRowIds(new Set(filteredRows.map((r) => r.id)));
  }, [filteredRows]);

  const clearSelection = useCallback(() => {
    setSelectedRowIds(new Set());
  }, []);

  const isAllSelected = filteredRows.length > 0 && filteredRows.every((r) => selectedRowIds.has(r.id));
  const isSomeSelected = selectedRowIds.size > 0 && !isAllSelected;

  const toggleSelectGov = useCallback((govName: string, rows: EstRoundRow[]) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      const allGovSelected = rows.every((r) => next.has(r.id));
      if (allGovSelected) {
        rows.forEach((r) => next.delete(r.id));
      } else {
        rows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  }, []);

  const toggleSelectCenter = useCallback((rows: EstRoundRow[]) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      const allCenterSelected = rows.every((r) => next.has(r.id));
      if (allCenterSelected) {
        rows.forEach((r) => next.delete(r.id));
      } else {
        rows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  }, []);

  // Collapse toggles
  const toggleCollapseGov = useCallback((gov: string) => {
    setCollapsedGovs((prev) => {
      const next = new Set(prev);
      if (next.has(gov)) next.delete(gov);
      else next.add(gov);
      return next;
    });
  }, []);

  const toggleCollapseCenter = useCallback((centerKey: string) => {
    setCollapsedCenters((prev) => {
      const next = new Set(prev);
      if (next.has(centerKey)) next.delete(centerKey);
      else next.add(centerKey);
      return next;
    });
  }, []);

  // Format English Date & Day
  const formattedRoundDate = useMemo(() => {
    if (!activeRound?.roundDate) return "";
    try {
      const d = new Date(activeRound.roundDate);
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      });
    } catch {
      return "";
    }
  }, [activeRound]);

  // Generate PDF Stickers & Logistics Documents
  const handleGeneratePdf = useCallback(
    async (
      type:
        | "room_placards"
        | "floor_placards"
        | "floor_subject_bags"
        | "building_placards"
        | "head_placards"
        | "head_bag_placards"
        | "floor_senior_bag_placards"
        | "exam_stickers"
        | "bundle"
        | "carton"
        | "carton_driver_manifest"
        | "combined_carton"
        | "combined_driver_manifest"
        | "bag"
        | "manifest"
        | "clean_skin_master"
        | "clean_skin_log"
        | "clean_skin_subjects"
        | "clean_skin_bags"
        | "center_dossier",
    ) => {
      if (!activeRoundId) return;

      try {
        setIsGenerating(true);
        setActiveActionType(type);

        const targetRowIds = selectedRowIds.size > 0
          ? Array.from(selectedRowIds)
          : filteredRows.map((r) => r.id);

        const res = await fetch(`/api/est-rounds/${activeRoundId}/stickers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            selectedRowIds: targetRowIds,
            orientation,
            paperMode: "a4",
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to generate stickers PDF");
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setPreviewPdfUrl(url);

        let typeLabel = isAr ? "استيكرات القاعات" : "Room Placards";
        if (type === "exam_stickers") typeLabel = isAr ? "مظاريف المواد (نسختين)" : "Exam Subject Stickers";
        else if (type === "floor_placards") typeLabel = isAr ? "ملفات الأدوار (Senior)" : "Floor Senior Dossiers";
        else if (type === "floor_subject_bags") typeLabel = isAr ? "أكياس مواد الأدوار (A4)" : "Floor Subject Bags";
        else if (type === "building_placards") typeLabel = isAr ? "استيكرات المباني (A4)" : "Building Placards";
        else if (type === "head_placards") typeLabel = isAr ? "ملفات رئيس المبنى" : "Building Head Dossiers";
        else if (type === "head_bag_placards" || type === "bundle") typeLabel = isAr ? "كيس رئيس المبنى (A4 بالعرض)" : "Building Head Bag Placards";
        else if (type === "floor_senior_bag_placards") typeLabel = isAr ? "كيس مشرف الدور (A4 بالعرض)" : "Floor Senior Bag Placards";
        else if (type === "carton") typeLabel = isAr ? "ستيكر كرتونة المبنى (A4)" : "Building Master Carton";
        else if (type === "carton_driver_manifest") typeLabel = isAr ? "شيت تسليم سيارات التوزيع (الكراتين)" : "Carton Delivery Manifest";
        else if (type === "combined_carton") typeLabel = isAr ? "كرتونة الامتحان المشتركة (EST 1 + EST 2)" : "Combined Master Carton";
        else if (type === "combined_driver_manifest") typeLabel = isAr ? "شيت تسليم الكراتين المشتركة" : "Combined Driver Manifest";
        else if (type === "bag") typeLabel = isAr ? "بيان محتويات شنطة الامتحان (A4)" : "Transit Bag Checklist";
        else if (type === "manifest") typeLabel = isAr ? "بيان الحصر العام للجان والمبنى" : "Master Building Manifest";
        else if (type === "clean_skin_master") typeLabel = isAr ? "شيك الكنترول (الحصر + سجل الصرف)" : "Control Room Check";
        else if (type === "clean_skin_log") typeLabel = isAr ? "سجل صرف الطوارئ" : "Clean Skin Incident Log";
        else if (type === "clean_skin_subjects") typeLabel = isAr ? "ستيكرات الكلين سكين" : "Clean Skin Stickers";
        else if (type === "clean_skin_bags") typeLabel = isAr ? "أكياس الكلين سكين للمبنى (A4 بالعرض)" : "Building Clean Skin Bag Placards";
        else if (type === "center_dossier") typeLabel = isAr ? "ستيكرات ملفات السناتر (ربع A4)" : "Center Dossier Stickers";

        setPreviewTitle(
          `${activeRound?.name || "EST"} - ${typeLabel} (${targetRowIds.length} ${isAr ? "قاعة" : "rooms"})`,
        );
        setPreviewOpen(true);
      } catch (err: any) {
        toast.error(err?.message || (isAr ? "فشل إنشاء ملف الاستيكرات" : "Failed to generate stickers PDF"));
      } finally {
        setIsGenerating(false);
        setActiveActionType(null);
      }
    },
    [activeRoundId, selectedRowIds, filteredRows, orientation, activeRound, isAr],
  );

  return (
    <div className="space-y-6 pb-16">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400 shadow-xs">
            <GraduationCap className="size-7" />
          </span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black tracking-tight text-foreground">
                {isAr ? "دورات EST (استيراد وطباعة الاستيكرات)" : "EST Exam Rounds (Import & Stickers)"}
              </h1>
              <span className="rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-300 text-[11px] font-bold px-2.5 py-0.5">
                {isAr ? "قاعدة البيانات المباشرة" : "Database Powered"}
              </span>
            </div>
            <p className="text-xs text-muted">
              {isAr
                ? "ارفع شيتات Excel لدورات EST 1 و EST 2 لتحليل البيانات وطباعة استيكرات القاعات، الأدوار، ومظاريف المواد مع تضمين التاريخ واليوم المعتمدين."
                : "Import EST 1 & EST 2 Excel sheets, view contents, and print official dossier placards and subject stickers with verified dates."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={handleSeedDefaultEst2}
            disabled={isSeedingDefault}
            className="cursor-pointer gap-1.5 text-xs h-9 px-3.5 bg-purple-600 hover:bg-purple-700 text-white shadow-xs"
          >
            {isSeedingDefault ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            <span>{isAr ? "تحميل/تحديث دورات ديسمبر 2026 (EST 1 و EST 2)" : "Sync Dec 2026 (EST 1 & 2)"}</span>
          </Button>

          <Button
            variant="secondary"
            onClick={() => void fetchRounds({ autoSelectFirst: false })}
            disabled={loadingRounds}
            className="cursor-pointer gap-1.5 text-xs h-9 px-3"
          >
            {loadingRounds ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            <span>{isAr ? "تحديث" : "Refresh"}</span>
          </Button>
        </div>
      </div>

      {/* Rounds List Grid */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-purple-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              {isAr ? "الدورات المحفوظة في قاعدة البيانات" : "Saved Exam Rounds (Database)"}
            </span>
          </div>
          <span className="text-xs font-semibold text-muted">
            {rounds.length} {isAr ? "دورة مسجلة" : "rounds"}
          </span>
        </div>

        {loadingRounds && rounds.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted">
            <Loader2 className="size-4 animate-spin me-2" />
            {isAr ? "جارٍ تحميل الدورات..." : "Loading rounds..."}
          </div>
        ) : rounds.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-soft/40 p-6 text-center text-sm text-muted">
            {isAr
              ? "لا توجد دورات مسجلة بعد. اضغط على زر 'تحميل دورة ديسمبر 2026' أعلاه أو ارفع شيت Excel جديد أدناه."
              : "No exam rounds found yet. Click 'Load Official EST 2' above or upload a new Excel sheet below."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rounds.map((round) => {
              const isSelected = activeRoundId === round.id;
              const isEst2 = round.examType === "EST 2";

              return (
                <div
                  key={round.id}
                  onClick={() => setActiveRoundId(round.id)}
                  className={cn(
                    "rounded-xl border p-4 transition-all cursor-pointer relative group",
                    isSelected
                      ? "border-purple-600 bg-purple-500/[0.05] ring-2 ring-purple-500/20 shadow-xs"
                      : "border-border bg-surface-soft/40 hover:border-purple-500/40 hover:bg-surface-soft",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span
                          className={cn(
                            "rounded-full text-[10px] font-black px-2 py-0.5",
                            isEst2 ? "bg-purple-600 text-white" : "bg-emerald-600 text-white",
                          )}
                        >
                          {round.examType}
                        </span>
                        <h3 className="text-sm font-bold text-foreground truncate" title={round.name}>
                          {round.name}
                        </h3>
                        {isSelected && (
                          <span className="rounded-full bg-purple-500/20 text-purple-700 dark:text-purple-300 text-[10px] font-bold px-1.5 py-0.5">
                            {isAr ? "نشط" : "Active"}
                          </span>
                        )}
                      </div>

                      {/* Date & Day Badge */}
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300 mt-1">
                        <Calendar className="size-3.5 shrink-0" />
                        <span>
                          {round.roundDay ? `${round.roundDay}, ` : ""}
                          {round.roundDate ? new Date(round.roundDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""}
                        </span>
                      </div>

                      {round.fileName && (
                        <p className="text-[11px] text-muted line-clamp-1 mt-1 font-mono" title={round.fileName}>
                          {round.fileName}
                        </p>
                      )}

                      {/* Stats preview */}
                      <div className="mt-2.5 text-[11px] text-muted flex flex-wrap gap-2 pt-2 border-t border-border/40">
                        <span>{round.summaryStats?.totalGovernorates || 0} {isAr ? "محافظات" : "govs"}</span>
                        <span>•</span>
                        <span>{round.summaryStats?.totalCenters || 0} {isAr ? "سناتر" : "centers"}</span>
                        <span>•</span>
                        <span className="font-bold text-foreground">{round.summaryStats?.totalRooms || 0} {isAr ? "قاعة" : "rooms"}</span>
                        <span>•</span>
                        <span className="font-bold text-purple-600">{round.summaryStats?.totalStudents || 0} {isAr ? "طالب" : "students"}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRoundToDelete(round);
                      }}
                      className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10 cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
                      title={isAr ? "حذف هذه الدورة" : "Delete this round"}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload Drag & Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const files = e.dataTransfer.files;
          if (files && files.length > 0) void handleFileUpload(files[0]);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition-all cursor-pointer",
          "border-border hover:border-purple-500 hover:bg-purple-500/[0.02]",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void handleFileUpload(e.target.files[0]);
          }}
        />
        <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform">
          {isUploading ? <Loader2 className="size-6 animate-spin" /> : <FileSpreadsheet className="size-6" />}
        </div>
        <h3 className="text-sm font-bold text-foreground">
          {isUploading
            ? (isAr ? "جارٍ استيراد وتحليل شيت الإكسيل في قاعدة البيانات..." : "Importing and analyzing Excel sheet into database...")
            : (isAr ? "اسحب شيت Excel هنا أو اضغط لرفع دورة جديدة (EST 1 أو EST 2)" : "Drop Excel sheet here or click to import new round (EST 1 or EST 2)")}
        </h3>
        <p className="mt-1 text-xs text-muted max-w-lg">
          {isAr
            ? "سيتم حفظ البيانات مباشرة في قاعدة البيانات واستخراج المحافظات، السناتر، الأدوار، والقاعات مع أعداد الطلاب لكل مادة فوراً."
            : "Data is stored directly in Postgres with automated extraction of Governorates, Centers, Floors, Rooms, and student totals."}
        </p>
      </div>

      {/* Loading active round indicator */}
      {loadingActiveRound && (
        <div className="flex items-center justify-center gap-3 p-8 rounded-2xl border border-border bg-surface shadow-xs">
          <Loader2 className="size-6 animate-spin text-purple-600" />
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">
              {isAr ? "جارٍ تحميل بيانات وتفاصيل القاعات..." : "Loading exam round rooms..."}
            </span>
            <span className="text-xs text-muted">
              {isAr ? "يرجى الانتظار ثانية واحدة" : "Please wait a moment"}
            </span>
          </div>
        </div>
      )}

      {/* Active Round Workspace */}
      {activeRound && !loadingActiveRound && (
        <div className="space-y-4">
          {/* Active Round Info Header Banner */}
          <div className="rounded-2xl border border-purple-500/30 bg-purple-500/[0.04] p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-purple-600 text-white font-black text-sm shrink-0">
                {activeRound.examType}
              </span>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-black text-foreground">{activeRound.name}</h2>
                  <span className="rounded-md bg-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-bold px-2 py-0.5">
                    {activeRound.cycleName || "December 2026"}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted mt-0.5 flex-wrap">
                  <span className="font-bold text-purple-700 dark:text-purple-300">
                    🗓️ {activeRound.roundDay ? `${activeRound.roundDay}, ` : ""}{formattedRoundDate}
                  </span>
                  <span>•</span>
                  <span>{activeRound.summaryStats?.totalRooms || sheetRows.length} {isAr ? "قاعة مسجلة" : "rooms"}</span>
                  <span>•</span>
                  <span className="font-mono text-[11px]">{activeRound.fileName}</span>
                </div>
              </div>
            </div>

            {/* Quick Sticker Generation Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-border bg-surface p-1 shadow-xs text-xs">
                <button
                  type="button"
                  onClick={() => setOrientation("portrait")}
                  className={cn(
                    "px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer",
                    orientation === "portrait"
                      ? "bg-purple-600 text-white shadow-xs"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {isAr ? "طولي (Portrait)" : "Portrait"}
                </button>
                <button
                  type="button"
                  onClick={() => setOrientation("landscape")}
                  className={cn(
                    "px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer",
                    orientation === "landscape"
                      ? "bg-purple-600 text-white shadow-xs"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {isAr ? "عرضي (Landscape)" : "Landscape"}
                </button>
              </div>
            </div>
          </div>

          {/* 5 Top Summary Statistics Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-border bg-surface p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{isAr ? "المحافظات" : "Governorates"}</span>
                <Building className="size-4 text-purple-500" />
              </div>
              <div className="mt-2 text-2xl font-black text-foreground">
                {activeRound.summaryStats?.totalGovernorates || 0}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{isAr ? "السناتر والمدارس" : "Exam Centers"}</span>
                <Building2 className="size-4 text-sky-500" />
              </div>
              <div className="mt-2 text-2xl font-black text-foreground">
                {activeRound.summaryStats?.totalCenters || 0}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{isAr ? "الأدوار" : "Floors"}</span>
                <Layers className="size-4 text-indigo-500" />
              </div>
              <div className="mt-2 text-2xl font-black text-foreground">
                {activeRound.summaryStats?.totalFloors || 0}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{isAr ? "إجمالي القاعات" : "Total Rooms"}</span>
                <Tag className="size-4 text-amber-500" />
              </div>
              <div className="mt-2 text-2xl font-black text-purple-600 dark:text-purple-400">
                {activeRound.summaryStats?.totalRooms || sheetRows.length}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-3.5 shadow-xs col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{isAr ? "إجمالي الطلاب" : "Total Students"}</span>
                <Users className="size-4 text-emerald-500" />
              </div>
              <div className="mt-2 text-2xl font-black text-emerald-600 dark:text-emerald-400">
                {activeRound.summaryStats?.totalStudents || 0}
              </div>
            </div>
          </div>

          {/* Subject Breakdown Badges */}
          {activeRound.summaryStats?.subjectTotals && (
            <div className="rounded-xl border border-border bg-surface-soft/60 p-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-muted me-1">
                {isAr ? "إجمالي المواد:" : "Subject Totals:"}
              </span>
              {Object.entries(activeRound.summaryStats.subjectTotals)
                .sort(([codeA], [codeB]) => getSubjectSortKey(codeA) - getSubjectSortKey(codeB))
                .map(([code, count]) => (
                <span
                  key={code}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-surface border border-border px-2.5 py-1 text-xs font-bold text-foreground shadow-2xs"
                >
                  <span className="text-purple-600">{code}:</span>
                  <span className="font-mono">{count}</span>
                </span>
              ))}
            </div>
          )}

          {/* Sticker Printing Categories & Actions */}
          <div className="space-y-4">
            {/* Header info */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-foreground flex items-center gap-2">
                  <Printer className="size-4 text-purple-600" />
                  <span>{isAr ? "مركز طباعة الاستيكرات والوثائق اللوجستية" : "Stickers & Logistics Printing Hub"}</span>
                </h3>
                <p className="text-[11px] text-muted">
                  {isAr
                    ? "اختر نوع الوثائق المطلوبة أدناه للطباعة أو المعاينة المباشرة (تشمل جميع وثائق الهيكل، الامتحانات، واللوجستيات)."
                    : "Select required documents below for instant preview and printing across Structure, Exams, and Logistics."}
                </p>
              </div>

              {selectedRowIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-purple-500/10 text-purple-700 dark:text-purple-300 text-xs font-bold px-2.5 py-1">
                    {isAr ? `تم تحديد ${selectedRowIds.size} قاعة للطباعة` : `${selectedRowIds.size} rooms selected`}
                  </span>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-xs text-muted hover:text-foreground underline cursor-pointer"
                  >
                    {isAr ? "إلغاء التحديد" : "Clear"}
                  </button>
                </div>
              )}
            </div>

            {/* SECTION 1: Organizational Structure (Building, Head, Floor/Senior, Room, Carton) */}
            <div className="rounded-2xl border border-purple-500/30 bg-purple-500/[0.02] p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-purple-500/20 pb-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-purple-600 text-white font-black text-xs shadow-xs">
                    1
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-foreground">
                      {isAr ? "الهيكل التنظيمي والمقرات (المبنى • الهيد • الدور / السنيور • القاعات • كرتونة المبنى)" : "Organizational Structure (Building • Head • Floor Senior • Rooms • Carton)"}
                    </h4>
                    <p className="text-[10.5px] text-muted">
                      {isAr ? "استيكرات مقرات اللجان، ملفات المشرفين، كرتونة المبنى، واستيكرات القاعات المعتمدة" : "Headquarters placards, supervisor dossiers, building carton, and room placards"}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-300">
                  {isAr ? "ملفات وإشراف المقرات" : "Structure & Dossiers"}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
                {/* 1. Building Placards (Light Red Background) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("building_placards")}
                  disabled={isGenerating}
                  className="flex flex-col items-start justify-between p-3 rounded-xl border border-rose-300 dark:border-rose-900/40 bg-rose-50/90 dark:bg-rose-950/20 hover:border-rose-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "طباعة استيكرات المباني بحجم A4 بالعرض (Landscape)" : "Print Full-page A4 Landscape Building Placards"}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="size-8 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
                      {isGenerating && activeActionType === "building_placards" ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
                    </span>
                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-mono">
                      A4 Landscape
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-rose-950 dark:text-rose-200 group-hover:text-rose-600 transition-colors">
                      {isAr ? "استيكرات المباني" : "Building Placards"}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {isAr ? "صفحة A4 بالعرض لكل مبنى" : "Full-page Landscape"}
                    </div>
                  </div>
                </button>

                {/* 2. Building Head Dossiers */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("head_placards")}
                  disabled={isGenerating}
                  className="flex flex-col items-start justify-between p-3 rounded-xl border border-border bg-surface hover:border-purple-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "طباعة استيكرات رئيس المبنى بنظام 4 في صفحة A4" : "Print Quarter-A4 Building Head Dossier Stickers"}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="size-8 rounded-lg bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold">
                      {isGenerating && activeActionType === "head_placards" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                    </span>
                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-surface-soft text-muted font-mono">
                      Quarter A4
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-foreground group-hover:text-purple-600 transition-colors">
                      {isAr ? "ملفات رئيس المبنى" : "Building Head"}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {isAr ? "استيكرات الهيد ربع A4" : "Quarter-A4 Stickers"}
                    </div>
                  </div>
                </button>

                {/* 3. Building Head Bag Placard (A4 Landscape) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("head_bag_placards")}
                  disabled={isGenerating}
                  className="flex flex-col items-start justify-between p-3 rounded-xl border border-purple-500/30 bg-purple-500/5 hover:border-purple-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "طباعة استيكر كيسة رئيس المبنى مقاس A4 بالعرض مع بيان المحتويات والمستلزمات" : "Print A4 Landscape Head Bag Placard with Enclosed Dossiers & Supplies"}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="size-8 rounded-lg bg-purple-600 text-white flex items-center justify-center font-bold shadow-xs">
                      {isGenerating && activeActionType === "head_bag_placards" ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
                    </span>
                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-700 dark:text-purple-300 font-mono">
                      A4 Landscape
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-foreground group-hover:text-purple-600 transition-colors">
                      {isAr ? "كيس رئيس المبنى" : "Head Bag Placard"}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {isAr ? "بيان محتويات كيس الهيد" : "A4 Landscape Placard"}
                    </div>
                  </div>
                </button>

                {/* 4. Floor Senior Dossiers (Light Blue Background) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("floor_placards")}
                  disabled={isGenerating}
                  className="flex flex-col items-start justify-between p-3 rounded-xl border border-sky-300 dark:border-sky-900/40 bg-sky-50/90 dark:bg-sky-950/20 hover:border-sky-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "طباعة ملفات المشرفين للأدوار (Senior)" : "Print Floor Senior Dossiers"}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="size-8 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center font-bold">
                      {isGenerating && activeActionType === "floor_placards" ? <Loader2 className="size-4 animate-spin" /> : <Layers className="size-4" />}
                    </span>
                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 font-mono">
                      Quarter A4
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-sky-950 dark:text-sky-200 group-hover:text-sky-600 transition-colors">
                      {isAr ? "ملفات الأدوار (Senior)" : "Floor Dossiers"}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {isAr ? "ملفات السنيور للأدوار" : "Senior Supervisor"}
                    </div>
                  </div>
                </button>

                {/* 5. Floor Senior Bag Placard (A4 Landscape) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("floor_senior_bag_placards")}
                  disabled={isGenerating}
                  className="flex flex-col items-start justify-between p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 hover:border-indigo-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "طباعة استيكر كيسة السنيور (مشرف الدور) مقاس A4 بالعرض مع بيان المحتويات والقاعات" : "Print A4 Landscape Floor Senior Bag Placard with Assigned Rooms & Supplies"}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="size-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold shadow-xs">
                      {isGenerating && activeActionType === "floor_senior_bag_placards" ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
                    </span>
                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-mono">
                      A4 Landscape
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-foreground group-hover:text-indigo-600 transition-colors">
                      {isAr ? "كيس مشرف الدور" : "Floor Senior Bag"}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {isAr ? "بيان محتويات كيس الدور" : "A4 Landscape Placard"}
                    </div>
                  </div>
                </button>

                {/* 6. Room Placards (Light Yellow Background) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("room_placards")}
                  disabled={isGenerating}
                  className="flex flex-col items-start justify-between p-3 rounded-xl border border-amber-300 dark:border-amber-800/50 bg-amber-50/90 dark:bg-amber-950/25 hover:border-amber-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "طباعة استيكرات القاعات بنظام 4 في صفحة A4 مع جداول التحقق" : "Print 4-Up A4 Room Dossier Placards"}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="size-8 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold">
                      {isGenerating && activeActionType === "room_placards" ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
                    </span>
                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-mono">
                      4-Up A4
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-amber-950 dark:text-amber-100 group-hover:text-amber-700 transition-colors">
                      {isAr ? "استيكرات القاعات" : "Room Placards"}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {isAr ? "مع كشوفات وجداول التحقق" : "With student checklist"}
                    </div>
                  </div>
                </button>

                {/* 7. Carton Placard (Moved from Sec 3, Light Brown Cardboard Color) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("carton")}
                  disabled={isGenerating}
                  className="flex flex-col items-start justify-between p-3 rounded-xl border border-[#d6c5b0] dark:border-amber-800/40 bg-[#f9f4ed] dark:bg-amber-950/20 hover:border-[#b89f82] hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "ورقة مقاس A4 بالعرض تلصق على الكرتونة الخارجية مرقمة تسلسلياً لكل سنتر ومبنى" : "Master Building Carton Placard (A4 Landscape, Sequentially Numbered)"}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="size-8 rounded-lg bg-[#e8dbcc] text-[#735334] dark:bg-amber-900/40 dark:text-amber-300 flex items-center justify-center font-bold">
                      {isGenerating && activeActionType === "carton" ? <Loader2 className="size-4 animate-spin" /> : <Boxes className="size-4" />}
                    </span>
                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-[#ebdccb] text-[#5c3e21] dark:bg-amber-900/30 dark:text-amber-200 font-mono">
                      A4 Land
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[#5c3e21] dark:text-amber-200 group-hover:text-[#8a5b2f] transition-colors">
                      {isAr ? "كرتونة المبنى" : "Carton Placard"}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {isAr ? "مرقمة تسلسلياً للسناتر" : "Sequentially Numbered"}
                    </div>
                  </div>
                </button>

                {/* 8. Control Check (Emergency Packet in Sec 1) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("clean_skin_master")}
                  disabled={isGenerating}
                  className="flex flex-col items-start justify-between p-3 rounded-xl border border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10 hover:border-rose-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "بيان تدقيق وحصر الكنترول مع سجل الصرف لموظفي الكنترول" : "Control Room Check & Log (2-Page Dossier)"}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="size-8 rounded-lg bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
                      {isGenerating && activeActionType === "clean_skin_master" ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}
                    </span>
                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-700 dark:text-rose-300 font-mono">
                      2 Pages
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-rose-950 dark:text-rose-200">
                      {isAr ? "شيك الكنترول" : "Control Check"}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {isAr ? "الحصر + سجل الصرف" : "Manifest + Log"}
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* SECTION 2: Exam Envelopes & Floor Subject Bags */}
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.02] p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-amber-600 text-white font-black text-xs shadow-xs">
                    2
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-foreground">
                      {isAr ? "مظاريف الامتحانات وأكياس مواد الأدوار (المواد • الفترات • أكياس الأدوار • الحصر العام)" : "Exam Envelopes & Floor Subject Bags (Subjects • Periods • Floor Bags)"}
                    </h4>
                    <p className="text-[10.5px] text-muted">
                      {isAr ? "مظاريف أوراق الأسئلة والإجابة للقاعات، أكياس المواد المخصصة لكل دور، وبيان الحصر والكلين سكين" : "Question & Answer subject envelopes, floor subject bags, master manifest, and clean skin"}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  {isAr ? "مظاريف وأكياس المواد" : "Envelopes & Subject Bags"}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* 1. Exam Subject Envelopes (Light Gray Background) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("exam_stickers")}
                  disabled={isGenerating}
                  className="flex items-center gap-3.5 p-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/40 hover:border-slate-400 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "طباعة نسختين لكل مادة في كل قاعة (مظروف الأسئلة ومظروف كراسات الإجابة)" : "Print 2 copies per subject per room"}
                >
                  <span className="size-10 rounded-xl bg-slate-200/80 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold shrink-0">
                    {isGenerating && activeActionType === "exam_stickers" ? <Loader2 className="size-5 animate-spin" /> : <FileSpreadsheet className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-primary transition-colors">
                        {isAr ? "مظاريف المواد للقاعات (نسختين)" : "Room Subject Exam Stickers"}
                      </div>
                      <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-surface-soft text-muted font-mono">
                        Quarter A4
                      </span>
                    </div>
                    <div className="text-[11px] text-muted line-clamp-1">
                      {isAr ? "نسخة لأوراق الأسئلة ونسخة لكراسات الإجابة مع أسماء ومواعيد الفترات" : "2 copies per subject: Question envelope & Answer sheet envelope"}
                    </div>
                  </div>
                </button>

                {/* 2. Floor Subject Bags Placards */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("floor_subject_bags")}
                  disabled={isGenerating}
                  className="flex items-center gap-3.5 p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "طباعة استيكرات أكياس المواد للأدوار بالحجم الكبير A4 بالعرض مع تفصيل اللجان وأعداد الطلاب" : "Print A4 Landscape Floor Subject Bag Placards with Room Directory & Student Counts"}
                >
                  <span className="size-10 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold shrink-0">
                    {isGenerating && activeActionType === "floor_subject_bags" ? <Loader2 className="size-5 animate-spin" /> : <ShoppingBag className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
                        {isAr ? "أكياس مواد الأدوار (A4 بالعرض)" : "Floor Subject Bag Placards"}
                      </div>
                      <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 font-mono">
                        A4 Landscape
                      </span>
                    </div>
                    <div className="text-[11px] text-muted line-clamp-1">
                      {isAr ? "استيكر كيس المادة لكل دور مع جدول تفصيلي بالقاعات وأعداد طلابها" : "Dedicated A4 Landscape placard per floor per subject with room breakdown"}
                    </div>
                  </div>
                </button>

                {/* 3. Building Clean Skin Bags Placards */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("clean_skin_bags")}
                  disabled={isGenerating}
                  className="flex items-center gap-3.5 p-3.5 rounded-xl border border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10 hover:border-rose-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "طباعة استيكرات أكياس الكلين سكين (طوارئ الكنترول) لكل مبنى بالحجم الكبير A4 بالعرض حسب مواد الامتحان" : "Print A4 Landscape Clean Skin Bag Placards per Building per Subject"}
                >
                  <span className="size-10 rounded-xl bg-rose-500/20 text-rose-700 dark:text-rose-300 flex items-center justify-center font-bold shrink-0">
                    {isGenerating && activeActionType === "clean_skin_bags" ? <Loader2 className="size-5 animate-spin" /> : <ShieldAlert className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="text-xs font-bold text-rose-950 dark:text-rose-200">
                        {isAr ? "أكياس كلين سكين للمبنى (A4 بالعرض)" : "Clean Skin Bag Placards"}
                      </div>
                      <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-800 dark:text-rose-200 font-mono">
                        A4 Landscape
                      </span>
                    </div>
                    <div className="text-[11px] text-muted line-clamp-1">
                      {isAr ? "ورقة بالعرض على كيس الطوارئ لكل مبنى حسب المواد (EST 1 أو EST 2)" : "Dedicated A4 Landscape placard per building per subject for emergency reserve bags"}
                    </div>
                  </div>
                </button>

                {/* 4. Master Manifest (Moved from Sec 3 to Sec 2 per manager request) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("manifest")}
                  disabled={isGenerating}
                  className="flex items-center gap-3.5 p-3.5 rounded-xl border border-sky-500/30 bg-sky-500/5 hover:bg-sky-500/10 hover:border-sky-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "ورقة بالعرض A4 تجمع كافة تفاصيل السنتر والمبنى: الأدوار، القاعات، ومواد وأعداد EST 1 و EST 2 مع تظليل وتمييز إحصائي متقن" : "Master Center & Building Manifest (A4 Landscape Blueprint)"}
                >
                  <span className="size-10 rounded-xl bg-sky-500/20 text-sky-700 dark:text-sky-300 flex items-center justify-center font-bold shrink-0">
                    {isGenerating && activeActionType === "manifest" ? <Loader2 className="size-5 animate-spin" /> : <ClipboardList className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="text-xs font-bold text-sky-950 dark:text-sky-200">
                        {isAr ? "بيان الحصر العام" : "Master Manifest"}
                      </div>
                      <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-800 dark:text-sky-200 font-mono">
                        A4 Landscape
                      </span>
                    </div>
                    <div className="text-[11px] text-muted line-clamp-1">
                      {isAr ? "مخطط الحصر الشامل لكافة اللجان والمواد بالعرض" : "Landscape Blueprint A4"}
                    </div>
                  </div>
                </button>

                {/* 5. Clean Skin Stickers (Moved from Sec 3 to Sec 2 per manager request) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("clean_skin_subjects")}
                  disabled={isGenerating}
                  className="flex items-center gap-3.5 p-3.5 rounded-xl border border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10 hover:border-orange-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "ستيكرات ربع A4 مقسمة 4 في الصفحة للمواد تحمل عنوان CLEAN SKIN وخانة عدد فارغة للتعبئة اليدوية" : "Quarter-A4 Clean Skin stickers with blank quantity boxes for manual pen entry"}
                >
                  <span className="size-10 rounded-xl bg-orange-500/20 text-orange-700 dark:text-orange-300 flex items-center justify-center font-bold shrink-0">
                    {isGenerating && activeActionType === "clean_skin_subjects" ? <Loader2 className="size-5 animate-spin" /> : <Tag className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="text-xs font-bold text-orange-950 dark:text-orange-200">
                        {isAr ? "ستيكرات كلين سكين" : "Clean Skin Stickers"}
                      </div>
                      <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-orange-500/20 text-orange-800 dark:text-orange-200 font-mono">
                        Quarter A4
                      </span>
                    </div>
                    <div className="text-[11px] text-muted line-clamp-1">
                      {isAr ? "CLEAN SKIN للمواد مع خانة التعبئة" : "Clean Skin Only"}
                    </div>
                  </div>
                </button>

                {/* 6. Control Check (Emergency Packet in Sec 2 per manager request) */}
                <button
                  type="button"
                  onClick={() => void handleGeneratePdf("clean_skin_master")}
                  disabled={isGenerating}
                  className="flex items-center gap-3.5 p-3.5 rounded-xl border border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10 hover:border-rose-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                  title={isAr ? "بيان تدقيق وحصر الكنترول مع سجل الصرف لموظفي الكنترول" : "Control Room Check & Log (2-Page Dossier)"}
                >
                  <span className="size-10 rounded-xl bg-rose-500/20 text-rose-700 dark:text-rose-300 flex items-center justify-center font-bold shrink-0">
                    {isGenerating && activeActionType === "clean_skin_master" ? <Loader2 className="size-5 animate-spin" /> : <ShieldAlert className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="text-xs font-bold text-rose-950 dark:text-rose-200">
                        {isAr ? "شيك الكنترول" : "Control Check"}
                      </div>
                      <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-800 dark:text-rose-200 font-mono">
                        2 Pages
                      </span>
                    </div>
                    <div className="text-[11px] text-muted line-clamp-1">
                      {isAr ? "الحصر + سجل الصرف لموظفي الكنترول" : "Manifest + Log Sheet"}
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* SECTION 3: Logistics, Transit Bags & Shipping (Collapsible, Closed by default per manager request) */}
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/[0.02] p-4 shadow-xs space-y-3">
              <button
                type="button"
                onClick={() => setIsSection3Open(!isSection3Open)}
                className="flex items-center justify-between w-full border-b border-indigo-500/20 pb-2 text-start cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-black text-xs shadow-xs">
                    3
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-foreground group-hover:text-indigo-600 transition-colors flex items-center gap-1.5">
                      {isAr ? "اللوجستيات وسيارات التوزيع والشنط (شيتات التوزيع • الشنط • سجل الصرف)" : "Logistics, Transit Bags & Shipping (Driver Manifests • Transit Bag • Log)"}
                      {isSection3Open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
                    </h4>
                    <p className="text-[10.5px] text-muted">
                      {isAr ? (isSection3Open ? "انقر للطي والإغلاق" : "قسم مغلق افتراضياً - انقر للفتح والاستعراض") : (isSection3Open ? "Click to collapse" : "Closed by default - click to expand")}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                  {isSection3Open ? (isAr ? "مفتوح" : "Expanded") : (isAr ? "مغلق (انقر للفتح)" : "Collapsed")}
                </span>
              </button>

              {isSection3Open && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    {/* 1. Driver Delivery Manifest */}
                    <button
                      type="button"
                      onClick={() => void handleGeneratePdf("carton_driver_manifest")}
                      disabled={isGenerating}
                      className="flex flex-col items-start justify-between p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/5 hover:bg-indigo-500/10 hover:border-indigo-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                      title={isAr ? "شيت مجمع لسيارة التوزيع يوضح أرقام الكراتين، السناتر، اللجان، وتوقيعات الاستلام" : "Consolidated Master Carton Delivery Manifest for Driver / Carrier"}
                    >
                      <div className="flex items-center justify-between w-full mb-2">
                        <span className="size-8 rounded-lg bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold">
                          {isGenerating && activeActionType === "carton_driver_manifest" ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
                        </span>
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 font-mono">
                          A4 Driver
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-indigo-950 dark:text-indigo-200 group-hover:text-indigo-600 transition-colors">
                          {isAr ? "شيت سيارات التوزيع" : "Driver Manifest"}
                        </div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {isAr ? "كشف استلام الكراتين" : "Delivery Truck Sheet"}
                        </div>
                      </div>
                    </button>

                    {/* 2. Combined Carton Placard (EST 1 + EST 2) */}
                    <button
                      type="button"
                      onClick={() => void handleGeneratePdf("combined_carton")}
                      disabled={isGenerating}
                      className="flex flex-col items-start justify-between p-3 rounded-xl border border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10 hover:border-purple-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                      title={isAr ? "كرتونة الامتحان المشتركة تجمع مواد EST 1 و EST 2 معاً في كرتونة واحدة لكل سنتر" : "Combined Master Carton (EST 1 + EST 2 Together)"}
                    >
                      <div className="flex items-center justify-between w-full mb-2">
                        <span className="size-8 rounded-lg bg-purple-500/20 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold">
                          {isGenerating && activeActionType === "combined_carton" ? <Loader2 className="size-4 animate-spin" /> : <Boxes className="size-4" />}
                        </span>
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-800 dark:text-purple-200 font-mono">
                          EST 1+2
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-purple-950 dark:text-purple-200 group-hover:text-purple-600 transition-colors">
                          {isAr ? "كرتونة الامتحان المشتركة" : "Combined Carton"}
                        </div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {isAr ? "EST 1 + EST 2 معاً" : "EST I & II in 1 Box"}
                        </div>
                      </div>
                    </button>

                    {/* 3. Combined Driver Manifest */}
                    <button
                      type="button"
                      onClick={() => void handleGeneratePdf("combined_driver_manifest")}
                      disabled={isGenerating}
                      className="flex flex-col items-start justify-between p-3 rounded-xl border border-border bg-surface hover:border-purple-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                      title={isAr ? "شيت مجمع لسيارات التوزيع خاص بالكراتين المشتركة (EST 1 + EST 2)" : "Consolidated Driver Manifest for Combined Cartons"}
                    >
                      <div className="flex items-center justify-between w-full mb-2">
                        <span className="size-8 rounded-lg bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold">
                          {isGenerating && activeActionType === "combined_driver_manifest" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                        </span>
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-surface-soft text-muted font-mono">
                          A4 Driver
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-foreground group-hover:text-purple-600 transition-colors">
                          {isAr ? "شيت تسليم المشترك" : "Combined Manifest"}
                        </div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {isAr ? "كشف سيارات EST 1+2" : "EST I & II Truck Sheet"}
                        </div>
                      </div>
                    </button>

                    {/* 4. Transit Bag Checklist */}
                    <button
                      type="button"
                      onClick={() => void handleGeneratePdf("bag")}
                      disabled={isGenerating}
                      className="flex flex-col items-start justify-between p-3 rounded-xl border border-border bg-surface hover:border-indigo-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                      title={isAr ? "بيان A4 رأسي ملصق على شنطة نقل أوراق الإجابة والأسئلة لتأكيد استلام أكياس كل قاعة" : "Transit Bag Exam Checklist (A4 Portrait)"}
                    >
                      <div className="flex items-center justify-between w-full mb-2">
                        <span className="size-8 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold">
                          {isGenerating && activeActionType === "bag" ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
                        </span>
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-surface-soft text-muted font-mono">
                          A4 Port
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-foreground group-hover:text-indigo-600 transition-colors">
                          {isAr ? "شنطة الامتحان" : "Transit Bag"}
                        </div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {isAr ? "بيان محتويات الشنطة" : "Bag Checklist"}
                        </div>
                      </div>
                    </button>

                    {/* 5. Clean Skin Log Sheet */}
                    <button
                      type="button"
                      onClick={() => void handleGeneratePdf("clean_skin_log")}
                      disabled={isGenerating}
                      className="flex flex-col items-start justify-between p-3 rounded-xl border border-border bg-surface hover:border-indigo-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                      title={isAr ? "جدول سجل صرف الطوارئ لكيس الكنترول المسطر بـ 18 صفاً" : "Clean Skin Emergency Dispatch Log Sheet"}
                    >
                      <div className="flex items-center justify-between w-full mb-2">
                        <span className="size-8 rounded-lg bg-red-500/10 text-red-600 flex items-center justify-center font-bold">
                          {isGenerating && activeActionType === "clean_skin_log" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                        </span>
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-surface-soft text-muted font-mono">
                          18 Rows
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-foreground group-hover:text-indigo-600 transition-colors">
                          {isAr ? "سجل صرف الطوارئ" : "Incident Log"}
                        </div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {isAr ? "سجل استهلاك الطوارئ" : "Dispatch Log Sheet"}
                        </div>
                      </div>
                    </button>

                    {/* 6. Center Dossier Stickers (Quarter A4) */}
                    <button
                      type="button"
                      onClick={() => void handleGeneratePdf("center_dossier")}
                      disabled={isGenerating}
                      className="flex flex-col items-start justify-between p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/5 hover:bg-indigo-500/10 hover:border-indigo-500 hover:shadow-xs transition-all cursor-pointer text-start group disabled:opacity-50"
                      title={isAr ? "ستيكر ربع A4 يوضع على فايل السنتر المتجه للقاهرة، يوضح ملخص مباني وأدوار EST 1 و EST 2 مع بيان المحتويات" : "Quarter-A4 Center Dossier Sticker for Cairo File (EST 1 & EST 2 Buildings & Floors Summary)"}
                    >
                      <div className="flex items-center justify-between w-full mb-2">
                        <span className="size-8 rounded-lg bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold">
                          {isGenerating && activeActionType === "center_dossier" ? <Loader2 className="size-4 animate-spin" /> : <FolderArchive className="size-4" />}
                        </span>
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 font-mono">
                          1/4 A4
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-indigo-950 dark:text-indigo-200 group-hover:text-indigo-600 transition-colors">
                          {isAr ? "استيكر ملف السنتر" : "Center Dossier"}
                        </div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {isAr ? "ملخص المباني والأدوار" : "EST 1+2 Buildings & Floors"}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Filter, Search, and Bulk Selection Bar */}
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                {/* Search Input */}
                <div className="relative flex-1 min-w-[180px] max-w-xs">
                  <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isAr ? "ابحث بالقاعة، السنتر، أو المحافظة..." : "Search room, center, gov..."}
                    className="ps-8 text-xs h-8.5"
                  />
                </div>

                {/* Governorate Filter Dropdown */}
                <select
                  value={selectedGov}
                  onChange={(e) => {
                    setSelectedGov(e.target.value);
                    setSelectedCenter("all");
                  }}
                  className="rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground focus:outline-hidden focus:ring-2 focus:ring-purple-500/30 cursor-pointer h-8.5"
                >
                  <option value="all">{isAr ? "كل المحافظات" : "All Governorates"}</option>
                  {availableGovs.map((gov) => (
                    <option key={gov} value={gov}>
                      {gov}
                    </option>
                  ))}
                </select>

                {/* Center Filter Dropdown */}
                <select
                  value={selectedCenter}
                  onChange={(e) => setSelectedCenter(e.target.value)}
                  className="rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground focus:outline-hidden focus:ring-2 focus:ring-purple-500/30 cursor-pointer h-8.5 max-w-[220px]"
                >
                  <option value="all">{isAr ? "كل السناتر" : "All Test Centers"}</option>
                  {availableCenters.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Selection Summary Badge & Buttons */}
              <div className="flex items-center gap-2">
                {selectedRowIds.size > 0 ? (
                  <div className="flex items-center gap-2 bg-purple-500/15 border border-purple-500/30 text-purple-800 dark:text-purple-200 px-3 py-1.5 rounded-xl text-xs font-bold">
                    <CheckSquare className="size-3.5" />
                    <span>
                      {isAr
                        ? `محدد (${selectedRowIds.size}) من ${filteredRows.length}`
                        : `Selected (${selectedRowIds.size}) of ${filteredRows.length}`}
                    </span>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="text-xs underline hover:text-purple-950 dark:hover:text-white cursor-pointer ms-1"
                    >
                      {isAr ? "إلغاء التحديد" : "Clear"}
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={selectAllFiltered}
                    className="cursor-pointer gap-1.5 text-xs h-8.5 px-3"
                  >
                    <CheckSquare className="size-3.5" />
                    <span>{isAr ? "تحديد الكل" : "Select All"}</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Quick Subject Filter Shortcuts */}
            <div className="pt-2.5 border-t border-border/50 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-muted flex items-center gap-1 me-1">
                  <Sparkles className="size-3 text-purple-600" />
                  <span>{isAr ? "اختصارات المواد:" : "Subject Shortcuts:"}</span>
                </span>

                {/* All Pill */}
                <button
                  type="button"
                  onClick={() => setSubjectShortcut("all")}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border",
                    subjectShortcut === "all"
                      ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                      : "bg-surface hover:bg-surface-soft border-border text-foreground hover:border-purple-300",
                  )}
                >
                  <span>{isAr ? "جميع القاعات" : "All Rooms"}</span>
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.2 rounded-full font-black",
                      subjectShortcut === "all" ? "bg-white/20 text-white" : "bg-muted/15 text-muted",
                    )}
                  >
                    {shortcutCounts.all}
                  </span>
                </button>

                {/* EST 1 specific shortcuts */}
                {activeRound?.examType !== "EST 2" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSubjectShortcut(subjectShortcut === "essay" ? "all" : "essay")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border",
                        subjectShortcut === "essay"
                          ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                          : "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      <span>✍️ {isAr ? "قاعات المقال (Essay)" : "Essay Rooms"}</span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.2 rounded-full font-black",
                          subjectShortcut === "essay" ? "bg-white/20 text-white" : "bg-amber-500/20 text-amber-800 dark:text-amber-200",
                        )}
                      >
                        {shortcutCounts.essay || 0}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSubjectShortcut(subjectShortcut === "no_essay" ? "all" : "no_essay")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border",
                        subjectShortcut === "no_essay"
                          ? "bg-slate-700 text-white border-slate-700 shadow-xs"
                          : "bg-surface hover:bg-surface-soft border-border text-muted hover:text-foreground",
                      )}
                    >
                      <span>{isAr ? "بدون مقال" : "Without Essay"}</span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.2 rounded-full font-black",
                          subjectShortcut === "no_essay" ? "bg-white/20 text-white" : "bg-muted/15 text-muted",
                        )}
                      >
                        {shortcutCounts.no_essay || 0}
                      </span>
                    </button>
                  </>
                )}

                {/* EST 2 specific shortcuts */}
                {activeRound?.examType === "EST 2" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSubjectShortcut(subjectShortcut === "math2" ? "all" : "math2")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border",
                        subjectShortcut === "math2"
                          ? "bg-violet-600 text-white border-violet-600 shadow-xs"
                          : "bg-violet-500/10 hover:bg-violet-500/20 border-violet-500/30 text-violet-700 dark:text-violet-300",
                      )}
                    >
                      <span>📐 {isAr ? "ماث 2 (Math 2)" : "Math 2"}</span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.2 rounded-full font-black",
                          subjectShortcut === "math2" ? "bg-white/20 text-white" : "bg-violet-500/20 text-violet-800 dark:text-violet-200",
                        )}
                      >
                        {shortcutCounts.math2 || 0}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSubjectShortcut(subjectShortcut === "chem" ? "all" : "chem")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border",
                        subjectShortcut === "chem"
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                          : "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
                      )}
                    >
                      <span>🧪 {isAr ? "كيمياء (Chemistry)" : "Chemistry"}</span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.2 rounded-full font-black",
                          subjectShortcut === "chem" ? "bg-white/20 text-white" : "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200",
                        )}
                      >
                        {shortcutCounts.chem || 0}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSubjectShortcut(subjectShortcut === "bio" ? "all" : "bio")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border",
                        subjectShortcut === "bio"
                          ? "bg-teal-600 text-white border-teal-600 shadow-xs"
                          : "bg-teal-500/10 hover:bg-teal-500/20 border-teal-500/30 text-teal-700 dark:text-teal-300",
                      )}
                    >
                      <span>🧬 {isAr ? "أحياء (Biology)" : "Biology"}</span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.2 rounded-full font-black",
                          subjectShortcut === "bio" ? "bg-white/20 text-white" : "bg-teal-500/20 text-teal-800 dark:text-teal-200",
                        )}
                      >
                        {shortcutCounts.bio || 0}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSubjectShortcut(subjectShortcut === "math1" ? "all" : "math1")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border",
                        subjectShortcut === "math1"
                          ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                          : "bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/30 text-blue-700 dark:text-blue-300",
                      )}
                    >
                      <span>📊 {isAr ? "ماث 1 (Math 1)" : "Math 1"}</span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.2 rounded-full font-black",
                          subjectShortcut === "math1" ? "bg-white/20 text-white" : "bg-blue-500/20 text-blue-800 dark:text-blue-200",
                        )}
                      >
                        {shortcutCounts.math1 || 0}
                      </span>
                    </button>

                    {(shortcutCounts.phy || 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => setSubjectShortcut(subjectShortcut === "phy" ? "all" : "phy")}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border",
                          subjectShortcut === "phy"
                            ? "bg-sky-600 text-white border-sky-600 shadow-xs"
                            : "bg-sky-500/10 hover:bg-sky-500/20 border-sky-500/30 text-sky-700 dark:text-sky-300",
                        )}
                      >
                        <span>⚛️ {isAr ? "فيزياء (Physics)" : "Physics"}</span>
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.2 rounded-full font-black",
                            subjectShortcut === "phy" ? "bg-white/20 text-white" : "bg-sky-500/20 text-sky-800 dark:text-sky-200",
                          )}
                        >
                          {shortcutCounts.phy || 0}
                        </span>
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Quick Select Filtered Action */}
              {subjectShortcut !== "all" && filteredRows.length > 0 && (
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-xs font-bold text-purple-700 dark:text-purple-300 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <CheckSquare className="size-3.5" />
                  <span>
                    {isAr
                      ? `تحديد هذه القاعات فقط (${filteredRows.length})`
                      : `Select only these rooms (${filteredRows.length})`}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Grouped Data Table */}
          <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
            {filteredRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted">
                {isAr ? "لا توجد قاعات مطابقة للبحث أو التصفية الحالية." : "No rooms match the current search or filters."}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {Array.from(groupedData.entries()).map(([govName, centersMap]) => {
                  const govRows = Array.from(centersMap.values()).flat();
                  const isGovCollapsed = collapsedGovs.has(govName);
                  const isGovSelected = govRows.every((r) => selectedRowIds.has(r.id));
                  const isGovSomeSelected = !isGovSelected && govRows.some((r) => selectedRowIds.has(r.id));

                  return (
                    <div key={govName} className="bg-surface">
                      {/* Governorate Header */}
                      <div className="bg-surface-soft/80 px-4 py-2.5 flex items-center justify-between border-b border-border/40 select-none">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => toggleCollapseGov(govName)}
                            className="p-1 rounded hover:bg-border/40 cursor-pointer text-muted"
                          >
                            {isGovCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleSelectGov(govName, govRows)}
                            className="text-purple-600 hover:text-purple-700 cursor-pointer"
                          >
                            {isGovSelected ? (
                              <CheckSquare className="size-4.5" />
                            ) : isGovSomeSelected ? (
                              <Square className="size-4.5 fill-purple-500/20" />
                            ) : (
                              <Square className="size-4.5" />
                            )}
                          </button>

                          <span className="font-black text-sm text-foreground flex items-center gap-2">
                            <span>🏛️ {govName}</span>
                            <span className="text-xs font-normal text-muted">
                              ({centersMap.size} {isAr ? "سناتر" : "centers"}, {govRows.length} {isAr ? "قاعة" : "rooms"})
                            </span>
                          </span>
                        </div>

                        <span className="text-xs font-bold text-purple-600 bg-purple-500/10 px-2.5 py-0.5 rounded-full">
                          {govRows.reduce((sum, r) => sum + r.totalStudents, 0)} {isAr ? "طالب" : "students"}
                        </span>
                      </div>

                      {/* Centers inside this governorate */}
                      {!isGovCollapsed && (
                        <div className="divide-y divide-border/30">
                          {Array.from(centersMap.entries()).map(([centerName, centerRows]) => {
                            const centerKey = `${govName}::${centerName}`;
                            const isCenterCollapsed = collapsedCenters.has(centerKey);
                            const isCenterSelected = centerRows.every((r) => selectedRowIds.has(r.id));
                            const isCenterSomeSelected = !isCenterSelected && centerRows.some((r) => selectedRowIds.has(r.id));

                            return (
                              <div key={centerKey} className="ps-4 sm:ps-6">
                                {/* Center Header */}
                                <div className="py-2 pe-4 flex items-center justify-between border-b border-border/20 select-none">
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => toggleCollapseCenter(centerKey)}
                                      className="p-0.5 rounded hover:bg-border/40 cursor-pointer text-muted"
                                    >
                                      {isCenterCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => toggleSelectCenter(centerRows)}
                                      className="text-purple-600 hover:text-purple-700 cursor-pointer"
                                    >
                                      {isCenterSelected ? (
                                        <CheckSquare className="size-4" />
                                      ) : isCenterSomeSelected ? (
                                        <Square className="size-4 fill-purple-500/20" />
                                      ) : (
                                        <Square className="size-4" />
                                      )}
                                    </button>

                                    <span className="text-xs font-bold text-foreground">
                                      🏫 {centerName}
                                      <span className="text-[11px] font-normal text-muted ms-2">
                                        ({centerRows.length} {isAr ? "قاعة" : "rooms"})
                                      </span>
                                    </span>
                                  </div>

                                  <span className="text-[11px] font-semibold text-muted">
                                    {centerRows.reduce((s, r) => s + r.totalStudents, 0)} {isAr ? "طالب" : "students"}
                                  </span>
                                </div>

                                {/* Rooms Table for this Center */}
                                {!isCenterCollapsed && (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-start border-collapse">
                                      <thead>
                                        <tr className="border-b border-border/40 text-muted bg-surface-soft/30 text-[11px]">
                                          <th className="py-1.5 px-3 w-8 text-center"></th>
                                          <th className="py-1.5 px-3 text-start font-semibold">{isAr ? "القاعة" : "Room"}</th>
                                          <th className="py-1.5 px-3 text-start font-semibold">{isAr ? "المبنى" : "Building"}</th>
                                          <th className="py-1.5 px-3 text-start font-semibold">{isAr ? "الدور" : "Floor"}</th>
                                          {subjectColumns.map((col) => (
                                            <th key={col.code} className="py-1.5 px-3 text-center font-semibold">
                                              {col.label}
                                            </th>
                                          ))}
                                          <th className="py-1.5 px-3 text-center font-semibold">{isAr ? "إجمالي القاعة" : "Total"}</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-border/20">
                                        {centerRows.map((row) => {
                                          const isSelected = selectedRowIds.has(row.id);
                                          return (
                                            <tr
                                              key={row.id}
                                              onClick={() => toggleSelectRow(row.id)}
                                              className={cn(
                                                "transition-colors cursor-pointer hover:bg-purple-500/[0.04]",
                                                isSelected && "bg-purple-500/[0.07]",
                                              )}
                                            >
                                              <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                  type="checkbox"
                                                  checked={isSelected}
                                                  onChange={() => toggleSelectRow(row.id)}
                                                  className="size-4 rounded accent-purple-600 cursor-pointer"
                                                />
                                              </td>
                                              <td className="py-2 px-3 font-bold text-foreground">
                                                <div className="flex items-center gap-1.5">
                                                  <span>{row.room}</span>
                                                  {row.rawRoom !== row.room && (
                                                    <span className="text-[10px] text-muted font-normal">
                                                      ({row.rawRoom})
                                                    </span>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="py-2 px-3 text-muted">
                                                {(row as any).building && (row as any).building.toLowerCase() !== row.center.toLowerCase() ? (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300 font-medium text-[10.5px]">
                                                    🏢 {(row as any).building}
                                                  </span>
                                                ) : (
                                                  <span className="text-muted/50 text-[10.5px]">—</span>
                                                )}
                                              </td>
                                              <td className="py-2 px-3 text-muted">{row.floor}</td>
                                              {subjectColumns.map((col) => {
                                                const count = row.subjects[col.code] ?? 0;
                                                return (
                                                  <td
                                                    key={col.code}
                                                    className={cn(
                                                      "py-2 px-3 text-center font-mono",
                                                      count > 0 ? "font-bold text-foreground" : "text-muted/40",
                                                    )}
                                                  >
                                                    {count > 0 ? count : "—"}
                                                  </td>
                                                );
                                              })}
                                              <td className="py-2 px-3 text-center font-mono font-black text-purple-600 dark:text-purple-400">
                                                {row.totalStudents}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Round Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(roundToDelete)}
        title={isAr ? "تأكيد حذف الدورة" : "Confirm Round Deletion"}
        description={
          isAr
            ? `هل أنت متأكد من حذف الدورة "${roundToDelete?.name}"؟ سيتم حذف جميع بيانات القاعات المرتبطة بها من قاعدة البيانات نهائياً.`
            : `Are you sure you want to delete round "${roundToDelete?.name}"? All associated room data will be permanently removed.`
        }
        confirmLabel={isAr ? "حذف الدورة" : "Delete Round"}
        confirmVariant="danger"
        onConfirm={() => {
          if (roundToDelete) void handleDeleteRound(roundToDelete.id);
        }}
        onClose={() => setRoundToDelete(null)}
        loading={deletingRound}
      />

      {/* PDF Sticker Preview Modal */}
      <StickerPreviewModal
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          if (previewPdfUrl) {
            URL.revokeObjectURL(previewPdfUrl);
            setPreviewPdfUrl(null);
          }
        }}
        pdfUrl={previewPdfUrl}
        title={previewTitle}
        customTitle={isAr ? "معاينة الاستيكرات والملصقات المعتمدة" : "Official Stickers & Placards Preview"}
        customDescription={
          isAr
            ? "جاهز للطباعة المباشرة بأعلى جودة متضمناً شعار EST والتاريخ واليوم وجداول التحقق."
            : "Print-ready high resolution document with official EST logo, date/day, and verification checklists."
        }
      />
    </div>
  );
}
