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
  forcedOffRemaining: number;
  nightCount: number;
  assignedWorkDays: number;
  weekendAssignments: number;
  holidayAssignments: number;
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

  const requirementByKey = new Map<string, number>();
  const holidayByDate = new Map<string, boolean>();
  for (const requirement of requirements) {
    requirementByKey.set(
      `${requirement.date}:${requirement.shiftType}`,
      requirement.requiredCount
    );
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
      forcedOffRemaining: 0,
      nightCount: 0,
      assignedWorkDays: 0,
      weekendAssignments: 0,
      holidayAssignments: 0,
    });
  }

  function isWeekend(date: string) {
    const day = new Date(`${date}T00:00:00`).getDay();
    return day === 0 || day === 6;
  }

  function isHoliday(date: string) {
    return holidayByDate.get(date) ?? isWeekend(date);
  }

  function canAssignBase(nurse: Nurse, shift: string, date: string): boolean {
    const state = nurseState.get(nurse.id)!;

    if (fixedOffByNurse.get(nurse.id)?.has(date)) return false;
    if (forbiddenShiftByNurse.get(nurse.id)?.get(date)?.has(shift)) return false;
    if (forbiddenShiftByMonth.get(nurse.id)?.get(yearMonth)?.has(shift)) return false;
    if (!nurse.allowedShifts.includes(shift)) return false;
    if (state.forcedOffRemaining > 0) return false;

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

  function getGroupForNurse(nurseId: number): number[] {
    return sameShiftGroups.get(nurseId) ?? [nurseId];
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

    const projectedNewCount = projectedNurses.filter(
      (nurse) => nurse.experienceLevel === "new"
    ).length;
    const projectedExperiencedCount = projectedNurses.length - projectedNewCount;
    const projectedRatio =
      projectedNurses.length > 0 ? projectedNewCount / projectedNurses.length : 0;

    let score = 0;

    for (const groupNurseId of groupIds) {
      const nurse = nurseById.get(groupNurseId)!;
      const state = nurseState.get(groupNurseId)!;
      const prefersOff = preferredOffByNurse.get(groupNurseId)?.has(date) ?? false;

      score += state.assignedWorkDays * (priorityMode === "coverage" ? 6 : 10);
      score += state.consecutiveWork * 3;
      score += shift === "N" ? state.nightCount * 8 : state.nightCount * 2;

      if (rules.weekendFairness && weekend) {
        score += state.weekendAssignments * (priorityMode === "fairness" ? 14 : 8);
      }

      if (rules.holidayFairness && holiday) {
        score += state.holidayAssignments * (priorityMode === "fairness" ? 16 : 10);
      }

      if (prefersOff) {
        score += priorityMode === "coverage" ? 40 : 85;
      }

      if (shift === "N" && nurse.isNightKeep) score -= 35;
      if (shift !== "N" && nurse.isNightKeep) score += 45;

      if (nurse.experienceLevel !== "new" && projectedExperiencedCount < rules.minExperiencedPerShift) {
        score -= 24;
      }

      if (priorityMode === "new_nurse_protection" && nurse.experienceLevel === "new") {
        score += 24;
      }
    }

    if (projectedRatio > rules.maxNewNurseRatioPerShift) {
      score += priorityMode === "new_nurse_protection" ? 220 : 140;
    }

    if (shift === "N" && projectedNewCount > 0) {
      score += priorityMode === "new_nurse_protection" ? 160 : 90;
    }

    if (projectedExperiencedCount < rules.minExperiencedPerShift && projectedIds.length >= needed) {
      score += 180;
    }

    return score;
  }

  function canAssignGroup(
    nurseId: number,
    shift: string,
    date: string,
    assignedToday: Map<number, string>,
    currentFilled: number,
    needed: number
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

    if (currentFilled + unassignedIds.length > needed) return null;
    return unassignedIds;
  }

  function sortCandidates(candidates: Nurse[], shift: string): Nurse[] {
    return [...candidates].sort((left, right) => {
      const leftState = nurseState.get(left.id)!;
      const rightState = nurseState.get(right.id)!;

      if (shift === "N" && left.isNightKeep !== right.isNightKeep) {
        return left.isNightKeep ? -1 : 1;
      }

      if (shift !== "N" && left.isNightKeep !== right.isNightKeep) {
        return left.isNightKeep ? 1 : -1;
      }

      if (shift === "N" && leftState.nightCount !== rightState.nightCount) {
        return leftState.nightCount - rightState.nightCount;
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

  for (const date of days) {
    const assignedToday = new Map<number, string>();
    const shiftAssigned: Record<string, number> = { D: 0, E: 0, N: 0 };
    const shiftNeeded: Record<string, number> = {
      D: requirementByKey.get(`${date}:D`) ?? 3,
      E: requirementByKey.get(`${date}:E`) ?? 3,
      N: requirementByKey.get(`${date}:N`) ?? 2,
    };

    for (const shift of ["D", "E", "N"]) {
      const needed = shiftNeeded[shift];
      if (needed <= 0) continue;

      const eligible = sortCandidates(
        nurses.filter((nurse) => {
          if (assignedToday.has(nurse.id)) return false;
          return canAssignBase(nurse, shift, date);
        }),
        shift
      );

      let filled = shiftAssigned[shift];

      while (filled < needed) {
        let selectedGroupIds: number[] | null = null;
        let selectedScore = Number.POSITIVE_INFINITY;

        for (const nurse of eligible) {
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

          const score = scoreCandidateGroup(assignableIds, shift, date, assignedToday, needed);
          if (score < selectedScore) {
            selectedScore = score;
            selectedGroupIds = assignableIds;
          }
        }

        if (!selectedGroupIds) {
          break;
        }

        for (const assignableId of selectedGroupIds) {
          assignedToday.set(assignableId, shift);
        }

        filled += selectedGroupIds.length;
      }

      shiftAssigned[shift] = filled;
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

        if (state.lastShift === "N" && state.consecutiveNight > 0) {
          forcedOffRemaining = Math.max(
            forcedOffRemaining,
            Math.max(0, rules.offDaysAfterNightShifts - 1)
          );
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
        state.consecutiveWork = 0;
        state.consecutiveNight = 0;
      } else {
        state.forcedOffRemaining = 0;
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
      }

      state.lastShift = shift;
    }
  }

  return entries;
}
