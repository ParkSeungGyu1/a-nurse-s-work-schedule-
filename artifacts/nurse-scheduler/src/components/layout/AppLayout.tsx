import { Link, useLocation } from "wouter";
import { LayoutDashboard, Building2, Users, CalendarDays, Settings, ChevronRight, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { useListWards } from "@workspace/api-client-react";
import { useState } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  exact?: boolean;
}

const topNav: NavItem[] = [
  { label: "대시보드", href: "/", icon: <LayoutDashboard className="w-4 h-4" />, exact: true },
  { label: "병동 관리", href: "/wards", icon: <Building2 className="w-4 h-4" /> },
];

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

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: wards } = useListWards();
  const [expandedWardId, setExpandedWardId] = useState<number | null>(null);

  // Detect current ward from URL
  const wardMatch = location.match(/^\/wards\/(\d+)/);
  const currentWardId = wardMatch ? Number(wardMatch[1]) : null;

  function isActive(href: string, exact = false) {
    if (exact) return location === href;
    return location.startsWith(href);
  }

  return (
    <div className="min-h-screen flex flex-col" data-testid="app-layout">
      {/* Top header */}
      <header className="bg-card border-b border-border h-14 flex items-center px-4 sticky top-0 z-30 shadow-sm" data-testid="header">
        <Link href="/" className="flex items-center gap-2 mr-8">
          <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
            <CalendarDays className="w-4 h-4" />
          </div>
          <span className="font-bold text-lg text-foreground tracking-tight">너스케줄</span>
        </Link>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-56 bg-sidebar border-r border-sidebar-border flex-shrink-0 flex flex-col py-3 overflow-y-auto" data-testid="sidebar">
          <nav className="flex-1 px-2 space-y-0.5">
            {topNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`nav-${item.label}`}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive(item.href, item.exact)
                    ? "bg-primary text-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-accent-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}

            {/* Ward list */}
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
                    <ChevronRight className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-90")} />
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

            {/* Add ward shortcut */}
            <Link
              href="/wards"
              data-testid="nav-add-ward"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
            >
              + 병동 추가
            </Link>
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-background" data-testid="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
