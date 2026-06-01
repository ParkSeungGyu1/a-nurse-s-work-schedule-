import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import {
  useCreateSchedule,
  useGenerateSchedule,
  useGetSchedule,
  useGetScheduleRecommendations,
  useListNurses,
  useListSchedules,
  useRepairSchedule,
  useRegeneratePartialSchedule,
  useUpdateScheduleEntries,
  useValidateSchedule,
  getGetScheduleQueryKey,
  getGetScheduleRecommendationsQueryKey,
  getListSchedulesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Info,
  Lightbulb,
  Plus,
  RefreshCcw,
  Save,
  Wand2,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import {
  DAYS_KR,
  getExperienceLabel,
  getRecommendationDecisionMeta,
  getRecommendationTypeLabel,
  getSuggestedShiftLabel,
  getValidationRuleLabel,
  getValidationSummary,
  PRIORITY_MODE_LABELS,
} from "@/lib/schedule-copy";
import { cn } from "@/lib/utils";
import { MobileIssuesSheet, MobileScheduleWorkspace } from "@/components/schedule/mobile-schedule-workspace";

const SHIFT_CYCLE = ["D", "E", "N", "OFF", ""] as const;
type ShiftType = (typeof SHIFT_CYCLE)[number];
type PriorityMode = "balanced" | "fairness" | "coverage" | "new_nurse_protection";
type MobileSheetMode = "validation" | "recommendations" | null;
type ValidationFilter = "all" | "critical" | "warning" | "info";
type RecommendationStatusFilter = "all" | RecommendationFollowUpStatus;
type RecommendationCandidateView = {
  nurseId: number;
  nurseName: string;
  currentShift: string;
  experienceLevel?: string;
  reasons: string[];
  tier?: "strict" | "fallback";
  cautions: string[];
};
type RecommendationItemView = {
  id: string;
  type: string;
  date?: string;
  shiftType?: string;
  title?: string;
  sourceNurseId?: number | null;
  sourceNurseName?: string | null;
  strictCandidateCount?: number;
  fallbackCandidateCount?: number;
  shortageCount?: number | null;
  candidates?: RecommendationCandidateView[];
};
type RecommendationFollowUpStatus = "new" | "reviewing" | "requested" | "on_hold" | "done";
type RecommendationFollowUp = {
  status: RecommendationFollowUpStatus;
  note: string;
};

const SHIFT_COLORS: Record<string, string> = {
  D: "border border-[hsl(var(--shift-d))]/40 bg-[hsl(var(--shift-d))]/20 font-bold text-[hsl(var(--shift-d))]",
  E: "border border-[hsl(var(--shift-e))]/40 bg-[hsl(var(--shift-e))]/20 font-bold text-[hsl(var(--shift-e))]",
  N: "border border-[hsl(var(--shift-n))]/40 bg-[hsl(var(--shift-n))]/20 font-bold text-[hsl(var(--shift-n))]",
  OFF: "border border-muted bg-muted/50 font-normal text-muted-foreground/60",
};

const SEVERITY_ICONS = {
  critical: <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-destructive" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />,
  info: <Info className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />,
};

const SEVERITY_BG: Record<string, string> = {
  critical: "border-destructive/30 bg-destructive/5",
  warning: "border-amber-400/30 bg-amber-50",
  info: "border-blue-300/30 bg-blue-50",
};
const RECOMMENDATION_FOLLOW_UP_STORAGE_KEY = "schedule-recommendation-follow-up-v1";
const FOLLOW_UP_STATUS_LABELS: Record<RecommendationFollowUpStatus, string> = {
  new: "미처리",
  reviewing: "검토 중",
  requested: "지원 요청",
  on_hold: "보류",
  done: "처리 완료",
};

function loadRecommendationFollowUps() {
  if (typeof window === "undefined") return {} as Record<string, RecommendationFollowUp>;

  try {
    const raw = window.localStorage.getItem(RECOMMENDATION_FOLLOW_UP_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, RecommendationFollowUp>) : {};
  } catch {
    return {};
  }
}

export default function SchedulePage() {
  const params = useParams<{ wardId: string }>();
  const wardId = Number(params.wardId);
  const isMobile = useIsMobile();
  const [yearMonth, setYearMonth] = useState(dayjs().format("YYYY-MM"));
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});
  const [showValidation, setShowValidation] = useState(false);
  const [priorityMode, setPriorityMode] = useState<PriorityMode>("balanced");
  const [overwriteManualEdits, setOverwriteManualEdits] = useState(false);
  const [selectedRange, setSelectedRange] = useState("week-1");
  const [mobileFocusedDate, setMobileFocusedDate] = useState("");
  const [mobileSheetMode, setMobileSheetMode] = useState<MobileSheetMode>(null);
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>("all");
  const [recommendationStatusFilter, setRecommendationStatusFilter] =
    useState<RecommendationStatusFilter>("all");
  const [recommendationNoteOnly, setRecommendationNoteOnly] = useState(false);
  const [applyPreview, setApplyPreview] = useState<{
    item: RecommendationItemView;
    candidate: RecommendationCandidateView;
  } | null>(null);
  const [recommendationFollowUps, setRecommendationFollowUps] = useState<Record<string, RecommendationFollowUp>>({});
  const [bulkApplyPreview, setBulkApplyPreview] = useState<{
    pairs: Array<{ item: RecommendationItemView; candidate: RecommendationCandidateView }>;
    skippedCount: number;
  } | null>(null);

  const { data: schedules } = useListSchedules(wardId);
  const { data: wardNurses } = useListNurses(wardId);
  const { data: schedule, isLoading } = useGetSchedule(wardId, selectedScheduleId ?? 0, {
    query: {
      enabled: !!selectedScheduleId,
      queryKey: getGetScheduleQueryKey(wardId, selectedScheduleId ?? 0),
    },
  });
  const { data: recommendations } = useGetScheduleRecommendations(wardId, selectedScheduleId ?? 0, {
    query: {
      enabled: !!selectedScheduleId,
      queryKey: getGetScheduleRecommendationsQueryKey(wardId, selectedScheduleId ?? 0),
    },
  });

  const createSchedule = useCreateSchedule();
  const generateSchedule = useGenerateSchedule();
  const regeneratePartialSchedule = useRegeneratePartialSchedule();
  const repairSchedule = useRepairSchedule();
  const validateSchedule = useValidateSchedule();
  const updateEntries = useUpdateScheduleEntries();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const monthSchedules = schedules?.filter((item) => item.yearMonth === yearMonth);
  const activeScheduleId = selectedScheduleId ?? monthSchedules?.[0]?.id ?? null;

  useEffect(() => {
    if (!selectedScheduleId && activeScheduleId) {
      setSelectedScheduleId(activeScheduleId);
    }
  }, [activeScheduleId, selectedScheduleId]);

  useEffect(() => {
    setRecommendationFollowUps(loadRecommendationFollowUps());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      RECOMMENDATION_FOLLOW_UP_STORAGE_KEY,
      JSON.stringify(recommendationFollowUps)
    );
  }, [recommendationFollowUps]);

  const days = useMemo(
    () =>
      Array.from({ length: dayjs(`${yearMonth}-01`).daysInMonth() }, (_, index) => {
        return `${yearMonth}-${String(index + 1).padStart(2, "0")}`;
      }),
    [yearMonth]
  );

  const weekOptions = useMemo(() => {
    const chunks: Array<{ value: string; label: string; dates: string[] }> = [];

    for (let index = 0; index < days.length; index += 7) {
      const dates = days.slice(index, index + 7);
      chunks.push({
        value: `week-${Math.floor(index / 7) + 1}`,
        label: `${Math.floor(index / 7) + 1}주차 (${dates[0]?.slice(8)}~${dates.at(-1)?.slice(8)})`,
        dates,
      });
    }

    return chunks;
  }, [days]);

  useEffect(() => {
    if (!weekOptions.some((option) => option.value === selectedRange)) {
      setSelectedRange(weekOptions[0]?.value ?? "week-1");
    }
  }, [selectedRange, weekOptions]);

  const selectedRangeDates =
    weekOptions.find((option) => option.value === selectedRange)?.dates ?? [];

  useEffect(() => {
    if (selectedRangeDates.length === 0) {
      setMobileFocusedDate("");
      return;
    }

    if (!mobileFocusedDate || !selectedRangeDates.includes(mobileFocusedDate)) {
      setMobileFocusedDate(selectedRangeDates[0]);
    }
  }, [mobileFocusedDate, selectedRangeDates]);

  const nurseIdsFromSchedule = schedule ? [...new Set(schedule.entries.map((entry) => entry.nurseId))] : [];
  const nurses =
    wardNurses && wardNurses.length > 0
      ? wardNurses.map((nurse) => ({
          id: nurse.id,
          name: nurse.name,
          exp:
            nurse.experienceLevel ??
            schedule?.entries.find((entry) => entry.nurseId === nurse.id)?.nurseExperienceLevel ??
            "",
        }))
      : nurseIdsFromSchedule.map((id) => {
          const entry = schedule?.entries.find((candidate) => candidate.nurseId === id);
          return {
            id,
            name: entry?.nurseName ?? `#${id}`,
            exp: entry?.nurseExperienceLevel ?? "",
          };
        });

  const validationResults = schedule?.validationResults ?? [];
  const criticals = validationResults.filter((item) => item.severity === "critical");
  const warnings = validationResults.filter((item) => item.severity === "warning");
  const infos = validationResults.filter((item) => item.severity === "info");
  const filteredValidationResults =
    validationFilter === "all"
      ? validationResults
      : validationResults.filter((item) => item.severity === validationFilter);
  const noSchedule = !selectedScheduleId && (!monthSchedules || monthSchedules.length === 0);
  const shortageRecommendations = useMemo(
    () =>
      (recommendations?.items ?? []).filter(
        (item): item is RecommendationItemView =>
          Boolean((item as RecommendationItemView).shortageCount)
      ),
    [recommendations]
  );
  const recommendationStatusCounts = useMemo(() => {
    return shortageRecommendations.reduce<Record<RecommendationFollowUpStatus, number>>(
      (counts, item) => {
        const status = getRecommendationFollowUp(item).status;
        counts[status] += 1;
        return counts;
      },
      {
        new: 0,
        reviewing: 0,
        requested: 0,
        on_hold: 0,
        done: 0,
      }
    );
  }, [shortageRecommendations, recommendationFollowUps]);
  const recommendationNoteCount = useMemo(
    () =>
      shortageRecommendations.filter((item) => {
        const note = getRecommendationFollowUp(item).note.trim();
        return note.length > 0;
      }).length,
    [shortageRecommendations, recommendationFollowUps]
  );
  const filteredRecommendationItems = useMemo(() => {
    const items = recommendations?.items ?? [];
    return items.filter((item) => {
      const recommendationItem = item as RecommendationItemView;
      const isShortageItem = Boolean(recommendationItem.shortageCount);

      if (recommendationStatusFilter !== "all") {
        if (!isShortageItem) return false;
        if (getRecommendationFollowUp(recommendationItem).status !== recommendationStatusFilter) {
          return false;
        }
      }

      if (recommendationNoteOnly) {
        if (!isShortageItem) return false;
        if (getRecommendationFollowUp(recommendationItem).note.trim().length === 0) {
          return false;
        }
      }

      return true;
    });
  }, [recommendationNoteOnly, recommendationStatusFilter, recommendationFollowUps, recommendations]);
  const bulkApplicableRecommendations = useMemo(() => {
    if (!recommendations) return [];

    return filteredRecommendationItems
      .map((item) => {
        const strictCandidate = item.candidates.find((candidate) => candidate.tier === "strict");
        return strictCandidate && item.date && item.shiftType
          ? {
              item: item as RecommendationItemView,
              candidate: strictCandidate as RecommendationCandidateView,
            }
          : null;
      })
      .filter((value): value is { item: RecommendationItemView; candidate: RecommendationCandidateView } => value !== null);
  }, [filteredRecommendationItems, recommendations]);

  const EXP_COLORS: Record<string, string> = {
    new: "border-amber-200 bg-amber-50",
    experienced: "",
    senior: "border-teal-200 bg-teal-50/40",
  };

  function buildRecommendationEditPatch(
    item: RecommendationItemView,
    candidate: RecommendationCandidateView
  ) {
    if (!item.date || !item.shiftType) return null;

    const entries: Record<string, string> = {
      [`${candidate.nurseId}:${item.date}`]: item.shiftType,
    };

    if (item.sourceNurseId && item.sourceNurseId !== candidate.nurseId) {
      entries[`${item.sourceNurseId}:${item.date}`] = "OFF";
    }

    return entries;
  }

  function getFollowUpKey(item: RecommendationItemView) {
    return `${wardId}:${selectedScheduleId ?? 0}:${item.id}`;
  }

  function getRecommendationFollowUp(item: RecommendationItemView): RecommendationFollowUp {
    return recommendationFollowUps[getFollowUpKey(item)] ?? { status: "new", note: "" };
  }

  function updateRecommendationFollowUp(
    item: RecommendationItemView,
    patch: Partial<RecommendationFollowUp>
  ) {
    const key = getFollowUpKey(item);
    setRecommendationFollowUps((previous) => ({
      ...previous,
      [key]: {
        status: patch.status ?? previous[key]?.status ?? "new",
        note: patch.note ?? previous[key]?.note ?? "",
      },
    }));
  }

  function getShift(nurseId: number, date: string): string {
    const editKey = `${nurseId}:${date}`;
    if (editKey in pendingEdits) return pendingEdits[editKey];
    return schedule?.entries.find((entry) => entry.nurseId === nurseId && entry.date === date)?.shiftType ?? "";
  }

  function cycleShift(nurseId: number, date: string) {
    const current = getShift(nurseId, date);
    const index = SHIFT_CYCLE.indexOf(current as ShiftType);
    const next = SHIFT_CYCLE[(index + 1) % SHIFT_CYCLE.length];
    setPendingEdits((previous) => ({ ...previous, [`${nurseId}:${date}`]: next }));
  }

  function requestApplyRecommendation(
    rawItem: RecommendationItemView,
    rawCandidate: RecommendationCandidateView
  ) {
    if (!rawItem.date || !rawItem.shiftType) {
      toast({
        title: "바로 적용할 수 없는 제안입니다.",
        description: "날짜와 근무가 명확한 추천만 스케줄에 반영할 수 있습니다.",
        variant: "destructive",
      });
      return;
    }

    setApplyPreview({ item: rawItem, candidate: rawCandidate });
  }

  function confirmApplyRecommendation() {
    if (!applyPreview) return;

    const { item: rawItem, candidate: rawCandidate } = applyPreview;
    const patch = buildRecommendationEditPatch(rawItem, rawCandidate);

    if (!patch) {
      toast({
        title: "추천 반영에 필요한 정보가 부족합니다.",
        variant: "destructive",
      });
      setApplyPreview(null);
      return;
    }

    setPendingEdits((previous) => {
      return { ...previous, ...patch };
    });

    toast({
      title: `${rawCandidate.nurseName} 간호사 후보를 임시 반영했습니다.`,
      description:
        rawCandidate.tier === "fallback" && rawCandidate.cautions && rawCandidate.cautions.length > 0
          ? `차선 후보입니다. 저장 전에 주의사항을 다시 확인해 주세요. ${rawCandidate.cautions[0]}`
          : rawItem.sourceNurseName
            ? `${rawItem.sourceNurseName} 간호사의 같은 날짜 근무를 비우고 ${rawCandidate.nurseName} 간호사를 ${rawItem.shiftType}로 배치했습니다.`
            : `${rawCandidate.nurseName} 간호사를 ${rawItem.date.slice(5)} ${rawItem.shiftType} 근무에 배치했습니다.`,
    });

    setShowValidation(true);
    if (isMobile) {
      setMobileSheetMode("validation");
    }
    setApplyPreview(null);
  }

  function requestBulkApplyRecommendations() {
    const groupedPairs = bulkApplicableRecommendations;

    if (groupedPairs.length === 0) {
      toast({
        title: "한 번에 반영할 우선 후보가 없습니다.",
        description: "날짜와 근무가 명확한 우선 후보가 생기면 여기서 바로 반영할 수 있습니다.",
      });
      return;
    }

    const usedKeys = new Set<string>();
    const pairs: Array<{ item: RecommendationItemView; candidate: RecommendationCandidateView }> = [];
    let skippedCount = 0;

    for (const pair of groupedPairs) {
      const assignmentKey = `${pair.candidate.nurseId}:${pair.item.date}`;
      const sourceKey =
        pair.item.sourceNurseId && pair.item.sourceNurseId !== pair.candidate.nurseId
          ? `${pair.item.sourceNurseId}:${pair.item.date}`
          : null;

      if (usedKeys.has(assignmentKey) || (sourceKey && usedKeys.has(sourceKey))) {
        skippedCount += 1;
        continue;
      }

      usedKeys.add(assignmentKey);
      if (sourceKey) usedKeys.add(sourceKey);
      pairs.push(pair);
    }

    setBulkApplyPreview({ pairs, skippedCount });
  }

  function confirmBulkApplyRecommendations() {
    if (!bulkApplyPreview) return;

    const patch: Record<string, string> = {};

    for (const pair of bulkApplyPreview.pairs) {
      const nextPatch = buildRecommendationEditPatch(pair.item, pair.candidate);
      if (!nextPatch) continue;
      Object.assign(patch, nextPatch);
    }

    setPendingEdits((previous) => ({ ...previous, ...patch }));

    toast({
      title: `${bulkApplyPreview.pairs.length}건의 우선 후보를 임시 반영했습니다.`,
      description:
        bulkApplyPreview.skippedCount > 0
          ? `겹치는 후보 ${bulkApplyPreview.skippedCount}건은 제외했습니다. 저장 전에 스케줄 표와 검증 패널을 함께 확인해 주세요.`
          : "저장 전까지는 임시 변경 상태입니다. 검증 패널에서 영향 범위를 함께 확인해 주세요.",
    });

    setShowValidation(true);
    if (isMobile) {
      setMobileSheetMode("validation");
    }
    setBulkApplyPreview(null);
  }

  function invalidateScheduleQueries(scheduleId: number) {
    queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey(wardId) });
    queryClient.invalidateQueries({ queryKey: getGetScheduleQueryKey(wardId, scheduleId) });
    queryClient.invalidateQueries({
      queryKey: getGetScheduleRecommendationsQueryKey(wardId, scheduleId),
    });
  }

  function ensureNoPendingEdits() {
    if (Object.keys(pendingEdits).length === 0) return true;
    toast({
      title: "저장되지 않은 수정이 있습니다.",
      description: "재생성이나 검증 전에 먼저 수동 수정 내용을 저장해 주세요.",
      variant: "destructive",
    });
    return false;
  }

  function handleCreate() {
    createSchedule.mutate(
      { wardId, data: { yearMonth, autoGenerate: false } },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey(wardId) });
          setSelectedScheduleId(created.id);
          toast({ title: "빈 스케줄을 생성했습니다." });
        },
      }
    );
  }

  function handleGenerate() {
    if (!selectedScheduleId || !ensureNoPendingEdits()) return;

    generateSchedule.mutate(
      {
        wardId,
        scheduleId: selectedScheduleId,
        data: {
          priorityMode,
          overwriteManualEdits,
        },
      },
      {
        onSuccess: () => {
          invalidateScheduleQueries(selectedScheduleId);
          setShowValidation(true);
          setPendingEdits({});
          toast({
            title: overwriteManualEdits ? "스케줄 전체를 다시 생성했습니다." : "수동 수정 내용을 유지하고 다시 생성했습니다.",
          });
        },
        onError: (error: Error) =>
          toast({ title: `전체 재생성 실패: ${error.message}`, variant: "destructive" }),
      }
    );
  }

  function handlePartialRegenerate() {
    if (!selectedScheduleId || !ensureNoPendingEdits()) return;
    if (selectedRangeDates.length === 0) {
      toast({ title: "부분 재생성할 주차를 먼저 선택해 주세요.", variant: "destructive" });
      return;
    }

    regeneratePartialSchedule.mutate(
      {
        wardId,
        scheduleId: selectedScheduleId,
        data: {
          dates: selectedRangeDates,
          priorityMode,
          overwriteManualEdits,
        },
      },
      {
        onSuccess: () => {
          invalidateScheduleQueries(selectedScheduleId);
          setShowValidation(true);
          setPendingEdits({});
          toast({
            title: `${selectedRangeDates[0]?.slice(8)}~${selectedRangeDates.at(-1)?.slice(8)} 구간을 다시 생성했습니다.`,
          });
        },
        onError: (error: Error) =>
          toast({ title: `부분 재생성 실패: ${error.message}`, variant: "destructive" }),
      }
    );
  }

  function handleRepair() {
    if (!selectedScheduleId || !ensureNoPendingEdits()) return;

    repairSchedule.mutate(
      {
        wardId,
        scheduleId: selectedScheduleId,
        data: {
          priorityMode,
          overwriteManualEdits,
        },
      },
      {
        onSuccess: () => {
          invalidateScheduleQueries(selectedScheduleId);
          setShowValidation(true);
          setPendingEdits({});
          toast({ title: "충돌이 있는 날짜만 다시 보정했습니다." });
        },
        onError: (error: Error) =>
          toast({ title: `오류 보정 실패: ${error.message}`, variant: "destructive" }),
      }
    );
  }

  function handleValidate() {
    if (!selectedScheduleId) return;
    validateSchedule.mutate(
      { wardId, scheduleId: selectedScheduleId },
      {
        onSuccess: () => {
          invalidateScheduleQueries(selectedScheduleId);
          setShowValidation(true);
          toast({ title: "검증을 다시 실행했습니다." });
        },
      }
    );
  }

  function handleSave() {
    if (!selectedScheduleId || Object.keys(pendingEdits).length === 0) return;

    const entries = Object.entries(pendingEdits)
      .map(([key, shiftType]) => {
        const [nurseId, date] = key.split(":");
        return { nurseId: Number(nurseId), date, shiftType };
      })
      .filter((entry) => entry.shiftType !== "");

    if (entries.length === 0) {
      setPendingEdits({});
      return;
    }

    updateEntries.mutate(
      { wardId, scheduleId: selectedScheduleId, data: { entries } },
      {
        onSuccess: () => {
          invalidateScheduleQueries(selectedScheduleId);
          setPendingEdits({});
          toast({ title: "수동 수정 내용을 저장했습니다." });
        },
      }
    );
  }

  function prevMonth() {
    setYearMonth(dayjs(`${yearMonth}-01`).subtract(1, "month").format("YYYY-MM"));
    setSelectedScheduleId(null);
    setPendingEdits({});
    setMobileSheetMode(null);
  }

  function nextMonth() {
    setYearMonth(dayjs(`${yearMonth}-01`).add(1, "month").format("YYYY-MM"));
    setSelectedScheduleId(null);
    setPendingEdits({});
    setMobileSheetMode(null);
  }

  function getDayShiftCount(date: string, shift: string) {
    if (!schedule) return 0;
    const fromEntries = schedule.entries.filter(
      (entry) => entry.date === date && entry.shiftType === shift
    ).length;
    const overrideCount = Object.entries(pendingEdits).filter(([key, value]) => {
      const [, targetDate] = key.split(":");
      return targetDate === date && value === shift;
    }).length;
    const overriddenAway = Object.entries(pendingEdits).filter(([key, value]) => {
      const [nurseId, targetDate] = key.split(":");
      if (targetDate !== date) return false;
      const original = schedule.entries.find(
        (entry) => entry.nurseId === Number(nurseId) && entry.date === date
      )?.shiftType;
      return original === shift && value !== shift;
    }).length;

    return fromEntries + overrideCount - overriddenAway;
  }

  function openValidationPanel() {
    if (isMobile) {
      setMobileSheetMode("validation");
      return;
    }

    setShowValidation((previous) => !previous);
  }

  function openRecommendationPanel() {
    setMobileSheetMode("recommendations");
  }

  const mobileDate = mobileFocusedDate || selectedRangeDates[0] || days[0] || "";

  return (
    <div className="flex h-full flex-col" data-testid="schedule-page">
      <div
        className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2"
        data-testid="schedule-toolbar"
      >
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-20 text-center text-sm font-semibold" data-testid="text-schedule-month">
            {yearMonth}
          </span>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {monthSchedules && monthSchedules.length > 1 && (
          <Select value={String(selectedScheduleId ?? "")} onValueChange={(value) => setSelectedScheduleId(Number(value))}>
            <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-schedule">
              <SelectValue placeholder="스케줄 선택" />
            </SelectTrigger>
            <SelectContent>
              {monthSchedules.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  #{item.id} ({item.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {selectedScheduleId && (
          <>
            <Select value={priorityMode} onValueChange={(value) => setPriorityMode(value as PriorityMode)}>
              <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-priority-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_MODE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedRange} onValueChange={setSelectedRange}>
              <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-partial-range">
                <SelectValue placeholder="부분 재생성 범위" />
              </SelectTrigger>
              <SelectContent>
                {weekOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              variant={overwriteManualEdits ? "destructive" : "secondary"}
              className="h-8 text-xs"
              onClick={() => setOverwriteManualEdits((previous) => !previous)}
              data-testid="button-toggle-overwrite-manual"
            >
              {overwriteManualEdits ? "수동 수정 덮어쓰기" : "수동 수정 유지"}
            </Button>
          </>
        )}

        <div className="hidden flex-1 lg:flex" />

        <div className="flex flex-wrap items-center gap-1.5">
          {noSchedule && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={handleCreate}
              disabled={createSchedule.isPending}
              data-testid="button-create-schedule"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> 빈 스케줄 생성
            </Button>
          )}

          {selectedScheduleId && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={handleGenerate}
                disabled={generateSchedule.isPending}
                data-testid="button-regenerate-full"
              >
                <Zap className="mr-1 h-3.5 w-3.5" />
                {generateSchedule.isPending ? "재생성 중..." : isMobile ? "전체" : "전체 재생성"}
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={handlePartialRegenerate}
                disabled={regeneratePartialSchedule.isPending}
                data-testid="button-regenerate-partial"
              >
                <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                {regeneratePartialSchedule.isPending ? "부분 재생성 중..." : isMobile ? "부분" : "부분 재생성"}
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={handleRepair}
                disabled={repairSchedule.isPending}
                data-testid="button-repair-schedule"
              >
                <Wand2 className="mr-1 h-3.5 w-3.5" />
                {repairSchedule.isPending ? "보정 중..." : isMobile ? "보정" : "오류 보정"}
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={handleValidate}
                disabled={validateSchedule.isPending}
                data-testid="button-validate-schedule"
              >
                <CheckCircle className="mr-1 h-3.5 w-3.5" />
                {validateSchedule.isPending ? "검증 중..." : "검증"}
              </Button>

              {Object.keys(pendingEdits).length > 0 && (
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleSave}
                  disabled={updateEntries.isPending}
                  data-testid="button-save-schedule"
                >
                  <Save className="mr-1 h-3.5 w-3.5" />
                  저장 ({Object.keys(pendingEdits).length})
                </Button>
              )}

              {isMobile && recommendations && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={openRecommendationPanel}
                  data-testid="button-toggle-recommendations"
                >
                  <Lightbulb className="mr-1 h-3.5 w-3.5" />
                  해결 제안
                  {recommendations.unresolvedCriticalCount > 0 && (
                    <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">
                      {recommendations.unresolvedCriticalCount}
                    </Badge>
                  )}
                </Button>
              )}

              <Button
                size="sm"
                variant={showValidation && !isMobile ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={openValidationPanel}
                data-testid="button-toggle-validation"
              >
                <AlertCircle className="mr-1 h-3.5 w-3.5" />
                <span className={cn(isMobile ? "" : "hidden sm:inline")}>검증 패널</span>
                {criticals.length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">
                    {criticals.length}
                  </Badge>
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {selectedScheduleId && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span>생성 모드: {PRIORITY_MODE_LABELS[priorityMode]}</span>
          <span>수동 수정 처리: {overwriteManualEdits ? "덮어쓰기 허용" : "기존 수정 유지"}</span>
          <span>부분 재생성 범위: {weekOptions.find((option) => option.value === selectedRange)?.label ?? "-"}</span>
        </div>
      )}

      {!isMobile && selectedScheduleId && recommendations && (
        <div className="border-b bg-[linear-gradient(180deg,rgba(242,248,247,0.95),rgba(255,255,255,0.98))] px-3 py-2.5">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">해결 제안 대시보드</h2>
              <p className="text-[11px] text-muted-foreground">
                검증 결과를 기준으로 먼저 살펴볼 문제와 적용 가능한 추천 후보를 정리합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge variant="secondary" className="h-6 bg-white/80">
                전체 문제 {recommendations.totalIssues}건
              </Badge>
              <Badge variant="secondary" className="h-6 bg-white/80">
                적용 가능 제안 {recommendations.actionableIssues}건
              </Badge>
              <Badge
                variant={recommendations.unresolvedCriticalCount > 0 ? "destructive" : "secondary"}
                className="h-6"
              >
                필수 수정 {recommendations.unresolvedCriticalCount}건
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[11px]"
                onClick={requestBulkApplyRecommendations}
                disabled={bulkApplicableRecommendations.length === 0}
              >
                우선 후보 일괄 반영 {bulkApplicableRecommendations.length > 0 ? `(${bulkApplicableRecommendations.length})` : ""}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <Button
                size="sm"
                variant={recommendationStatusFilter === "all" ? "secondary" : "outline"}
                className="h-6 text-[11px]"
                onClick={() => setRecommendationStatusFilter("all")}
              >
                전체 {recommendations.items.length}
              </Button>
              {(Object.entries(FOLLOW_UP_STATUS_LABELS) as Array<
                [RecommendationFollowUpStatus, string]
              >).map(([status, label]) => (
                <Button
                  key={status}
                  size="sm"
                  variant={recommendationStatusFilter === status ? "secondary" : "outline"}
                  className="h-6 text-[11px]"
                  onClick={() => setRecommendationStatusFilter(status)}
                >
                  {label} {recommendationStatusCounts[status]}
                </Button>
              ))}
              <Button
                size="sm"
                variant={recommendationNoteOnly ? "secondary" : "outline"}
                className="h-6 text-[11px]"
                onClick={() => setRecommendationNoteOnly((previous) => !previous)}
              >
                메모 있음 {recommendationNoteCount}
              </Button>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto pr-1">
            {recommendations.items.length === 0 ? (
              <div className="rounded-xl border bg-white/80 p-3 text-sm text-muted-foreground">
                현재는 별도 조정이 필요한 추천 항목이 없습니다.
              </div>
            ) : filteredRecommendationItems.length === 0 ? (
              <div className="rounded-xl border bg-white/80 p-3 text-sm text-muted-foreground">
                현재 선택한 필터에 해당하는 추천 카드가 없습니다.
              </div>
            ) : (
              <div className="grid gap-2 xl:grid-cols-2">
                {filteredRecommendationItems.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-xl border bg-white/90 p-3 shadow-sm",
                      item.severity === "critical"
                        ? "border-destructive/25"
                        : item.severity === "warning"
                          ? "border-amber-300/50"
                          : "border-slate-200"
                    )}
                  >
                    {(() => {
                      const decisionMeta = getRecommendationDecisionMeta(item);
                      const followUp = getRecommendationFollowUp(item as RecommendationItemView);

                      return (
                        <>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center gap-1.5">
                          {SEVERITY_ICONS[item.severity as keyof typeof SEVERITY_ICONS]}
                          <h3 className="truncate text-xs font-semibold text-foreground">{item.title}</h3>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{item.summary}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {item.shortageCount ? (
                          <Badge variant="destructive" className="h-5 text-[10px]">
                            부족 {item.shortageCount}명                          </Badge>
                        ) : (
                          <Badge variant="outline" className="h-5 text-[10px]">
                            {getRecommendationTypeLabel(item.type)}
                          </Badge>
                        )}
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                            decisionMeta.className
                          )}
                        >
                          {decisionMeta.label}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-2.5 py-2 text-[11px] text-slate-700">
                      {item.actionText}
                    </div>

                    {item.shortageCount && item.strictCandidateCount === 0 && (
                      <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700">
                        내부 인력만으로 바로 채우기 어려운 구간입니다. 차선 후보를 검토하거나 추가 지원 인력을 요청하는 편이 좋습니다.
                      </div>
                    )}

                    {item.shortageCount ? (
                      <div className="mt-2 rounded-lg border border-slate-200 bg-white/80 p-2">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-foreground">부족 인력 처리 메모</span>
                          <Select
                            value={followUp.status}
                            onValueChange={(value) =>
                              updateRecommendationFollowUp(item as RecommendationItemView, {
                                status: value as RecommendationFollowUpStatus,
                              })
                            }
                          >
                            <SelectTrigger className="h-7 w-[120px] text-[11px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(FOLLOW_UP_STATUS_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Input
                          value={followUp.note}
                          onChange={(event) =>
                            updateRecommendationFollowUp(item as RecommendationItemView, {
                              note: event.target.value,
                            })
                          }
                          placeholder="예: 플로트 간호사 요청 예정, 오후 회의 후 재확인"
                          className="h-8 text-[11px]"
                        />
                      </div>
                    ) : null}

                    {(item.date || item.shiftType) && (
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        {item.date && (
                          <Badge variant="secondary" className="h-5 bg-slate-100 px-1.5 text-[10px]">
                            조정 날짜 {item.date.slice(5)}
                          </Badge>
                        )}
                        {item.shiftType && (
                          <Badge variant="secondary" className="h-5 bg-slate-100 px-1.5 text-[10px]">
                            {getSuggestedShiftLabel(item.shiftType)}
                          </Badge>
                        )}
                      </div>
                    )}

                    {item.candidates.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                          <span>규칙 내 후보 {item.strictCandidateCount}명</span>
                          <span>차선 후보 {item.fallbackCandidateCount}명</span>
                        </div>

                        {item.candidates.slice(0, 2).map((candidate, index) => (
                          <div
                            key={`${item.id}:${candidate.nurseId}`}
                            className={cn(
                              "rounded-lg border p-2",
                              candidate.tier === "strict"
                                ? "border-emerald-200 bg-emerald-50/70"
                                : "border-amber-200 bg-amber-50/80"
                            )}
                          >
                            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-foreground">
                                  {index + 1}. {candidate.nurseName}
                                </span>
                                <Badge variant="outline" className="h-4 bg-white/80 px-1 text-[9px]">
                                  {getExperienceLabel(candidate.experienceLevel)}
                                </Badge>
                                <Badge
                                  variant={candidate.tier === "strict" ? "secondary" : "outline"}
                                  className="h-4 px-1 text-[9px]"
                                >
                                  {candidate.tier === "strict" ? "우선" : "차선"}
                                </Badge>
                              </div>
                              <span className="text-[10px] text-muted-foreground">
                                변경 예상 {candidate.currentShift === "OFF" ? "OFF" : candidate.currentShift} →{" "}
                                {getSuggestedShiftLabel(item.shiftType)}
                              </span>
                            </div>

                            <div className="space-y-0.5 text-[11px] text-slate-700">
                              {candidate.reasons.slice(0, 1).map((reason) => (
                                <p key={reason}>- {reason}</p>
                              ))}
                              {candidate.cautions.slice(0, 1).map((caution) => (
                                <p key={caution} className="text-amber-700">
                                  - 주의: {caution}
                                </p>
                              ))}
                            </div>

                            <div className="mt-2 flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px]"
                                onClick={() =>
                                  requestApplyRecommendation(
                                    item as RecommendationItemView,
                                    candidate as RecommendationCandidateView
                                  )
                                }
                              >
                                후보 적용
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-auto" data-testid="schedule-grid-container">
          {!selectedScheduleId && !isLoading && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <p className="mb-2 font-medium">아직 이 달의 스케줄이 없습니다.</p>
                <Button onClick={handleCreate} disabled={createSchedule.isPending} data-testid="button-create-schedule-empty">
                  <Plus className="mr-1.5 h-4 w-4" /> 빈 스케줄 생성
                </Button>
              </div>
            </div>
          )}

          {selectedScheduleId && isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          )}

          {isMobile && schedule && mobileDate && (
            <MobileScheduleWorkspace
              focusedDate={mobileDate}
              rangeDates={selectedRangeDates.length > 0 ? selectedRangeDates : days}
              nurses={nurses}
              validationResults={validationResults}
              recommendations={recommendations}
              pendingEditsCount={Object.keys(pendingEdits).length}
              getShift={getShift}
              cycleShift={cycleShift}
              getDayShiftCount={getDayShiftCount}
              onFocusDateChange={setMobileFocusedDate}
            />
          )}

          {!isMobile && schedule && (
            <table className="border-collapse text-xs" style={{ minWidth: "max-content" }} data-testid="schedule-grid">
              <thead className="sticky top-0 z-20 bg-card">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[90px] border-b border-r bg-card p-2 text-left font-medium text-muted-foreground md:w-[120px] md:min-w-[120px]">
                    간호사                  </th>
                  {days.map((date) => {
                    const dayOfWeek = dayjs(date).day();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                    return (
                      <th
                        key={date}
                        className={cn(
                          "w-[28px] min-w-[28px] border-b border-r p-1 text-center font-medium",
                          isWeekend ? "bg-red-50/60 text-destructive" : "text-muted-foreground"
                        )}
                      >
                        <div className="text-[10px] font-semibold">{date.slice(8)}</div>
                        <div className="text-[9px] opacity-70">{DAYS_KR[dayOfWeek]}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {nurses.map((nurse) => (
                  <tr
                    key={nurse.id}
                    className={cn("border-b hover:bg-muted/20", EXP_COLORS[nurse.exp] ?? "")}
                    data-testid={`row-schedule-${nurse.id}`}
                  >
                    <td className={cn("sticky left-0 z-10 border-r bg-inherit p-1.5 text-xs font-medium md:p-2", EXP_COLORS[nurse.exp])}>
                      <div className="flex items-center gap-1">
                        <span className="max-w-[70px] truncate md:max-w-[90px]">{nurse.name}</span>
                        {nurse.exp === "new" && (
                          <Badge variant="outline" className="border-amber-400 px-1 py-0 text-[9px] text-amber-600">
                            신규
                          </Badge>
                        )}
                        {nurse.exp === "senior" && (
                          <Badge variant="outline" className="border-teal-500 px-1 py-0 text-[9px] text-teal-600">
                            책임
                          </Badge>
                        )}
                      </div>
                    </td>
                    {days.map((date) => {
                      const shift = getShift(nurse.id, date);
                      const isPending = `${nurse.id}:${date}` in pendingEdits;
                      const dayOfWeek = dayjs(date).day();
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                      const hasIssue = validationResults.some(
                        (result) => result.nurseId === nurse.id && result.date === date
                      );

                      return (
                        <td
                          key={date}
                          className={cn(
                            "cursor-pointer select-none border-r p-0.5 text-center",
                            isWeekend ? "bg-red-50/30" : "",
                            isPending ? "ring-2 ring-inset ring-primary" : ""
                          )}
                          onClick={() => cycleShift(nurse.id, date)}
                          data-testid={`cell-${nurse.id}-${date}`}
                        >
                          {shift && (
                            <span
                              className={cn(
                                "inline-block min-w-[20px] rounded px-1 py-0.5 text-center text-[10px] transition-colors",
                                SHIFT_COLORS[shift] ?? "text-muted-foreground",
                                hasIssue && "ring-1 ring-destructive"
                              )}
                            >
                              {shift === "OFF" ? "OFF" : shift}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="sticky bottom-0 z-10 border-t-2 bg-muted/30">
                  <td className="sticky left-0 border-r bg-muted/40 p-1.5 text-xs font-semibold text-muted-foreground">
                    합계
                  </td>
                  {days.map((date) => (
                    <td key={date} className="border-r p-0.5 text-center" data-testid={`col-summary-${date}`}>
                      <div className="flex flex-col gap-0.5">
                        {["D", "E", "N"].map((shift) => {
                          const count = getDayShiftCount(date, shift);
                          return count > 0 ? (
                            <span
                              key={shift}
                              className={cn(
                                "text-[9px] font-semibold leading-none",
                                shift === "D"
                                  ? "text-[hsl(var(--shift-d))]"
                                  : shift === "E"
                                    ? "text-[hsl(var(--shift-e))]"
                                    : "text-[hsl(var(--shift-n))]"
                              )}
                            >
                              {count}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {!isMobile && showValidation && (
          <div
            className={cn(
              "absolute inset-0 z-20 w-full flex-shrink-0 overflow-y-auto border-l bg-card sm:relative sm:inset-auto sm:z-auto sm:w-72"
            )}
            data-testid="validation-panel"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card p-3">
              <div>
                <h3 className="text-sm font-semibold">검증 결과</h3>
                <p className="text-[11px] text-muted-foreground">
                  필수 {criticals.length}건 · 경고 {warnings.length}건 · 참고 {infos.length}건                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 sm:hidden"
                onClick={() => setShowValidation(false)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5 border-b px-3 py-2">
              {[
                { key: "all", label: "전체", count: validationResults.length },
                { key: "critical", label: "필수", count: criticals.length },
                { key: "warning", label: "경고", count: warnings.length },
                { key: "info", label: "참고", count: infos.length },
              ].map((option) => (
                <Button
                  key={option.key}
                  variant={validationFilter === option.key ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setValidationFilter(option.key as ValidationFilter)}
                >
                  {option.label} {option.count}
                </Button>
              ))}
            </div>

            {filteredValidationResults.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                <CheckCircle className="mx-auto mb-2 h-8 w-8 text-green-500 opacity-70" />
                <p>{validationFilter === "all" ? "현재 검증 문제 없음" : "선택한 조건의 검증 문제 없음"}</p>
              </div>
            ) : (
              <div className="space-y-1.5 p-2">
                {filteredValidationResults.map((item) => (
                  <div
                    key={item.id}
                    className={cn("flex gap-2 rounded border p-2 text-xs", SEVERITY_BG[item.severity] ?? "")}
                    data-testid={`validation-issue-${item.id}`}
                  >
                    {SEVERITY_ICONS[item.severity as keyof typeof SEVERITY_ICONS]}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-1.5">
                        <Badge variant="outline" className="h-5 text-[10px]">
                          {getValidationRuleLabel(item.ruleCode)}
                        </Badge>
                      </div>
                      <p className="leading-snug text-foreground">{getValidationSummary(item)}</p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
                        {item.date && <span>{item.date.slice(5)}</span>}
                        {item.shiftType && <span className="font-mono font-semibold">{item.shiftType}</span>}
                        {item.nurseName && <span>{item.nurseName}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!applyPreview} onOpenChange={(open) => !open && setApplyPreview(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>추천 후보를 스케줄에 반영할까요?</DialogTitle>
            <DialogDescription>
              저장 전까지는 임시 변경으로만 반영됩니다. 적용 후에는 스케줄 표에서 다시 수정할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          {applyPreview && (
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{applyPreview.item.date?.slice(5)}</Badge>
                  <Badge variant="secondary">{getSuggestedShiftLabel(applyPreview.item.shiftType)}</Badge>
                  <Badge
                    variant={applyPreview.candidate.tier === "strict" ? "secondary" : "outline"}
                  >
                    {applyPreview.candidate.tier === "strict" ? "우선 후보" : "차선 후보"}
                  </Badge>
                </div>
                <p className="mt-2 text-foreground">
                  <span className="font-semibold">{applyPreview.candidate.nurseName}</span> 간호사를{" "}
                  <span className="font-semibold">
                    {applyPreview.item.date?.slice(5)} {applyPreview.item.shiftType}
                  </span>{" "}
                  근무에 반영합니다.
                </p>
                {applyPreview.item.sourceNurseName && (
                  <p className="mt-1 text-muted-foreground">
                    기존 {applyPreview.item.sourceNurseName} 간호사의 같은 날짜 근무는 OFF로 조정됩니다.
                  </p>
                )}
              </div>

              <div className="space-y-1 rounded-xl border bg-background p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>현재 근무</span>
                  <span className="font-medium text-foreground">
                    {applyPreview.candidate.currentShift || "OFF"}
                  </span>
                  <span>→</span>
                  <span className="font-medium text-foreground">
                    {getSuggestedShiftLabel(applyPreview.item.shiftType)}
                  </span>
                </div>
                {applyPreview.candidate.cautions?.[0] && (
                  <p className="text-xs text-amber-700">주의: {applyPreview.candidate.cautions[0]}</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyPreview(null)}>
              취소
            </Button>
            <Button onClick={confirmApplyRecommendation}>임시 반영</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!bulkApplyPreview} onOpenChange={(open) => !open && setBulkApplyPreview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>우선 후보를 한 번에 반영할까요?</DialogTitle>
            <DialogDescription>
              규칙 안에서 바로 적용 가능한 우선 후보만 임시 반영합니다. 저장 전까지는 다시 수정할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          {bulkApplyPreview && (
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">반영 예정 {bulkApplyPreview.pairs.length}건</Badge>
                  {bulkApplyPreview.skippedCount > 0 && (
                    <Badge variant="outline">겹쳐서 제외 {bulkApplyPreview.skippedCount}건</Badge>
                  )}
                </div>
                <p className="mt-2 text-muted-foreground">
                  저장 전까지는 임시 반영 상태입니다. 적용 후에는 검증 패널과 스케줄 표를 함께 확인해 주세요.
                </p>
              </div>

              <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border bg-background p-3">
                {bulkApplyPreview.pairs.slice(0, 6).map(({ item, candidate }) => (
                  <div key={`${item.id}:${candidate.nurseId}`} className="rounded-lg border p-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="secondary">{item.date?.slice(5)}</Badge>
                      <Badge variant="secondary">{getSuggestedShiftLabel(item.shiftType)}</Badge>
                      <span className="font-medium text-foreground">{candidate.nurseName}</span>
                      <span className="text-muted-foreground">
                        {candidate.currentShift || "OFF"} → {item.shiftType}
                      </span>
                    </div>
                    {candidate.cautions[0] && (
                      <p className="mt-1 text-xs text-amber-700">주의: {candidate.cautions[0]}</p>
                    )}
                  </div>
                ))}
                {bulkApplyPreview.pairs.length > 6 && (
                  <p className="text-xs text-muted-foreground">
                    외 {bulkApplyPreview.pairs.length - 6}건은 적용 후 스케줄 표에서 확인할 수 있습니다.
                  </p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkApplyPreview(null)}>
              취소
            </Button>
            <Button onClick={confirmBulkApplyRecommendations}>우선 후보 일괄 반영</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MobileIssuesSheet
        open={isMobile && mobileSheetMode !== null}
        mode={mobileSheetMode}
        recommendations={recommendations}
        validationResults={validationResults}
        onApplyCandidate={(item, candidate) =>
          requestApplyRecommendation(item as RecommendationItemView, candidate as RecommendationCandidateView)
        }
        getRecommendationFollowUp={(item) => getRecommendationFollowUp(item as RecommendationItemView)}
        onUpdateRecommendationFollowUp={(item, patch) =>
          updateRecommendationFollowUp(item as RecommendationItemView, patch)
        }
        onOpenChange={(open) => {
          if (!open) {
            setMobileSheetMode(null);
          }
        }}
      />
    </div>
  );
}
