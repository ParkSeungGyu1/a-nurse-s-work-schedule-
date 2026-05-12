import { useParams } from "wouter";
import { useGetWard, useUpdateWard, getGetWardQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

const wardSchema = z.object({
  name: z.string().min(1, "병동 이름을 입력해주세요"),
  wardType: z.string().min(1),
  maxNurseCount: z.coerce.number().optional(),
  shiftDStart: z.string(),
  shiftDEnd: z.string(),
  shiftEStart: z.string(),
  shiftEEnd: z.string(),
  shiftNStart: z.string(),
  shiftNEnd: z.string(),
});

type WardForm = z.infer<typeof wardSchema>;

const WARD_TYPES = ["내과", "외과", "응급의학과", "중환자실", "산부인과", "소아과", "정형외과", "신경외과", "일반병동"];

export default function WardDetailPage() {
  const params = useParams<{ wardId: string }>();
  const wardId = Number(params.wardId);
  const { data: ward, isLoading } = useGetWard(wardId);
  const updateWard = useUpdateWard();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<WardForm>({
    resolver: zodResolver(wardSchema),
    defaultValues: { name: "", wardType: "내과", shiftDStart: "07:00", shiftDEnd: "15:00", shiftEStart: "15:00", shiftEEnd: "23:00", shiftNStart: "23:00", shiftNEnd: "07:00" },
  });

  useEffect(() => {
    if (ward) {
      form.reset({
        name: ward.name, wardType: ward.wardType, maxNurseCount: ward.maxNurseCount ?? undefined,
        shiftDStart: ward.shiftDStart ?? "07:00", shiftDEnd: ward.shiftDEnd ?? "15:00",
        shiftEStart: ward.shiftEStart ?? "15:00", shiftEEnd: ward.shiftEEnd ?? "23:00",
        shiftNStart: ward.shiftNStart ?? "23:00", shiftNEnd: ward.shiftNEnd ?? "07:00",
      });
    }
  }, [ward]);

  function onSubmit(data: WardForm) {
    updateWard.mutate({ wardId, data }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetWardQueryKey(wardId) }); toast({ title: "병동 정보가 저장되었습니다." }); },
      onError: () => toast({ title: "저장에 실패했습니다.", variant: "destructive" }),
    });
  }

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!ward) return <div className="p-4 md:p-6 text-muted-foreground">병동을 찾을 수 없습니다.</div>;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto" data-testid="ward-detail-page">
      <div className="flex items-center gap-3 mb-5 md:mb-6">
        <div className="bg-primary/10 p-2 rounded-lg">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">{ward.name}</h1>
          <p className="text-muted-foreground text-xs md:text-sm">병동 기본 설정</p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">기본 정보</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>병동 이름</Label>
                <Input data-testid="input-ward-name" {...form.register("name")} />
                {form.formState.errors.name && <p className="text-destructive text-xs mt-1">{form.formState.errors.name.message}</p>}
              </div>
              <div>
                <Label>병동 유형</Label>
                <Select value={form.watch("wardType")} onValueChange={(v) => form.setValue("wardType", v)}>
                  <SelectTrigger data-testid="select-ward-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{WARD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="sm:w-1/2">
              <Label>최대 간호사 수</Label>
              <Input type="number" data-testid="input-max-nurses" {...form.register("maxNurseCount")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">근무 시간 설정</CardTitle>
            <CardDescription className="text-xs">각 근무 유형의 시작 및 종료 시간을 설정합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "데이 (D)", startKey: "shiftDStart" as const, endKey: "shiftDEnd" as const, colorClass: "bg-[hsl(var(--shift-d))]/20 text-[hsl(var(--shift-d))]" },
              { label: "이브닝 (E)", startKey: "shiftEStart" as const, endKey: "shiftEEnd" as const, colorClass: "bg-[hsl(var(--shift-e))]/20 text-[hsl(var(--shift-e))]" },
              { label: "나이트 (N)", startKey: "shiftNStart" as const, endKey: "shiftNEnd" as const, colorClass: "bg-[hsl(var(--shift-n))]/20 text-[hsl(var(--shift-n))]" },
            ].map(({ label, startKey, endKey, colorClass }) => (
              <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded self-start sm:self-auto ${colorClass} sm:w-24 text-center`}>{label}</span>
                <div className="flex items-center gap-2 flex-1">
                  <Input type="time" data-testid={`input-${startKey}`} className="flex-1" {...form.register(startKey)} />
                  <span className="text-muted-foreground text-sm">~</span>
                  <Input type="time" data-testid={`input-${endKey}`} className="flex-1" {...form.register(endKey)} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateWard.isPending} data-testid="button-save-ward">
            <Save className="w-4 h-4 mr-1.5" />
            {updateWard.isPending ? "저장 중..." : "저장"}
          </Button>
        </div>
      </form>
    </div>
  );
}
