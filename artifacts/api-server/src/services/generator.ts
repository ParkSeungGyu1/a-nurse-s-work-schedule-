import type {
  DailyRequirement,
  Nurse,
  NurseConstraint,
  PairRule,
  WardRule,
} from "@workspace/db";

export interface GeneratedEntry {
  nurseId: number;
  date: string;
  shiftType: string;
}

export interface GenerateScheduleOptions {
  priorityMode?: "balanced" | "fairness" | "coverage" | "new_nurse_protection";
}

interface NurseState {
  lastShift: string;
  consecutiveWork: number;
  consecutiveNight: number;
  consecutiveSameShift: number;
  forcedOffRemaining: number;
  nightRecoveryRemaining: number;
  nightCount: number;
  assignedWorkDays: number;
  weekendAssignments: number;
  holidayAssignments: number;
}

interface ConstraintMaps {
  fixedOffByNurse: Map<number, Set<string>>;
  preferredOffByNurse: Map<number, Set<string>>;
  forbiddenShiftByNurse: Map<number, Map<string, Set<string>>>;
  forbiddenShiftByMonth: Map<number, Map<string, Set<string>>>;
}

interface NightKeepPlanState {
  nightCount: number;
  blockCount: number;
  lastBlockEndIndex: number;
}

interface DayEveningPlanState {
  assignedDays: number;
  lastBlockEndIndex: number;
  lastShift: "D" | "E" | "OFF";
  consecutiveSameShift: number;
}

function getDaysInMonth(yearMonth: string): string[] {
  const [year, month] = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: string[] = [];

  for (let dayIndex = 1; dayIndex <= daysInMonth; dayIndex += 1) {
    days.push(`${yearMonth}-${String(dayIndex).padStart(2, "0")}`);
  }

  return days;
}

function buildSameShiftGroups(pairRules: PairRule[]): Map<number, number[]> {
  const adjacency = new Map<number, Set<number>>();

  for (const rule of pairRules) {
    if (!rule.isActive || rule.ruleType !== "same_shift") continue;

    if (!adjacency.has(rule.preceptorId)) adjacency.set(rule.preceptorId, new Set());
    if (!adjacency.has(rule.precepteeId)) adjacency.set(rule.precepteeId, new Set());

    adjacency.get(rule.preceptorId)!.add(rule.precepteeId);
    adjacency.get(rule.precepteeId)!.add(rule.preceptorId);
  }

  const groups = new Map<number, number[]>();
  const visited = new Set<number>();

  for (const nurseId of adjacency.keys()) {
    if (visited.has(nurseId)) continue;

    const stack = [nurseId];
    const component: number[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);

      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) stack.push(next);
      }
    }

    for (const memberId of component) {
      groups.set(memberId, component);
    }
  }

  return groups;
}

function buildConstraintMaps(constraints: NurseConstraint[]): ConstraintMaps {
  const fixedOffByNurse = new Map<number, Set<string>>();
  const preferredOffByNurse = new Map<number, Set<string>>();
  const forbiddenShiftByNurse = new Map<number, Map<string, Set<string>>>();
  const forbiddenShiftByMonth = new Map<number, Map<string, Set<string>>>();

  for (const constraint of constraints) {
    if (
      (
        constraint.constraintType === "fixed_off" ||
        constraint.constraintType === "annual_leave" ||
        constraint.constraintType === "education"
      ) &&
      constraint.date
    ) {
      if (!fixedOffByNurse.has(constraint.nurseId)) {
        fixedOffByNurse.set(constraint.nurseId, new Set());
      }
      fixedOffByNurse.get(constraint.nurseId)!.add(constraint.date);
    }

    if (constraint.constraintType === "preferred_off" && constraint.date) {
      if (!preferredOffByNurse.has(constraint.nurseId)) {
        preferredOffByNurse.set(constraint.nurseId, new Set());
      }
      preferredOffByNurse.get(constraint.nurseId)!.add(constraint.date);
    }

    if (constraint.constraintType === "forbidden_shift" && constraint.date && constraint.shiftType) {
      if (!forbiddenShiftByNurse.has(constraint.nurseId)) {
        forbiddenShiftByNurse.set(constraint.nurseId, new Map());
      }

      const byDate = forbiddenShiftByNurse.get(constraint.nurseId)!;
      if (!byDate.has(constraint.date)) byDate.set(constraint.date, new Set());
      byDate.get(constraint.date)!.add(constraint.shiftType);
    }

    if (
      constraint.constraintType === "forbidden_shift" &&
      constraint.yearMonth &&
      constraint.shiftType
    ) {
      if (!forbiddenShiftByMonth.has(constraint.nurseId)) {
        forbiddenShiftByMonth.set(constraint.nurseId, new Map());
      }

      const byMonth = forbiddenShiftByMonth.get(constraint.nurseId)!;
      if (!byMonth.has(constraint.yearMonth)) byMonth.set(constraint.yearMonth, new Set());
      byMonth.get(constraint.yearMonth)!.add(constraint.shiftType);
    }
  }

  return {
    fixedOffByNurse,
    preferredOffByNurse,
    forbiddenShiftByNurse,
    forbiddenShiftByMonth,
  };
}

function buildNightKeepLocks(args: {
  yearMonth: string;
  days: string[];
  nurses: Nurse[];
  rules: WardRule;
  requirementByKey: Map<string, number>;
  constraintMaps: ConstraintMaps;
}) {
  const { yearMonth, days, nurses, rules, requirementByKey, constraintMaps } = args;
  const nightKeepNurses = nurses.filter((nurse) => nurse.isNightKeep);
  const lockedAssignments = new Map<string, string>();

  if (nightKeepNurses.length === 0) {
    return lockedAssignments;
  }

  const remainingNightNeed = new Map<string, number>();
  for (const date of days) {
    remainingNightNeed.set(date, requirementByKey.get(`${date}:N`) ?? 2);
  }

  const planState = new Map<number, NightKeepPlanState>();
  for (const nurse of nightKeepNurses) {
    planState.set(nurse.id, {
      nightCount: 0,
      blockCount: 0,
      lastBlockEndIndex: -99,
    });
  }

  const getKey = (nurseId: number, date: string) => `${nurseId}:${date}`;
  const getLock = (nurseId: number, date: string) => lockedAssignments.get(getKey(nurseId, date));

  function countNightKeepOnDate(date: string) {
    let count = 0;
    for (const nurse of nightKeepNurses) {
      if (getLock(nurse.id, date) === "N") count += 1;
    }
    return count;
  }

  function canPlaceNightKeepBlock(nurse: Nurse, startIndex: number, length: number) {
    const state = planState.get(nurse.id)!;
    const nightLimit = nurse.monthlyNightLimit ?? rules.monthlyMaxNightShifts;

    if (state.nightCount + length > nightLimit) return false;
    if (state.lastBlockEndIndex >= startIndex - 1) return false;
    if (state.lastBlockEndIndex + rules.offDaysAfterNightShifts >= startIndex) return false;

    for (let offset = 0; offset < length; offset += 1) {
      const date = days[startIndex + offset];
      if (!date) return false;
      if (!nurse.allowedShifts.includes("N")) return false;
      if (constraintMaps.fixedOffByNurse.get(nurse.id)?.has(date)) return false;
      if (constraintMaps.forbiddenShiftByNurse.get(nurse.id)?.get(date)?.has("N")) return false;
      if (constraintMaps.forbiddenShiftByMonth.get(nurse.id)?.get(yearMonth)?.has("N")) return false;
      if (getLock(nurse.id, date)) return false;
      if ((remainingNightNeed.get(date) ?? 0) <= 0) return false;
      if (countNightKeepOnDate(date) > 0) return false;
    }

    for (let recoveryOffset = 1; recoveryOffset <= rules.offDaysAfterNightShifts; recoveryOffset += 1) {
      const recoveryDate = days[startIndex + length - 1 + recoveryOffset];
      if (!recoveryDate) break;

      const existing = getLock(nurse.id, recoveryDate);
      if (existing && existing !== "OFF") return false;
    }

    return true;
  }

  function scoreNightKeepBlock(nurse: Nurse, startIndex: number, length: number) {
    const state = planState.get(nurse.id)!;
    let score = state.nightCount * 8 + state.blockCount * 5;

    if (length === 1) score += 20;
    if (length === 2) score += 6;
    if (length === 3) score -= 4;

    for (let offset = 0; offset < length; offset += 1) {
      const date = days[startIndex + offset];
      const need = remainingNightNeed.get(date) ?? 0;
      score -= need * 18;

      if (constraintMaps.preferredOffByNurse.get(nurse.id)?.has(date)) {
        score += 55;
      }
    }

    for (let recoveryOffset = 1; recoveryOffset <= rules.offDaysAfterNightShifts; recoveryOffset += 1) {
      const recoveryDate = days[startIndex + length - 1 + recoveryOffset];
      if (!recoveryDate) break;

      if (constraintMaps.preferredOffByNurse.get(nurse.id)?.has(recoveryDate)) {
        score -= 8;
      }
    }

    return score;
  }

  function lockNightKeepBlock(nurse: Nurse, startIndex: number, length: number) {
    const state = planState.get(nurse.id)!;

    for (let offset = 0; offset < length; offset += 1) {
      const date = days[startIndex + offset];
      lockedAssignments.set(getKey(nurse.id, date), "N");
      remainingNightNeed.set(date, Math.max(0, (remainingNightNeed.get(date) ?? 0) - 1));
    }

    for (let recoveryOffset = 1; recoveryOffset <= rules.offDaysAfterNightShifts; recoveryOffset += 1) {
      const recoveryDate = days[startIndex + length - 1 + recoveryOffset];
      if (!recoveryDate) break;
      if (!lockedAssignments.has(getKey(nurse.id, recoveryDate))) {
        lockedAssignments.set(getKey(nurse.id, recoveryDate), "OFF");
      }
    }

    state.nightCount += length;
    state.blockCount += 1;
    state.lastBlockEndIndex = startIndex + length - 1;
  }

  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const date = days[dayIndex];
    if ((remainingNightNeed.get(date) ?? 0) <= 0) continue;
    if (countNightKeepOnDate(date) > 0) continue;

    let bestCandidate: { nurse: Nurse; length: number; score: number } | null = null;

    for (const nurse of nightKeepNurses) {
      for (const length of [rules.maxConsecutiveNightShifts, 2, 1]) {
        if (length <= 0) continue;
        if (!canPlaceNightKeepBlock(nurse, dayIndex, length)) continue;

        const score = scoreNightKeepBlock(nurse, dayIndex, length);
        if (!bestCandidate || score < bestCandidate.score) {
          bestCandidate = { nurse, length, score };
        }
      }
    }

    if (bestCandidate) {
      lockNightKeepBlock(bestCandidate.nurse, dayIndex, bestCandidate.length);
    }
  }

  return lockedAssignments;
}

