import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListWards, useCreateWard, useDeleteWard, getListWardsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Building2, Users, ArrowRight, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const createWardSchema = z.object({
  name: z.string().min(1, "병동 이름을 입력해주세요."),
  wardType: z.string().min(1),
  maxNurseCount: z.coerce.number().optional(),
});

type CreateWardForm = z.infer<typeof createWardSchema>;

const WARD_TYPES = ["내과", "외과", "응급의학과", "중환자실", "분만실", "소아과", "정형외과", "신경외과", "일반병동"];

export default function WardsPage() {
  const { data: wards, isLoading } = useListWards();
  const createWard = useCreateWard();
  const deleteWard = useDeleteWard();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);

  const form = useForm<CreateWardForm>({
    resolver: zodResolver(createWardSchema),
    defaultValues: { name: "", wardType: "내과", maxNurseCount: undefined },
  });

  function onSubmit(data: CreateWardForm) {
    createWard.mutate(
      { data: { name: data.name, wardType: data.wardType, maxNurseCount: data.maxNurseCount } },
      {
        onSuccess: (ward) => {
          queryClient.invalidateQueries({ queryKey: getListWardsQueryKey() });
          setShowCreate(false);
          form.reset();
          toast({ title: "병동이 생성되었습니다." });
          navigate(`/wards/${ward.id}`);
        },
        onError: () => toast({ title: "병동 생성에 실패했습니다.", variant: "destructive" }),
      }
    );
  }

  function handleDelete(wardId: number, e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm("이 병동을 삭제하시겠습니까? 모든 관련 데이터가 삭제됩니다.")) return;
    deleteWard.mutate({
      wardId,
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWardsQueryKey() });
        toast({ title: "병동이 삭제되었습니다." });
      },
    });
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6" data-testid="wards-page">
      <div className="mb-5 flex items-center justify-between md:mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">병동 관리</h1>
          <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">병동을 추가하고 기본 정보를 관리합니다.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm" className="md:size-auto" data-testid="button-create-ward">
          <Plus className="h-4 w-4 md:mr-1.5" />
          <span className="hidden md:inline">병동 추가</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : wards && wards.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {wards.map((ward) => (
            <Card key={ward.id} className="group transition-shadow hover:shadow-md" data-testid={`card-ward-${ward.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded bg-primary/10 p-1.5">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{ward.name}</CardTitle>
                      <Badge variant="secondary" className="mt-0.5 text-xs">{ward.wardType}</Badge>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(ward.id, e)}
                    data-testid={`button-delete-ward-${ward.id}`}
                    className="p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    style={{ WebkitTapHighlightColor: "transparent" }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  <span data-testid={`text-nurse-count-${ward.id}`}>
                    {ward.nurseCount ?? 0}명{ward.maxNurseCount ? ` / ${ward.maxNurseCount}명` : ""}
                  </span>
                </div>
                <Link href={`/wards/${ward.id}/schedule`}>
                  <Button size="sm" variant="outline" className="w-full gap-1 text-xs" data-testid={`button-manage-ward-${ward.id}`}>
                    스케줄 관리 <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="py-16 text-center text-muted-foreground" data-testid="empty-wards">
          <CardContent>
            <Building2 className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-medium">등록된 병동이 없습니다.</p>
            <p className="mt-1 text-sm">오른쪽 위 버튼으로 병동을 추가해보세요.</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="mx-auto w-[calc(100%-2rem)] max-w-sm" data-testid="dialog-create-ward">
          <DialogHeader><DialogTitle>새 병동 추가</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="name">병동 이름</Label>
              <Input id="name" placeholder="예: 53병동" data-testid="input-ward-name" {...form.register("name")} />
              {form.formState.errors.name && <p className="mt-1 text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div>
              <Label htmlFor="wardType">병동 유형</Label>
              <Select defaultValue="내과" onValueChange={(v) => form.setValue("wardType", v)}>
                <SelectTrigger data-testid="select-ward-type"><SelectValue /></SelectTrigger>
                <SelectContent>{WARD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="maxNurseCount">최대 간호사 수 (선택)</Label>
              <Input id="maxNurseCount" type="number" placeholder="예: 20" data-testid="input-max-nurses" {...form.register("maxNurseCount")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>취소</Button>
              <Button type="submit" disabled={createWard.isPending} data-testid="button-submit-ward">
                {createWard.isPending ? "추가 중..." : "추가"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
