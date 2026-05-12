import type { Nurse, WardRule, DailyRequirement, NurseConstraint } from "@workspace/db";

export interface GeneratedEntry {
  nurseId: number;
  date: string;
  shiftType: string;
}

function getDaysInMonth(yearMonth: string): string[] {
  const [year, month] = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const day = d.toString().padStart(2, "0");
    days.push(`${yearMonth}-${day}`);
  }
  return days;
}

function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr).getDay(); // 0=Sun, 6=Sat
}

export function generateSchedule(
  yearMonth: string,
  nurses: Nurse[],
  rules: WardRule,
  requirements: DailyRequirement[],
  constraints: NurseConstraint[]
): GeneratedEntry[] {
  const days = getDaysInMonth(yearMonth);
  const entries: GeneratedEntry[] = [];

  // Build constraint maps for fast lookup
  const fixedOffByNurse = new Map<number, Set<string>>();
  const forbiddenShiftByNurse = new Map<number, Map<string, Set<string>>>();

  for (const c of constraints) {
    if (c.constraintType === "fixed_off" && c.date) {
      if (!fixedOffByNurse.has(c.nurseId)) fixedOffByNurse.set(c.nurseId, new Set());
      fixedOffByNurse.get(c.nurseId)!.add(c.date);
    }
    if (c.constraintType === "annual_leave" && c.date) {
      if (!fixedOffByNurse.has(c.nurseId)) fixedOffByNurse.set(c.nurseId, new Set());
      fixedOffByNurse.get(c.nurseId)!.add(c.date);
    }
    if (c.constraintType === "forbidden_shift" && c.date && c.shiftType) {
      if (!forbiddenShiftByNurse.has(c.nurseId)) forbiddenShiftByNurse.set(c.nurseId, new Map());
      const dateMap = forbiddenShiftByNurse.get(c.nurseId)!;
      if (!dateMap.has(c.date)) dateMap.set(c.date, new Set());
      dateMap.get(c.date)!.add(c.shiftType);
    }
  }

  // Build requirements map: date + shiftType -> count
  const reqMap = new Map<string, number>();
  for (const r of requirements) {
    reqMap.set(`${r.date}:${r.shiftType}`, r.requiredCount);
  }

  // State tracking per nurse
  const nurseState = new Map<number, {
    lastShift: string;
    consecutiveWork: number;
    consecutiveNight: number;
    offAfterNightRemaining: number;
    nightCount: number;
    shiftHistory: Array<{ date: string; shift: string }>;
  }>();

  for (const nurse of nurses) {
    nurseState.set(nurse.id, {
      lastShift: "OFF",
      consecutiveWork: 0,
      consecutiveNight: 0,
      offAfterNightRemaining: 0,
      nightCount: 0,
      shiftHistory: [],
    });
  }

  // Per date: track how many assigned per shift
  for (const date of days) {
    const shiftAssigned: Record<string, number> = { D: 0, E: 0, N: 0 };
    const shiftNeeded: Record<string, number> = {
      D: reqMap.get(`${date}:D`) ?? 3,
      E: reqMap.get(`${date}:E`) ?? 3,
      N: reqMap.get(`${date}:N`) ?? 2,
    };

    // First pass: assign nurses to shifts based on need, constraints, and rules
    // Prioritize: cover D, then E, then N
    const nurseShifts: Map<number, string> = new Map();

    // Determine eligible nurses per shift
    function canAssign(nurse: Nurse, shift: string, state: typeof nurseState extends Map<any, infer V> ? V : never): boolean {
      // Fixed off / leave
      if (fixedOffByNurse.get(nurse.id)?.has(date)) return false;
      // Forbidden shift on date
      if (forbiddenShiftByNurse.get(nurse.id)?.get(date)?.has(shift)) return false;
      // Allowed shifts
      if (!nurse.allowedShifts.includes(shift)) return false;
      // Off after night
      if (state.offAfterNightRemaining > 0) return false;
      // Max consecutive work
      if (state.consecutiveWork >= rules.maxConsecutiveWorkDays) return false;
      // Max consecutive nights
      if (shift === "N" && state.consecutiveNight >= rules.maxConsecutiveNightShifts) return false;
      // Monthly night limit
      const nightLimit = nurse.monthlyNightLimit ?? rules.monthlyMaxNightShifts;
      if (shift === "N" && state.nightCount >= nightLimit) return false;
      // E -> D restriction
      if (!rules.allowEToD && shift === "D" && state.lastShift === "E") return false;
      return true;
    }

    // Assign by shift priority
    for (const shift of ["D", "E", "N"]) {
      const needed = shiftNeeded[shift] ?? 0;
      if (needed <= 0) continue;

      // Sort nurses: prioritize those with fewer shifts assigned this month
      const eligible = nurses.filter((n) => {
        if (nurseShifts.has(n.id)) return false; // already assigned today
        const state = nurseState.get(n.id)!;
        return canAssign(n, shift, state);
      });

      // Try to fill the shift
      let filled = shiftAssigned[shift] ?? 0;
      for (const nurse of eligible) {
        if (filled >= needed) break;
        nurseShifts.set(nurse.id, shift);
        filled++;
      }
      shiftAssigned[shift] = filled;
    }

    // Assign remaining nurses to OFF
    for (const nurse of nurses) {
      if (!nurseShifts.has(nurse.id)) {
        nurseShifts.set(nurse.id, "OFF");
      }
    }

    // Commit entries and update state
    for (const nurse of nurses) {
      const shift = nurseShifts.get(nurse.id) ?? "OFF";
      entries.push({ nurseId: nurse.id, date, shiftType: shift });

      const state = nurseState.get(nurse.id)!;
      if (shift === "OFF") {
        if (state.offAfterNightRemaining > 0) state.offAfterNightRemaining--;
        state.consecutiveWork = 0;
        state.consecutiveNight = 0;
      } else {
        state.consecutiveWork++;
        if (shift === "N") {
          state.consecutiveNight++;
          state.nightCount++;
        } else {
          // If previous streak was night, check if we need forced offs
          if (state.consecutiveNight > 0) {
            state.offAfterNightRemaining = rules.offDaysAfterNightShifts;
          }
          state.consecutiveNight = 0;
        }
      }
      state.lastShift = shift;
      state.shiftHistory.push({ date, shift });
    }
  }

  return entries;
}