function buildGeneralNightLocks(args: {
  yearMonth: string;
  days: string[];
  nurses: Nurse[];
  rules: WardRule;
  requirementByKey: Map<string, number>;
  constraintMaps: ConstraintMaps;
  lockedAssignments: Map<string, string>;
  sameShiftGroups: Map<number, number[]>;
}) {
  const {
    yearMonth,
    days,
    nurses,
    rules,
    requirementByKey,
    constraintMaps,
    lockedAssignments,
    sameShiftGroups,
  } = args;
  const generalNurses = nurses.filter((nurse) => !nurse.isNightKeep && !sameShiftGroups.has(nurse.id));

  if (generalNurses.length === 0) {
    return lockedAssignments;
  }

  const remainingNightNeed = new Map<string, number>();
  for (const date of days) {
    let prefilled = 0;
    for (const nurse of nurses) {
      if (lockedAssignments.get(`${nurse.id}:${date}`) === "N") {
        prefilled += 1;
      }
    }

    remainingNightNeed.set(date, Math.max(0, (requirementByKey.get(`${date}:N`) ?? 2) - prefilled));
  }

  const planState = new Map<number, NightKeepPlanState>();
  for (const nurse of generalNurses) {
    planState.set(nurse.id, {
      nightCount: 0,
      blockCount: 0,
      lastBlockEndIndex: -99,
    });
  }

  const getKey = (nurseId: number, date: string) => `${nurseId}:${date}`;
  const getLock = (nurseId: number, date: string) => lockedAssignments.get(getKey(nurseId, date));

  function canPlaceGeneralNightBlock(nurse: Nurse, startIndex: number, length: number) {
    const state = planState.get(nurse.id)!;
    const nightLimit = nurse.monthlyNightLimit ?? rules.monthlyMaxNightShifts;

    if (state.nightCount + length > nightLimit) return false;
    if (state.lastBlockEndIndex >= startIndex - 1) return false;
    if (state.lastBlockEndIndex + rules.offDaysAfterNightShifts >= startIndex) return false;

    for (let offset = 0; offset < length; offset += 1) {
      const date = days[startIndex + offset];
      if (!date) return false;
      if (!nurse.allowedShifts.includes("N")) return false;
      if (constraintMaps.fixedOffByNurse.get(nurse.id)?.has(date)) return false;
      if (constraintMaps.forbiddenShiftByNurse.get(nurse.id)?.get(date)?.has("N")) return false;
      if (constraintMaps.forbiddenShiftByMonth.get(nurse.id)?.get(yearMonth)?.has("N")) return false;
      if (getLock(nurse.id, date)) return false;
      if ((remainingNightNeed.get(date) ?? 0) <= 0) return false;
    }

    for (let recoveryOffset = 1; recoveryOffset <= rules.offDaysAfterNightShifts; recoveryOffset += 1) {
      const recoveryDate = days[startIndex + length - 1 + recoveryOffset];
      if (!recoveryDate) break;

      const existing = getLock(nurse.id, recoveryDate);
      if (existing && existing !== "OFF") return false;
    }

    return true;
  }

  function scoreGeneralNightBlock(nurse: Nurse, startIndex: number, length: number) {
    const state = planState.get(nurse.id)!;
    let score = state.nightCount * 10 + state.blockCount * 5;

    if (nurse.experienceLevel === "new") {
      score += 90;
    } else if (nurse.experienceLevel === "senior") {
      score -= 12;
    } else {
      score -= 6;
    }

    if (length === 1) score += 24;
    if (length === 2) score += 7;
    if (length === 3) score -= 6;

    for (let offset = 0; offset < length; offset += 1) {
      const date = days[startIndex + offset];
      const need = remainingNightNeed.get(date) ?? 0;
      score -= need * 16;

      if (constraintMaps.preferredOffByNurse.get(nurse.id)?.has(date)) {
        score += 48;
      }
    }

    for (let recoveryOffset = 1; recoveryOffset <= rules.offDaysAfterNightShifts; recoveryOffset += 1) {
      const recoveryDate = days[startIndex + length - 1 + recoveryOffset];
      if (!recoveryDate) break;

      if (constraintMaps.preferredOffByNurse.get(nurse.id)?.has(recoveryDate)) {
        score -= 8;
      }
    }

    return score;
  }

  function lockGeneralNightBlock(nurse: Nurse, startIndex: number, length: number) {
    const state = planState.get(nurse.id)!;

    for (let offset = 0; offset < length; offset += 1) {
      const date = days[startIndex + offset];
      lockedAssignments.set(getKey(nurse.id, date), "N");
      remainingNightNeed.set(date, Math.max(0, (remainingNightNeed.get(date) ?? 0) - 1));
    }

    for (let recoveryOffset = 1; recoveryOffset <= rules.offDaysAfterNightShifts; recoveryOffset += 1) {
      const recoveryDate = days[startIndex + length - 1 + recoveryOffset];
      if (!recoveryDate) break;
      if (!lockedAssignments.has(getKey(nurse.id, recoveryDate))) {
        lockedAssignments.set(getKey(nurse.id, recoveryDate), "OFF");
      }
    }

    state.nightCount += length;
    state.blockCount += 1;
    state.lastBlockEndIndex = startIndex + length - 1;
  }

  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const date = days[dayIndex];

    while ((remainingNightNeed.get(date) ?? 0) > 0) {
      let bestCandidate: { nurse: Nurse; length: number; score: number } | null = null;

      for (const nurse of generalNurses) {
        for (const length of [rules.maxConsecutiveNightShifts, 2, 1]) {
          if (length <= 0) continue;
          if (!canPlaceGeneralNightBlock(nurse, dayIndex, length)) continue;

          const score = scoreGeneralNightBlock(nurse, dayIndex, length);
          if (!bestCandidate || score < bestCandidate.score) {
            bestCandidate = { nurse, length, score };
          }
        }
      }

      if (!bestCandidate) break;

      lockGeneralNightBlock(bestCandidate.nurse, dayIndex, bestCandidate.length);
    }
  }

  return lockedAssignments;
}

