import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import {
  useGetWardRules,
  useUpsertWardRules,
  useListPairRules,
  useCreatePairRule,
  useDeletePairRule,
  useListNurses,
  getGetWardRulesQueryKey,
  getListPairRulesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Save, Settings2, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const TEMPLATE_STORAGE_KEY = "ward-rule-templates-v1";

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

type SavedTemplate = {
  id: string;
  wardId: number;
  scope: "ward" | "shared";
  sourceWardId: number;
  name: string;
  savedAt: string;
  values: RulesForm;
};

const DEFAULT_VALUES: RulesForm = {
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
};

const RULE_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  values: RulesForm;
}> = [
  {
    id: "standard",
    label: "기본 병동",
    description: "대부분의 일반 병동에서 바로 시작하기 좋은 기본값입니다.",
    values: DEFAULT_VALUES,
  },
  {
    id: "night-safe",
    label: "야간 안정 우선",
    description: "야간 회복과 연속 나이트 부담을 더 엄격하게 보는 기준입니다.",
    values: {
      maxConsecutiveWorkDays: 5,
      offDaysAfterConsecutiveWork: 2,
      maxConsecutiveNightShifts: 2,
      offDaysAfterNightShifts: 3,
      allowEToD: false,
      monthlyMaxNightShifts: 7,
      minExperiencedPerShift: 2,
      maxNewNurseRatioPerShift: 0.25,
      weekendFairness: true,
      holidayFairness: true,
    },
  },
  {
    id: "new-nurse-care",
    label: "신규 보호 우선",
    description: "신규 간호사 비율과 경력자 배치를 더 보수적으로 맞추는 기준입니다.",
    values: {
      maxConsecutiveWorkDays: 5,
      offDaysAfterConsecutiveWork: 2,
      maxConsecutiveNightShifts: 3,
      offDaysAfterNightShifts: 2,
      allowEToD: false,
      monthlyMaxNightShifts: 7,
      minExperiencedPerShift: 3,
      maxNewNurseRatioPerShift: 0.2,
      weekendFairness: true,
      holidayFairness: true,
    },
  },
];

function loadTemplatesFromStorage() {
  if (typeof window === "undefined") return [] as SavedTemplate[];

  try {
    const raw = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((template) => ({
      ...template,
      scope: template.scope === "shared" ? "shared" : "ward",
      sourceWardId: typeof template.sourceWardId === "number" ? template.sourceWardId : template.wardId,
    })) as SavedTemplate[];
  } catch {
    return [];
  }
}

