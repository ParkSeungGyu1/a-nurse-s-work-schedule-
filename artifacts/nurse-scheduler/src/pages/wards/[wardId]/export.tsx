import { useState } from "react";
import { useParams } from "wouter";
import { useListSchedules, useGetSchedule, getListSchedulesQueryKey, getGetScheduleQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Printer, FileSpreadsheet } from "lucide-react";
import dayjs from "dayjs";

const SHIFT_COLORS: Record<string, string> = {
  D: "bg-[hsl(var(--shift-d))]/20 text-[hsl(var(--shift-d))] border-[hsl(var(--shift-d))]/30",
  E: "bg-[hsl(var(--shift-e))]/20 text-[hsl(var(--shift-e))] border-[hsl(var(--shift-e))]/30",
  N: "bg-[hsl(var(--shift-n))]/20 text-[hsl(var(--shift-n))] border-[hsl(var(--shift-n))]/30",
  OFF: "bg-muted/40 text-muted-foreground border-muted",
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

  // Build nurse list from entries
  const nurseIds = schedule
    ? [...new Set(schedule.entries.map((e) => e.nurseId))]
    : [];
  const nurses = nurseIds.map((id) => {
    const entry = schedule!.entries.find((e) => e.nurseId === id);
    return { id, name: entry?.nurseName ?? `#${id}`, exp: entry?.nurseExperienceLevel ?? "" };
  });

  // Build date list from schedule yearMonth
  const days = schedule
    ? Array.from(
        { length: dayjs(schedule.yearMonth + "-01").daysInMonth() },
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
    <div className="p-6 max-w-7xl mx-auto" data-testid="export-page">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">내보내기</h1>
          <p className="text-muted-foreground text-sm">스케줄을 출력하거나 내보냅니다.</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedScheduleId && (
            <>
              <Button variant="outline" onClick={handlePrint} data-testid="button-print">
                <Printer className="w-4 h-4 mr-1.5" /> 인쇄
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="mb-4 print:hidden">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">스케줄 선택</label>
            <Select
              value={selectedScheduleId ? String(selectedScheduleId) : ""}
              onValueChange={(v) => setSelectedScheduleId(Number(v))}
            >
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
          <div className="mb-4 text-center print:block hidden">
            <h2 className="text-xl font-bold">{schedule.yearMonth} 근무 일정표</h2>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-[11px] border-collapse" data-testid="table-export">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="p-2 text-left font-medium sticky left-0 bg-muted/50 min-w-[100px]">간호사</th>
                    {days.map((date) => {
                      const dow = dayjs(date).day();
                      const isWeekend = dow === 0 || dow === 6;
                      return (
                        <th
                          key={date}
                          className={`p-1 text-center font-medium min-w-[28px] ${isWeekend ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          <div>{date.slice(8)}</div>
                          <div className="text-[10px]">{DAYS_KR[dow]}</div>
                        </th>
                      );
                    })}
                    <th className="p-2 text-center font-medium text-muted-foreground min-w-[50px]">D</th>
                    <th className="p-2 text-center font-medium text-muted-foreground min-w-[50px]">E</th>
                    <th className="p-2 text-center font-medium text-muted-foreground min-w-[50px]">N</th>
                  </tr>
                </thead>
                <tbody>
                  {nurses.map((nurse) => {
                    const shiftCounts = { D: 0, E: 0, N: 0 };
                    days.forEach((date) => {
                      const s = getShift(nurse.id, date);
                      if (s === "D") shiftCounts.D++;
                      else if (s === "E") shiftCounts.E++;
                      else if (s === "N") shiftCounts.N++;
                    });
                    return (
                      <tr key={nurse.id} className="border-b last:border-0 hover:bg-muted/20" data-testid={`row-export-${nurse.id}`}>
                        <td className="p-2 font-medium sticky left-0 bg-background">{nurse.name}</td>
                        {days.map((date) => {
                          const shift = getShift(nurse.id, date);
                          return (
                            <td key={date} className="p-0.5 text-center">
                              {shift && shift !== "OFF" ? (
                                <span className={`inline-block px-1 rounded text-[10px] font-bold border ${SHIFT_COLORS[shift] ?? ""}`}>
                                  {shift}
                                </span>
                              ) : shift === "OFF" ? (
                                <span className="text-muted-foreground/40 text-[10px]">-</span>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="p-2 text-center text-[hsl(var(--shift-d))] font-semibold">{shiftCounts.D}</td>
                        <td className="p-2 text-center text-[hsl(var(--shift-e))] font-semibold">{shiftCounts.E}</td>
                        <td className="p-2 text-center text-[hsl(var(--shift-n))] font-semibold">{shiftCounts.N}</td>
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
        <Card className="text-center py-16">
          <CardContent>
            <Download className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-muted-foreground font-medium">스케줄을 선택하여 미리보기</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
