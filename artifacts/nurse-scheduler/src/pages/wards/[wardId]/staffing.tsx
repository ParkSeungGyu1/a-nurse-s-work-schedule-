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
import { Badge } from "@/components/ui/badge";
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
    const [y, m] = ym.split("-").map(Number);
    const count = dayjs(`${y}-${String(m).padStart(2, "0")}-01`).daysInMonth();
    return Array.from({ length: count }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      return `${ym}-${d}`;
    });
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
    for (const date of days) {
      updates[`${date}:${shift}`] = value;
    }
    setOverrides((prev) => ({ ...prev, ...updates }));
  }

  async function handleSave() {
    const reqs = [];
    for (const date of days) {
      for (const shift of SHIFT_TYPES) {
        reqs.push({
          date,
          shiftType: shift,
          requiredCount: getReqCount(date, shift),
          isHoliday: false,
        });
      }
    }
    upsert.mutate(
      { wardId, data: { requirements: reqs } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListStaffingRequirementsQueryKey(wardId, yearMonth) });
          setOverrides({});
          toast({ title: "인력 요구가 저장되었습니다." });
        },
        onError: () => toast({ title: "저장에 실패했습니다.", variant: "destructive" }),
      }
    );
  }

  const prevMonth = () => setYearMonth(dayjs(yearMonth + "-01").subtract(1, "month").format("YYYY-MM"));
  const nextMonth = () => setYearMonth(dayjs(yearMonth + "-01").add(1, "month").format("YYYY-MM"));

  return (
    <div className="p-6 max-w-6xl mx-auto" data-testid="staffing-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">인력 요구 설정</h1>
          <p className="text-muted-foreground text-sm mt-1">날짜별 D/E/N 필요 인원을 설정합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={prevMonth} data-testid="button-prev-month"><ChevronLeft className="w-4 h-4" /></Button>
          <span className="font-semibold text-sm w-24 text-center" data-testid="text-year-month">{yearMonth}</span>
          <Button variant="outline" size="sm" onClick={nextMonth} data-testid="button-next-month"><ChevronRight className="w-4 h-4" /></Button>
          <Button onClick={handleSave} disabled={upsert.isPending} data-testid="button-save-staffing">
            <Save className="w-4 h-4 mr-1.5" />
            {upsert.isPending ? "저장 중..." : "저장"}
          </Button>
        </div>
      </div>

      {/* Bulk edit row */}
      <Card className="mb-4">
        <CardHeader className="py-3">
          <CardTitle className="text-sm">일괄 설정</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-6 py-2">
          {SHIFT_TYPES.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`text-xs font-bold w-16 ${SHIFT_COLORS[s]}`}>{SHIFT_LABELS[s]} ({s})</span>
              <Input
                type="number"
                className="w-16 h-7 text-center text-sm"
                defaultValue={3}
                data-testid={`input-bulk-${s}`}
                onBlur={(e) => applyBulk(s, Number(e.target.value))}
              />
              <span className="text-xs text-muted-foreground">명 일괄 적용</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs border-collapse" data-testid="table-staffing">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="p-2 text-left font-medium text-muted-foreground w-20 sticky left-0 bg-muted/50">날짜</th>
                  <th className="p-2 text-left font-medium text-muted-foreground w-8">요일</th>
                  {SHIFT_TYPES.map((s) => (
                    <th key={s} className={`p-2 font-semibold w-20 text-center ${SHIFT_COLORS[s]}`}>{SHIFT_LABELS[s]} ({s})</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((date) => {
                  const dow = dayjs(date).day();
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <tr key={date} className={`border-b last:border-0 ${isWeekend ? "bg-muted/20" : ""}`} data-testid={`row-staffing-${date}`}>
                      <td className="p-2 font-medium sticky left-0 bg-inherit">{date.slice(5)}</td>
                      <td className={`p-2 ${isWeekend ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{DAYS_KR[dow]}</td>
                      {SHIFT_TYPES.map((s) => (
                        <td key={s} className="p-1.5 text-center">
                          <Input
                            type="number"
                            min={0}
                            max={20}
                            className="w-14 h-7 text-center mx-auto"
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
