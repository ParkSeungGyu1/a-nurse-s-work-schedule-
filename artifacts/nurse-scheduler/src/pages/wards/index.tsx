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
  name: z.string().min(1, "병동 이름을 입력해주세요"),
  wardType: z.string().min(1),
  maxNurseCount: z.coerce.number().optional(),
});

type CreateWardForm = z.infer<typeof createWardSchema>;

const WARD_TYPES = ["내과", "외과", "응급의학과", "중환자실", "산부인과", "소아과", "정형외과", "신경외과", "일반병동"];

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
          setShowCreate(false); form.reset();
          toast({ title: "병동이 생성되었습니다." });
          navigate(`/wards/${ward.id}`);
        },
        onError: () => toast({ title: "오류가 발생했습니다.", variant: "destructive" }),
      }
    );
  }

  function handleDelete(wardId: number, e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm("이 병동을 삭제하시겠습니까? 모든 관련 데이터가 삭제됩니다.")) return;
    deleteWard.mutate({ wardId }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListWardsQueryKey() }); toast({ title: "병동이 삭제되었습니다." }); },
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto" data-testid="wards-page">
      <div className="flex items-center justify-between mb-5 md:mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">병동 관리</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-0.5">병동을 추가하고 설정을 관리합니다.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm" className="md:size-auto" data-testid="button-create-ward">
          <Plus className="w-4 h-4 md:mr-1.5" />
          <span className="hidden md:inline">병동 추가</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : wards && wards.length > 0 ? (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {wards.map((ward) => (
            <Card key={ward.id} className="group hover:shadow-md transition-shadow" data-testid={`card-ward-${ward.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="bg-primary/10 p-1.5 rounded">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{ward.name}</CardTitle>
                      <Badge variant="secondary" className="text-xs mt-0.5">{ward.wardType}</Badge>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(ward.id, e)}
                    data-testid={`button-delete-ward-${ward.id}`}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-1 touch-manipulation"
                    style={{ WebkitTapHighlightColor: "transparent" }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
                  <Users className="w-3.5 h-3.5" />
                  <span data-testid={`text-nurse-count-${ward.id}`}>{ward.nurseCount ?? 0}명{ward.maxNurseCount ? ` / ${ward.maxNurseCount}명` : ""}</span>
                </div>
                <Link href={`/wards/${ward.id}/schedule`}>
                  <Button size="sm" variant="outline" className="w-full text-xs gap-1" data-testid={`button-manage-ward-${ward.id}`}>
                    스케줄 관리 <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="text-center py-16 text-muted-foreground" data-testid="empty-wards">
          <CardContent>
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">등록된 병동이 없습니다</p>
            <p className="text-sm mt-1">오른쪽 위 버튼으로 병동을 추가하세요.</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm w-[calc(100%-2rem)] mx-auto" data-testid="dialog-create-ward">
          <DialogHeader><DialogTitle>새 병동 추가</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="name">병동 이름</Label>
              <Input id="name" placeholder="예: 3내과병동" data-testid="input-ward-name" {...form.register("name")} />
              {form.formState.errors.name && <p className="text-destructive text-xs mt-1">{form.formState.errors.name.message}</p>}
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
