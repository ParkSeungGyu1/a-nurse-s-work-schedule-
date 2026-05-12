import { useState, useCallback } from "react";
import { useParams } from "wouter";
import {
  useListSchedules, useGetSchedule, useCreateSchedule, useGenerateSchedule,
  useValidateSchedule, useUpdateScheduleEntries,
  getListSchedulesQueryKey, getGetScheduleQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Zap, CheckCircle, Save, AlertCircle, AlertTriangle, Info, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";

const SHIFT_CYCLE = ["D", "E", "N", "OFF", ""] as const;
type ShiftType = typeof SHIFT_CYCLE[number];

const SHIFT_COLORS: Record<string, string> = {
  D:   "bg-[hsl(var(--shift-d))]/20 text-[hsl(var(--shift-d))] border border-[hsl(var(--shift-d))]/40 font-bold",
  E:   "bg-[hsl(var(--shift-e))]/20 text-[hsl(var(--shift-e))] border border-[hsl(var(--shift-e))]/40 font-bold",
  N:   "bg-[hsl(var(--shift-n))]/20 text-[hsl(var(--shift-n))] border border-[hsl(var(--shift-n))]/40 font-bold",
  OFF: "bg-muted/50 text-muted-foreground/60 border border-muted font-normal",
};

const SEVERITY_ICONS = {
  critical: <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />,
  warning:  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />,
  info:     <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />,
};

const SEVERITY_BG: Record<string, string> = {
  critical: "border-destructive/30 bg-destructive/5",
  warning:  "border-amber-400/30 bg-amber-50",
  info:     "border-blue-300/30 bg-blue-50",
};

const DAYS_KR = ["일", "월", "화", "수", "목", "금", "토"];

export default function SchedulePage() {
  const params = useParams<{ wardId: string }>();
  const wardId = Number(params.wardId);
  const [yearMonth, setYearMonth] = useState(dayjs().format("YYYY-MM"));
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});
  const [showValidation, setShowValidation] = useState(false);

  const { data: schedules } = useListSchedules(wardId);
  const { data: schedule, isLoading } = useGetSchedule(
    wardId,
    selectedScheduleId ?? 0,
    { query: { enabled: !!selectedScheduleId, queryKey: getGetScheduleQueryKey(wardId, selectedScheduleId ?? 0) } }
  );

  const createSchedule = useCreateSchedule();
  const generateSchedule = useGenerateSchedule();
  const validateSchedule = useValidateSchedule();
  const updateEntries = useUpdateScheduleEntries();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const monthSchedules = schedules?.filter((s) => s.yearMonth === yearMonth);
  const activeScheduleId = selectedScheduleId ?? monthSchedules?.[0]?.id ?? null;
  if (activeScheduleId && !selectedScheduleId) setSelectedScheduleId(activeScheduleId);

  const days = Array.from(
    { length: dayjs(yearMonth + "-01").daysInMonth() },
    (_, i) => `${yearMonth}-${String(i + 1).padStart(2, "0")}`
  );

  const nurseIds = schedule ? [...new Set(schedule.entries.map((e) => e.nurseId))] : [];
  const nurses = nurseIds.map((id) => {
    const entry = schedule!.entries.find((e) => e.nurseId === id);
    return { id, name: entry?.nurseName ?? `#${id}`, exp: entry?.nurseExperienceLevel ?? "" };
  });

  function getShift(nurseId: number, date: string): string {
    const editKey = `${nurseId}:${date}`;
    if (editKey in pendingEdits) return pendingEdits[editKey];
    return schedule?.entries.find((e) => e.nurseId === nurseId && e.date === date)?.shiftType ?? "";
  }

  function cycleShift(nurseId: number, date: string) {
    const current = getShift(nurseId, date);
    const idx = SHIFT_CYCLE.indexOf(current as ShiftType);
    const next = SHIFT_CYCLE[(idx + 1) % SHIFT_CYCLE.length];
    setPendingEdits((prev) => ({ ...prev, [`${nurseId}:${date}`]: next }));
  }

  function handleCreate() {
    createSchedule.mutate({ wardId, data: { yearMonth, autoGenerate: false } }, {
      onSuccess: (s) => {
        queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey(wardId) });
        setSelectedScheduleId(s.id);
        toast({ title: "스케줄이 생성되었습니다." });
      },
    });
  }

  function handleGenerate() {
    if (!selectedScheduleId) return;
    generateSchedule.mutate(
      { wardId, scheduleId: selectedScheduleId, data: { priorityMode: "balanced", overwriteManualEdits: false } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetScheduleQueryKey(wardId, selectedScheduleId) });
          setShowValidation(true); setPendingEdits({});
          toast({ title: "스케줄이 자동 생성되었습니다." });
        },
        onError: (e: Error) => toast({ title: "생성 실패: " + e.message, variant: "destructive" }),
      }
    );
  }

  function handleValidate() {
    if (!selectedScheduleId) return;
    validateSchedule.mutate({ wardId, scheduleId: selectedScheduleId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetScheduleQueryKey(wardId, selectedScheduleId) });
        setShowValidation(true);
        toast({ title: "검증이 완료되었습니다." });
      },
    });
  }

  function handleSave() {
    if (!selectedScheduleId || Object.keys(pendingEdits).length === 0) return;
    const entries = Object.entries(pendingEdits)
      .map(([key, shiftType]) => { const [nurseId, date] = key.split(":"); return { nurseId: Number(nurseId), date, shiftType }; })
      .filter((e) => e.shiftType !== "");
    if (entries.length === 0) { setPendingEdits({}); return; }
    updateEntries.mutate({ wardId, scheduleId: selectedScheduleId, data: { entries } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetScheduleQueryKey(wardId, selectedScheduleId) });
        setPendingEdits({});
        toast({ title: "변경사항이 저장되었습니다." });
      },
    });
  }

  const prevMonth = () => { setYearMonth(dayjs(yearMonth + "-01").subtract(1, "month").format("YYYY-MM")); setSelectedScheduleId(null); };
  const nextMonth = () => { setYearMonth(dayjs(yearMonth + "-01").add(1, "month").format("YYYY-MM")); setSelectedScheduleId(null); };

  const validationResults = schedule?.validationResults ?? [];
  const criticals = validationResults.filter((v) => v.severity === "critical");
  const warnings = validationResults.filter((v) => v.severity === "warning");
  const infos = validationResults.filter((v) => v.severity === "info");

  function getDayShiftCount(date: string, shift: string) {
    if (!schedule) return 0;
    const fromEntries = schedule.entries.filter((e) => e.date === date && e.shiftType === shift).length;
    const overrideCount = Object.entries(pendingEdits).filter(([k, v]) => { const [, d] = k.split(":"); return d === date && v === shift; }).length;
    const overridedAway = Object.entries(pendingEdits).filter(([k, v]) => {
      const [nid, d] = k.split(":");
      if (d !== date) return false;
      const orig = schedule.entries.find((e) => e.nurseId === Number(nid) && e.date === date)?.shiftType;
      return orig === shift && v !== shift;
    }).length;
    return fromEntries + overrideCount - overridedAway;
  }

  const EXP_COLORS: Record<string, string> = {
    new: "bg-amber-50 border-amber-200",
    experienced: "",
    senior: "bg-teal-50/40 border-teal-200",
  };

  const noSchedule = !selectedScheduleId && (!monthSchedules || monthSchedules.length === 0);

  return (
    <div className="flex flex-col h-full" data-testid="schedule-page">
      {/* Toolbar — responsive wrap */}
      <div
        className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b bg-card flex-shrink-0"
        data-testid="schedule-toolbar"
      >
        {/* Month nav */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="font-semibold text-sm w-20 text-center" data-testid="text-schedule-month">{yearMonth}</span>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
        </div>

        {monthSchedules && monthSchedules.length > 1 && (
          <Select value={String(selectedScheduleId ?? "")} onValueChange={(v) => setSelectedScheduleId(Number(v))}>
            <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-schedule"><SelectValue placeholder="스케줄 선택" /></SelectTrigger>
            <SelectContent>
              {monthSchedules.map((s) => <SelectItem key={s.id} value={String(s.id)}>#{s.id} ({s.status})</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {/* Spacer on larger screens */}
        <div className="hidden sm:flex flex-1" />

        {/* Action buttons — wrap on small screens */}
        <div className="flex flex-wrap items-center gap-1.5">
          {noSchedule && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleCreate} disabled={createSchedule.isPending} data-testid="button-create-schedule">
              <Plus className="w-3.5 h-3.5 mr-1" />스케줄 생성
            </Button>
          )}
          {selectedScheduleId && (
            <>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleGenerate} disabled={generateSchedule.isPending} data-testid="button-generate-schedule">
                <Zap className="w-3.5 h-3.5 mr-1" />
                <span className="hidden xs:inline">{generateSchedule.isPending ? "생성 중..." : "자동 생성"}</span>
                <span className="xs:hidden">{generateSchedule.isPending ? "..." : "생성"}</span>
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleValidate} disabled={validateSchedule.isPending} data-testid="button-validate-schedule">
                <CheckCircle className="w-3.5 h-3.5 mr-1" />
                <span className="hidden xs:inline">{validateSchedule.isPending ? "검증 중..." : "검증"}</span>
                <span className="xs:hidden">{validateSchedule.isPending ? "..." : "검증"}</span>
              </Button>
              {Object.keys(pendingEdits).length > 0 && (
                <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={updateEntries.isPending} data-testid="button-save-schedule">
                  <Save className="w-3.5 h-3.5 mr-1" />
                  저장 ({Object.keys(pendingEdits).length})
                </Button>
              )}
              <Button
                size="sm"
                variant={showValidation ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setShowValidation(!showValidation)}
                data-testid="button-toggle-validation"
              >
                <AlertCircle className="w-3.5 h-3.5 mr-1" />
                <span className="hidden sm:inline">검증 패널</span>
                {criticals.length > 0 && <Badge variant="destructive" className="ml-1 h-4 text-[10px] px-1">{criticals.length}</Badge>}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Main grid */}
        <div className="flex-1 overflow-auto" data-testid="schedule-grid-container">
          {!selectedScheduleId && !isLoading && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <p className="font-medium mb-2">이달의 스케줄이 없습니다</p>
                <Button onClick={handleCreate} disabled={createSchedule.isPending} data-testid="button-create-schedule-empty">
                  <Plus className="w-4 h-4 mr-1.5" /> 스케줄 생성
                </Button>
              </div>
            </div>
          )}

          {selectedScheduleId && isLoading && (
            <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          )}

          {schedule && (
            <table className="border-collapse text-xs" style={{ minWidth: "max-content" }} data-testid="schedule-grid">
              <thead className="sticky top-0 z-20 bg-card">
                <tr>
                  <th className="sticky left-0 z-30 bg-card border-b border-r p-2 text-left font-medium text-muted-foreground min-w-[90px] w-[90px] md:min-w-[120px] md:w-[120px]">
                    간호사
                  </th>
                  {days.map((date) => {
                    const dow = dayjs(date).day();
                    const isWeekend = dow === 0 || dow === 6;
                    return (
                      <th key={date} className={cn("border-b border-r p-1 text-center font-medium min-w-[28px] w-[28px]", isWeekend ? "bg-red-50/60 text-destructive" : "text-muted-foreground")}>
                        <div className="text-[10px] font-semibold">{date.slice(8)}</div>
                        <div className="text-[9px] opacity-70">{DAYS_KR[dow]}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {nurses.map((nurse) => (
                  <tr key={nurse.id} className={cn("hover:bg-muted/20 border-b", EXP_COLORS[nurse.exp] ?? "")} data-testid={`row-schedule-${nurse.id}`}>
                    <td className={cn("sticky left-0 z-10 border-r p-1.5 md:p-2 font-medium bg-inherit text-xs md:text-xs", EXP_COLORS[nurse.exp])}>
                      <div className="flex items-center gap-1">
                        <span className="truncate max-w-[70px] md:max-w-[90px]">{nurse.name}</span>
                        {nurse.exp === "new" && <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-400 text-amber-600">신</Badge>}
                        {nurse.exp === "senior" && <Badge variant="outline" className="text-[9px] px-1 py-0 border-teal-500 text-teal-600">선</Badge>}
                      </div>
                    </td>
                    {days.map((date) => {
                      const shift = getShift(nurse.id, date);
                      const isPending = `${nurse.id}:${date}` in pendingEdits;
                      const dow = dayjs(date).day();
                      const isWeekend = dow === 0 || dow === 6;
                      const hasIssue = validationResults.some((v) => v.nurseId === nurse.id && v.date === date);
                      return (
                        <td
                          key={date}
                          className={cn("border-r p-0.5 text-center cursor-pointer select-none", isWeekend ? "bg-red-50/30" : "", isPending ? "ring-2 ring-primary ring-inset" : "")}
                          onClick={() => cycleShift(nurse.id, date)}
                          data-testid={`cell-${nurse.id}-${date}`}
                        >
                          {shift && (
                            <span className={cn("inline-block rounded text-[10px] px-1 py-0.5 min-w-[20px] text-center transition-colors", SHIFT_COLORS[shift] ?? "text-muted-foreground", hasIssue && "ring-1 ring-destructive")}>
                              {shift === "OFF" ? "휴" : shift}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Summary row */}
                <tr className="border-t-2 bg-muted/30 sticky bottom-0 z-10">
                  <td className="sticky left-0 bg-muted/40 border-r p-1.5 font-semibold text-xs text-muted-foreground">합계</td>
                  {days.map((date) => (
                    <td key={date} className="border-r p-0.5 text-center" data-testid={`col-summary-${date}`}>
                      <div className="flex flex-col gap-0.5">
                        {["D","E","N"].map((s) => {
                          const count = getDayShiftCount(date, s);
                          return count > 0 ? (
                            <span key={s} className={cn("text-[9px] font-semibold leading-none", s === "D" ? "text-[hsl(var(--shift-d))]" : s === "E" ? "text-[hsl(var(--shift-e))]" : "text-[hsl(var(--shift-n))]")}>{count}</span>
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

        {/* Validation panel — slide over on mobile as overlay */}
        {showValidation && (
          <div className={cn(
            "border-l bg-card flex-shrink-0 overflow-y-auto",
            "w-full absolute inset-0 z-20 sm:relative sm:inset-auto sm:z-auto sm:w-64"
          )} data-testid="validation-panel">
            <div className="p-3 border-b flex items-center justify-between sticky top-0 bg-card z-10">
              <h3 className="font-semibold text-sm">검증 결과</h3>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  {criticals.length > 0 && <span className="text-destructive font-semibold">{criticals.length}건 필수</span>}
                  {warnings.length > 0 && <span className="text-amber-600">{warnings.length}건 경고</span>}
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 sm:hidden" onClick={() => setShowValidation(false)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
            {validationResults.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500 opacity-70" />
                <p>검증 문제 없음</p>
              </div>
            ) : (
              <div className="p-2 space-y-1.5">
                {[...criticals, ...warnings, ...infos].map((v) => (
                  <div key={v.id} className={cn("flex gap-2 p-2 rounded border text-xs", SEVERITY_BG[v.severity] ?? "")} data-testid={`validation-issue-${v.id}`}>
                    {SEVERITY_ICONS[v.severity as keyof typeof SEVERITY_ICONS]}
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground leading-snug">{v.message}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground">
                        {v.date && <span>{v.date.slice(5)}</span>}
                        {v.shiftType && <span className="font-mono font-semibold">{v.shiftType}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
