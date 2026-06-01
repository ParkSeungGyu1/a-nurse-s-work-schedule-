import dayjs from "dayjs";
import { AlertCircle, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DAYS_KR,
  getExperienceLabel,
  getRecommendationDecisionMeta,
  getRecommendationTypeLabel,
  getSuggestedShiftLabel,
  getValidationRuleLabel,
  getValidationSummary,
} from "@/lib/schedule-copy";
import { cn } from "@/lib/utils";

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

type RecommendationFollowUpStatus = "new" | "reviewing" | "requested" | "on_hold" | "done";
type RecommendationFollowUp = {
  status: RecommendationFollowUpStatus;
  note: string;
};

const FOLLOW_UP_STATUS_LABELS: Record<RecommendationFollowUpStatus, string> = {
  new: "미처리",
  reviewing: "검토 중",
  requested: "지원 요청",
  on_hold: "보류",
  done: "처리 완료",
};

interface NurseView {
  id: number;
  name: string;
  exp: string;
}

interface ValidationIssue {
  id: number;
  severity: "critical" | "warning" | "info";
  ruleCode?: string | null;
  message: string;
  date?: string | null;
  shiftType?: string | null;
  nurseId?: number | null;
  nurseName?: string | null;
}

interface RecommendationCandidate {
  nurseId: number;
  nurseName: string;
  experienceLevel: string;
  tier: "strict" | "fallback";
  currentShift: string;
  reasons: string[];
  cautions: string[];
}

interface RecommendationItem {
  id: string;
  severity: "critical" | "warning" | "info";
  type: "understaffed_shift" | "rule_conflict" | "fairness_warning";
  title: string;
  summary: string;
  actionText: string;
  date?: string;
  shiftType?: string;
  sourceNurseId?: number | null;
  sourceNurseName?: string | null;
  shortageCount?: number | null;
  strictCandidateCount: number;
  fallbackCandidateCount: number;
  candidates: RecommendationCandidate[];
}

interface RecommendationSummary {
  totalIssues: number;
  actionableIssues: number;
  unresolvedCriticalCount: number;
  items: RecommendationItem[];
}

interface MobileScheduleWorkspaceProps {
  focusedDate: string;
  rangeDates: string[];
  nurses: NurseView[];
  validationResults: ValidationIssue[];
  recommendations?: RecommendationSummary;
  pendingEditsCount: number;
  getShift: (nurseId: number, date: string) => string;
  cycleShift: (nurseId: number, date: string) => void;
  getDayShiftCount: (date: string, shift: string) => number;
  onFocusDateChange: (date: string) => void;
}