function buildDayEveningLocks(args: {
  yearMonth: string;
  days: string[];
  nurses: Nurse[];
  rules: WardRule;
  requirementByKey: Map<string, number>;
  constraintMaps: ConstraintMaps;
  lockedAssignments: Map<string, string>;
  sameShiftGroups: Map<number, number[]>;
}) {
  const {
    yearMonth,
    days,
    nurses,
    rules,
    requirementByKey,
    constraintMaps,
    lockedAssignments,
    sameShiftGroups,
  } = args;
  const dayEveningNurses = nurses.filter((nurse) => !nurse.isNightKeep && !sameShiftGroups.has(nurse.id));

  if (dayEveningNurses.length === 0) {
    return lockedAssignments;
  }

  const planState = new Map<number, DayEveningPlanState>();
  for (const nurse of dayEveningNurses) {
    planState.set(nurse.id, {
      assignedDays: 0,
      lastBlockEndIndex: -99,
      lastShift: "OFF",
      consecutiveSameShift: 0,
    });
  }

  const remainingNeed = new Map<string, number>();
  for (const date of days) {
    for (const shift of ["D", "E"] as const) {
      let prefilled = 0;
      for (const nurse of nurses) {
        if (lockedAssignments.get(`${nurse.id}:${date}`) === shift) {
          prefilled += 1;
        }
      }

      remainingNeed.set(
        `${date}:${shift}`,
        Math.max(0, (requirementByKey.get(`${date}:${shift}`) ?? 3) - prefilled)
      );
    }
  }

  const getKey = (nurseId: number, date: string) => `${nurseId}:${date}`;
  const getLock = (nurseId: number, date: string) => lockedAssignments.get(getKey(nurseId, date)) ?? "OFF";

  function countLockedSameShiftRun(nurseId: number, startIndex: number, shift: "D" | "E") {
    let total = 0;
    for (let previousIndex = startIndex - 1; previousIndex >= 0; previousIndex -= 1) {
      if (getLock(nurseId, days[previousIndex]) !== shift) break;
      total += 1;
    }
    return total;
  }

  function computeProjectedLockedWorkRun(nurseId: number, startIndex: number, length: number) {
    let total = length;

    for (let previousIndex = startIndex - 1; previousIndex >= 0; previousIndex -= 1) {
      const shift = getLock(nurseId, days[previousIndex]);
      if (shift === "OFF") break;
      total += 1;
    }

    for (let nextIndex = startIndex + length; nextIndex < days.length; nextIndex += 1) {
      const shift = getLock(nurseId, days[nextIndex]);
      if (shift === "OFF") break;
      total += 1;
    }

    return total;
  }

  function countProjectedAssigned(date: string, shift: "D" | "E") {
    let count = 0;
    for (const nurse of nurses) {
      if (getLock(nurse.id, date) === shift) count += 1;
    }
    return count;
  }

  function projectedNewRatio(date: string, shift: "D" | "E", nurse: Nurse) {
    let total = 0;
    let newCount = 0;

    for (const candidate of nurses) {
      const lockedShift = getLock(candidate.id, date);
      if (lockedShift === shift) {
        total += 1;
        if (candidate.experienceLevel === "new") newCount += 1;
      }
    }

    total += 1;
    if (nurse.experienceLevel === "new") newCount += 1;

    return total > 0 ? newCount / total : 0;
  }

  function canPlaceDayEveningBlock(
    nurse: Nurse,
    startIndex: number,
    shift: "D" | "E",
    length: number
  ) {
    const state = planState.get(nurse.id)!;

    if (state.lastBlockEndIndex >= startIndex) return false;
    if (state.lastShift === shift && state.consecutiveSameShift + length > 4) return false;

    const previousSameShiftRun = countLockedSameShiftRun(nurse.id, startIndex, shift);
    if (previousSameShiftRun + length > 4) return false;
    if (computeProjectedLockedWorkRun(nurse.id, startIndex, length) > 4) return false;

    for (let offset = 0; offset < length; offset += 1) {
      const date = days[startIndex + offset];
      if (!date) return false;
      if (!nurse.allowedShifts.includes(shift)) return false;

      const existingLock = lockedAssignments.get(getKey(nurse.id, date));
      if (existingLock) return false;

      if (constraintMaps.fixedOffByNurse.get(nurse.id)?.has(date)) return false;
      if (constraintMaps.forbiddenShiftByNurse.get(nurse.id)?.get(date)?.has(shift)) return false;
      if (constraintMaps.forbiddenShiftByMonth.get(nurse.id)?.get(yearMonth)?.has(shift)) return false;
      if ((remainingNeed.get(`${date}:${shift}`) ?? 0) <= 0) return false;
      if (projectedNewRatio(date, shift, nurse) > rules.maxNewNurseRatioPerShift) return false;

      if (!rules.allowEToD && shift === "D") {
        const previousDate = days[startIndex + offset - 1];
        if (previousDate && getLock(nurse.id, previousDate) === "E") return false;
      }

      if (!rules.allowEToD && shift === "E") {
        const nextDate = days[startIndex + offset + 1];
        if (nextDate && lockedAssignments.get(getKey(nurse.id, nextDate)) === "D") return false;
      }
    }

    return true;
  }

  function scoreDayEveningBlock(
    nurse: Nurse,
    startIndex: number,
    shift: "D" | "E",
    length: number
  ) {
    const state = planState.get(nurse.id)!;
    let score = state.assignedDays * 6;

    if (length === 2) score -= 18;
    if (length === 1) score += 8;

    if (state.lastShift === shift) {
      score += 24;
    } else if (
      (state.lastShift === "D" && shift === "E") ||
      (state.lastShift === "E" && shift === "D")
    ) {
      score -= 16;
    }

    if (nurse.experienceLevel === "new") {
      score += 12;
    } else {
      score -= 6;
    }

    for (let offset = 0; offset < length; offset += 1) {
      const date = days[startIndex + offset];
      score -= (remainingNeed.get(`${date}:${shift}`) ?? 0) * 10;

      if (constraintMaps.preferredOffByNurse.get(nurse.id)?.has(date)) {
        score += 40;
      }
    }

    return score;
  }

  function lockDayEveningBlock(
    nurse: Nurse,
    startIndex: number,
    shift: "D" | "E",
    length: number
  ) {
    const state = planState.get(nurse.id)!;

    for (let offset = 0; offset < length; offset += 1) {
      const date = days[startIndex + offset];
      lockedAssignments.set(getKey(nurse.id, date), shift);
      remainingNeed.set(`${date}:${shift}`, Math.max(0, (remainingNeed.get(`${date}:${shift}`) ?? 0) - 1));
    }

    state.assignedDays += length;
    state.lastBlockEndIndex = startIndex + length - 1;
    if (state.lastShift === shift) {
      state.consecutiveSameShift += length;
    } else {
      state.consecutiveSameShift = length;
    }
    state.lastShift = shift;
  }

  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    let assignedAny = true;

    while (assignedAny) {
      assignedAny = false;
      let bestCandidate: { nurse: Nurse; shift: "D" | "E"; length: number; score: number } | null = null;

      for (const shift of ["D", "E"] as const) {
        const date = days[dayIndex];
        if ((remainingNeed.get(`${date}:${shift}`) ?? 0) <= 0) continue;

        for (const nurse of dayEveningNurses) {
          for (const length of [2, 1]) {
            if (!canPlaceDayEveningBlock(nurse, dayIndex, shift, length)) continue;

            const score = scoreDayEveningBlock(nurse, dayIndex, shift, length);
            if (!bestCandidate || score < bestCandidate.score) {
              bestCandidate = { nurse, shift, length, score };
            }
          }
        }
      }

      if (!bestCandidate) break;

      lockDayEveningBlock(
        bestCandidate.nurse,
        dayIndex,
        bestCandidate.shift,
        bestCandidate.length
      );
      assignedAny = true;
    }
  }

  return lockedAssignments;
}

