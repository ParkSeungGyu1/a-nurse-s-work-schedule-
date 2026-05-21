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
  type: "understaffed_shift" | "rule_conflict" | "fairness_warning";
  severity: "critical" | "warning" | "info";
  title: string;
  summary: string;
  actionText: string;
  date?: string;
  shiftType?: string;
  sourceNurseId?: number;
  sourceNurseName?: string;
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

function countMonthShift(
  entriesByDate: Map<string, ScheduleEntry>,
  yearMonth: string,
  shiftType: string
) {
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

  const reasons: string[] = ["현재 OFF라서 추가 배치 검토가 가능합니다."];
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
    reasons.push("경력 간호사라 대체 배치 적합도가 높습니다.");
    penalty -= 6;
  }

  if (prefersOff) {
    cautions.push("해당 날짜가 희망 OFF로 등록되어 있습니다.");
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
    cautions.push(`배정 시 연속 근무가 ${projectedConsecutiveWork}일이 됩니다.`);
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
      penalty -= 26;
    }

    if (nurse.experienceLevel === "new") {
      cautions.push("신규 간호사라 야간 부담 분산을 우선 검토하는 편이 좋습니다.");
      penalty += 18;
    }

    if (isWeekend(date)) {
      cautions.push("주말 야간 배정이라 공정성 부담을 함께 확인해야 합니다.");
      penalty += 8;
    }

    if (previousNight > 0 || nextNight > 0) {
      reasons.push("기존 야간 블록과 이어져 단독 나이트를 줄일 수 있습니다.");
      penalty -= 10;
    } else {
      cautions.push("단독 야간이 될 수 있어 패턴 공정성을 함께 확인하는 편이 좋습니다.");
      penalty += 6;
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
      cautions.push(`야간 후 ${rules.offDaysAfterNightShifts}일 OFF 확보가 어렵습니다.`);
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
    const totalCandidates = strictCandidates.length + fallbackCandidates.length;
    const hasStrictCoverage = strictCandidates.length >= shortageCount;
    const canCoverWithFallback = totalCandidates >= shortageCount && totalCandidates > 0;

    items.push({
      id: `understaffed:${requirement.date}:${requirement.shiftType}`,
      type: "understaffed_shift",
      severity: "critical",
      title: `${requirement.date} ${requirement.shiftType}조 인원 부족`,
      summary: hasStrictCoverage
        ? `${assignedCount}/${requirement.requiredCount}명 배정되어 ${shortageCount}명이 부족합니다. 규칙 안에서 바로 검토할 수 있는 후보가 있습니다.`
        : canCoverWithFallback
          ? `${assignedCount}/${requirement.requiredCount}명 배정되어 ${shortageCount}명이 부족합니다. 차선 배정을 감수해야 충원이 가능합니다.`
          : `${assignedCount}/${requirement.requiredCount}명 배정되어 ${shortageCount}명이 부족합니다. 현재 인력만으로는 모두 채우기 어렵습니다.`,
      actionText: hasStrictCoverage
        ? "현재 규칙 안에서 바로 넣을 수 있는 후보부터 검토하면 됩니다."
        : canCoverWithFallback
          ? "현재 규칙만으로는 부족합니다. 차선 후보를 수동으로 선택해 어떤 규칙을 감수할지 결정해야 합니다."
          : "현재 병동 내부 인력만으로는 충원이 어렵습니다. 추가 인력 요청이나 다른 조 교체 검토가 필요합니다.",
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

function buildNightLoadMap(entries: ScheduleEntry[]) {
  const map = new Map<number, number>();

  for (const entry of entries) {
    if (entry.shiftType !== "N") continue;
    map.set(entry.nurseId, (map.get(entry.nurseId) ?? 0) + 1);
  }

  return map;
}

function findReplacementOptionsForShift(args: {
  date: string;
  shiftType: string;
  entries: ScheduleEntry[];
  nurses: Nurse[];
  rules: WardRule;
  constraints: NurseConstraint[];
  excludeNurseIds?: number[];
}) {
  const entriesByNurseDate = buildEntriesByNurseDate(args.entries);
  const constraintMaps = buildConstraintMaps(args.constraints);
  const excluded = new Set(args.excludeNurseIds ?? []);
  const yearMonth = args.date.slice(0, 7);

  const candidates = args.nurses
    .filter((nurse) => !excluded.has(nurse.id))
    .map((nurse) =>
      evaluateCandidateForShift(
        nurse,
        args.date,
        args.shiftType,
        yearMonth,
        args.rules,
        entriesByNurseDate.get(nurse.id) ?? new Map<string, ScheduleEntry>(),
        constraintMaps
      )
    )
    .filter((candidate): candidate is RecommendationCandidate => Boolean(candidate))
    .sort((left, right) => left.score - right.score);

  const strictCandidates = candidates.filter((candidate) => candidate.tier === "strict");
  const fallbackCandidates = candidates.filter((candidate) => candidate.tier === "fallback");

  return {
    strictCandidates,
    fallbackCandidates,
    candidates: [...strictCandidates, ...fallbackCandidates].slice(0, 3),
  };
}

function findNightReplacementOptions(args: {
  targetNurseId: number;
  entries: ScheduleEntry[];
  nurses: Nurse[];
  rules: WardRule;
  constraints: NurseConstraint[];
}) {
  const entriesByNurseDate = buildEntriesByNurseDate(args.entries);
  const targetEntries = [...(entriesByNurseDate.get(args.targetNurseId)?.values() ?? [])]
    .filter((entry) => entry.shiftType === "N")
    .sort((left, right) => left.date.localeCompare(right.date));

  for (const targetEntry of targetEntries) {
    const replacement = findReplacementOptionsForShift({
      date: targetEntry.date,
      shiftType: "N",
      entries: args.entries,
      nurses: args.nurses,
      rules: args.rules,
      constraints: args.constraints,
      excludeNurseIds: [args.targetNurseId],
    });

    if (replacement.candidates.length > 0) {
      return {
        date: targetEntry.date,
        strictCandidates: replacement.strictCandidates,
        fallbackCandidates: replacement.fallbackCandidates,
        candidates: replacement.candidates,
      };
    }
  }

  return null;
}

function buildConflictRecommendations(args: {
  validationResults: ValidationResult[];
  entries: ScheduleEntry[];
  nurses: Nurse[];
  rules: WardRule;
  constraints: NurseConstraint[];
}) {
  const nurseMap = new Map(args.nurses.map((nurse) => [nurse.id, nurse]));
  const nightLoadMap = buildNightLoadMap(args.entries);
  const handledRuleCodes = new Set([
    "E_TO_D",
    "OFF_AFTER_NIGHT",
    "OFF_AFTER_CONSECUTIVE_WORK",
    "MAX_CONSECUTIVE_WORK",
    "MAX_CONSECUTIVE_NIGHT",
    "PAIR_RULE_SAME_SHIFT",
    "PAIR_RULE_DIFFERENT_SHIFT",
    "NIGHT_KEEP_CLUSTERED",
    "NIGHT_KEEP_NON_NIGHT_SHIFT",
    "NIGHT_KEEP_IMBALANCE",
  ]);

  return args.validationResults
    .filter((issue) => handledRuleCodes.has(issue.ruleCode))
    .slice(0, 8)
    .map((issue, index) => {
      const nurseName = issue.nurseId ? nurseMap.get(issue.nurseId)?.name : null;
      let actionText = "해당 날짜 전후 근무를 교체하거나 부분 재생성으로 다시 맞춰보는 편이 좋습니다.";
      let strictCandidateCount = 0;
      let fallbackCandidateCount = 0;
      let candidates: RecommendationCandidate[] = [];
      let date = issue.date ?? undefined;
      let shiftType = issue.shiftType ?? undefined;
      let sourceNurseId: number | undefined;
      let sourceNurseName: string | undefined;

      if (issue.ruleCode === "E_TO_D") {
        actionText = "전날 Evening 또는 다음 날 Day 중 하나를 다른 간호사로 바꾸는 편이 좋습니다.";
      } else if (issue.ruleCode === "OFF_AFTER_NIGHT") {
        actionText = "야간 직후 OFF를 확보하도록 같은 날짜 이후 구간을 다시 조정하는 편이 좋습니다.";
      } else if (issue.ruleCode === "PAIR_RULE_SAME_SHIFT") {
        actionText = "프리셉터와 프리셉티를 같은 조로 묶도록 부분 재생성을 권장합니다.";
      } else if (issue.ruleCode === "NIGHT_KEEP_CLUSTERED") {
        actionText = "같은 날짜 N조에 나이트 keep이 몰렸습니다. 다른 후보로 분산하는 편이 좋습니다.";

        if (issue.date) {
          const clusteredNightKeeps = args.entries
            .filter((entry) => entry.date === issue.date && entry.shiftType === "N")
            .map((entry) => nurseMap.get(entry.nurseId))
            .filter((nurse): nurse is Nurse => Boolean(nurse) && nurse.isNightKeep)
            .sort((left, right) => (nightLoadMap.get(right.id) ?? 0) - (nightLoadMap.get(left.id) ?? 0));

          sourceNurseId = clusteredNightKeeps[0]?.id;
          sourceNurseName = clusteredNightKeeps[0]?.name;

          const excludeIds = clusteredNightKeeps.map((nurse) => nurse.id);
          const replacement = findReplacementOptionsForShift({
            date: issue.date,
            shiftType: "N",
            entries: args.entries,
            nurses: args.nurses,
            rules: args.rules,
            constraints: args.constraints,
            excludeNurseIds: excludeIds,
          });

          strictCandidateCount = replacement.strictCandidates.length;
          fallbackCandidateCount = replacement.fallbackCandidates.length;
          candidates = replacement.candidates;
          date = issue.date;
          shiftType = "N";

          if (replacement.candidates.length > 0) {
            actionText = `우선 ${issue.date.slice(5)} N 근무에서 전담 1명을 일반 또는 다른 경력 간호사로 분산하는 편이 좋습니다.`;
          }
        }
      } else if (issue.ruleCode === "NIGHT_KEEP_NON_NIGHT_SHIFT") {
        actionText = "나이트 keep 간호사는 N 전용으로 두는 편이 좋습니다. 같은 날짜의 D/E 대체 후보를 먼저 검토해보세요.";
        sourceNurseId = issue.nurseId ?? undefined;
        sourceNurseName = issue.nurseId ? nurseMap.get(issue.nurseId)?.name : undefined;

        if (issue.date && issue.shiftType && issue.nurseId) {
          const replacement = findReplacementOptionsForShift({
            date: issue.date,
            shiftType: issue.shiftType,
            entries: args.entries,
            nurses: args.nurses,
            rules: args.rules,
            constraints: args.constraints,
            excludeNurseIds: [issue.nurseId],
          });

          strictCandidateCount = replacement.strictCandidates.length;
          fallbackCandidateCount = replacement.fallbackCandidates.length;
          candidates = replacement.candidates;

          if (replacement.candidates.length > 0) {
            actionText = `우선 ${issue.date.slice(5)} ${issue.shiftType} 근무를 다른 후보로 바꾸고, 전담 간호사는 N 전용으로 유지하는 편이 좋습니다.`;
          }
        }
      } else if (issue.ruleCode === "NIGHT_KEEP_IMBALANCE") {
        actionText = "전담 간호사별 월 N 횟수 편차가 큽니다. 다음 생성에서는 전담 N 블록을 더 고르게 분산하는 편이 좋습니다.";
      }

      return {
        id: `conflict:${issue.ruleCode}:${issue.date ?? index}:${issue.nurseId ?? index}`,
        type: "rule_conflict" as const,
        severity: issue.severity as "critical" | "warning" | "info",
        title: nurseName ? `${nurseName} 근무 규칙 충돌` : "근무 규칙 충돌",
        summary: issue.message,
        actionText,
        date,
        shiftType,
        sourceNurseId,
        sourceNurseName,
        strictCandidateCount,
        fallbackCandidateCount,
        candidates,
      };
    });
}

function buildFairnessRecommendations(entries: ScheduleEntry[], nurses: Nurse[]) {
  const items: RecommendationItem[] = [];
  const entriesByNurseDate = buildEntriesByNurseDate(entries);

  const generalNightLoads = nurses
    .filter((nurse) => !nurse.isNightKeep)
    .map((nurse) => {
      const nurseEntries = [...(entriesByNurseDate.get(nurse.id)?.values() ?? [])];
      return {
        nurse,
        nightCount: nurseEntries.filter((entry) => entry.shiftType === "N").length,
      };
    })
    .filter((item) => item.nightCount > 0);

  if (generalNightLoads.length > 1) {
    const average =
      generalNightLoads.reduce((sum, item) => sum + item.nightCount, 0) / generalNightLoads.length;

    for (const item of generalNightLoads) {
      if (item.nightCount >= average + 2) {
        items.push({
          id: `fairness:general-night:${item.nurse.id}`,
          type: "fairness_warning",
          severity: "warning",
          title: `${item.nurse.name} 나이트 부담 집중`,
          summary: `${item.nurse.name} 간호사는 일반 간호사 평균보다 나이트 근무가 많이 배정되어 있습니다.`,
          actionText: `현재 ${item.nightCount}회로 평균 ${average.toFixed(1)}회보다 높습니다. 다음 재생성에서는 이 간호사의 N을 일부 분산하는 편이 좋습니다.`,
          strictCandidateCount: 0,
          fallbackCandidateCount: 0,
          candidates: [],
        });
      }
    }
  }

  const newNurseNightLoads = nurses
    .filter((nurse) => nurse.experienceLevel === "new")
    .map((nurse) => {
      const nurseEntries = [...(entriesByNurseDate.get(nurse.id)?.values() ?? [])];
      return {
        nurse,
        nightCount: nurseEntries.filter((entry) => entry.shiftType === "N").length,
      };
    })
    .filter((item) => item.nightCount >= 3);

  for (const item of newNurseNightLoads) {
    items.push({
      id: `fairness:new-night:${item.nurse.id}`,
      type: "fairness_warning",
      severity: "warning",
      title: `${item.nurse.name} 신규 나이트 집중`,
      summary: `신규 간호사인 ${item.nurse.name}에게 나이트 근무가 비교적 많이 배정되어 있습니다.`,
      actionText: `현재 ${item.nightCount}회의 N 근무가 있습니다. 경력 또는 전담 간호사로 일부를 분산할 수 있는지 확인하는 편이 좋습니다.`,
      strictCandidateCount: 0,
      fallbackCandidateCount: 0,
      candidates: [],
    });
  }

  return items;
}

function buildFairnessRecommendationsV2(args: {
  entries: ScheduleEntry[];
  nurses: Nurse[];
  rules: WardRule;
  constraints: NurseConstraint[];
}) {
  const items = buildFairnessRecommendations(args.entries, args.nurses).map((item) => {
    const targetNurse = args.nurses.find((nurse) => item.id.endsWith(`:${nurse.id}`));
    if (!targetNurse || item.type !== "fairness_warning") {
      return item;
    }

    const replacement = findNightReplacementOptions({
      targetNurseId: targetNurse.id,
      entries: args.entries,
      nurses: args.nurses,
      rules: args.rules,
      constraints: args.constraints,
    });

    if (!replacement) {
      return item;
    }

    return {
      ...item,
      actionText: item.id.startsWith("fairness:new-night:")
        ? `우선 ${replacement.date.slice(5)} N 근무를 경력 또는 전담 간호사에게 분산할 수 있는지 확인해보세요.`
        : `우선 ${replacement.date.slice(5)} N 근무를 다른 후보에게 분산하는 편이 좋습니다.`,
      date: replacement.date,
      shiftType: "N",
      sourceNurseId: targetNurse.id,
      sourceNurseName: targetNurse.name,
      strictCandidateCount: replacement.strictCandidates.length,
      fallbackCandidateCount: replacement.fallbackCandidates.length,
      candidates: replacement.candidates,
    };
  });

  return items;
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
  const conflictItems = buildConflictRecommendations({
    validationResults: args.validationResults,
    entries: args.entries,
    nurses: args.nurses,
    rules: args.rules,
    constraints: args.constraints,
  });
  const fairnessItems = buildFairnessRecommendationsV2({
    entries: args.entries,
    nurses: args.nurses,
    rules: args.rules,
    constraints: args.constraints,
  });
  const items = [...understaffedItems, ...conflictItems, ...fairnessItems];

  return {
    totalIssues: args.validationResults.length,
    actionableIssues: items.length,
    unresolvedCriticalCount: args.validationResults.filter(
      (issue) => issue.severity === "critical"
    ).length,
    items,
  };
}
