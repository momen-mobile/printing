"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  Building,
  Building2,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  FolderPlus,
  GraduationCap,
  Layers,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Square,
  Tag,
  Trash2,
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

  // Selection
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

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

      toast.success(
        isAr
          ? `تم رفع ومعالجة شيت الدورة بنجاح (${data.round?.name || "EST Round"})`
          : `Successfully imported EST round (${data.round?.name || "EST Round"})`,
      );

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
          ? "تم تحميل دورة EST 2 - ديسمبر 2026 (149 قاعة معتمدة) بنجاح!"
          : "Successfully loaded official EST 2 - December 2026 round (149 rooms)!",
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

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.governorate.toLowerCase().includes(q) ||
          r.center.toLowerCase().includes(q) ||
          r.floor.toLowerCase().includes(q) ||
          r.room.toLowerCase().includes(q) ||
          r.rawRoom.toLowerCase().includes(q) ||
          (r.breakdownText && r.breakdownText.toLowerCase().includes(q)),
      );
    }

    return list;
  }, [sheetRows, selectedGov, selectedCenter, searchQuery]);

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

  // Generate PDF Stickers
  const handleGeneratePdf = useCallback(
    async (
      type:
        | "room_placards"
        | "floor_placards"
        | "floor_subject_bags"
        | "building_placards"
        | "head_placards"
        | "exam_stickers"
        | "bundle",
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
        else if (type === "floor_placards") typeLabel = isAr ? "ملفات الأدوار (Senior)" : "Floor Dossiers";
        else if (type === "building_placards") typeLabel = isAr ? "استيكرات المباني (A4)" : "Building Placards";
        else if (type === "head_placards") typeLabel = isAr ? "ملفات رئيس المبنى" : "Building Head Dossiers";
        else if (type === "bundle") typeLabel = isAr ? "الحزمة الشاملة" : "Complete Logistics Bundle";

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
          {rounds.length === 0 && (
            <Button
              variant="primary"
              onClick={handleSeedDefaultEst2}
              disabled={isSeedingDefault}
              className="cursor-pointer gap-1.5 text-xs h-9 px-3.5 bg-purple-600 hover:bg-purple-700 text-white shadow-xs"
            >
              {isSeedingDefault ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              <span>{isAr ? "تحميل دورة ديسمبر 2026 (EST 2) المعتمدة" : "Load Official EST 2 Dec 2026"}</span>
            </Button>
          )}

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
            : "Data is stored directly in Postgres with automated extraction of Governorates, Centers, Floors, Rooms, and candidate totals."}
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

          {/* Sticker Printing Actions Toolbar */}
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">
                  {isAr ? "طباعة الاستيكرات:" : "Print Stickers:"}
                </span>

                {/* Print Room Placards (4-Up A4) */}
                <Button
                  variant="primary"
                  onClick={() => void handleGeneratePdf("room_placards")}
                  disabled={isGenerating}
                  className="cursor-pointer gap-1.5 text-xs h-9 px-3.5 bg-purple-600 hover:bg-purple-700 text-white font-bold shadow-xs"
                  title={isAr ? "طباعة استيكرات القاعات بنظام 4 في صفحة A4 مع جداول التحقق" : "Print 4-Up A4 Room Dossier Placards"}
                >
                  {isGenerating && activeActionType === "room_placards" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Printer className="size-4" />
                  )}
                  <span>{isAr ? "استيكرات القاعات (A4 4-Up)" : "Room Placards (4-Up)"}</span>
                </Button>

                {/* Print Subject Exam Stickers (2 copies per subject) */}
                <Button
                  variant="secondary"
                  onClick={() => void handleGeneratePdf("exam_stickers")}
                  disabled={isGenerating}
                  className="cursor-pointer gap-1.5 text-xs h-9 px-3 border border-border hover:border-purple-500 font-bold"
                  title={isAr ? "طباعة نسختين لكل مادة في كل قاعة" : "Print 2 copies per subject per room"}
                >
                  {isGenerating && activeActionType === "exam_stickers" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="size-4 text-emerald-600" />
                  )}
                  <span>{isAr ? "مظاريف المواد (نسختين)" : "Exam Subject Stickers"}</span>
                </Button>

                {/* Print Floor Dossiers */}
                <Button
                  variant="secondary"
                  onClick={() => void handleGeneratePdf("floor_placards")}
                  disabled={isGenerating}
                  className="cursor-pointer gap-1.5 text-xs h-9 px-3 border border-border hover:border-purple-500 font-bold"
                  title={isAr ? "طباعة ملفات المشرفين للأدوار (Senior)" : "Print Floor Senior Dossiers"}
                >
                  {isGenerating && activeActionType === "floor_placards" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Layers className="size-4 text-indigo-600" />
                  )}
                  <span>{isAr ? "ملفات الأدوار (Senior)" : "Floor Dossiers"}</span>
                </Button>

                {/* Print Floor Subject Bags (A4 Landscape) */}
                <Button
                  variant="secondary"
                  onClick={() => void handleGeneratePdf("floor_subject_bags")}
                  disabled={isGenerating}
                  className="cursor-pointer gap-1.5 text-xs h-9 px-3 border border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 font-bold shadow-xs"
                  title={isAr ? "طباعة استيكرات أكياس المواد للأدوار بالحجم الكبير A4 بالعرض مع تفصيل اللجان وأعداد الطلاب" : "Print A4 Landscape Floor Subject Bag Placards with Room Directory & Candidate Counts"}
                >
                  {isGenerating && activeActionType === "floor_subject_bags" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ShoppingBag className="size-4 text-amber-600" />
                  )}
                  <span>{isAr ? "أكياس مواد الأدوار (A4)" : "Floor Subject Bags"}</span>
                </Button>

                {/* Print Building Placards (A4 Landscape) */}
                <Button
                  variant="secondary"
                  onClick={() => void handleGeneratePdf("building_placards")}
                  disabled={isGenerating}
                  className="cursor-pointer gap-1.5 text-xs h-9 px-3 border border-border hover:border-purple-500 font-bold"
                  title={isAr ? "طباعة استيكرات المباني بحجم A4 بالعرض (Landscape)" : "Print Full-page A4 Landscape Building Placards"}
                >
                  {isGenerating && activeActionType === "building_placards" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Building2 className="size-4 text-sky-600" />
                  )}
                  <span>{isAr ? "استيكرات المباني (A4)" : "Building Placards"}</span>
                </Button>

                {/* Print Building Head Dossiers (Quarter A4) */}
                <Button
                  variant="secondary"
                  onClick={() => void handleGeneratePdf("head_placards")}
                  disabled={isGenerating}
                  className="cursor-pointer gap-1.5 text-xs h-9 px-3 border border-purple-500/40 text-purple-700 dark:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 font-bold"
                  title={isAr ? "طباعة استيكرات رئيس المبنى بنظام 4 في صفحة A4" : "Print Quarter-A4 Building Head Dossier Stickers"}
                >
                  {isGenerating && activeActionType === "head_placards" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4 text-purple-600" />
                  )}
                  <span>{isAr ? "استيكرات الهيد (Quarter A4)" : "Building Head"}</span>
                </Button>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/60">
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
                  <option value="all">{isAr ? "كل السناتر والمدارس" : "All Centers / Schools"}</option>
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