function saveTemplatesToStorage(templates: SavedTemplate[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
}

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
  const [templateName, setTemplateName] = useState("");
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);

  const form = useForm<RulesForm>({
    resolver: zodResolver(rulesSchema),
    defaultValues: DEFAULT_VALUES,
  });

  useEffect(() => {
    if (rules) form.reset({ ...rules });
  }, [form, rules]);

  useEffect(() => {
    setSavedTemplates(loadTemplatesFromStorage());
  }, []);

  const watchedValues = form.watch();
  const summaryItems = useMemo(() => {
    return [
      `최대 연속 근무 ${watchedValues.maxConsecutiveWorkDays}일`,
      `연속 근무 후 OFF ${watchedValues.offDaysAfterConsecutiveWork}일`,
      `최대 연속 N ${watchedValues.maxConsecutiveNightShifts}일`,
      `N 이후 OFF ${watchedValues.offDaysAfterNightShifts}일`,
      `월 최대 N ${watchedValues.monthlyMaxNightShifts}회`,
      `최소 경력자 ${watchedValues.minExperiencedPerShift}명`,
      `신규 비율 최대 ${Math.round(watchedValues.maxNewNurseRatioPerShift * 100)}%`,
      watchedValues.allowEToD ? "E 다음날 D 허용" : "E 다음날 D 금지",
    ];
  }, [watchedValues]);

  const wardTemplates = useMemo(
    () => savedTemplates.filter((template) => template.scope === "ward" && template.wardId === wardId),
    [savedTemplates, wardId]
  );
  const sharedTemplates = useMemo(
    () => savedTemplates.filter((template) => template.scope === "shared"),
    [savedTemplates]
  );

  function applyPreset(values: RulesForm, message = "프리셋을 적용했습니다. 저장하면 병동 규칙에 반영됩니다.") {
    form.reset(values);
    toast({ title: message });
  }

  function saveCurrentTemplate(scope: "ward" | "shared") {
    const name = templateName.trim();

    if (!name) {
      toast({
        title: "템플릿 이름을 먼저 입력해 주세요.",
        variant: "destructive",
      });
      return;
    }

    const nextTemplate: SavedTemplate = {
      id: `${wardId}-${Date.now()}`,
      wardId,
      scope,
      sourceWardId: wardId,
      name,
      savedAt: new Date().toISOString(),
      values: form.getValues(),
    };

    const nextTemplates = [nextTemplate, ...savedTemplates];
    setSavedTemplates(nextTemplates);
    saveTemplatesToStorage(nextTemplates);
    setTemplateName("");
    toast({
      title: scope === "shared" ? "공용 규칙 템플릿으로 저장했습니다." : "현재 병동 템플릿으로 저장했습니다.",
    });
  }

  function applySavedTemplate(template: SavedTemplate) {
    const origin =
      template.scope === "shared"
        ? "공용 템플릿"
        : template.sourceWardId === wardId
          ? "현재 병동 템플릿"
          : `${template.sourceWardId} 병동 템플릿`;

    applyPreset(template.values, `${template.name} (${origin})을 불러왔습니다. 저장하면 병동 규칙에 반영됩니다.`);
  }

  function deleteSavedTemplate(templateId: string) {
    const nextTemplates = savedTemplates.filter((template) => template.id !== templateId);
    setSavedTemplates(nextTemplates);
    saveTemplatesToStorage(nextTemplates);
    toast({ title: "저장한 템플릿을 삭제했습니다." });
  }

  function onSubmit(data: RulesForm) {
    upsertRules.mutate(
      { wardId, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWardRulesQueryKey(wardId) });
          toast({ title: "근무 규칙을 저장했습니다." });
        },
        onError: () => toast({ title: "규칙 저장에 실패했습니다.", variant: "destructive" }),
      }
    );
  }

  function handleAddPair() {
    if (!newPair.preceptorId || !newPair.precepteeId) return;

    createPair.mutate(
      {
        wardId,
        data: {
          preceptorId: Number(newPair.preceptorId),
          precepteeId: Number(newPair.precepteeId),
          ruleType: "same_shift",
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPairRulesQueryKey(wardId) });
          setNewPair({ preceptorId: "", precepteeId: "" });
          toast({ title: "프리셉터 매칭을 추가했습니다." });
        },
      }
    );
  }

  function handleDeletePair(pairRuleId: number) {
    deletePair.mutate(
      { wardId, pairRuleId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPairRulesQueryKey(wardId) });
          toast({ title: "프리셉터 매칭을 삭제했습니다." });
        },
      }
    );
  }

  const nurseMap = new Map(nurses?.map((nurse) => [nurse.id, nurse.name]) ?? []);

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-40" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6" data-testid="rules-page">
      <div className="mb-5 flex items-center gap-3 md:mb-6">
        <div className="rounded-lg bg-primary/10 p-2">
          <Settings2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">근무 규칙 설정</h1>
          <p className="text-xs text-muted-foreground md:text-sm">
            자동 생성과 검증에 사용할 병동별 기준을 정리합니다.
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">현재 규칙 요약</CardTitle>
          <CardDescription className="text-xs">
            저장 전에 지금 설정이 어떤 기준으로 동작하는지 빠르게 확인할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {summaryItems.map((item) => (
            <div key={item} className="rounded-full border bg-muted/40 px-3 py-1 text-xs text-foreground">
              {item}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">빠른 시작 프리셋</CardTitle>
          <CardDescription className="text-xs">
            병동 상황에 가까운 기본값을 먼저 불러오고, 필요한 항목만 세부 조정할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-3">
          {RULE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.values)}
              className="rounded-xl border bg-card px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <div className="mb-1 text-sm font-semibold text-foreground">{preset.label}</div>
              <p className="text-xs text-muted-foreground">{preset.description}</p>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">규칙 템플릿 저장 / 불러오기</CardTitle>
          <CardDescription className="text-xs">
            자주 쓰는 조합을 저장해 두면 다른 달이나 같은 병동에서 다시 쉽게 불러올 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row">
            <Input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="예: 53병동 기본형, 신규 보호형"
              className="md:max-w-sm"
            />
            <Button type="button" variant="outline" onClick={() => saveCurrentTemplate("ward")}>
              이 병동용 저장
            </Button>
            <Button type="button" variant="outline" onClick={() => saveCurrentTemplate("shared")}>
              공용 템플릿 저장
            </Button>
          </div>

          {wardTemplates.length === 0 && sharedTemplates.length === 0 ? (
            <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              아직 저장한 규칙 템플릿이 없습니다.
            </div>
          ) : (
            <div className="space-y-4">
              {wardTemplates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">현재 병동 템플릿</p>
                  {wardTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="flex flex-col gap-2 rounded-xl border bg-card px-3 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{template.name}</p>
                        <p className="text-xs text-muted-foreground">
                          저장일 {new Date(template.savedAt).toLocaleDateString("ko-KR")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => applySavedTemplate(template)}>
                          불러오기
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => deleteSavedTemplate(template.id)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          삭제
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sharedTemplates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">공용 템플릿</p>
                  {sharedTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="flex flex-col gap-2 rounded-xl border bg-card px-3 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{template.name}</p>
                        <p className="text-xs text-muted-foreground">
                          원본 병동 {template.sourceWardId} · 저장일 {new Date(template.savedAt).toLocaleDateString("ko-KR")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => applySavedTemplate(template)}>
                          불러오기
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => deleteSavedTemplate(template.id)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          삭제
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">연속 근무와 나이트 회복</CardTitle>
            <CardDescription className="text-xs">
              연속 근무 한도와 나이트 이후 회복 OFF 기준을 설정합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "최대 연속 근무 일수", name: "maxConsecutiveWorkDays" as const, unit: "일" },
              { label: "연속 근무 후 최소 OFF", name: "offDaysAfterConsecutiveWork" as const, unit: "일" },
              { label: "최대 연속 나이트", name: "maxConsecutiveNightShifts" as const, unit: "일" },
              { label: "나이트 이후 최소 OFF", name: "offDaysAfterNightShifts" as const, unit: "일" },
              { label: "월 최대 나이트 횟수", name: "monthlyMaxNightShifts" as const, unit: "회" },
            ].map(({ label, name, unit }) => (
              <div key={name} className="flex items-center justify-between gap-4">
                <Label className="flex-1 text-sm">{label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="h-8 w-16 text-center text-sm"
                    data-testid={`input-rule-${name}`}
                    {...form.register(name)}
                  />
                  <span className="w-5 text-sm text-muted-foreground">{unit}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">배치 제한</CardTitle>
            <CardDescription className="text-xs">
              경력자 배치, 신규 비율, E 다음날 D 허용 여부를 조정합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Label className="text-sm">E 다음날 D 허용</Label>
                <p className="text-xs text-muted-foreground">
                  끄면 Evening 다음날 Day 배정을 자동으로 막습니다.
                </p>
              </div>
              <Controller
                control={form.control}
                name="allowEToD"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="switch-allow-e-to-d"
                  />
                )}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label className="flex-1 text-sm">근무별 최소 경력 간호사</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  className="h-8 w-16 text-center text-sm"
                  data-testid="input-rule-minExperiencedPerShift"
                  {...form.register("minExperiencedPerShift")}
                />
                <span className="w-5 text-sm text-muted-foreground">명</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label className="flex-1 text-sm">근무별 신규 간호사 최대 비율</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  className="h-8 w-16 text-center text-sm"
                  data-testid="input-rule-maxNewNurseRatioPerShift"
                  {...form.register("maxNewNurseRatioPerShift")}
                />
                <span className="w-8 text-sm text-muted-foreground">
                  {Math.round((watchedValues.maxNewNurseRatioPerShift ?? 0) * 100)}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">공정성 기준</CardTitle>
            <CardDescription className="text-xs">
              주말과 공휴일 근무가 특정 인원에게 몰리지 않도록 설정합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              {
                label: "주말 공정 분배",
                desc: "주말 근무가 특정 간호사에게 몰리지 않도록 조정합니다.",
                name: "weekendFairness" as const,
              },
              {
                label: "공휴일 공정 분배",
                desc: "공휴일 근무를 가능한 한 고르게 나누도록 조정합니다.",
                name: "holidayFairness" as const,
              },
            ].map(({ label, desc, name }) => (
              <div key={name} className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <Label className="text-sm">{label}</Label>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Controller
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} data-testid={`switch-${name}`} />
                  )}
                />
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
          <CardDescription className="text-xs">
            신규 간호사와 프리셉터를 연결해 같은 근무로 맞출 기준을 설정합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pairRules && pairRules.length > 0 && (
            <div className="space-y-1.5">
              {pairRules.map((pair) => (
                <div
                  key={pair.id}
                  className="flex items-center justify-between rounded bg-muted p-2 text-sm"
                  data-testid={`row-pair-${pair.id}`}
                >
                  <span>
                    <span className="font-medium">{nurseMap.get(pair.preceptorId) ?? `#${pair.preceptorId}`}</span>
                    <span className="mx-2 text-muted-foreground">↔</span>
                    <span>{nurseMap.get(pair.precepteeId) ?? `#${pair.precepteeId}`}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-destructive"
                    onClick={() => handleDeletePair(pair.id)}
                    data-testid={`button-delete-pair-${pair.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-end">
            <div className="w-full flex-1 sm:w-auto">
              <Label className="text-xs">프리셉터</Label>
              <Select
                value={newPair.preceptorId}
                onValueChange={(value) => setNewPair((previous) => ({ ...previous, preceptorId: value }))}
              >
                <SelectTrigger className="h-8 text-sm" data-testid="select-preceptor">
                  <SelectValue placeholder="경력 간호사 선택" />
                </SelectTrigger>
                <SelectContent>
                  {nurses
                    ?.filter((nurse) => nurse.experienceLevel !== "new")
                    .map((nurse) => (
                      <SelectItem key={nurse.id} value={String(nurse.id)}>
                        {nurse.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-full flex-1 sm:w-auto">
              <Label className="text-xs">프리셉티</Label>
              <Select
                value={newPair.precepteeId}
                onValueChange={(value) => setNewPair((previous) => ({ ...previous, precepteeId: value }))}
              >
                <SelectTrigger className="h-8 text-sm" data-testid="select-preceptee">
                  <SelectValue placeholder="신규 간호사 선택" />
                </SelectTrigger>
                <SelectContent>
                  {nurses
                    ?.filter((nurse) => nurse.experienceLevel === "new")
                    .map((nurse) => (
                      <SelectItem key={nurse.id} value={String(nurse.id)}>
                        {nurse.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              size="sm"
              className="h-8 w-full sm:w-auto"
              onClick={handleAddPair}
              disabled={!newPair.preceptorId || !newPair.precepteeId}
              data-testid="button-add-pair"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              추가
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
