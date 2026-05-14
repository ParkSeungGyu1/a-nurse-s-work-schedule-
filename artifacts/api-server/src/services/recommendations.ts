import type {
  DailyRequirement,
  Nurse,
  NurseConstraint,
  ScheduleEntry,
  ValidationResult,
  WardRule,
} from "@workspace/db";

type ConstraintType =
  | "fixed_off"
  | "preferred_off"
  | "forbidden_shift"
  | "education"
  | "annual_leave";

export interface RecommendationCandidate {
  nurseId: number;
  nurseName: string;
  experienceLevel: string;
  tier: "strict" | "fallback";
  currentShift: string;
  score: number;
  reasons: string[];
  cautions: string[];
}

export interface RecommendationItem {
  id: string;
  type: "understaffed_shift" | "rule_conflict";
  severity: "critical" | "warning" | "info";
  title: string;
  summary: string;
  actionText: string;
  date?: string;
  shiftType?: string;
  shortageCount?: number;
  strictCandidateCount: number;
  fallbackCandidateCount: number;
  candidates: RecommendationCandidate[];
}

export interface RecommendationSummary {
  totalIssues: number;
  actionableIssues: number;
  unresolvedCriticalCount: number;
  items: RecommendationItem[];
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function buildEntriesByNurseDate(entries: ScheduleEntry[]) {
  const map = new Map<number, Map<string, ScheduleEntry>>();

  for (const entry of entries) {
    if (!map.has(entry.nurseId)) {
      map.set(entry.nurseId, new Map());
    }

    map.get(entry.nurseId)!.set(entry.date, entry);
  }

  return map;
}

function buildConstraintMaps(constraints: NurseConstraint[]) {
  const hardOffByNurse = new Map<number, Set<string>>();
  const preferredOffByNurse = new Map<number, Set<string>>();
  const forbiddenByDate = new Map<number, Map<string, Set<string>>>();
  const forbiddenByMonth = new Map<number, Map<string, Set<string>>>();

  for (const constraint of constraints) {
    const type = constraint.constraintType as ConstraintType;

    if (
      (type === "fixed_off" || type === "annual_leave" || type === "education") &&
      constraint.date
    ) {
      if (!hardOffByNurse.has(constraint.nurseId)) {
        hardOffByNurse.set(constraint.nurseId, new Set());
      }

      hardOffByNurse.get(constraint.nurseId)!.add(constraint.date);
    }

    if (type === "preferred_off" && constraint.date) {
      if (!preferredOffByNurse.has(constraint.nurseId)) {
        preferredOffByNurse.set(constraint.nurseId, new Set());
      }

      preferredOffByNurse.get(constraint.nurseId)!.add(constraint.date);
    }

    if (type === "forbidden_shift" && constraint.date && constraint.shiftType) {
      if (!forbiddenByDate.has(constraint.nurseId)) {
        forbiddenByDate.set(constraint.nurseId, new Map());
      }

      const byDate = forbiddenByDate.get(constraint.nurseId)!;
      if (!byDate.has(constraint.date)) byDate.set(constraint.date, new Set());
      byDate.get(constraint.date)!.add(constraint.shiftType);
    }

    if (type === "forbidden_shift" && constraint.yearMonth && constraint.shiftType) {
      if (!forbiddenByMonth.has(constraint.nurseId)) {
        forbiddenByMonth.set(constraint.nurseId, new Map());
      }

      const byMonth = forbiddenByMonth.get(constraint.nurseId)!;
      if (!byMonth.has(constraint.yearMonth)) byMonth.set(constraint.yearMonth, new Set());
      byMonth.get(constraint.yearMonth)!.add(constraint.shiftType);
    }
  }

  return { hardOffByNurse, preferredOffByNurse, forbiddenByDate, forbiddenByMonth };
}

function countMonthShift(entriesByDate: Map<string, ScheduleEntry>, yearMonth: string, shiftType: string) {
  let count = 0;

  for (const [date, entry] of entriesByDate.entries()) {
    if (date.startsWith(yearMonth) && entry.shiftType === shiftType) {
      count += 1;
    }
  }

  return count;
}

function countAssignedWorkDays(entriesByDate: Map<string, ScheduleEntry>, yearMonth: string) {
  let count = 0;

  for (const [date, entry] of entriesByDate.entries()) {
    if (date.startsWith(yearMonth) && entry.shiftType !== "OFF") {
      count += 1;
    }
  }

  return count;
}

function countWeekendAssignments(entriesByDate: Map<string, ScheduleEntry>, yearMonth: string) {
  let count = 0;

  for (const [date, entry] of entriesByDate.entries()) {
    if (date.startsWith(yearMonth) && isWeekend(date) && entry.shiftType !== "OFF") {
      count += 1;
    }
  }

  return count;
}

function countContinuousShift(
  entriesByDate: Map<string, ScheduleEntry>,
  date: string,
  matcher: (shiftType: string) => boolean,
  direction: -1 | 1
) {
  let count = 0;
  let offset = direction;

  while (true) {
    const targetDate = addDays(date, offset);
    const entry = entriesByDate.get(targetDate);
    if (!entry || !matcher(entry.shiftType)) break;

    count += 1;
    offset += direction;
  }

  return count;
}

function checkNightRecovery(
  entriesByDate: Map<string, ScheduleEntry>,
  date: string,
  rules: WardRule
) {
  for (let offset = 1; offset <= rules.offDaysAfterNightShifts; offset += 1) {
    const targetDate = addDays(date, offset);
    const nextEntry = entriesByDate.get(targetDate);
    if (!nextEntry) break;
    if (nextEntry.shiftType !== "OFF") return false;
  }

  return true;
}

function evaluateCandidateForShift(
  nurse: Nurse,
  date: string,
  shiftType: string,
  yearMonth: string,
  rules: WardRule,
  entriesByDate: Map<string, ScheduleEntry>,
  constraintMaps: ReturnType<typeof buildConstraintMaps>
): RecommendationCandidate | null {
  const currentEntry = entriesByDate.get(date);
  const currentShift = currentEntry?.shiftType ?? "OFF";

  if (currentShift !== "OFF") {
    return null;
  }

  if (!nurse.allowedShifts.includes(shiftType)) {
    return null;
  }

  if (constraintMaps.hardOffByNurse.get(nurse.id)?.has(date)) {
    return null;
  }

  if (constraintMaps.forbiddenByDate.get(nurse.id)?.get(date)?.has(shiftType)) {
    return null;
  }

  if (constraintMaps.forbiddenByMonth.get(nurse.id)?.get(yearMonth)?.has(shiftType)) {
    return null;
  }

  const reasons: string[] = ["현재 OFF로 배치 전환이 가능합니다."];
  const cautions: string[] = [];
  let penalty = 0;

  const previousDate = addDays(date, -1);
  const nextDate = addDays(date, 1);
  const previousShift = entriesByDate.get(previousDate)?.shiftType ?? "OFF";
  const nextShift = entriesByDate.get(nextDate)?.shiftType ?? "OFF";
  const assignedWorkDays = countAssignedWorkDays(entriesByDate, yearMonth);
  const nightCount = countMonthShift(entriesByDate, yearMonth, "N");
  const weekendAssignments = countWeekendAssignments(entriesByDate, yearMonth);
  const prefersOff = constraintMaps.preferredOffByNurse.get(nurse.id)?.has(date) ?? false;

  penalty += assignedWorkDays * 4;
  penalty += isWeekend(date) ? weekendAssignments * 3 : 0;

  if (nurse.experienceLevel !== "new") {
    reasons.push("경력 간호사로 대체 적합도가 높습니다.");
    penalty -= 6;
  }

  if (prefersOff) {
    cautions.push("해당 날짜는 희망 OFF로 등록되어 있습니다.");
    penalty += 16;
  }

  if (shiftType === "D" && previousShift === "E") {
    cautions.push("전날 Evening 근무라 Day 추가 시 휴식이 부족합니다.");
    penalty += 90;
  }

  if (shiftType === "E" && nextShift === "D") {
    cautions.push("당일 Evening 추가 시 다음 날 Day와 충돌합니다.");
    penalty += 90;
  }

  const previousWork = countContinuousShift(
    entriesByDate,
    date,
    (candidateShift) => candidateShift !== "OFF",
    -1
  );
  const nextWork = countContinuousShift(
    entriesByDate,
    date,
    (candidateShift) => candidateShift !== "OFF",
    1
  );
  const projectedConsecutiveWork = previousWork + 1 + nextWork;

  if (projectedConsecutiveWork > rules.maxConsecutiveWorkDays) {
    cautions.push(
      `배정 시 연속 근무가 ${projectedConsecutiveWork}일로 늘어납니다.`
    );
    penalty += 80 + (projectedConsecutiveWork - rules.maxConsecutiveWorkDays) * 10;
  }

  if (shiftType === "N") {
    const projectedNightCount = nightCount + 1;
    const nightLimit = nurse.monthlyNightLimit ?? rules.monthlyMaxNightShifts;
    const previousNight = countContinuousShift(
      entriesByDate,
      date,
      (candidateShift) => candidateShift === "N",
      -1
    );
    const nextNight = countContinuousShift(
      entriesByDate,
      date,
      (candidateShift) => candidateShift === "N",
      1
    );
    const projectedConsecutiveNight = previousNight + 1 + nextNight;

    reasons.push(`${projectedNightCount}회차 야간으로 계산됩니다.`);

    if (nurse.isNightKeep) {
      reasons.push("나이트 keep 간호사입니다.");
      penalty -= 18;
    }

    if (projectedNightCount > nightLimit) {
      cautions.push(`야간 횟수가 월 상한 ${nightLimit}회를 초과합니다.`);
      penalty += 85;
    }

    if (projectedConsecutiveNight > rules.maxConsecutiveNightShifts) {
      cautions.push(`연속 야간이 ${projectedConsecutiveNight}일이 됩니다.`);
      penalty += 95;
    }

    if (!checkNightRecovery(entriesByDate, date, rules)) {
      cautions.push(`야간 후 ${rules.offDaysAfterNightShifts}일 휴무 확보가 어렵습니다.`);
      penalty += 88;
    }
  } else {
    reasons.push(`이번 달 총 근무일은 ${assignedWorkDays}일입니다.`);
  }

  const tier = cautions.length === 0 ? "strict" : "fallback";

  return {
    nurseId: nurse.id,
    nurseName: nurse.name,
    experienceLevel: nurse.experienceLevel,
    tier,
    currentShift,
    score: penalty,
    reasons,
    cautions,
  };
}

function buildUnderstaffedRecommendations(
  entries: ScheduleEntry[],
  nurses: Nurse[],
  rules: WardRule,
  requirements: DailyRequirement[],
  constraints: NurseConstraint[],
  validationResults: ValidationResult[]
) {
  const entriesByNurseDate = buildEntriesByNurseDate(entries);
  const constraintMaps = buildConstraintMaps(constraints);
  const nurseMap = new Map(nurses.map((nurse) => [nurse.id, nurse]));
  const byDateShift = new Map<string, number>();
  const items: RecommendationItem[] = [];

  for (const issue of validationResults) {
    if (issue.ruleCode !== "UNDERSTAFFED" || !issue.date || !issue.shiftType) continue;
    byDateShift.set(`${issue.date}:${issue.shiftType}`, 0);
  }

  for (const entry of entries) {
    if (entry.shiftType === "OFF") continue;
    const key = `${entry.date}:${entry.shiftType}`;
    if (!byDateShift.has(key)) continue;
    byDateShift.set(key, (byDateShift.get(key) ?? 0) + 1);
  }

  for (const requirement of requirements) {
    const key = `${requirement.date}:${requirement.shiftType}`;
    if (!byDateShift.has(key)) continue;

    const assignedCount = byDateShift.get(key) ?? 0;
    const shortageCount = Math.max(0, requirement.requiredCount - assignedCount);
    if (shortageCount <= 0) continue;

    const candidates = nurses
      .map((nurse) =>
        evaluateCandidateForShift(
          nurse,
          requirement.date,
          requirement.shiftType,
          requirement.date.slice(0, 7),
          rules,
          entriesByNurseDate.get(nurse.id) ?? new Map<string, ScheduleEntry>(),
          constraintMaps
        )
      )
      .filter((candidate): candidate is RecommendationCandidate => Boolean(candidate))
      .sort((left, right) => left.score - right.score);

    const strictCandidates = candidates.filter((candidate) => candidate.tier === "strict");
    const fallbackCandidates = candidates.filter((candidate) => candidate.tier === "fallback");
    const recommendedCandidates = [...strictCandidates, ...fallbackCandidates].slice(
      0,
      Math.max(3, shortageCount)
    );

    items.push({
      id: `understaffed:${requirement.date}:${requirement.shiftType}`,
      type: "understaffed_shift",
      severity: "critical",
      title: `${requirement.date} ${requirement.shiftType}조 인원 부족`,
      summary: `${assignedCount}/${requirement.requiredCount}명 배정되어 ${shortageCount}명이 부족합니다.`,
      actionText:
        strictCandidates.length >= shortageCount
          ? "엄격 조건 안에서 추가 배치가 가능한 후보가 있습니다."
          : "엄격 조건 후보가 부족해 차선 후보까지 함께 검토해야 합니다.",
      date: requirement.date,
      shiftType: requirement.shiftType,
      shortageCount,
      strictCandidateCount: strictCandidates.length,
      fallbackCandidateCount: fallbackCandidates.length,
      candidates: recommendedCandidates,
    });
  }

  return items;
}

function buildConflictRecommendations(
  validationResults: ValidationResult[],
  nurses: Nurse[]
) {
  const nurseMap = new Map(nurses.map((nurse) => [nurse.id, nurse]));
  const handledRuleCodes = new Set([
    "E_TO_D",
    "OFF_AFTER_NIGHT",
    "OFF_AFTER_CONSECUTIVE_WORK",
    "MAX_CONSECUTIVE_WORK",
    "MAX_CONSECUTIVE_NIGHT",
    "PAIR_RULE_SAME_SHIFT",
    "PAIR_RULE_DIFFERENT_SHIFT",
  ]);

  return validationResults
    .filter((issue) => handledRuleCodes.has(issue.ruleCode))
    .slice(0, 8)
    .map((issue, index) => {
      const nurseName = issue.nurseId ? nurseMap.get(issue.nurseId)?.name : null;
      let actionText = "해당 날짜 전후 근무를 교체하거나 부분 재생성으로 다시 맞춰보세요.";

      if (issue.ruleCode === "E_TO_D") {
        actionText = "전날 Evening 또는 당일 Day 중 하나를 다른 간호사로 바꾸는 것이 좋습니다.";
      } else if (issue.ruleCode === "OFF_AFTER_NIGHT") {
        actionText = "야간 직후 OFF를 확보하도록 같은 날짜 이후 구간을 다시 조정하는 것이 좋습니다.";
      } else if (issue.ruleCode === "PAIR_RULE_SAME_SHIFT") {
        actionText = "프리셉터와 프리셉티를 같은 조로 묶도록 부분 재생성을 권장합니다.";
      }

      return {
        id: `conflict:${issue.ruleCode}:${issue.date ?? index}:${issue.nurseId ?? index}`,
        type: "rule_conflict" as const,
        severity: issue.severity as "critical" | "warning" | "info",
        title: nurseName ? `${nurseName} 근무 규칙 충돌` : "근무 규칙 충돌",
        summary: issue.message,
        actionText,
        date: issue.date ?? undefined,
        shiftType: issue.shiftType ?? undefined,
        strictCandidateCount: 0,
        fallbackCandidateCount: 0,
        candidates: [],
      };
    });
}

export function buildScheduleRecommendations(args: {
  entries: ScheduleEntry[];
  nurses: Nurse[];
  rules: WardRule;
  requirements: DailyRequirement[];
  constraints: NurseConstraint[];
  validationResults: ValidationResult[];
}): RecommendationSummary {
  const understaffedItems = buildUnderstaffedRecommendations(
    args.entries,
    args.nurses,
    args.rules,
    args.requirements,
    args.constraints,
    args.validationResults
  );
  const conflictItems = buildConflictRecommendations(args.validationResults, args.nurses);
  const items = [...understaffedItems, ...conflictItems];

  return {
    totalIssues: args.validationResults.length,
    actionableIssues: items.length,
    unresolvedCriticalCount: args.validationResults.filter(
      (issue) => issue.severity === "critical"
    ).length,
    items,
  };
}
