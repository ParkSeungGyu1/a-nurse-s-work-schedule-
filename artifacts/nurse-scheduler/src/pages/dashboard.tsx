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
    <div className="p-4 md:p-6 lg:p-8 max-w-5xl mx-auto" data-testid="dashboard-page">
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">대시보드</h1>
        <p className="text-muted-foreground text-sm">병동 및 간호사 스케줄 현황을 확인하세요.</p>
      </div>

      {isLoading ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-[80px]" />
                <Skeleton className="h-4 w-4 rounded-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-7 w-[50px]" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6 md:mb-8">
            {[
              { label: "전체 병동", value: `${summary.wardCount}개`, icon: Building, color: "" },
              { label: "등록된 간호사", value: `${summary.nurseCount}명`, icon: Users, color: "" },
              { label: "활성 스케줄", value: `${summary.activeSchedules}건`, icon: Calendar, color: "" },
              { label: "미해결 충돌", value: `${summary.unresolvedConflicts}건`, icon: AlertCircle, color: "destructive" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-3 md:pb-2 md:pt-4 md:px-4">
                  <CardTitle className={`text-xs md:text-sm font-medium ${color === "destructive" ? "text-destructive" : ""}`}>
                    {label}
                  </CardTitle>
                  <Icon className={`h-3.5 w-3.5 md:h-4 md:w-4 ${color === "destructive" ? "text-destructive" : "text-muted-foreground"}`} />
                </CardHeader>
                <CardContent className="px-3 pb-3 md:px-4 md:pb-4">
                  <div className={`text-xl md:text-2xl font-bold ${color === "destructive" ? "text-destructive" : ""}`}
                    data-testid={`stat-${label}`}>
                    {value}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {wards && wards.length > 0 && (
            <div>
              <h2 className="text-base md:text-lg font-semibold mb-3">병동 바로가기</h2>
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
