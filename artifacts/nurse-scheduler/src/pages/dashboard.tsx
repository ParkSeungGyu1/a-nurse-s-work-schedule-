import { useGetDashboardSummary, useListWards } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building, Users, Calendar, AlertCircle, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: wards } = useListWards();

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto" data-testid="dashboard-page">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-1">대시보드</h1>
        <p className="text-muted-foreground">병동 및 간호사 스케줄 현황을 확인하세요.</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-[100px]" />
                <Skeleton className="h-4 w-4 rounded-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-[60px]" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">전체 병동</CardTitle>
                <Building className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-ward-count">{summary.wardCount}개</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">등록된 간호사</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-nurse-count">{summary.nurseCount}명</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">활성 스케줄</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-schedule-count">{summary.activeSchedules}건</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-destructive">미해결 충돌</CardTitle>
                <AlertCircle className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive" data-testid="stat-conflict-count">{summary.unresolvedConflicts}건</div>
              </CardContent>
            </Card>
          </div>

          {/* Quick links to wards */}
          {wards && wards.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">병동 바로가기</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {wards.map((ward) => (
                  <Card key={ward.id} className="hover:shadow-md transition-shadow" data-testid={`dashboard-ward-${ward.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-semibold">{ward.name}</p>
                          <p className="text-xs text-muted-foreground">{ward.wardType}</p>
                        </div>
                        <span className="text-xs bg-muted px-2 py-1 rounded">{ward.nurseCount ?? 0}명</span>
                      </div>
                      <div className="flex gap-2">
                        <Link href={`/wards/${ward.id}/schedule`} className="flex-1">
                          <Button size="sm" variant="outline" className="w-full text-xs gap-1" data-testid={`button-goto-schedule-${ward.id}`}>
                            스케줄 <ArrowRight className="w-3 h-3" />
                          </Button>
                        </Link>
                        <Link href={`/wards/${ward.id}/nurses`} className="flex-1">
                          <Button size="sm" variant="ghost" className="w-full text-xs gap-1">
                            간호사 <ArrowRight className="w-3 h-3" />
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {wards?.length === 0 && (
            <Card className="text-center py-12 border-dashed">
              <CardContent>
                <Building className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium text-muted-foreground mb-4">아직 등록된 병동이 없습니다</p>
                <Link href="/wards">
                  <Button data-testid="button-add-first-ward">첫 병동 추가하기</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