export function MobileScheduleWorkspace({
  focusedDate,
  rangeDates,
  nurses,
  validationResults,
  pendingEditsCount,
  getShift,
  cycleShift,
  getDayShiftCount,
  onFocusDateChange,
}: MobileScheduleWorkspaceProps) {
  const criticalCount = validationResults.filter(
    (item) => item.date === focusedDate && item.severity === "critical"
  ).length;
  const warningCount = validationResults.filter(
    (item) => item.date === focusedDate && item.severity === "warning"
  ).length;

  const expColors: Record<string, string> = {
    new: "border-amber-200 bg-amber-50",
    experienced: "",
    senior: "border-teal-200 bg-teal-50/40",
  };

  return (
    <div className="flex h-full flex-col md:hidden">
      <div className="border-b bg-background px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">모바일 일정 보기</h2>
            <p className="text-[11px] text-muted-foreground">
              날짜 하나를 선택해 간호사별 근무를 빠르게 확인하고 수정할 수 있습니다.
            </p>
          </div>
          {focusedDate && (
            <Badge variant="secondary" className="h-6 bg-white">
              {focusedDate.slice(5)} {DAYS_KR[dayjs(focusedDate).day()]}
            </Badge>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {rangeDates.map((date) => {
            const active = date === focusedDate;
            const weekend = [0, 6].includes(dayjs(date).day());

            return (
              <button
                key={date}
                type="button"
                onClick={() => onFocusDateChange(date)}
                className={cn(
                  "min-w-[60px] rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : weekend
                      ? "border-red-200 bg-red-50/80 text-red-700"
                      : "border-border bg-card text-foreground"
                )}
              >
                <div className="font-semibold">{date.slice(8)}일</div>
                <div className="text-[10px] opacity-80">{DAYS_KR[dayjs(date).day()]}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {[
            { label: "D", value: getDayShiftCount(focusedDate, "D"), color: "text-[hsl(var(--shift-d))]" },
            { label: "E", value: getDayShiftCount(focusedDate, "E"), color: "text-[hsl(var(--shift-e))]" },
            { label: "N", value: getDayShiftCount(focusedDate, "N"), color: "text-[hsl(var(--shift-n))]" },
            {
              label: "변경",
              value: pendingEditsCount,
              color:
                pendingEditsCount > 0 ? "text-primary" : criticalCount > 0 ? "text-destructive" : "text-amber-600",
            },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border bg-card px-3 py-2 shadow-sm">
              <div className="text-[10px] text-muted-foreground">{item.label}</div>
              <div className={cn("text-sm font-bold", item.color)}>{item.value}</div>
            </div>
          ))}
        </div>

        {(criticalCount > 0 || warningCount > 0) && (
          <div className="mt-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            선택한 날짜에 필수 수정 {criticalCount}건, 권장 검토 {warningCount}건이 있습니다.
          </div>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {nurses.map((nurse) => {
          const shift = getShift(nurse.id, focusedDate);
          const hasIssue = validationResults.some(
            (item) => item.nurseId === nurse.id && item.date === focusedDate
          );

          return (
            <div
              key={`${nurse.id}:${focusedDate}`}
              className={cn(
                "rounded-2xl border bg-card p-3 shadow-sm",
                hasIssue ? "border-destructive/40" : "border-border",
                expColors[nurse.exp] ?? ""
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">{nurse.name}</p>
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
                  <p className="text-[11px] text-muted-foreground">
                    카드를 누르면 D/E/N/OFF 순서로 근무가 바뀝니다.
                  </p>
                </div>
                {hasIssue && (
                  <Badge variant="destructive" className="h-5 text-[10px]">
                    검토
                  </Badge>
                )}
              </div>

              <button
                type="button"
                onClick={() => cycleShift(nurse.id, focusedDate)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition-colors",
                  shift ? "" : "border-border bg-background"
                )}
              >
                <span className="text-xs text-muted-foreground">선택 근무</span>
                <span
                  className={cn(
                    "rounded-lg px-3 py-1 text-lg font-bold",
                    shift ? "bg-muted" : "text-muted-foreground"
                  )}
                >
                  {shift === "OFF" ? "OFF" : shift || "-"}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface MobileIssuesSheetProps {
  open: boolean;
  mode: "validation" | "recommendations" | null;
  recommendations?: RecommendationSummary;
  validationResults: ValidationIssue[];
  onApplyCandidate?: (item: RecommendationItem, candidate: RecommendationCandidate) => void;
  getRecommendationFollowUp?: (item: RecommendationItem) => RecommendationFollowUp;
  onUpdateRecommendationFollowUp?: (
    item: RecommendationItem,
    patch: Partial<RecommendationFollowUp>
  ) => void;
  onOpenChange: (open: boolean) => void;
}

export function MobileIssuesSheet({
  open,
  mode,
  recommendations,
  validationResults,
  onApplyCandidate,
  getRecommendationFollowUp,
  onUpdateRecommendationFollowUp,
  onOpenChange,
}: MobileIssuesSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[78vh] rounded-t-3xl px-0 pb-0">
        <SheetHeader className="border-b px-4 pb-3 pt-2 text-left">
          <SheetTitle className="text-base">{mode === "recommendations" ? "해결 제안" : "검증 결과"}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {mode === "recommendations"
              ? "부족 인원, 공정성 경고, 추천 후보를 모바일에서도 빠르게 확인할 수 있습니다."
              : "검증 이슈를 날짜와 근무 기준으로 빠르게 확인할 수 있습니다."}
          </p>
        </SheetHeader>

        <div className="h-full overflow-y-auto px-3 py-3">
          {mode === "recommendations" ? (
            <div className="space-y-3">
              {recommendations && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <Badge variant="secondary">전체 문제 {recommendations.totalIssues}건</Badge>
                  <Badge variant="secondary">적용 가능 제안 {recommendations.actionableIssues}건</Badge>
                  <Badge variant={recommendations.unresolvedCriticalCount > 0 ? "destructive" : "secondary"}>
                    필수 수정 {recommendations.unresolvedCriticalCount}건
                  </Badge>
                </div>
              )}

              {recommendations?.items.map((item) => {
                const decisionMeta = getRecommendationDecisionMeta(item);
                const followUp = getRecommendationFollowUp?.(item) ?? { status: "new", note: "" };

                return (
                  <div key={item.id} className="rounded-xl border bg-white/90 p-3 shadow-sm">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center gap-1.5">
                          {SEVERITY_ICONS[item.severity]}
                          <h3 className="truncate text-xs font-semibold text-foreground">{item.title}</h3>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{item.summary}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {item.shortageCount ? (
                          <Badge variant="destructive" className="h-5 text-[10px]">
                            부족 {item.shortageCount}명
                          </Badge>
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
                        내부 인력만으로 바로 채우기 어려운 구간입니다. 차선 후보 검토나 추가 지원 요청이 필요할 수 있습니다.
                      </div>
                    )}

                    {item.shortageCount && getRecommendationFollowUp && onUpdateRecommendationFollowUp && (
                      <div className="mt-2 rounded-lg border border-slate-200 bg-white/90 p-2">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-foreground">처리 상태</span>
                          <Select
                            value={followUp.status}
                            onValueChange={(value) =>
                              onUpdateRecommendationFollowUp(item, {
                                status: value as RecommendationFollowUpStatus,
                              })
                            }
                          >
                            <SelectTrigger className="h-7 w-[112px] text-[11px]">
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
                            onUpdateRecommendationFollowUp(item, {
                              note: event.target.value,
                            })
                          }
                          placeholder="예: 플로트 간호사 요청 예정"
                          className="h-8 text-[11px]"
                        />
                      </div>
                    )}

                    {(item.date || item.shiftType) && (
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        {item.date && <Badge variant="secondary">조정 날짜 {item.date.slice(5)}</Badge>}
                        {item.shiftType && <Badge variant="secondary">{getSuggestedShiftLabel(item.shiftType)}</Badge>}
                      </div>
                    )}

                    {item.candidates.slice(0, 3).map((candidate, index) => (
                      <div key={`${item.id}:${candidate.nurseId}`} className="mt-2 rounded-lg border p-2">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-foreground">
                              {index + 1}. {candidate.nurseName}
                            </span>
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
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
                            {candidate.currentShift || "OFF"} → {getSuggestedShiftLabel(item.shiftType)}
                          </span>
                        </div>
                        {candidate.reasons.slice(0, 1).map((reason) => (
                          <p key={reason} className="text-[11px] text-slate-700">
                            - {reason}
                          </p>
                        ))}
                        {candidate.cautions.slice(0, 1).map((caution) => (
                          <p key={caution} className="text-[11px] text-amber-700">
                            - 주의: {caution}
                          </p>
                        ))}

                        {onApplyCandidate && (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => onApplyCandidate(item, candidate)}
                              className="rounded-md border px-2.5 py-1 text-[11px] font-medium text-foreground"
                            >
                              후보 적용
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : validationResults.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <CheckCircle className="mx-auto mb-2 h-8 w-8 text-green-500 opacity-70" />
              <p>현재 검증 문제 없음</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {validationResults.map((item) => (
                <div
                  key={item.id}
                  className={cn("flex gap-2 rounded border p-2 text-xs", SEVERITY_BG[item.severity] ?? "")}
                >
                  {SEVERITY_ICONS[item.severity]}
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <span className="font-semibold text-foreground">{getValidationRuleLabel(item.ruleCode)}</span>
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
      </SheetContent>
    </Sheet>
  );
}
