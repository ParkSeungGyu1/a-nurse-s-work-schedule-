import { useState } from "react";
import { useParams } from "wouter";
import {
  useListStaffingRequirements,
  useUpsertStaffingRequirements,
  getListStaffingRequirementsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import dayjs from "dayjs";

const SHIFT_TYPES = ["D", "E", "N"] as const;
const SHIFT_LABELS: Record<string, string> = { D: "데이", E: "이브닝", N: "나이트" };
const SHIFT_COLORS: Record<string, string> = {
  D: "text-[hsl(var(--shift-d))]",
  E: "text-[hsl(var(--shift-e))]",
  N: "text-[hsl(var(--shift-n))]",
};
const DAYS_KR = ["일", "월", "화", "수", "목", "금", "토"];

export default function StaffingPage() {
  const params = useParams<{ wardId: string }>();
  const wardId = Number(params.wardId);
  const [yearMonth, setYearMonth] = useState(dayjs().format("YYYY-MM"));
  const { data: requirements, isLoading } = useListStaffingRequirements(wardId, yearMonth, {
    query: { queryKey: getListStaffingRequirementsQueryKey(wardId, yearMonth) },
  });
  const upsert = useUpsertStaffingRequirements();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const days = getDaysInMonth(yearMonth);

  function getDaysInMonth(ym: string) {
    const count = dayjs(`${ym}-01`).daysInMonth();
    return Array.from({ length: count }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
  }

  function getReqCount(date: string, shift: string): number {
    const key = `${date}:${shift}`;
    if (key in overrides) return overrides[key];
    return requirements?.find((r) => r.date === date && r.shiftType === shift)?.requiredCount ?? 3;
  }

  function setReqCount(date: string, shift: string, value: number) {
    setOverrides((prev) => ({ ...prev, [`${date}:${shift}`]: value }));
  }

  function applyBulk(shift: string, value: number) {
    const updates: Record<string, number> = {};
    for (const date of days) updates[`${date}:${shift}`] = value;
    setOverrides((prev) => ({ ...prev, ...updates }));
  }

  async function handleSave() {
    const reqs = [];
    for (const date of days) {
      for (const shift of SHIFT_TYPES) {
        reqs.push({ date, shiftType: shift, requiredCount: getReqCount(date, shift), isHoliday: false });
      }
    }

    upsert.mutate({ wardId, data: { requirements: reqs } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStaffingRequirementsQueryKey(wardId, yearMonth) });
        setOverrides({});
        toast({ title: "인력 요구가 저장되었습니다." });
      },
      onError: () => toast({ title: "저장에 실패했습니다.", variant: "destructive" }),
    });
  }

  const prevMonth = () => setYearMonth(dayjs(`${yearMonth}-01`).subtract(1, "month").format("YYYY-MM"));
  const nextMonth = () => setYearMonth(dayjs(`${yearMonth}-01`).add(1, "month").format("YYYY-MM"));

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6" data-testid="staffing-page">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 md:mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">인력 요구 설정</h1>
          <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">날짜별 D/E/N 필요 인원을 설정합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={prevMonth} data-testid="button-prev-month"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="w-20 text-center text-sm font-semibold" data-testid="text-year-month">{yearMonth}</span>
          <Button variant="outline" size="sm" onClick={nextMonth} data-testid="button-next-month"><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" onClick={handleSave} disabled={upsert.isPending} data-testid="button-save-staffing">
            <Save className="h-4 w-4 md:mr-1.5" />
            <span className="hidden md:inline">{upsert.isPending ? "저장 중..." : "저장"}</span>
          </Button>
        </div>
      </div>

      <Card className="mb-3">
        <CardHeader className="px-3 py-2 md:px-4">
          <CardTitle className="text-sm">일괄 설정</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 px-3 py-2 md:px-4">
          {SHIFT_TYPES.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`w-12 text-xs font-bold md:w-16 ${SHIFT_COLORS[s]}`}>{SHIFT_LABELS[s]} ({s})</span>
              <Input
                type="number"
                className="h-7 w-12 text-center text-sm"
                defaultValue={3}
                data-testid={`input-bulk-${s}`}
                onBlur={(e) => applyBulk(s, Number(e.target.value))}
              />
              <span className="hidden text-xs text-muted-foreground sm:inline">모든 날짜 적용</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[340px] border-collapse text-xs" data-testid="table-staffing">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="sticky left-0 w-16 bg-muted/50 p-2 text-left font-medium text-muted-foreground">날짜</th>
                  <th className="w-8 p-2 text-left font-medium text-muted-foreground">요일</th>
                  {SHIFT_TYPES.map((s) => (
                    <th key={s} className={`p-2 text-center font-semibold ${SHIFT_COLORS[s]}`}>{SHIFT_LABELS[s]} ({s})</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((date) => {
                  const dow = dayjs(date).day();
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <tr key={date} className={`border-b last:border-0 ${isWeekend ? "bg-muted/20" : ""}`} data-testid={`row-staffing-${date}`}>
                      <td className="sticky left-0 bg-inherit p-2 font-medium">{date.slice(5)}</td>
                      <td className={`p-2 ${isWeekend ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{DAYS_KR[dow]}</td>
                      {SHIFT_TYPES.map((s) => (
                        <td key={s} className="p-1.5 text-center">
                          <Input
                            type="number"
                            min={0}
                            max={20}
                            className="mx-auto h-7 w-12 text-center text-xs"
                            value={getReqCount(date, s)}
                            onChange={(e) => setReqCount(date, s, Number(e.target.value))}
                            data-testid={`input-staffing-${date}-${s}`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
