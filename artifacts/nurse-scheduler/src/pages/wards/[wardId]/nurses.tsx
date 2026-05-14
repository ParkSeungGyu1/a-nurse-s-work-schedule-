import { useState } from "react";
import { useParams } from "wouter";
import {
  useListNurses, useCreateNurse, useUpdateNurse, useDeleteNurse,
  getListNursesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Users, Edit2, Trash2, Moon, Baby } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const EXPERIENCE_LABELS: Record<string, string> = { new: "신규", experienced: "경력", senior: "책임" };
const EXPERIENCE_COLORS: Record<string, string> = {
  new: "bg-amber-100 text-amber-800",
  experienced: "bg-blue-100 text-blue-800",
  senior: "bg-teal-100 text-teal-800",
};

const nurseSchema = z.object({
  name: z.string().min(1, "이름을 입력해주세요."),
  employeeNumber: z.string().min(1, "사번을 입력해주세요."),
  experienceLevel: z.enum(["new", "experienced", "senior"]),
  isNightKeep: z.boolean(),
  isPregnant: z.boolean(),
  allowedShifts: z.array(z.string()).min(1, "허용 근무를 최소 1개 선택해주세요."),
  monthlyNightLimit: z.coerce.number().optional(),
  notes: z.string().optional(),
});

type NurseForm = z.infer<typeof nurseSchema>;

const ALL_SHIFTS = ["D", "E", "N"];
const SHIFT_LABELS: Record<string, string> = { D: "데이", E: "이브닝", N: "나이트" };
const SHIFT_COLORS: Record<string, string> = {
  D: "bg-[hsl(var(--shift-d))]/20 text-[hsl(var(--shift-d))]",
  E: "bg-[hsl(var(--shift-e))]/20 text-[hsl(var(--shift-e))]",
  N: "bg-[hsl(var(--shift-n))]/20 text-[hsl(var(--shift-n))]",
};

