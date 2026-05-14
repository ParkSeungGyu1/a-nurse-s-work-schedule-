import { useParams } from "wouter";
import {
  useGetWardRules, useUpsertWardRules, useListPairRules, useCreatePairRule, useDeletePairRule,
  useListNurses, getGetWardRulesQueryKey, getListPairRulesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Plus, Trash2, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";

const rulesSchema = z.object({
  maxConsecutiveWorkDays: z.coerce.number().min(1).max(14),
  offDaysAfterConsecutiveWork: z.coerce.number().min(0).max(7),
  maxConsecutiveNightShifts: z.coerce.number().min(1).max(7),
  offDaysAfterNightShifts: z.coerce.number().min(0).max(7),
  allowEToD: z.boolean(),
  monthlyMaxNightShifts: z.coerce.number().min(0).max(31),
  minExperiencedPerShift: z.coerce.number().min(0).max(20),
  maxNewNurseRatioPerShift: z.coerce.number().min(0).max(1),
  weekendFairness: z.boolean(),
  holidayFairness: z.boolean(),
});

type RulesForm = z.infer<typeof rulesSchema>;

export default function RulesPage() {
  const params = useParams<{ wardId: string }>();
  const wardId = Number(params.wardId);
  const { data: rules, isLoading } = useGetWardRules(wardId);
  const { data: nurses } = useListNurses(wardId);
  const { data: pairRules } = useListPairRules(wardId);
  const upsertRules = useUpsertWardRules();
  const createPair = useCreatePairRule();
  const deletePair = useDeletePairRule();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newPair, setNewPair] = useState({ preceptorId: "", precepteeId: "" });

  const form = useForm<RulesForm>({
    resolver: zodResolver(rulesSchema),
    defaultValues: {
      maxConsecutiveWorkDays: 5,
      offDaysAfterConsecutiveWork: 2,
      maxConsecutiveNightShifts: 3,
      offDaysAfterNightShifts: 2,
      allowEToD: false,
      monthlyMaxNightShifts: 8,
      minExperiencedPerShift: 2,
      maxNewNurseRatioPerShift: 0.3,
      weekendFairness: true,
      holidayFairness: true,
    },
  });

  useEffect(() => {
    if (rules) form.reset({ ...rules });
  }, [form, rules]);

  function onSubmit(data: RulesForm) {
    upsertRules.mutate({ wardId, data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWardRulesQueryKey(wardId) });
        toast({ title: "규칙이 저장되었습니다." });
      },
      onError: () => toast({ title: "저장에 실패했습니다.", variant: "destructive" }),
    });
  }

  function handleAddPair() {
    if (!newPair.preceptorId || !newPair.precepteeId) return;
    createPair.mutate({
      wardId,
      data: { preceptorId: Number(newPair.preceptorId), precepteeId: Number(newPair.precepteeId), ruleType: "same_shift" },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPairRulesQueryKey(wardId) });
        setNewPair({ preceptorId: "", precepteeId: "" });
        toast({ title: "프리셉터 매칭이 추가되었습니다." });
      },
    });
  }

  function handleDeletePair(pairRuleId: number) {
    deletePair.mutate({ wardId, pairRuleId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPairRulesQueryKey(wardId) }),
    });
  }

  const nurseMap = new Map(nurses?.map((n) => [n.id, n.name]) ?? []);

  if (isLoading) {
    return <div className="space-y-4 p-4 md:p-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6" data-testid="rules-page">
      <div className="mb-5 flex items-center gap-3 md:mb-6">
        <div className="rounded-lg bg-primary/10 p-2">
          <Settings2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">근무 규칙</h1>
          <p className="text-xs text-muted-foreground md:text-sm">스케줄 생성과 검증에 사용할 병동 규칙을 설정합니다.</p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">연속 근무 제한</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "최대 연속 근무 일수", name: "maxConsecutiveWorkDays" as const, unit: "일" },
              { label: "연속 근무 후 최소 OFF", name: "offDaysAfterConsecutiveWork" as const, unit: "일" },
              { label: "최대 연속 나이트", name: "maxConsecutiveNightShifts" as const, unit: "일" },
              { label: "나이트 후 최소 OFF", name: "offDaysAfterNightShifts" as const, unit: "일" },
              { label: "월 최대 나이트", name: "monthlyMaxNightShifts" as const, unit: "회" },
            ].map(({ label, name, unit }) => (
              <div key={name} className="flex items-center justify-between gap-4">
                <Label className="flex-1 text-sm">{label}</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" className="h-8 w-16 text-center text-sm" data-testid={`input-rule-${name}`} {...form.register(name)} />
                  <span className="w-5 text-sm text-muted-foreground">{unit}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">배치 제한</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Label className="text-sm">이브닝 다음날 데이 허용</Label>
                <p className="text-xs text-muted-foreground">E 다음날 D 배정을 허용할지 선택합니다.</p>
              </div>
              <Controller control={form.control} name="allowEToD" render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-allow-e-to-d" />
              )} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label className="flex-1 text-sm">근무별 최소 경력 간호사 수</Label>
              <div className="flex items-center gap-2">
                <Input type="number" className="h-8 w-16 text-center text-sm" data-testid="input-rule-minExperiencedPerShift" {...form.register("minExperiencedPerShift")} />
                <span className="w-5 text-sm text-muted-foreground">명</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label className="flex-1 text-sm">근무별 신규 간호사 최대 비율</Label>
              <div className="flex items-center gap-2">
                <Input type="number" step="0.05" min="0" max="1" className="h-8 w-16 text-center text-sm" data-testid="input-rule-maxNewNurseRatioPerShift" {...form.register("maxNewNurseRatioPerShift")} />
                <span className="w-5 text-sm text-muted-foreground">비율</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">공정성 설정</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "주말 공정 분배", desc: "주말 근무를 가능한 한 균등하게 배분합니다.", name: "weekendFairness" as const },
              { label: "공휴일 공정 분배", desc: "공휴일 근무를 가능한 한 균등하게 배분합니다.", name: "holidayFairness" as const },
            ].map(({ label, desc, name }) => (
              <div key={name} className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <Label className="text-sm">{label}</Label>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Controller control={form.control} name={name} render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} data-testid={`switch-${name}`} />
                )} />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={upsertRules.isPending} data-testid="button-save-rules">
            <Save className="mr-1.5 h-4 w-4" />
            {upsertRules.isPending ? "저장 중..." : "규칙 저장"}
          </Button>
        </div>
      </form>

      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">프리셉터 매칭</CardTitle>
          <CardDescription className="text-xs">신규 간호사와 프리셉터를 연결해 같은 근무로 배정할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pairRules && pairRules.length > 0 && (
            <div className="space-y-1.5">
              {pairRules.map((pair) => (
                <div key={pair.id} className="flex items-center justify-between rounded bg-muted p-2 text-sm" data-testid={`row-pair-${pair.id}`}>
                  <span>
                    <span className="font-medium">{nurseMap.get(pair.preceptorId) ?? `#${pair.preceptorId}`}</span>
                    <span className="mx-2 text-muted-foreground">→</span>
                    <span>{nurseMap.get(pair.precepteeId) ?? `#${pair.precepteeId}`}</span>
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDeletePair(pair.id)} data-testid={`button-delete-pair-${pair.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-end">
            <div className="w-full flex-1 sm:w-auto">
              <Label className="text-xs">프리셉터</Label>
              <Select value={newPair.preceptorId} onValueChange={(v) => setNewPair((p) => ({ ...p, preceptorId: v }))}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-preceptor"><SelectValue placeholder="경력자 선택" /></SelectTrigger>
                <SelectContent>{nurses?.filter((n) => n.experienceLevel !== "new").map((n) => <SelectItem key={n.id} value={String(n.id)}>{n.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="w-full flex-1 sm:w-auto">
              <Label className="text-xs">프리셉티</Label>
              <Select value={newPair.precepteeId} onValueChange={(v) => setNewPair((p) => ({ ...p, precepteeId: v }))}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-preceptee"><SelectValue placeholder="신규 선택" /></SelectTrigger>
                <SelectContent>{nurses?.filter((n) => n.experienceLevel === "new").map((n) => <SelectItem key={n.id} value={String(n.id)}>{n.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button size="sm" className="h-8 w-full sm:w-auto" onClick={handleAddPair} disabled={!newPair.preceptorId || !newPair.precepteeId} data-testid="button-add-pair">
              <Plus className="mr-1 h-3.5 w-3.5" /> 추가
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
