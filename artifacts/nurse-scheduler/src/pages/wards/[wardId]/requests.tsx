import { useState } from "react";
import { useParams } from "wouter";
import {
  useListNurses,
  useListNurseConstraints,
  useCreateNurseConstraint,
  useDeleteNurseConstraint,
  getListNurseConstraintsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const CONSTRAINT_TYPE_LABELS: Record<string, string> = {
  fixed_off: "고정 휴무",
  preferred_off: "희망 휴무",
  forbidden_shift: "금지 근무",
  education: "교육",
  annual_leave: "연차",
};

const CONSTRAINT_COLORS: Record<string, string> = {
  fixed_off: "bg-red-100 text-red-800",
  preferred_off: "bg-orange-100 text-orange-800",
  forbidden_shift: "bg-purple-100 text-purple-800",
  education: "bg-blue-100 text-blue-800",
  annual_leave: "bg-green-100 text-green-800",
};

const constraintSchema = z.object({
  constraintType: z.string().min(1),
  date: z.string().optional(),
  shiftType: z.string().optional(),
  yearMonth: z.string().optional(),
  isHard: z.boolean(),
  notes: z.string().optional(),
});

type ConstraintForm = z.infer<typeof constraintSchema>;

function NurseConstraints({ wardId, nurseId }: { wardId: number; nurseId: number }) {
  const { data: constraints, isLoading } = useListNurseConstraints(wardId, nurseId, {
    query: { queryKey: getListNurseConstraintsQueryKey(wardId, nurseId) },
  });
  const createConstraint = useCreateNurseConstraint();
  const deleteConstraint = useDeleteNurseConstraint();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);

  const form = useForm<ConstraintForm>({
    resolver: zodResolver(constraintSchema),
    defaultValues: { constraintType: "fixed_off", isHard: true },
  });

  const constraintType = form.watch("constraintType");

  function onSubmit(data: ConstraintForm) {
    createConstraint.mutate({ wardId, nurseId, data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNurseConstraintsQueryKey(wardId, nurseId) });
        setShowForm(false);
        form.reset({ constraintType: "fixed_off", isHard: true });
        toast({ title: "요청이 등록되었습니다." });
      },
    });
  }

  if (isLoading) return <Skeleton className="h-10" />;

  return (
    <div className="space-y-1.5">
      {constraints && constraints.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {constraints.map((c) => (
            <div key={c.id} className="flex items-center gap-1 p-1.5 bg-muted/40 rounded text-xs border" data-testid={`row-constraint-${c.id}`}>
              <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${CONSTRAINT_COLORS[c.constraintType] ?? ""}`}>
                {CONSTRAINT_TYPE_LABELS[c.constraintType] ?? c.constraintType}
              </span>
              {c.date && <span className="text-muted-foreground">{c.date.slice(5)}</span>}
              {c.shiftType && <span className="font-mono font-semibold">{c.shiftType}</span>}
              {c.isHard && <Badge variant="destructive" className="text-[9px] px-1 py-0">필수</Badge>}
              {c.notes && <span className="text-muted-foreground hidden sm:inline">· {c.notes}</span>}
              <Button
                size="sm" variant="ghost"
                className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                onClick={() => deleteConstraint.mutate(
                  { wardId, nurseId, constraintId: c.id },
                  { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNurseConstraintsQueryKey(wardId, nurseId) }) }
                )}
                data-testid={`button-delete-constraint-${c.id}`}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">요청 없음</p>
      )}

      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowForm(true)} data-testid={`button-add-constraint-${nurseId}`}>
        <Plus className="w-3 h-3 mr-1" /> 요청 추가
      </Button>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm w-[calc(100%-2rem)] mx-auto" data-testid="dialog-constraint-form">
          <DialogHeader><DialogTitle>근무 요청 추가</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <div>
              <Label>요청 유형</Label>
              <Select value={constraintType} onValueChange={(v) => form.setValue("constraintType", v)}>
                <SelectTrigger data-testid="select-constraint-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CONSTRAINT_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(constraintType === "fixed_off" || constraintType === "preferred_off" || constraintType === "education" || constraintType === "annual_leave") && (
              <div>
                <Label>날짜</Label>
                <Input type="date" data-testid="input-constraint-date" {...form.register("date")} />
              </div>
            )}
            {constraintType === "forbidden_shift" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>날짜 (선택)</Label>
                  <Input type="date" data-testid="input-constraint-date" {...form.register("date")} />
                </div>
                <div>
                  <Label>근무 유형</Label>
                  <Select onValueChange={(v) => form.setValue("shiftType", v)}>
                    <SelectTrigger data-testid="select-shift-type"><SelectValue placeholder="선택" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="D">데이 (D)</SelectItem>
                      <SelectItem value="E">이브닝 (E)</SelectItem>
                      <SelectItem value="N">나이트 (N)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div>
              <Label>월 (YYYY-MM, 선택)</Label>
              <Input type="month" data-testid="input-constraint-month" {...form.register("yearMonth")} />
            </div>
            <div className="flex items-center gap-2">
              <Controller control={form.control} name="isHard" render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-is-hard" id="isHard" />
              )} />
              <Label htmlFor="isHard" className="cursor-pointer text-sm">필수 제약 (Hard constraint)</Label>
            </div>
            <div>
              <Label>메모 (선택)</Label>
              <Input placeholder="사유 입력" data-testid="input-constraint-notes" {...form.register("notes")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>취소</Button>
              <Button type="submit" disabled={createConstraint.isPending} data-testid="button-submit-constraint">추가</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function RequestsPage() {
  const params = useParams<{ wardId: string }>();
  const wardId = Number(params.wardId);
  const { data: nurses, isLoading } = useListNurses(wardId);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto" data-testid="requests-page">
      <div className="flex items-center gap-3 mb-5 md:mb-6">
        <div className="bg-primary/10 p-2 rounded-lg">
          <MessageSquare className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">개인 근무 요청</h1>
          <p className="text-muted-foreground text-xs md:text-sm">간호사별 휴무 요청 및 근무 제약을 관리합니다.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : nurses && nurses.length > 0 ? (
        <div className="space-y-3">
          {nurses.map((nurse) => (
            <Card key={nurse.id} data-testid={`card-nurse-requests-${nurse.id}`}>
              <CardContent className="p-3 md:p-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="sm:w-32 flex-shrink-0">
                    <p className="font-semibold text-sm">{nurse.name}</p>
                    <p className="text-xs text-muted-foreground">{nurse.employeeNumber}</p>
                  </div>
                  <div className="flex-1">
                    <NurseConstraints wardId={wardId} nurseId={nurse.id} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="text-center py-16">
          <CardContent>
            <p className="text-muted-foreground">등록된 간호사가 없습니다.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
