import { Link, useLocation } from "wouter";
import { LayoutDashboard, Building2, CalendarDays, ChevronRight, Menu, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useListWards } from "@workspace/api-client-react";
import { useState, useEffect } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface WardSubNav {
  label: string;
  path: string;
}

const wardSubNav: WardSubNav[] = [
  { label: "병동 설정", path: "" },
  { label: "간호사 관리", path: "/nurses" },
  { label: "근무 규칙", path: "/rules" },
  { label: "인력 요구", path: "/staffing" },
  { label: "개인 요청", path: "/requests" },
  { label: "스케줄", path: "/schedule" },
  { label: "미리보기", path: "/export" },
];

interface SidebarContentProps {
  location: string;
  onNavigate?: () => void;
}

function SidebarContent({ location, onNavigate }: SidebarContentProps) {
  const { data: wards } = useListWards();
  const [expandedWardId, setExpandedWardId] = useState<number | null>(null);

  const wardMatch = location.match(/^\/wards\/(\d+)/);
  const currentWardId = wardMatch ? Number(wardMatch[1]) : null;

  useEffect(() => {
    if (currentWardId) setExpandedWardId(currentWardId);
  }, [currentWardId]);

  function isActive(href: string, exact = false) {
    if (exact) return location === href || location === href + "/";
    return location.startsWith(href);
  }

  const navLink = (href: string, label: string, icon: React.ReactNode, exact = false) => (
    <Link
      key={href}
      href={href}
      onClick={onNavigate}
      data-testid={`nav-${label}`}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive(href, exact)
          ? "bg-primary text-primary-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-accent-foreground"
      )}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {navLink("/", "대시보드", <LayoutDashboard className="h-4 w-4" />, true)}
      {navLink("/wards", "병동 관리", <Building2 className="h-4 w-4" />)}

      <div className="pb-1 pt-3">
        <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">병동</p>
      </div>

      {wards?.map((ward) => {
        const isExpanded = expandedWardId === ward.id || currentWardId === ward.id;
        const wardBase = `/wards/${ward.id}`;
        const isWardActive = location.startsWith(wardBase);

        return (
          <div key={ward.id}>
            <button
              data-testid={`nav-ward-${ward.id}`}
              onClick={() => setExpandedWardId(isExpanded ? null : ward.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
                isWardActive
                  ? "bg-sidebar-accent text-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-accent-foreground"
              )}
            >
              <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
              <span className="flex-1 truncate">{ward.name}</span>
              <ChevronRight className={cn("h-3 w-3 flex-shrink-0 transition-transform", isExpanded && "rotate-90")} />
            </button>

            {isExpanded && (
              <div className="mt-0.5 ml-4 space-y-0.5 border-l border-border pl-2">
                {wardSubNav.map((sub) => {
                  const href = `${wardBase}${sub.path}`;
                  const subActive =
                    sub.path === ""
                      ? location === wardBase || location === `${wardBase}/`
                      : location.startsWith(href);

                  return (
                    <Link
                      key={sub.path}
                      href={href}
                      onClick={onNavigate}
                      data-testid={`nav-ward-${ward.id}${sub.path || "-settings"}`}
                      className={cn(
                        "flex items-center rounded px-2 py-1.5 text-xs font-medium transition-colors",
                        subActive
                          ? "bg-primary/10 font-semibold text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {sub.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <Link
        href="/wards"
        onClick={onNavigate}
        data-testid="nav-add-ward"
        className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
      >
        <Plus className="h-3 w-3" /> 병동 추가
      </Link>
    </nav>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  return (
    <div className="flex min-h-screen flex-col" data-testid="app-layout">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card px-4 shadow-sm" data-testid="header">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-1 h-9 w-9 p-0 md:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="메뉴 열기"
          data-testid="button-mobile-menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <Link href="/" className="flex items-center gap-2">
          <div className="rounded-md bg-primary p-1.5 text-primary-foreground">
            <CalendarDays className="h-4 w-4" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">병동 스케줄러</span>
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 flex-shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar md:flex" data-testid="sidebar">
          <SidebarContent location={location} />
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 border-sidebar-border bg-sidebar p-0">
            <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
              <div className="rounded-md bg-primary p-1.5 text-primary-foreground">
                <CalendarDays className="h-4 w-4" />
              </div>
              <span className="text-base font-bold tracking-tight">병동 스케줄러</span>
            </div>
            <SidebarContent location={location} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="flex-1 overflow-auto bg-background" data-testid="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
