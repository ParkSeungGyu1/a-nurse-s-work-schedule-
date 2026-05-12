import { Link, useLocation } from "wouter";
import { LayoutDashboard, Building2, CalendarDays, ChevronRight, Menu, X, Plus } from "lucide-react";
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
  { label: "내보내기", path: "/export" },
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

  // Auto-expand active ward
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
        "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
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
    <nav className="flex-1 px-2 space-y-0.5 py-3 overflow-y-auto">
      {navLink("/", "대시보드", <LayoutDashboard className="w-4 h-4" />, true)}
      {navLink("/wards", "병동 관리", <Building2 className="w-4 h-4" />)}

      <div className="pt-3 pb-1">
        <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">병동</p>
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
                "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
                isWardActive
                  ? "bg-sidebar-accent text-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-accent-foreground"
              )}
            >
              <Building2 className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
              <span className="flex-1 truncate">{ward.name}</span>
              <ChevronRight className={cn("w-3 h-3 transition-transform flex-shrink-0", isExpanded && "rotate-90")} />
            </button>

            {isExpanded && (
              <div className="ml-4 pl-2 border-l border-border mt-0.5 space-y-0.5">
                {wardSubNav.map((sub) => {
                  const href = `${wardBase}${sub.path}`;
                  const subActive = sub.path === ""
                    ? location === wardBase || location === `${wardBase}/`
                    : location.startsWith(href);
                  return (
                    <Link
                      key={sub.path}
                      href={href}
                      onClick={onNavigate}
                      data-testid={`nav-ward-${ward.id}${sub.path || "-settings"}`}
                      className={cn(
                        "flex items-center px-2 py-1.5 rounded text-xs font-medium transition-colors",
                        subActive
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
        className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
      >
        <Plus className="w-3 h-3" /> 병동 추가
      </Link>
    </nav>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  return (
    <div className="min-h-screen flex flex-col" data-testid="app-layout">
      {/* Top header */}
      <header
        className="bg-card border-b border-border h-14 flex items-center px-4 sticky top-0 z-30 shadow-sm gap-3"
        data-testid="header"
      >
        {/* Mobile hamburger */}
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden -ml-1 h-9 w-9 p-0"
          onClick={() => setMobileOpen(true)}
          aria-label="메뉴 열기"
          data-testid="button-mobile-menu"
        >
          <Menu className="w-5 h-5" />
        </Button>

        <Link href="/" className="flex items-center gap-2">
          <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
            <CalendarDays className="w-4 h-4" />
          </div>
          <span className="font-bold text-lg text-foreground tracking-tight">너스케줄</span>
        </Link>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <aside
          className="hidden md:flex w-56 bg-sidebar border-r border-sidebar-border flex-shrink-0 flex-col overflow-y-auto"
          data-testid="sidebar"
        >
          <SidebarContent location={location} />
        </aside>

        {/* Mobile drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
            <div className="flex items-center gap-2 px-4 h-14 border-b border-sidebar-border">
              <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
                <CalendarDays className="w-4 h-4" />
              </div>
              <span className="font-bold text-base tracking-tight">너스케줄</span>
            </div>
            <SidebarContent location={location} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-background" data-testid="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
