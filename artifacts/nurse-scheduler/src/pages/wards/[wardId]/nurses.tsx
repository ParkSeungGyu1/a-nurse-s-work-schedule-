import { useState } from "react";
import { useParams } from "wouter";
import {
  useListNurses, useCreateNurse, useUpdateNurse, useDeleteNurse,
  getListNursesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const EXPERIENCE_LABELS: Record<string, string> = { new: "신규", experienced: "경력", senior: "선임" };
const EXPERIENCE_COLORS: Record<string, string> = {
  new: "bg-amber-100 text-amber-800",
  experienced: "bg-blue-100 text-blue-800",
  senior: "bg-teal-100 text-teal-800",
};

const nurseSchema = z.object({
  name: z.string().min(1, "이름을 입력해주세요"),
  employeeNumber: z.string().min(1, "사번을 입력해주세요"),
  experienceLevel: z.enum(["new", "experienced", "senior"]),
  isNightKeep: z.boolean(),
  isPregnant: z.boolean(),
  allowedShifts: z.array(z.string()).min(1, "허용 근무를 최소 1개 선택해주세요"),
  monthlyNightLimit: z.coerce.number().optional(),
  notes: z.string().optional(),
});

type NurseForm = z.infer<typeof nurseSchema>;

const ALL_SHIFTS = ["D", "E", "N"];
const SHIFT_LABELS: Record<string, string> = { D: "데이", E: "이브닝", N: "나이트" };

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
      name: "", employeeNumber: "", experienceLevel: "new",
      isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"],
      monthlyNightLimit: undefined, notes: "",
    },
  });

  function openCreate() {
    setEditingId(null);
    form.reset({ name: "", employeeNumber: "", experienceLevel: "new", isNightKeep: false, isPregnant: false, allowedShifts: ["D","E","N"] });
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
      updateNurse.mutate(
        { wardId, nurseId: editingId, data: payload },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListNursesQueryKey(wardId) });
            setShowForm(false);
            toast({ title: "간호사 정보가 수정되었습니다." });
          },
        }
      );
    } else {
      createNurse.mutate(
        { wardId, data: payload },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListNursesQueryKey(wardId) });
            setShowForm(false);
            form.reset();
            toast({ title: "간호사가 등록되었습니다." });
          },
        }
      );
    }
  }

  function handleDelete(nurseId: number) {
    if (!confirm("이 간호사를 삭제하시겠습니까?")) return;
    deleteNurse.mutate(
      { wardId, nurseId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNursesQueryKey(wardId) });
          toast({ title: "삭제되었습니다." });
        },
      }
    );
  }

  const allowedShiftsWatch = form.watch("allowedShifts");

  function toggleShift(shift: string) {
    const current = form.getValues("allowedShifts");
    if (current.includes(shift)) {
      form.setValue("allowedShifts", current.filter((s) => s !== shift));
    } else {
      form.setValue("allowedShifts", [...current, shift]);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="nurses-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">간호사 관리</h1>
          <p className="text-muted-foreground text-sm mt-1">간호사 정보와 근무 조건을 관리합니다.</p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-nurse">
          <Plus className="w-4 h-4 mr-1.5" /> 간호사 추가
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : nurses && nurses.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm" data-testid="table-nurses">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium text-muted-foreground">이름</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">사번</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">경력</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">허용 근무</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">월 야간 한도</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">특이사항</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {nurses.map((nurse) => (
                  <tr key={nurse.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors" data-testid={`row-nurse-${nurse.id}`}>
                    <td className="p-3 font-medium">
                      <div className="flex items-center gap-2">
                        {nurse.name}
                        {nurse.isNightKeep && <span title="야간 고정"><Moon className="w-3.5 h-3.5 text-[hsl(var(--shift-n))]" /></span>}
                        {nurse.isPregnant && <span title="임신"><Baby className="w-3.5 h-3.5 text-pink-500" /></span>}
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{nurse.employeeNumber}</td>
                    <td className="p-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${EXPERIENCE_COLORS[nurse.experienceLevel] ?? ""}`}>
                        {EXPERIENCE_LABELS[nurse.experienceLevel] ?? nurse.experienceLevel}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        {ALL_SHIFTS.map((s) => (
                          <span
                            key={s}
                            className={`text-xs px-1.5 py-0.5 rounded font-mono font-semibold ${
                              (nurse.allowedShifts ?? []).includes(s)
                                ? s === "D" ? "bg-[hsl(var(--shift-d))]/20 text-[hsl(var(--shift-d))]"
                                  : s === "E" ? "bg-[hsl(var(--shift-e))]/20 text-[hsl(var(--shift-e))]"
                                  : "bg-[hsl(var(--shift-n))]/20 text-[hsl(var(--shift-n))]"
                                : "text-muted-foreground/30"
                            }`}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{nurse.monthlyNightLimit !== null && nurse.monthlyNightLimit !== undefined ? `${nurse.monthlyNightLimit}회` : "-"}</td>
                    <td className="p-3 text-muted-foreground text-xs">{nurse.notes ?? "-"}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(nurse)} data-testid={`button-edit-nurse-${nurse.id}`}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDelete(nurse.id)} data-testid={`button-delete-nurse-${nurse.id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card className="text-center py-16 text-muted-foreground">
          <CardContent>
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">등록된 간호사가 없습니다</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md" data-testid="dialog-nurse-form">
          <DialogHeader>
            <DialogTitle>{editingId ? "간호사 수정" : "간호사 추가"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>이름</Label>
                <Input data-testid="input-nurse-name" {...form.register("name")} />
                {form.formState.errors.name && <p className="text-destructive text-xs mt-1">{form.formState.errors.name.message}</p>}
              </div>
              <div>
                <Label>사번</Label>
                <Input data-testid="input-nurse-employee-number" {...form.register("employeeNumber")} />
              </div>
            </div>
            <div>
              <Label>경력 구분</Label>
              <Select value={form.watch("experienceLevel")} onValueChange={(v) => form.setValue("experienceLevel", v as "new" | "experienced" | "senior")}>
                <SelectTrigger data-testid="select-experience-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">신규</SelectItem>
                  <SelectItem value="experienced">경력</SelectItem>
                  <SelectItem value="senior">선임</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>허용 근무 유형</Label>
              <div className="flex gap-3 mt-1">
                {ALL_SHIFTS.map((s) => (
                  <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={allowedShiftsWatch.includes(s)}
                      onCheckedChange={() => toggleShift(s)}
                      data-testid={`checkbox-shift-${s}`}
                    />
                    <span className="text-sm">{SHIFT_LABELS[s]} ({s})</span>
                  </label>
                ))}
              </div>
              {form.formState.errors.allowedShifts && <p className="text-destructive text-xs mt-1">{form.formState.errors.allowedShifts.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 pt-2">
                <Controller
                  control={form.control}
                  name="isNightKeep"
                  render={({ field }) => (
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-night-keep" id="nightKeep" />
                  )}
                />
                <Label htmlFor="nightKeep" className="cursor-pointer">야간 고정</Label>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Controller
                  control={form.control}
                  name="isPregnant"
                  render={({ field }) => (
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-pregnant" id="pregnant" />
                  )}
                />
                <Label htmlFor="pregnant" className="cursor-pointer">임신 중</Label>
              </div>
            </div>
            <div>
              <Label>월 야간 한도 (회)</Label>
              <Input type="number" placeholder="미입력 시 규칙 기본값 적용" data-testid="input-night-limit" {...form.register("monthlyNightLimit")} />
            </div>
            <div>
              <Label>메모</Label>
              <Input placeholder="특이사항" data-testid="input-nurse-notes" {...form.register("notes")} />
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