export function generateSchedule(
  yearMonth: string,
  nurses: Nurse[],
  rules: WardRule,
  requirements: DailyRequirement[],
  constraints: NurseConstraint[],
  pairRules: PairRule[] = [],
  options: GenerateScheduleOptions = {}
): GeneratedEntry[] {
  const days = getDaysInMonth(yearMonth);
  const entries: GeneratedEntry[] = [];
  const priorityMode = options.priorityMode ?? "balanced";

  const nurseById = new Map(nurses.map((nurse) => [nurse.id, nurse]));
  const sameShiftGroups = buildSameShiftGroups(pairRules);
  const constraintMaps = buildConstraintMaps(constraints);

  const requirementByKey = new Map<string, number>();
  const holidayByDate = new Map<string, boolean>();
  for (const requirement of requirements) {
    requirementByKey.set(`${requirement.date}:${requirement.shiftType}`, requirement.requiredCount);
    holidayByDate.set(
      requirement.date,
      holidayByDate.get(requirement.date) === true || requirement.isHoliday
    );
  }

  const nurseState = new Map<number, NurseState>();
  for (const nurse of nurses) {
    nurseState.set(nurse.id, {
      lastShift: "OFF",
      consecutiveWork: 0,
      consecutiveNight: 0,
      consecutiveSameShift: 0,
      forcedOffRemaining: 0,
      nightRecoveryRemaining: 0,
      nightCount: 0,
      assignedWorkDays: 0,
      weekendAssignments: 0,
      holidayAssignments: 0,
    });
  }

  const lockedAssignments = buildNightKeepLocks({
    yearMonth,
    days,
    nurses,
    rules,
    requirementByKey,
    constraintMaps,
  });

  buildGeneralNightLocks({
    yearMonth,
    days,
    nurses,
    rules,
    requirementByKey,
    constraintMaps,
    lockedAssignments,
    sameShiftGroups,
  });

  buildDayEveningLocks({
    yearMonth,
    days,
    nurses,
    rules,
    requirementByKey,
    constraintMaps,
    lockedAssignments,
    sameShiftGroups,
  });

  function isWeekend(date: string) {
    const day = new Date(`${date}T00:00:00`).getDay();
    return day === 0 || day === 6;
  }

  function isHoliday(date: string) {
    return holidayByDate.get(date) ?? isWeekend(date);
  }

  function getGroupForNurse(nurseId: number): number[] {
    return sameShiftGroups.get(nurseId) ?? [nurseId];
  }

  function canAssignBase(nurse: Nurse, shift: string, date: string): boolean {
    const state = nurseState.get(nurse.id)!;

    if (constraintMaps.fixedOffByNurse.get(nurse.id)?.has(date)) return false;
    if (constraintMaps.forbiddenShiftByNurse.get(nurse.id)?.get(date)?.has(shift)) return false;
    if (constraintMaps.forbiddenShiftByMonth.get(nurse.id)?.get(yearMonth)?.has(shift)) return false;
    if (!nurse.allowedShifts.includes(shift)) return false;

    // Night-keep nurses are treated as dedicated night resources in the generator.
    if (nurse.isNightKeep && shift !== "N") return false;

    if (state.forcedOffRemaining > 0) return false;
    if (state.nightRecoveryRemaining > 0) return false;
    if (state.consecutiveWork >= rules.maxConsecutiveWorkDays) return false;

    if (state.lastShift === "N" && state.consecutiveNight > 0 && shift !== "N") {
      return false;
    }

    if (shift === "N" && state.consecutiveNight >= rules.maxConsecutiveNightShifts) {
      return false;
    }

    const nightLimit = nurse.monthlyNightLimit ?? rules.monthlyMaxNightShifts;
    if (shift === "N" && state.nightCount >= nightLimit) return false;

    if (!rules.allowEToD && shift === "D" && state.lastShift === "E") {
      return false;
    }

    return true;
  }

  function canAssignGroup(
    nurseId: number,
    shift: string,
    date: string,
    assignedToday: Map<number, string>,
    currentFilled: number,
    targetFilled: number
  ): number[] | null {
    const groupIds = getGroupForNurse(nurseId);
    const unassignedIds: number[] = [];

    for (const memberId of groupIds) {
      const member = nurseById.get(memberId);
      if (!member) return null;

      const existingShift = assignedToday.get(memberId);
      if (existingShift) {
        if (existingShift !== shift) return null;
        continue;
      }

      if (!canAssignBase(member, shift, date)) return null;
      unassignedIds.push(memberId);
    }

    if (currentFilled + unassignedIds.length > targetFilled) return null;
    return unassignedIds;
  }

  function scoreCandidateGroup(
    groupIds: number[],
    shift: string,
    date: string,
    assignedToday: Map<number, string>,
    needed: number
  ): number {
    const weekend = isWeekend(date);
    const holiday = isHoliday(date);

    const assignedIdsForShift = [...assignedToday.entries()]
      .filter(([, assignedShift]) => assignedShift === shift)
      .map(([assignedNurseId]) => assignedNurseId);
    const projectedIds = [...new Set([...assignedIdsForShift, ...groupIds])];
    const projectedNurses = projectedIds
      .map((groupNurseId) => nurseById.get(groupNurseId))
      .filter((nurse): nurse is Nurse => Boolean(nurse));

    const projectedNewCount = projectedNurses.filter((nurse) => nurse.experienceLevel === "new").length;
    const projectedExperiencedCount = projectedNurses.length - projectedNewCount;
    const projectedRatio = projectedNurses.length > 0 ? projectedNewCount / projectedNurses.length : 0;
    const projectedNightKeepCount = projectedNurses.filter((nurse) => nurse.isNightKeep).length;

    let score = 0;

    for (const groupNurseId of groupIds) {
      const nurse = nurseById.get(groupNurseId)!;
      const state = nurseState.get(groupNurseId)!;
      const prefersOff = constraintMaps.preferredOffByNurse.get(groupNurseId)?.has(date) ?? false;

      score += state.assignedWorkDays * (priorityMode === "coverage" ? 6 : 10);
      score += state.consecutiveWork * 3;
      score += shift === "N" ? state.nightCount * (nurse.isNightKeep ? 5 : 8) : state.nightCount * 2;

      if (rules.weekendFairness && weekend) {
        score += state.weekendAssignments * (priorityMode === "fairness" ? 14 : 8);
      }

      if (rules.holidayFairness && holiday) {
        score += state.holidayAssignments * (priorityMode === "fairness" ? 16 : 10);
      }

      if (prefersOff) {
        score += priorityMode === "coverage" ? 40 : 85;
      }

      if (shift === "N") {
        if (state.lastShift === "N" && state.consecutiveNight > 0) {
          score -= nurse.isNightKeep ? 45 : 28;
          if (state.consecutiveNight === rules.maxConsecutiveNightShifts - 1) {
            score -= nurse.isNightKeep ? 18 : 10;
          }
        } else {
          score += nurse.isNightKeep ? 12 : 20;
        }

        if (nurse.isNightKeep) {
          score -= 50;
        }
      } else if (shift === "D" || shift === "E") {
        if (state.lastShift === shift && state.consecutiveSameShift > 0) {
          score += state.consecutiveSameShift * 12;

          if (state.consecutiveSameShift >= 2) {
            score += 18;
          }

          if (state.consecutiveSameShift >= 3) {
            score += 34;
          }
        }

        const isSwitchingDayEvening =
          (state.lastShift === "D" && shift === "E") || (state.lastShift === "E" && shift === "D");

        if (isSwitchingDayEvening) {
          score -= 22;
        }

        if (state.lastShift === "OFF") {
          score -= 4;
        }
      }

      if (nurse.experienceLevel !== "new" && projectedExperiencedCount < rules.minExperiencedPerShift) {
        score -= 24;
      }

      if (priorityMode === "new_nurse_protection" && nurse.experienceLevel === "new") {
        score += 24;
      }
    }

    if ((shift === "D" || shift === "E") && groupIds.length > 1) {
      score -= 42;
    }

    if (shift === "N" && projectedNightKeepCount > 1) {
      score += (projectedNightKeepCount - 1) * 90;
    }

    if (projectedRatio > rules.maxNewNurseRatioPerShift) {
      score += shift === "N" ? 220 : priorityMode === "new_nurse_protection" ? 220 : 140;
    }

    if (shift === "N" && projectedNewCount > 0) {
      score += projectedExperiencedCount > 0
        ? (priorityMode === "new_nurse_protection" ? 95 : 55)
        : 180;
    }

    if (projectedExperiencedCount < rules.minExperiencedPerShift && projectedIds.length >= needed) {
      score += shift === "N" ? 260 : 180;
    }

    return score;
  }

  function sortCandidates(candidates: Nurse[], shift: string): Nurse[] {
    return [...candidates].sort((left, right) => {
      const leftState = nurseState.get(left.id)!;
      const rightState = nurseState.get(right.id)!;

      if (shift === "N") {
        if (left.isNightKeep !== right.isNightKeep) {
          return left.isNightKeep ? -1 : 1;
        }

        const leftContinuesNight = leftState.lastShift === "N" && leftState.consecutiveNight > 0 ? 0 : 1;
        const rightContinuesNight = rightState.lastShift === "N" && rightState.consecutiveNight > 0 ? 0 : 1;
        if (leftContinuesNight !== rightContinuesNight) {
          return leftContinuesNight - rightContinuesNight;
        }

        if (leftState.nightCount !== rightState.nightCount) {
          return leftState.nightCount - rightState.nightCount;
        }
      }

      if (leftState.assignedWorkDays !== rightState.assignedWorkDays) {
        return leftState.assignedWorkDays - rightState.assignedWorkDays;
      }

      if (leftState.consecutiveWork !== rightState.consecutiveWork) {
        return leftState.consecutiveWork - rightState.consecutiveWork;
      }

      return left.id - right.id;
    });
  }

  function fillShiftToTarget(
    candidates: Nurse[],
    shift: string,
    date: string,
    assignedToday: Map<number, string>,
    needed: number,
    targetFilled: number
  ) {
    let filled = [...assignedToday.values()].filter((assignedShift) => assignedShift === shift).length;

    while (filled < targetFilled) {
      let selectedGroupIds: number[] | null = null;
      let selectedScore = Number.POSITIVE_INFINITY;

      for (const nurse of candidates) {
        if (assignedToday.has(nurse.id)) continue;

        const assignableIds = canAssignGroup(
          nurse.id,
          shift,
          date,
          assignedToday,
          filled,
          targetFilled
        );

        if (!assignableIds || assignableIds.length === 0) continue;

        const score = scoreCandidateGroup(assignableIds, shift, date, assignedToday, needed);
        if (score < selectedScore) {
          selectedScore = score;
          selectedGroupIds = assignableIds;
        }
      }

      if (!selectedGroupIds) break;

      for (const assignableId of selectedGroupIds) {
        assignedToday.set(assignableId, shift);
      }

      filled += selectedGroupIds.length;
    }
  }

  function isLongSameShiftRun(groupIds: number[], shift: "D" | "E") {
    return groupIds.some((groupNurseId) => {
      const state = nurseState.get(groupNurseId)!;
      return state.lastShift === shift && state.consecutiveSameShift >= 2;
    });
  }

  function selectBestShiftGroup(
    candidates: Nurse[],
    shift: "D" | "E",
    date: string,
    assignedToday: Map<number, string>,
    currentFilled: number,
    targetFilled: number,
    needed: number,
    options?: {
      requireExperienced?: boolean;
      avoidLongSameShiftRun?: boolean;
    }
  ) {
    let selectedGroupIds: number[] | null = null;
    let selectedScore = Number.POSITIVE_INFINITY;

    for (const nurse of candidates) {
      if (assignedToday.has(nurse.id)) continue;
      if (options?.requireExperienced && nurse.experienceLevel === "new") continue;

      const assignableIds = canAssignGroup(
        nurse.id,
        shift,
        date,
        assignedToday,
        currentFilled,
        targetFilled
      );

      if (!assignableIds || assignableIds.length === 0) continue;

      if (
        options?.requireExperienced &&
        assignableIds.some((id) => nurseById.get(id)?.experienceLevel === "new")
      ) {
        continue;
      }

      if (options?.avoidLongSameShiftRun && isLongSameShiftRun(assignableIds, shift)) {
        continue;
      }

      const score = scoreCandidateGroup(assignableIds, shift, date, assignedToday, needed);
      if (score < selectedScore) {
        selectedScore = score;
        selectedGroupIds = assignableIds;
      }
    }

    return selectedGroupIds;
  }

  function countAssignedForShift(assignedToday: Map<number, string>, shift: string) {
    return [...assignedToday.values()].filter((assignedShift) => assignedShift === shift).length;
  }

  function countExperiencedForShift(assignedToday: Map<number, string>, shift: string) {
    return [...assignedToday.entries()].filter(([nurseId, assignedShift]) => {
      if (assignedShift !== shift) return false;
      return nurseById.get(nurseId)?.experienceLevel !== "new";
    }).length;
  }

  function countNewForShift(assignedToday: Map<number, string>, shift: string) {
    return [...assignedToday.entries()].filter(([nurseId, assignedShift]) => {
      if (assignedShift !== shift) return false;
      return nurseById.get(nurseId)?.experienceLevel === "new";
    }).length;
  }

  function fillShiftWithStaffMix(
    candidates: Nurse[],
    shift: "D" | "E",
    date: string,
    assignedToday: Map<number, string>,
    needed: number
  ) {
    const experiencedCandidates = candidates.filter((nurse) => nurse.experienceLevel !== "new");
    const requiredExperienced = Math.min(rules.minExperiencedPerShift, needed);

    if (requiredExperienced > 0) {
      let experiencedFilled = countExperiencedForShift(assignedToday, shift);

      while (experiencedFilled < requiredExperienced) {
        let selectedGroupIds = selectBestShiftGroup(
          experiencedCandidates,
          shift,
          date,
          assignedToday,
          countAssignedForShift(assignedToday, shift),
          requiredExperienced,
          needed,
          {
            requireExperienced: true,
            avoidLongSameShiftRun: true,
          }
        );

        if (!selectedGroupIds) {
          selectedGroupIds = selectBestShiftGroup(
            experiencedCandidates,
            shift,
            date,
            assignedToday,
            countAssignedForShift(assignedToday, shift),
            requiredExperienced,
            needed,
            {
              requireExperienced: true,
            }
          );
        }

        if (!selectedGroupIds) break;

        for (const assignableId of selectedGroupIds) {
          assignedToday.set(assignableId, shift);
        }

        experiencedFilled = countExperiencedForShift(assignedToday, shift);
      }
    }

    let filled = countAssignedForShift(assignedToday, shift);
    let experiencedFilled = countExperiencedForShift(assignedToday, shift);
    if (experiencedFilled < requiredExperienced) {
      return;
    }

    while (filled < needed) {
      const pickCandidateGroup = (avoidLongSameShiftRun: boolean) => {
        let bestGroupIds: number[] | null = null;
        let bestScore = Number.POSITIVE_INFINITY;

        for (const nurse of candidates) {
          if (assignedToday.has(nurse.id)) continue;

          const assignableIds = canAssignGroup(
            nurse.id,
            shift,
            date,
            assignedToday,
            filled,
            needed
          );

          if (!assignableIds || assignableIds.length === 0) continue;
          if (avoidLongSameShiftRun && isLongSameShiftRun(assignableIds, shift)) continue;

          const projectedFilled = filled + assignableIds.length;
          const projectedExperienced =
            experiencedFilled +
            assignableIds.filter((id) => nurseById.get(id)?.experienceLevel !== "new").length;
          const projectedNew =
            countNewForShift(assignedToday, shift) +
            assignableIds.filter((id) => nurseById.get(id)?.experienceLevel === "new").length;
          const projectedRatio = projectedFilled > 0 ? projectedNew / projectedFilled : 0;

          if (projectedRatio > rules.maxNewNurseRatioPerShift) continue;

          const score = scoreCandidateGroup(assignableIds, shift, date, assignedToday, needed);
          if (score < bestScore) {
            bestScore = score;
            bestGroupIds = assignableIds;
          }
        }

        return bestGroupIds;
      };

      let selectedGroupIds = pickCandidateGroup(true);
      if (!selectedGroupIds) {
        selectedGroupIds = pickCandidateGroup(false);
      }

      if (!selectedGroupIds) break;

      for (const assignableId of selectedGroupIds) {
        assignedToday.set(assignableId, shift);
      }

      filled = countAssignedForShift(assignedToday, shift);
      experiencedFilled = countExperiencedForShift(assignedToday, shift);
    }
  }

  for (const date of days) {
    const assignedToday = new Map<number, string>();
    const shiftNeeded: Record<"D" | "E" | "N", number> = {
      D: requirementByKey.get(`${date}:D`) ?? 3,
      E: requirementByKey.get(`${date}:E`) ?? 3,
      N: requirementByKey.get(`${date}:N`) ?? 2,
    };

    for (const nurse of nurses) {
      const lockedShift = lockedAssignments.get(`${nurse.id}:${date}`);
      if (lockedShift) {
        assignedToday.set(nurse.id, lockedShift);
      }
    }

    const nightCandidates = sortCandidates(
      nurses.filter((nurse) => canAssignBase(nurse, "N", date)),
      "N"
    );
    const generalNightCandidates = nightCandidates.filter((nurse) => !nurse.isNightKeep);

    // Night-keep blocks are pre-assigned above. Remaining night demand is filled by general nurses.
    fillShiftToTarget(
      generalNightCandidates,
      "N",
      date,
      assignedToday,
      shiftNeeded.N,
      shiftNeeded.N
    );

    // If night still remains uncovered, leave it blank and surface a recommendation later.

    const dayEveningShiftOrder = (["D", "E"] as const)
      .map((shift) => {
        const eligibleCount = nurses.filter((nurse) => {
          if (assignedToday.has(nurse.id)) return false;
          return canAssignBase(nurse, shift, date);
        }).length;

        const needed = shiftNeeded[shift];
        const scarcityScore = eligibleCount - needed;
        return { shift, eligibleCount, needed, scarcityScore };
      })
      .sort((left, right) => {
        if (left.scarcityScore !== right.scarcityScore) {
          return left.scarcityScore - right.scarcityScore;
        }

        if (left.needed !== right.needed) {
          return right.needed - left.needed;
        }

        const dayNumber = Number(date.slice(-2));
        if (dayNumber % 2 === 0) {
          return left.shift === "E" ? -1 : 1;
        }

        return left.shift === "D" ? -1 : 1;
      })
      .map((item) => item.shift);

    for (const shift of dayEveningShiftOrder) {
      const needed = shiftNeeded[shift];
      if (needed <= 0) continue;

      const eligible = sortCandidates(
        nurses.filter((nurse) => {
          if (assignedToday.has(nurse.id)) return false;
          return canAssignBase(nurse, shift, date);
        }),
        shift
      );

      fillShiftWithStaffMix(eligible, shift, date, assignedToday, needed);
    }

    for (const nurse of nurses) {
      if (!assignedToday.has(nurse.id)) {
        assignedToday.set(nurse.id, "OFF");
      }
    }

    const weekend = isWeekend(date);
    const holiday = isHoliday(date);

    for (const nurse of nurses) {
      const shift = assignedToday.get(nurse.id) ?? "OFF";
      entries.push({ nurseId: nurse.id, date, shiftType: shift });

      const state = nurseState.get(nurse.id)!;

      if (shift === "OFF") {
        let forcedOffRemaining = state.forcedOffRemaining;
        let nightRecoveryRemaining = state.nightRecoveryRemaining;

        if (state.lastShift === "N" && state.consecutiveNight > 0) {
          nightRecoveryRemaining = Math.max(
            nightRecoveryRemaining,
            Math.max(0, rules.offDaysAfterNightShifts - 1)
          );
        } else if (nightRecoveryRemaining > 0) {
          nightRecoveryRemaining -= 1;
        }

        if (state.consecutiveWork >= rules.maxConsecutiveWorkDays) {
          forcedOffRemaining = Math.max(
            forcedOffRemaining,
            Math.max(0, rules.offDaysAfterConsecutiveWork - 1)
          );
        } else if (forcedOffRemaining > 0) {
          forcedOffRemaining -= 1;
        }

        state.forcedOffRemaining = forcedOffRemaining;
        state.nightRecoveryRemaining = nightRecoveryRemaining;
        state.consecutiveWork = 0;
        state.consecutiveNight = 0;
        state.consecutiveSameShift = 0;
      } else {
        state.forcedOffRemaining = 0;
        state.nightRecoveryRemaining = 0;
        state.consecutiveWork += 1;
        state.assignedWorkDays += 1;

        if (weekend) {
          state.weekendAssignments += 1;
        }

        if (holiday) {
          state.holidayAssignments += 1;
        }

        if (shift === "N") {
          state.consecutiveNight += 1;
          state.nightCount += 1;
        } else {
          state.consecutiveNight = 0;
        }

        if (state.lastShift === shift) {
          state.consecutiveSameShift += 1;
        } else {
          state.consecutiveSameShift = 1;
        }
      }

      state.lastShift = shift;
    }
  }

  const entryMap = new Map<string, GeneratedEntry>();
  const scheduleByNurse = new Map<number, Map<string, string>>();

  for (const entry of entries) {
    entryMap.set(`${entry.nurseId}:${entry.date}`, entry);
    if (!scheduleByNurse.has(entry.nurseId)) {
      scheduleByNurse.set(entry.nurseId, new Map());
    }
    scheduleByNurse.get(entry.nurseId)!.set(entry.date, entry.shiftType);
  }

  function getScheduledShift(nurseId: number, date: string) {
    return scheduleByNurse.get(nurseId)?.get(date) ?? "OFF";
  }

  function setScheduledShift(nurseId: number, date: string, shiftType: string) {
    const key = `${nurseId}:${date}`;
    const entry = entryMap.get(key);
    if (!entry) return;

    entry.shiftType = shiftType;

    if (!scheduleByNurse.has(nurseId)) {
      scheduleByNurse.set(nurseId, new Map());
    }
    scheduleByNurse.get(nurseId)!.set(date, shiftType);
  }

  function countDayShiftAssigned(date: string, shift: "D" | "E") {
    let count = 0;
    for (const nurse of nurses) {
      if (getScheduledShift(nurse.id, date) === shift) count += 1;
    }
    return count;
  }

  function getAssignedIdsForShift(date: string, shift: "D" | "E") {
    return nurses
      .filter((nurse) => getScheduledShift(nurse.id, date) === shift)
      .map((nurse) => nurse.id);
  }

  function meetsShiftMixForIds(assignedIds: number[]) {
    const assignedNurses = assignedIds
      .map((nurseId) => nurseById.get(nurseId))
      .filter((nurse): nurse is Nurse => Boolean(nurse));

    const newCount = assignedNurses.filter((nurse) => nurse.experienceLevel === "new").length;
    const experiencedCount = assignedNurses.length - newCount;
    const ratio = assignedNurses.length > 0 ? newCount / assignedNurses.length : 0;

    if (experiencedCount < Math.min(rules.minExperiencedPerShift, assignedNurses.length)) {
      return false;
    }

    return ratio <= rules.maxNewNurseRatioPerShift;
  }

  function wouldMaintainShiftMix(
    date: string,
    shift: "D" | "E",
    removeNurseId: number,
    addNurseId: number
  ) {
    const assignedIds = getAssignedIdsForShift(date, shift).filter((nurseId) => nurseId !== removeNurseId);
    assignedIds.push(addNurseId);

    return meetsShiftMixForIds(assignedIds);
  }

  function wouldMaintainSwapShiftMix(
    date: string,
    leftNurseId: number,
    leftShift: "D" | "E",
    rightNurseId: number,
    rightShift: "D" | "E"
  ) {
    const leftProjectedIds = getAssignedIdsForShift(date, leftShift)
      .filter((nurseId) => nurseId !== leftNurseId)
      .concat(rightNurseId);
    const rightProjectedIds = getAssignedIdsForShift(date, rightShift)
      .filter((nurseId) => nurseId !== rightNurseId)
      .concat(leftNurseId);

    return meetsShiftMixForIds(leftProjectedIds) && meetsShiftMixForIds(rightProjectedIds);
  }

  function computeMaxConsecutiveWork(nurseId: number, date: string, shiftType: string) {
    if (shiftType === "OFF") return 0;

    let total = 1;
    let index = days.indexOf(date);

    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      if (getScheduledShift(nurseId, days[previousIndex]) === "OFF") break;
      total += 1;
    }

    for (let nextIndex = index + 1; nextIndex < days.length; nextIndex += 1) {
      if (getScheduledShift(nurseId, days[nextIndex]) === "OFF") break;
      total += 1;
    }

    return total;
  }

  function computeSameShiftRun(nurseId: number, date: string, shiftType: string) {
    if (shiftType !== "D" && shiftType !== "E") return 0;

    let total = 1;
    let index = days.indexOf(date);

    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      if (getScheduledShift(nurseId, days[previousIndex]) !== shiftType) break;
      total += 1;
    }

    for (let nextIndex = index + 1; nextIndex < days.length; nextIndex += 1) {
      if (getScheduledShift(nurseId, days[nextIndex]) !== shiftType) break;
      total += 1;
    }

    return total;
  }

  function violatesDayShiftTransition(nurseId: number, date: string, shiftType: "D" | "E") {
    if (rules.allowEToD) return false;
    const index = days.indexOf(date);
    const previousDate = index > 0 ? days[index - 1] : null;
    const nextDate = index < days.length - 1 ? days[index + 1] : null;

    if (shiftType === "D" && previousDate && getScheduledShift(nurseId, previousDate) === "E") {
      return true;
    }

    if (shiftType === "E" && nextDate && getScheduledShift(nurseId, nextDate) === "D") {
      return true;
    }

    return false;
  }

  function isRecoveringFromNight(nurseId: number, date: string) {
    const index = days.indexOf(date);
    for (let offset = 1; offset <= rules.offDaysAfterNightShifts; offset += 1) {
      const previousIndex = index - offset;
      if (previousIndex < 0) break;
      if (getScheduledShift(nurseId, days[previousIndex]) === "N") {
        return true;
      }
      if (getScheduledShift(nurseId, days[previousIndex]) !== "OFF") {
        break;
      }
    }
    return false;
  }

  function isHardLockedDate(nurseId: number, date: string) {
    const lockedShift = lockedAssignments.get(`${nurseId}:${date}`);
    if (!lockedShift) return false;

    if (constraintMaps.fixedOffByNurse.get(nurseId)?.has(date)) {
      return true;
    }

    if (lockedShift === "N") {
      return true;
    }

    if (lockedShift === "OFF" && isRecoveringFromNight(nurseId, date)) {
      return true;
    }

    return false;
  }

  function canCoverReliefShift(nurse: Nurse, date: string, shift: "D" | "E") {
    if (nurse.isNightKeep) return false;
    if (getScheduledShift(nurse.id, date) !== "OFF") return false;
    if (isHardLockedDate(nurse.id, date)) return false;
    if (!nurse.allowedShifts.includes(shift)) return false;
    if (constraintMaps.fixedOffByNurse.get(nurse.id)?.has(date)) return false;
    if (constraintMaps.forbiddenShiftByNurse.get(nurse.id)?.get(date)?.has(shift)) return false;
    if (constraintMaps.forbiddenShiftByMonth.get(nurse.id)?.get(yearMonth)?.has(shift)) return false;
    if (violatesDayShiftTransition(nurse.id, date, shift)) return false;
    if (isRecoveringFromNight(nurse.id, date)) return false;
    if (computeMaxConsecutiveWork(nurse.id, date, shift) > rules.maxConsecutiveWorkDays) return false;
    if (computeSameShiftRun(nurse.id, date, shift) > rules.maxConsecutiveWorkDays - 1) return false;
    return true;
  }

  function canSwapIntoShift(nurse: Nurse, date: string, shift: "D" | "E") {
    if (nurse.isNightKeep) return false;
    if (isHardLockedDate(nurse.id, date)) return false;
    if (!nurse.allowedShifts.includes(shift)) return false;
    if (constraintMaps.forbiddenShiftByNurse.get(nurse.id)?.get(date)?.has(shift)) return false;
    if (constraintMaps.forbiddenShiftByMonth.get(nurse.id)?.get(yearMonth)?.has(shift)) return false;
    if (violatesDayShiftTransition(nurse.id, date, shift)) return false;
    if (computeMaxConsecutiveWork(nurse.id, date, shift) > rules.maxConsecutiveWorkDays) return false;
    if (computeSameShiftRun(nurse.id, date, shift) > rules.maxConsecutiveWorkDays - 1) return false;
    return true;
  }

  function chooseReliefCandidate(date: string, shift: "D" | "E", nurseIdToRelieve: number) {
    const nurseToRelieve = nurseById.get(nurseIdToRelieve);
    if (!nurseToRelieve) return null;

    const candidates = nurses
      .filter((nurse) => nurse.id !== nurseIdToRelieve)
      .filter((nurse) => canCoverReliefShift(nurse, date, shift))
      .filter((nurse) => wouldMaintainShiftMix(date, shift, nurseIdToRelieve, nurse.id));

    if (candidates.length === 0) return null;

    return [...candidates].sort((left, right) => {
      const leftWork = days.filter((day) => getScheduledShift(left.id, day) !== "OFF").length;
      const rightWork = days.filter((day) => getScheduledShift(right.id, day) !== "OFF").length;
      if (leftWork !== rightWork) return leftWork - rightWork;

      const leftSameShift = computeSameShiftRun(left.id, date, shift);
      const rightSameShift = computeSameShiftRun(right.id, date, shift);
      if (leftSameShift !== rightSameShift) return leftSameShift - rightSameShift;

      if ((left.experienceLevel === "new") !== (right.experienceLevel === "new")) {
        return left.experienceLevel === "new" ? 1 : -1;
      }

      return left.id - right.id;
    })[0] ?? null;
  }

  function tryReliefSwap(nurseId: number, date: string, shift: "D" | "E") {
    if (isHardLockedDate(nurseId, date)) return false;
    const candidate = chooseReliefCandidate(date, shift, nurseId);
    if (!candidate) return false;

    setScheduledShift(candidate.id, date, shift);
    setScheduledShift(nurseId, date, "OFF");
    return true;
  }

  function chooseDayEveningSwapCandidate(nurseId: number, date: string, shift: "D" | "E") {
    const nurse = nurseById.get(nurseId);
    if (!nurse) return null;

    const oppositeShift: "D" | "E" = shift === "D" ? "E" : "D";
    const currentRun = computeSameShiftRun(nurseId, date, shift);
    const targetRun = computeSameShiftRun(nurseId, date, oppositeShift);

    const candidates = nurses
      .filter((candidate) => candidate.id !== nurseId)
      .filter((candidate) => getScheduledShift(candidate.id, date) === oppositeShift)
      .filter((candidate) => canSwapIntoShift(candidate, date, shift))
      .filter(() => canSwapIntoShift(nurse, date, oppositeShift))
      .filter((candidate) => wouldMaintainSwapShiftMix(date, nurseId, shift, candidate.id, oppositeShift));

    if (candidates.length === 0) return null;

    let bestCandidate: Nurse | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const candidateCurrentRun = computeSameShiftRun(candidate.id, date, oppositeShift);
      const candidateTargetRun = computeSameShiftRun(candidate.id, date, shift);
      const improvement =
        (currentRun - targetRun) +
        (candidateCurrentRun - candidateTargetRun);

      if (improvement <= 0) continue;

      const score =
        improvement * 100 -
        targetRun * 18 -
        candidateTargetRun * 14 -
        days.filter((day) => getScheduledShift(candidate.id, day) !== "OFF").length;

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    return bestCandidate;
  }

  function tryDayEveningSwap(nurseId: number, date: string, shift: "D" | "E") {
    if (isHardLockedDate(nurseId, date)) return false;

    const candidate = chooseDayEveningSwapCandidate(nurseId, date, shift);
    if (!candidate) return false;

    const oppositeShift: "D" | "E" = shift === "D" ? "E" : "D";
    setScheduledShift(candidate.id, date, shift);
    setScheduledShift(nurseId, date, oppositeShift);
    return true;
  }

  function chooseSpecificShiftSwapCandidate(
    nurseId: number,
    date: string,
    currentShift: "D" | "E",
    targetShift: "D" | "E",
    excludedIds: number[] = []
  ) {
    const nurse = nurseById.get(nurseId);
    if (!nurse) return null;
    if (getScheduledShift(nurseId, date) !== currentShift) return null;
    if (isHardLockedDate(nurseId, date)) return null;
    if (!canSwapIntoShift(nurse, date, targetShift)) return null;

    const excluded = new Set(excludedIds.concat(nurseId));
    const candidates = nurses
      .filter((candidate) => !excluded.has(candidate.id))
      .filter((candidate) => getScheduledShift(candidate.id, date) === targetShift)
      .filter((candidate) => canSwapIntoShift(candidate, date, currentShift))
      .filter((candidate) =>
        wouldMaintainSwapShiftMix(date, nurseId, currentShift, candidate.id, targetShift)
      );

    if (candidates.length === 0) return null;

    return [...candidates].sort((left, right) => {
      const leftTargetRun = computeSameShiftRun(left.id, date, currentShift);
      const rightTargetRun = computeSameShiftRun(right.id, date, currentShift);
      if (leftTargetRun !== rightTargetRun) return leftTargetRun - rightTargetRun;

      const leftCurrentRun = computeSameShiftRun(left.id, date, targetShift);
      const rightCurrentRun = computeSameShiftRun(right.id, date, targetShift);
      if (leftCurrentRun !== rightCurrentRun) return rightCurrentRun - leftCurrentRun;

      const leftWork = days.filter((day) => getScheduledShift(left.id, day) !== "OFF").length;
      const rightWork = days.filter((day) => getScheduledShift(right.id, day) !== "OFF").length;
      if (leftWork !== rightWork) return leftWork - rightWork;

      return left.id - right.id;
    })[0] ?? null;
  }

  function trySpecificShiftSwap(
    nurseId: number,
    date: string,
    currentShift: "D" | "E",
    targetShift: "D" | "E",
    excludedIds: number[] = []
  ) {
    const candidate = chooseSpecificShiftSwapCandidate(
      nurseId,
      date,
      currentShift,
      targetShift,
      excludedIds
    );
    if (!candidate) return false;

    setScheduledShift(candidate.id, date, currentShift);
    setScheduledShift(nurseId, date, targetShift);
    return true;
  }

  function chooseTargetedEveningBreakCandidate(nurseId: number, date: string) {
    const nurse = nurseById.get(nurseId);
    if (!nurse) return null;
    if (isHardLockedDate(nurseId, date)) return null;
    if (!nurse.allowedShifts.includes("D")) return null;
    if (violatesDayShiftTransition(nurse.id, date, "D")) return null;
    if (computeSameShiftRun(nurse.id, date, "D") > 4) return null;

    const candidates = nurses
      .filter((candidate) => candidate.id !== nurseId)
      .filter((candidate) => getScheduledShift(candidate.id, date) === "D")
      .filter((candidate) => !isHardLockedDate(candidate.id, date))
      .filter((candidate) => candidate.allowedShifts.includes("E"))
      .filter((candidate) => !violatesDayShiftTransition(candidate.id, date, "E"))
      .filter((candidate) => computeSameShiftRun(candidate.id, date, "E") <= 4)
      .filter((candidate) => wouldMaintainSwapShiftMix(date, nurseId, "E", candidate.id, "D"));

    if (candidates.length === 0) return null;

    return [...candidates].sort((left, right) => {
      const leftEveningRun = computeSameShiftRun(left.id, date, "E");
      const rightEveningRun = computeSameShiftRun(right.id, date, "E");
      if (leftEveningRun !== rightEveningRun) return leftEveningRun - rightEveningRun;

      const leftWork = days.filter((day) => getScheduledShift(left.id, day) !== "OFF").length;
      const rightWork = days.filter((day) => getScheduledShift(right.id, day) !== "OFF").length;
      if (leftWork !== rightWork) return leftWork - rightWork;

      return left.id - right.id;
    })[0] ?? null;
  }

  function wouldMaintainShiftMixWithChanges(
    date: string,
    changes: Map<number, "D" | "E" | "OFF">
  ) {
    for (const shift of ["D", "E"] as const) {
      let currentTotal = 0;
      let currentExperienced = 0;
      let currentNewCount = 0;
      let nextTotal = 0;
      let nextExperienced = 0;
      let nextNewCount = 0;

      for (const nurse of nurses) {
        const currentShift = getScheduledShift(nurse.id, date);
        const nextShift = changes.get(nurse.id) ?? currentShift;

        if (currentShift === shift) {
          currentTotal += 1;
          if (nurse.experienceLevel === "new") {
            currentNewCount += 1;
          } else {
            currentExperienced += 1;
          }
        }

        if (nextShift === shift) {
          nextTotal += 1;
          if (nurse.experienceLevel === "new") {
            nextNewCount += 1;
          } else {
            nextExperienced += 1;
          }
        }
      }

      const required = requirementByKey.get(`${date}:${shift}`) ?? 0;
      const currentRequiredExperienced = Math.min(currentTotal, rules.minExperiencedPerShift);
      const targetRequiredExperienced = currentTotal >= required
        ? Math.min(required, rules.minExperiencedPerShift)
        : currentRequiredExperienced;

      if (nextTotal < currentTotal) return false;
      if (nextExperienced < targetRequiredExperienced) return false;

      const currentNewRatio = currentTotal > 0 ? currentNewCount / currentTotal : 0;
      const nextNewRatio = nextTotal > 0 ? nextNewCount / nextTotal : 0;
      const allowedNewRatio =
        currentTotal >= required
          ? rules.maxNewNurseRatioPerShift
          : Math.max(currentNewRatio, rules.maxNewNurseRatioPerShift);

      if (nextNewRatio > allowedNewRatio) return false;
    }

    return true;
  }

  function canAssignDuringRotation(
    nurseId: number,
    date: string,
    nextShift: "D" | "E" | "OFF"
  ) {
    const currentShift = getScheduledShift(nurseId, date);
    if (currentShift === nextShift) return true;
    if (lockedAssignments.has(`${nurseId}:${date}`)) return false;

    const nurse = nurseById.get(nurseId);
    if (!nurse) return false;

    if (nextShift === "OFF") {
      return currentShift !== "N";
    }

    if (currentShift === "OFF") {
      return canCoverReliefShift(nurse, date, nextShift);
    }

    return canSwapIntoShift(nurse, date, nextShift);
  }

  function chooseTargetedEveningRotation(nurseId: number, date: string) {
    const nurse = nurseById.get(nurseId);
    if (!nurse) return null;
    if (getScheduledShift(nurseId, date) !== "E") return null;
    if (isHardLockedDate(nurseId, date)) return null;

    const dayNurses = nurses.filter((candidate) => {
      return (
        candidate.id !== nurseId &&
        getScheduledShift(candidate.id, date) === "D" &&
        !isHardLockedDate(candidate.id, date)
      );
    });

    const offNurses = nurses.filter((candidate) => {
      return (
        candidate.id !== nurseId &&
        getScheduledShift(candidate.id, date) === "OFF" &&
        !isHardLockedDate(candidate.id, date)
      );
    });

    let bestPlan:
      | {
          score: number;
          assignments: Array<{ nurseId: number; shift: "D" | "E" | "OFF" }>;
        }
      | null = null;

    for (const dayNurse of dayNurses) {
      for (const offNurse of offNurses) {
        if (dayNurse.id === offNurse.id) continue;

        const options: Array<Array<{ nurseId: number; shift: "D" | "E" | "OFF" }>> = [
          [
            { nurseId, shift: "D" },
            { nurseId: dayNurse.id, shift: "OFF" },
            { nurseId: offNurse.id, shift: "E" },
          ],
          [
            { nurseId, shift: "OFF" },
            { nurseId: dayNurse.id, shift: "E" },
            { nurseId: offNurse.id, shift: "D" },
          ],
        ];

        for (const assignments of options) {
          const valid = assignments.every((assignment) =>
            canAssignDuringRotation(assignment.nurseId, date, assignment.shift)
          );
          if (!valid) continue;

          const changeMap = new Map<number, "D" | "E" | "OFF">();
          for (const assignment of assignments) {
            changeMap.set(assignment.nurseId, assignment.shift);
          }

          if (!wouldMaintainShiftMixWithChanges(date, changeMap)) continue;

          const targetShift = changeMap.get(nurseId)!;
          const score =
            (targetShift === "OFF" ? -16 : 0) +
            computeSameShiftRun(nurseId, date, targetShift === "D" ? "D" : "OFF") * 6 +
            days.filter((day) => getScheduledShift(offNurse.id, day) !== "OFF").length;

          if (!bestPlan || score < bestPlan.score) {
            bestPlan = { score, assignments };
          }
        }
      }
    }

    return bestPlan;
  }

  function tryTargetedEveningRotation(nurseId: number, date: string) {
    const plan = chooseTargetedEveningRotation(nurseId, date);
    if (!plan) return false;

    for (const assignment of plan.assignments) {
      setScheduledShift(assignment.nurseId, date, assignment.shift);
    }

    return true;
  }

  function canPromotePairMateIntoShift(
    offNurseId: number,
    date: string,
    shift: "D" | "E",
    protectedNurseId: number
  ) {
    const offNurse = nurseById.get(offNurseId);
    if (!offNurse) return null;
    if (!canCoverReliefShift(offNurse, date, shift)) return null;

    const candidates = nurses
      .filter((candidate) => candidate.id !== protectedNurseId && candidate.id !== offNurseId)
      .filter((candidate) => getScheduledShift(candidate.id, date) === shift)
      .filter((candidate) => !isHardLockedDate(candidate.id, date))
      .filter((candidate) => wouldMaintainShiftMix(date, shift, candidate.id, offNurseId));

    if (candidates.length === 0) return null;

    return [...candidates].sort((left, right) => {
      const leftWork = days.filter((day) => getScheduledShift(left.id, day) !== "OFF").length;
      const rightWork = days.filter((day) => getScheduledShift(right.id, day) !== "OFF").length;
      if (leftWork !== rightWork) return leftWork - rightWork;

      const leftRun = computeSameShiftRun(left.id, date, shift);
      const rightRun = computeSameShiftRun(right.id, date, shift);
      if (leftRun !== rightRun) return rightRun - leftRun;

      return left.id - right.id;
    })[0] ?? null;
  }

  function tryPromotePairMateIntoShift(
    offNurseId: number,
    date: string,
    shift: "D" | "E",
    protectedNurseId: number
  ) {
    const relievedNurse = canPromotePairMateIntoShift(offNurseId, date, shift, protectedNurseId);
    if (!relievedNurse) return false;

    setScheduledShift(offNurseId, date, shift);
    setScheduledShift(relievedNurse.id, date, "OFF");
    return true;
  }

  function tryTargetedEveningBreak(nurseId: number, date: string) {
    const candidate = chooseTargetedEveningBreakCandidate(nurseId, date);
    if (!candidate) return false;

    setScheduledShift(candidate.id, date, "E");
    setScheduledShift(nurseId, date, "D");
    return true;
  }

  function buildCenteredWindowDates(runDates: string[]) {
    return [...runDates]
      .map((value, index) => ({
        value,
        distance: Math.abs(index - Math.floor(runDates.length / 2)),
      }))
      .sort((left, right) => left.distance - right.distance)
      .map((item) => item.value);
  }

  function tryEveningWindowReplan(nurseId: number, runDates: string[]) {
    const centeredDates = buildCenteredWindowDates(runDates);

    for (const targetDate of centeredDates) {
      if (tryTargetedEveningRotation(nurseId, targetDate)) {
        return true;
      }
    }

    for (const targetDate of centeredDates) {
      if (tryTargetedEveningBreak(nurseId, targetDate)) {
        return true;
      }
    }

    for (const targetDate of centeredDates) {
      if (tryReliefSwap(nurseId, targetDate, "E")) {
        return true;
      }
    }

    for (const targetDate of centeredDates) {
      if (tryDayEveningSwap(nurseId, targetDate, "E")) {
        return true;
      }
    }

    return false;
  }

  function rebalanceConsecutiveWork() {
    for (const nurse of nurses) {
      let runDates: string[] = [];

      for (const date of days) {
        const shift = getScheduledShift(nurse.id, date);
        if (shift === "OFF") {
          runDates = [];
          continue;
        }

        runDates.push(date);

        if (runDates.length > rules.maxConsecutiveWorkDays) {
          const candidateDates = [...runDates]
            .map((value, index) => ({ value, distance: Math.abs(index - Math.floor(runDates.length / 2)) }))
            .sort((left, right) => left.distance - right.distance)
            .map((item) => item.value);

          let resolved = false;
          for (const targetDate of candidateDates) {
            const targetShift = getScheduledShift(nurse.id, targetDate);
            if (targetShift !== "D" && targetShift !== "E") continue;

            if (
              tryDayEveningSwap(nurse.id, targetDate, targetShift) ||
              tryReliefSwap(nurse.id, targetDate, targetShift)
            ) {
              runDates = runDates.filter((value) => value > targetDate);
              resolved = true;
              break;
            }
          }

          if (!resolved) {
            runDates = [];
          }
        }
      }
    }
  }

  function rebalanceLongDayEveningRuns() {
    for (const nurse of nurses) {
      let currentShift: "D" | "E" | "" = "";
      let runDates: string[] = [];

      for (const date of days) {
        const shift = getScheduledShift(nurse.id, date);
        if (shift !== "D" && shift !== "E") {
          currentShift = "";
          runDates = [];
          continue;
        }

        if (shift === currentShift) {
          runDates.push(date);
        } else {
          currentShift = shift;
          runDates = [date];
        }

        if (runDates.length >= 5) {
          const targetDate = runDates[Math.floor(runDates.length / 2)];
          if (tryDayEveningSwap(nurse.id, targetDate, shift) || tryReliefSwap(nurse.id, targetDate, shift)) {
            runDates = runDates.filter((value) => value > targetDate);
          }
        }
      }
    }
  }

  function rebalanceLongEveningRuns() {
    for (const nurse of nurses) {
      let runDates: string[] = [];

      for (const date of days) {
        const shift = getScheduledShift(nurse.id, date);
        if (shift !== "E") {
          runDates = [];
          continue;
        }

        runDates.push(date);

        if (runDates.length >= 5) {
          if (tryEveningWindowReplan(nurse.id, runDates)) {
            runDates = [];
            continue;
          }

          let resolved = false;
          const centeredDates = buildCenteredWindowDates(runDates);

          for (const targetDate of centeredDates) {
            if (tryReliefSwap(nurse.id, targetDate, "E")) {
              runDates = runDates.filter((value) => value > targetDate);
              resolved = true;
              break;
            }
          }

          if (!resolved) {
            const edgeDates = [runDates[0], runDates[runDates.length - 1]].filter(Boolean);
            for (const targetDate of edgeDates) {
              if (tryDayEveningSwap(nurse.id, targetDate, "E")) {
                runDates = runDates.filter((value) => value > targetDate);
                resolved = true;
                break;
              }
            }
          }

          if (!resolved) {
            runDates = [];
          }
        }
      }
    }
  }

  function tryAlignSameShiftPairOnDate(
    preceptorId: number,
    precepteeId: number,
    date: string
  ) {
    const preceptorShift = getScheduledShift(preceptorId, date);
    const precepteeShift = getScheduledShift(precepteeId, date);

    if (preceptorShift === precepteeShift) return true;

    if (
      (preceptorShift === "D" && precepteeShift === "E") ||
      (preceptorShift === "E" && precepteeShift === "D")
    ) {
      if (
        preceptorShift === "D" &&
        trySpecificShiftSwap(preceptorId, date, "D", "E", [precepteeId])
      ) {
        return getScheduledShift(preceptorId, date) === getScheduledShift(precepteeId, date);
      }

      if (
        preceptorShift === "E" &&
        trySpecificShiftSwap(preceptorId, date, "E", "D", [precepteeId])
      ) {
        return getScheduledShift(preceptorId, date) === getScheduledShift(precepteeId, date);
      }

      if (
        precepteeShift === "D" &&
        trySpecificShiftSwap(precepteeId, date, "D", "E", [preceptorId])
      ) {
        return getScheduledShift(preceptorId, date) === getScheduledShift(precepteeId, date);
      }

      if (
        precepteeShift === "E" &&
        trySpecificShiftSwap(precepteeId, date, "E", "D", [preceptorId])
      ) {
        return getScheduledShift(preceptorId, date) === getScheduledShift(precepteeId, date);
      }
    }

    if (preceptorShift === "OFF" && (precepteeShift === "D" || precepteeShift === "E")) {
      return tryPromotePairMateIntoShift(preceptorId, date, precepteeShift, precepteeId);
    }

    if (precepteeShift === "OFF" && (preceptorShift === "D" || preceptorShift === "E")) {
      return tryPromotePairMateIntoShift(precepteeId, date, preceptorShift, preceptorId);
    }

    return false;
  }

  function rebalanceSameShiftPairs() {
    for (const pairRule of pairRules) {
      if (!pairRule.isActive || pairRule.ruleType !== "same_shift") continue;

      for (const date of days) {
        if (getScheduledShift(pairRule.preceptorId, date) === getScheduledShift(pairRule.precepteeId, date)) {
          continue;
        }

        tryAlignSameShiftPairOnDate(pairRule.preceptorId, pairRule.precepteeId, date);
      }
    }
  }

  function fixDayAfterEveningTransitionsTargeted() {
    for (const nurse of nurses) {
      for (let index = 1; index < days.length; index += 1) {
        const previousDate = days[index - 1];
        const date = days[index];

        if (getScheduledShift(nurse.id, previousDate) !== "E") continue;
        if (getScheduledShift(nurse.id, date) !== "D") continue;

        if (trySpecificShiftSwap(nurse.id, date, "D", "E")) {
          continue;
        }

        if (tryReliefSwap(nurse.id, date, "D")) {
          continue;
        }
      }
    }
  }

  function countLocalSameShiftPairMismatches() {
    let count = 0;

    for (const pairRule of pairRules) {
      if (!pairRule.isActive || pairRule.ruleType !== "same_shift") continue;

      for (const date of days) {
        if (getScheduledShift(pairRule.preceptorId, date) !== getScheduledShift(pairRule.precepteeId, date)) {
          count += 1;
        }
      }
    }

    return count;
  }

  function countLocalDayAfterEveningViolations() {
    let count = 0;

    if (rules.allowEToD) return 0;

    for (const nurse of nurses) {
      for (let index = 1; index < days.length; index += 1) {
        const previousDate = days[index - 1];
        const date = days[index];

        if (getScheduledShift(nurse.id, previousDate) === "E" && getScheduledShift(nurse.id, date) === "D") {
          count += 1;
        }
      }
    }

    return count;
  }

  function stabilizeTargetedDayEveningIssues() {
    let previousSignature = "";

    for (let iteration = 0; iteration < 4; iteration += 1) {
      const beforeSignature = [
        countLocalSameShiftPairMismatches(),
        countLocalDayAfterEveningViolations(),
      ].join(":");

      rebalanceSameShiftPairs();
      fixDayAfterEveningTransitionsTargeted();
      fixDayAfterEveningTransitions();
      rebalanceConsecutiveWork();
      rebalanceLongEveningRuns();
      rebalanceLongDayEveningRuns();

      const afterSignature = [
        countLocalSameShiftPairMismatches(),
        countLocalDayAfterEveningViolations(),
      ].join(":");

      if (afterSignature === beforeSignature || afterSignature === previousSignature) {
        break;
      }

      previousSignature = afterSignature;
    }
  }

  function fixDayAfterEveningTransitions() {
    let changed = true;
    let guard = 0;

    while (changed && guard < 8) {
      changed = false;
      guard += 1;

      for (const nurse of nurses) {
        for (let index = 1; index < days.length; index += 1) {
          const previousDate = days[index - 1];
          const date = days[index];
          const previousShift = getScheduledShift(nurse.id, previousDate);
          const shift = getScheduledShift(nurse.id, date);

          if (previousShift !== "E" || shift !== "D") continue;

          if (tryDayEveningSwap(nurse.id, date, "D") || tryReliefSwap(nurse.id, date, "D")) {
            changed = true;
            break;
          }

          if (tryDayEveningSwap(nurse.id, previousDate, "E") || tryReliefSwap(nurse.id, previousDate, "E")) {
            changed = true;
            break;
          }
        }

        if (changed) break;
      }
    }
  }

  fixDayAfterEveningTransitions();
  rebalanceConsecutiveWork();
  rebalanceLongEveningRuns();
  rebalanceLongDayEveningRuns();
  stabilizeTargetedDayEveningIssues();

  return entries;
}