export default function NursesPage() {
  const params = useParams<{ wardId: string }>();
  const wardId = Number(params.wardId);
  const { data: nurses, isLoading } = useListNurses(wardId);
  const createNurse = useCreateNurse();
  const updateNurse = useUpdateNurse();
  const deleteNurse = useDeleteNurse();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const form = useForm<NurseForm>({
    resolver: zodResolver(nurseSchema),
    defaultValues: {
      name: "",
      employeeNumber: "",
      experienceLevel: "new",
      isNightKeep: false,
      isPregnant: false,
      allowedShifts: ["D", "E", "N"],
      monthlyNightLimit: undefined,
      notes: "",
    },
  });

  function openCreate() {
    setEditingId(null);
    form.reset({
      name: "",
      employeeNumber: "",
      experienceLevel: "new",
      isNightKeep: false,
      isPregnant: false,
      allowedShifts: ["D", "E", "N"],
      monthlyNightLimit: undefined,
      notes: "",
    });
    setShowForm(true);
  }

  function openEdit(nurse: NonNullable<typeof nurses>[0]) {
    setEditingId(nurse.id);
    form.reset({
      name: nurse.name,
      employeeNumber: nurse.employeeNumber,
      experienceLevel: nurse.experienceLevel as "new" | "experienced" | "senior",
      isNightKeep: nurse.isNightKeep,
      isPregnant: nurse.isPregnant,
      allowedShifts: nurse.allowedShifts,
      monthlyNightLimit: nurse.monthlyNightLimit ?? undefined,
      notes: nurse.notes ?? "",
    });
    setShowForm(true);
  }

  function onSubmit(data: NurseForm) {
    const payload = {
      name: data.name,
      employeeNumber: data.employeeNumber,
      experienceLevel: data.experienceLevel,
      isNightKeep: data.isNightKeep,
      isPregnant: data.isPregnant,
      allowedShifts: data.allowedShifts,
      monthlyNightLimit: data.monthlyNightLimit,
      notes: data.notes,
    };

    if (editingId) {
      updateNurse.mutate({ wardId, nurseId: editingId, data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNursesQueryKey(wardId) });
          setShowForm(false);
          toast({ title: "간호사 정보가 수정되었습니다." });
        },
      });
      return;
    }

    createNurse.mutate({ wardId, data: payload }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNursesQueryKey(wardId) });
        setShowForm(false);
        form.reset();
        toast({ title: "간호사가 등록되었습니다." });
      },
    });
  }

  function handleDelete(nurseId: number) {
    if (!confirm("이 간호사를 삭제하시겠습니까?")) return;
    deleteNurse.mutate({ wardId, nurseId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNursesQueryKey(wardId) });
        toast({ title: "간호사가 삭제되었습니다." });
      },
    });
  }

  const allowedShiftsWatch = form.watch("allowedShifts");

  function toggleShift(shift: string) {
    const current = form.getValues("allowedShifts");
    form.setValue("allowedShifts", current.includes(shift) ? current.filter((s) => s !== shift) : [...current, shift]);
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6" data-testid="nurses-page">
      <div className="mb-4 flex items-center justify-between md:mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">간호사 관리</h1>
          <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">간호사 정보와 근무 가능 조건을 관리합니다.</p>
        </div>
        <Button onClick={openCreate} size="sm" className="md:size-auto" data-testid="button-add-nurse">
          <Plus className="h-4 w-4 md:mr-1.5" />
          <span className="hidden md:inline">간호사 추가</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : nurses && nurses.length > 0 ? (
        <>
          <div className="space-y-2 md:hidden" data-testid="nurses-mobile-list">
            {nurses.map((nurse) => (
              <Card key={nurse.id} data-testid={`row-nurse-${nurse.id}`}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-1.5">
                        <span className="text-sm font-semibold">{nurse.name}</span>
                        <span className="text-xs text-muted-foreground">{nurse.employeeNumber}</span>
                        {nurse.isNightKeep && <span title="나이트 전담"><Moon className="h-3 w-3 text-[hsl(var(--shift-n))]" /></span>}
                        {nurse.isPregnant && <span title="임신"><Baby className="h-3 w-3 text-pink-500" /></span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${EXPERIENCE_COLORS[nurse.experienceLevel] ?? ""}`}>
                          {EXPERIENCE_LABELS[nurse.experienceLevel] ?? nurse.experienceLevel}
                        </span>
                        <div className="flex gap-0.5">
                          {ALL_SHIFTS.map((s) => (
                            <span key={s} className={`rounded px-1 py-0.5 font-mono text-xs font-semibold ${(nurse.allowedShifts ?? []).includes(s) ? SHIFT_COLORS[s] : "text-muted-foreground/30"}`}>{s}</span>
                          ))}
                        </div>
                        {nurse.monthlyNightLimit != null && (
                          <span className="text-xs text-muted-foreground">나이트 {nurse.monthlyNightLimit}회</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(nurse)} data-testid={`button-edit-nurse-${nurse.id}`}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(nurse.id)} data-testid={`button-delete-nurse-${nurse.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-nurses">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 text-left font-medium text-muted-foreground">이름</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">사번</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">경력</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">허용 근무</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">월 최대 N</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">특이사항</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {nurses.map((nurse) => (
                      <tr key={nurse.id} className="border-b transition-colors last:border-0 hover:bg-muted/30" data-testid={`row-nurse-${nurse.id}`}>
                        <td className="p-3 font-medium">
                          <div className="flex items-center gap-2">
                            {nurse.name}
                            {nurse.isNightKeep && <span title="나이트 전담"><Moon className="h-3.5 w-3.5 text-[hsl(var(--shift-n))]" /></span>}
                            {nurse.isPregnant && <span title="임신"><Baby className="h-3.5 w-3.5 text-pink-500" /></span>}
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground">{nurse.employeeNumber}</td>
                        <td className="p-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${EXPERIENCE_COLORS[nurse.experienceLevel] ?? ""}`}>
                            {EXPERIENCE_LABELS[nurse.experienceLevel] ?? nurse.experienceLevel}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            {ALL_SHIFTS.map((s) => (
                              <span key={s} className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${(nurse.allowedShifts ?? []).includes(s) ? SHIFT_COLORS[s] : "text-muted-foreground/30"}`}>{s}</span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground">{nurse.monthlyNightLimit != null ? `${nurse.monthlyNightLimit}회` : "-"}</td>
                        <td className="p-3 text-xs text-muted-foreground">{nurse.notes ?? "-"}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(nurse)} data-testid={`button-edit-nurse-${nurse.id}`}><Edit2 className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDelete(nurse.id)} data-testid={`button-delete-nurse-${nurse.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="py-16 text-center text-muted-foreground">
          <CardContent>
            <Users className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-medium">등록된 간호사가 없습니다.</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="mx-auto w-[calc(100%-2rem)] max-w-md" data-testid="dialog-nurse-form">
          <DialogHeader>
            <DialogTitle>{editingId ? "간호사 수정" : "간호사 추가"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>이름</Label>
                <Input data-testid="input-nurse-name" {...form.register("name")} />
                {form.formState.errors.name && <p className="mt-1 text-xs text-destructive">{form.formState.errors.name.message}</p>}
              </div>
              <div>
                <Label>사번</Label>
                <Input data-testid="input-nurse-employee-number" {...form.register("employeeNumber")} />
              </div>
            </div>

            <div>
              <Label>경력 구분</Label>
              <Select value={form.watch("experienceLevel")} onValueChange={(v) => form.setValue("experienceLevel", v as "new" | "experienced" | "senior")}>
                <SelectTrigger data-testid="select-experience-level"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">신규</SelectItem>
                  <SelectItem value="experienced">경력</SelectItem>
                  <SelectItem value="senior">책임</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>허용 근무 유형</Label>
              <div className="mt-1 flex gap-3">
                {ALL_SHIFTS.map((s) => (
                  <label key={s} className="flex cursor-pointer items-center gap-1.5">
                    <Checkbox checked={allowedShiftsWatch.includes(s)} onCheckedChange={() => toggleShift(s)} data-testid={`checkbox-shift-${s}`} />
                    <span className="text-sm">{SHIFT_LABELS[s]} ({s})</span>
                  </label>
                ))}
              </div>
              {form.formState.errors.allowedShifts && <p className="mt-1 text-xs text-destructive">{form.formState.errors.allowedShifts.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 pt-2">
                <Controller control={form.control} name="isNightKeep" render={({ field }) => (
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-night-keep" id="nightKeep" />
                )} />
                <Label htmlFor="nightKeep" className="cursor-pointer">나이트 전담</Label>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Controller control={form.control} name="isPregnant" render={({ field }) => (
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-pregnant" id="pregnant" />
                )} />
                <Label htmlFor="pregnant" className="cursor-pointer">임신 중</Label>
              </div>
            </div>

            <div>
              <Label>월 최대 나이트 횟수</Label>
              <Input type="number" placeholder="비워두면 병동 기본 규칙을 사용합니다." data-testid="input-night-limit" {...form.register("monthlyNightLimit")} />
            </div>

            <div>
              <Label>메모</Label>
              <Input placeholder="예: 교육기간 중 N 제외" data-testid="input-nurse-notes" {...form.register("notes")} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>취소</Button>
              <Button type="submit" disabled={createNurse.isPending || updateNurse.isPending} data-testid="button-submit-nurse">
                {editingId ? "수정" : "추가"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
