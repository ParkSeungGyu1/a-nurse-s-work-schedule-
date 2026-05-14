import { useState } from "react";
import { useParams } from "wouter";
import { useListSchedules, useGetSchedule, getGetScheduleQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Printer } from "lucide-react";
import dayjs from "dayjs";

const SHIFT_COLORS: Record<string, string> = {
  D: "border-[hsl(var(--shift-d))]/30 bg-[hsl(var(--shift-d))]/20 text-[hsl(var(--shift-d))]",
  E: "border-[hsl(var(--shift-e))]/30 bg-[hsl(var(--shift-e))]/20 text-[hsl(var(--shift-e))]",
  N: "border-[hsl(var(--shift-n))]/30 bg-[hsl(var(--shift-n))]/20 text-[hsl(var(--shift-n))]",
  OFF: "border-muted bg-muted/40 text-muted-foreground",
};

const DAYS_KR = ["일", "월", "화", "수", "목", "금", "토"];

export default function ExportPage() {
  const params = useParams<{ wardId: string }>();
  const wardId = Number(params.wardId);
  const { data: schedules, isLoading: schedulesLoading } = useListSchedules(wardId);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const { data: schedule, isLoading: scheduleLoading } = useGetSchedule(
    wardId,
    selectedScheduleId ?? 0,
    { query: { enabled: !!selectedScheduleId, queryKey: getGetScheduleQueryKey(wardId, selectedScheduleId ?? 0) } }
  );

  if (schedulesLoading) return <div className="p-6"><Skeleton className="h-96" /></div>;

  const nurseIds = schedule ? [...new Set(schedule.entries.map((e) => e.nurseId))] : [];
  const nurses = nurseIds.map((id) => {
    const entry = schedule!.entries.find((e) => e.nurseId === id);
    return { id, name: entry?.nurseName ?? `#${id}` };
  });

  const days = schedule
    ? Array.from(
        { length: dayjs(`${schedule.yearMonth}-01`).daysInMonth() },
        (_, i) => `${schedule.yearMonth}-${String(i + 1).padStart(2, "0")}`
      )
    : [];

  function getShift(nurseId: number, date: string) {
    return schedule?.entries.find((e) => e.nurseId === nurseId && e.date === date)?.shiftType ?? "";
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="mx-auto max-w-7xl p-6" data-testid="export-page">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">미리보기</h1>
          <p className="text-sm text-muted-foreground">스케줄을 출력하거나 인쇄 전 확인할 수 있습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedScheduleId && (
            <Button variant="outline" onClick={handlePrint} data-testid="button-print">
              <Printer className="mr-1.5 h-4 w-4" /> 인쇄
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-4 print:hidden">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">스케줄 선택</label>
            <Select value={selectedScheduleId ? String(selectedScheduleId) : ""} onValueChange={(v) => setSelectedScheduleId(Number(v))}>
              <SelectTrigger className="w-48" data-testid="select-export-schedule">
                <SelectValue placeholder="스케줄 선택" />
              </SelectTrigger>
              <SelectContent>
                {schedules?.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.yearMonth} ({s.status === "published" ? "발행됨" : s.status === "draft" ? "초안" : "보관됨"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedScheduleId && scheduleLoading && <Skeleton className="h-96" />}

      {schedule && (
        <div data-testid="print-area">
          <div className="mb-4 hidden text-center print:block">
            <h2 className="text-xl font-bold">{schedule.yearMonth} 근무 일정표</h2>
          </div>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full border-collapse text-[11px]" data-testid="table-export">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="sticky left-0 min-w-[100px] bg-muted/50 p-2 text-left font-medium">간호사</th>
                    {days.map((date) => {
                      const dow = dayjs(date).day();
                      const isWeekend = dow === 0 || dow === 6;
                      return (
                        <th key={date} className={`min-w-[28px] p-1 text-center font-medium ${isWeekend ? "text-destructive" : "text-muted-foreground"}`}>
                          <div>{date.slice(8)}</div>
                          <div className="text-[10px]">{DAYS_KR[dow]}</div>
                        </th>
                      );
                    })}
                    <th className="min-w-[50px] p-2 text-center font-medium text-muted-foreground">D</th>
                    <th className="min-w-[50px] p-2 text-center font-medium text-muted-foreground">E</th>
                    <th className="min-w-[50px] p-2 text-center font-medium text-muted-foreground">N</th>
                  </tr>
                </thead>
                <tbody>
                  {nurses.map((nurse) => {
                    const shiftCounts = { D: 0, E: 0, N: 0 };
                    days.forEach((date) => {
                      const shift = getShift(nurse.id, date);
                      if (shift === "D") shiftCounts.D++;
                      else if (shift === "E") shiftCounts.E++;
                      else if (shift === "N") shiftCounts.N++;
                    });

                    return (
                      <tr key={nurse.id} className="border-b last:border-0 hover:bg-muted/20" data-testid={`row-export-${nurse.id}`}>
                        <td className="sticky left-0 bg-background p-2 font-medium">{nurse.name}</td>
                        {days.map((date) => {
                          const shift = getShift(nurse.id, date);
                          return (
                            <td key={date} className="p-0.5 text-center">
                              {shift && shift !== "OFF" ? (
                                <span className={`inline-block rounded border px-1 text-[10px] font-bold ${SHIFT_COLORS[shift] ?? ""}`}>{shift}</span>
                              ) : shift === "OFF" ? (
                                <span className="text-[10px] text-muted-foreground/40">-</span>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="p-2 text-center font-semibold text-[hsl(var(--shift-d))]">{shiftCounts.D}</td>
                        <td className="p-2 text-center font-semibold text-[hsl(var(--shift-e))]">{shiftCounts.E}</td>
                        <td className="p-2 text-center font-semibold text-[hsl(var(--shift-n))]">{shiftCounts.N}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {!selectedScheduleId && (
        <Card className="py-16 text-center">
          <CardContent>
            <Download className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-medium text-muted-foreground">스케줄을 선택해 미리보기를 확인하세요.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
