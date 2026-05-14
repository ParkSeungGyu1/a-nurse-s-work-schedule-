import type {
  DailyRequirement,
  Nurse,
  PairRule,
  ScheduleEntry,
  WardRule,
} from "@workspace/db";

export interface ValidationIssue {
  severity: "critical" | "warning" | "info";
  ruleCode: string;
  message: string;
  date?: string;
  nurseId?: number;
  shiftType?: string;
}

function addDays(date: string, days: number): string {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

export function validateSchedule(
  entries: ScheduleEntry[],
  nurses: Nurse[],
  rules: WardRule,
  requirements: DailyRequirement[],
  pairRules: PairRule[] = []
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nurseMap = new Map(nurses.map((nurse) => [nurse.id, nurse]));

  const byNurse = new Map<number, ScheduleEntry[]>();
  const entriesByNurseDate = new Map<number, Map<string, ScheduleEntry>>();

  for (const entry of entries) {
    if (!byNurse.has(entry.nurseId)) byNurse.set(entry.nurseId, []);
    byNurse.get(entry.nurseId)!.push(entry);

    if (!entriesByNurseDate.has(entry.nurseId)) {
      entriesByNurseDate.set(entry.nurseId, new Map());
    }
    entriesByNurseDate.get(entry.nurseId)!.set(entry.date, entry);
  }

  const reqMap = new Map<string, DailyRequirement>();
  for (const requirement of requirements) {
    reqMap.set(`${requirement.date}:${requirement.shiftType}`, requirement);
  }

  for (const [nurseId, nurseEntries] of byNurse) {
    const nurse = nurseMap.get(nurseId);
    if (!nurse) continue;

    const sorted = [...nurseEntries].sort((a, b) => a.date.localeCompare(b.date));
    const byDate = entriesByNurseDate.get(nurseId)!;
    const workShifts = sorted.filter((entry) => entry.shiftType !== "OFF");

    let consecutiveWork = 0;
    let consecutiveNight = 0;
    let previousWorkDate = "";

    function checkRecoveryDays(
      lastWorkedDate: string,
      requiredOffDays: number,
      ruleCode: string,
      message: string
    ) {
      if (requiredOffDays <= 0) return;

      for (let offset = 1; offset <= requiredOffDays; offset++) {
        const targetDate = addDays(lastWorkedDate, offset);
        const nextEntry = byDate.get(targetDate);
        if (!nextEntry) break;

        if (nextEntry.shiftType !== "OFF") {
          issues.push({
            severity: "critical",
            ruleCode,
            message,
            date: targetDate,
            nurseId,
          });
          break;
        }
      }
    }

    for (let index = 0; index < sorted.length; index++) {
      const entry = sorted[index];

      if (entry.shiftType === "OFF") {
        if (consecutiveWork >= rules.maxConsecutiveWorkDays && previousWorkDate) {
          checkRecoveryDays(
            previousWorkDate,
            rules.offDaysAfterConsecutiveWork,
            "OFF_AFTER_CONSECUTIVE_WORK",
            `${nurse.name}: 연속 근무 후 휴무 부족 (연속 근무 후 ${rules.offDaysAfterConsecutiveWork}일 필요)`
          );
        }

        if (consecutiveNight > 0 && previousWorkDate) {
          checkRecoveryDays(
            previousWorkDate,
            rules.offDaysAfterNightShifts,
            "OFF_AFTER_NIGHT",
            `${nurse.name}: 야간 근무 후 휴무 부족 (야간 후 ${rules.offDaysAfterNightShifts}일 필요)`
          );
        }

        consecutiveWork = 0;
        consecutiveNight = 0;
        previousWorkDate = "";
        continue;
      }

      const currentDate = new Date(entry.date);
      if (previousWorkDate) {
        const previousDate = new Date(previousWorkDate);
        const dayDiff = (currentDate.getTime() - previousDate.getTime()) / 86400000;
        consecutiveWork = dayDiff === 1 ? consecutiveWork + 1 : 1;
      } else {
        consecutiveWork = 1;
      }

      if (consecutiveWork > rules.maxConsecutiveWorkDays) {
        issues.push({
          severity: "critical",
          ruleCode: "MAX_CONSECUTIVE_WORK",
          message: `${nurse.name}: 연속 근무 ${consecutiveWork}일 초과 (최대 ${rules.maxConsecutiveWorkDays}일)`,
          date: entry.date,
          nurseId,
        });
      }

      if (entry.shiftType === "N") {
        consecutiveNight += 1;
        if (consecutiveNight > rules.maxConsecutiveNightShifts) {
          issues.push({
            severity: "critical",
            ruleCode: "MAX_CONSECUTIVE_NIGHT",
            message: `${nurse.name}: 연속 야간 ${consecutiveNight}일 초과 (최대 ${rules.maxConsecutiveNightShifts}일)`,
            date: entry.date,
            nurseId,
            shiftType: "N",
          });
        }
      } else if (consecutiveNight > 0) {
        checkRecoveryDays(
          previousWorkDate,
          rules.offDaysAfterNightShifts,
          "OFF_AFTER_NIGHT",
          `${nurse.name}: 야간 근무 후 휴무 부족 (야간 후 ${rules.offDaysAfterNightShifts}일 필요)`
        );
        consecutiveNight = 0;
      }

      if (!rules.allowEToD && entry.shiftType === "D" && index > 0) {
        const previousEntry = sorted[index - 1];
        if (previousEntry.shiftType === "E" && addDays(previousEntry.date, 1) === entry.date) {
          issues.push({
            severity: "critical",
            ruleCode: "E_TO_D",
            message: `${nurse.name}: 이브닝 다음 날 데이 배정 금지`,
            date: entry.date,
            nurseId,
            shiftType: "D",
          });
        }
      }

      previousWorkDate = entry.date;
    }

    if (consecutiveWork >= rules.maxConsecutiveWorkDays && previousWorkDate) {
      checkRecoveryDays(
        previousWorkDate,
        rules.offDaysAfterConsecutiveWork,
        "OFF_AFTER_CONSECUTIVE_WORK",
        `${nurse.name}: 연속 근무 후 휴무 부족 (연속 근무 후 ${rules.offDaysAfterConsecutiveWork}일 필요)`
      );
    }

    if (consecutiveNight > 0 && previousWorkDate) {
      checkRecoveryDays(
        previousWorkDate,
        rules.offDaysAfterNightShifts,
        "OFF_AFTER_NIGHT",
        `${nurse.name}: 야간 근무 후 휴무 부족 (야간 후 ${rules.offDaysAfterNightShifts}일 필요)`
      );
    }

    const nightCount = workShifts.filter((entry) => entry.shiftType === "N").length;
    const nightLimit = nurse.monthlyNightLimit ?? rules.monthlyMaxNightShifts;
    if (nightCount > nightLimit) {
      issues.push({
        severity: "warning",
        ruleCode: "MONTHLY_NIGHT_LIMIT",
        message: `${nurse.name}: 월 야간 ${nightCount}회 초과 (최대 ${nightLimit}회)`,
        nurseId,
        shiftType: "N",
      });
    }

    for (const entry of workShifts) {
      if (!nurse.allowedShifts.includes(entry.shiftType)) {
        issues.push({
          severity: "critical",
          ruleCode: "FORBIDDEN_SHIFT",
          message: `${nurse.name}: 허용되지 않은 근무 유형 (${entry.shiftType})`,
          date: entry.date,
          nurseId,
          shiftType: entry.shiftType,
        });
      }
    }
  }

  const allDates = [...new Set(entries.map((entry) => entry.date))].sort();
  for (const date of allDates) {
    for (const shiftType of ["D", "E", "N"]) {
      const requirement = reqMap.get(`${date}:${shiftType}`);
      if (!requirement) continue;

      const assigned = entries.filter(
        (entry) => entry.date === date && entry.shiftType === shiftType
      );

      if (assigned.length < requirement.requiredCount) {
        issues.push({
          severity: "critical",
          ruleCode: "UNDERSTAFFED",
          message: `${date} ${shiftType}조: 인원 부족 (${assigned.length}/${requirement.requiredCount}명)`,
          date,
          shiftType,
        });
      }

      const newNurses = assigned.filter((entry) => {
        const nurse = nurseMap.get(entry.nurseId);
        return nurse?.experienceLevel === "new";
      });

      if (assigned.length > 0) {
        const ratio = newNurses.length / assigned.length;
        if (ratio > rules.maxNewNurseRatioPerShift) {
          issues.push({
            severity: "warning",
            ruleCode: "NEW_NURSE_RATIO",
            message: `${date} ${shiftType}조: 신규 간호사 비율 초과 (${newNurses.length}/${assigned.length}명)`,
            date,
            shiftType,
          });
        }
      }

      const experienced = assigned.filter((entry) => {
        const nurse = nurseMap.get(entry.nurseId);
        return nurse?.experienceLevel !== "new";
      });

      if (experienced.length < rules.minExperiencedPerShift && assigned.length > 0) {
        issues.push({
          severity: "warning",
          ruleCode: "MIN_EXPERIENCED",
          message: `${date} ${shiftType}조: 경력 간호사 부족 (${experienced.length}/${rules.minExperiencedPerShift}명 필요)`,
          date,
          shiftType,
        });
      }
    }
  }

  for (const pairRule of pairRules) {
    if (!pairRule.isActive) continue;

    const preceptorEntries = entriesByNurseDate.get(pairRule.preceptorId);
    const precepteeEntries = entriesByNurseDate.get(pairRule.precepteeId);
    if (!preceptorEntries || !precepteeEntries) continue;

    for (const date of allDates) {
      const preceptorShift = preceptorEntries.get(date)?.shiftType;
      const precepteeShift = precepteeEntries.get(date)?.shiftType;
      if (!preceptorShift || !precepteeShift) continue;

      if (pairRule.ruleType === "same_shift" && preceptorShift !== precepteeShift) {
        const preceptorName = nurseMap.get(pairRule.preceptorId)?.name ?? `#${pairRule.preceptorId}`;
        const precepteeName = nurseMap.get(pairRule.precepteeId)?.name ?? `#${pairRule.precepteeId}`;
        issues.push({
          severity: "warning",
          ruleCode: "PAIR_RULE_SAME_SHIFT",
          message: `${date}: ${preceptorName} / ${precepteeName} 프리셉터 매칭이 같은 근무로 배정되지 않았습니다.`,
          date,
        });
      }

      if (
        pairRule.ruleType === "different_shift" &&
        preceptorShift === precepteeShift &&
        preceptorShift !== "OFF"
      ) {
        const preceptorName = nurseMap.get(pairRule.preceptorId)?.name ?? `#${pairRule.preceptorId}`;
        const precepteeName = nurseMap.get(pairRule.precepteeId)?.name ?? `#${pairRule.precepteeId}`;
        issues.push({
          severity: "warning",
          ruleCode: "PAIR_RULE_DIFFERENT_SHIFT",
          message: `${date}: ${preceptorName} / ${precepteeName} 프리셉터 매칭이 다른 근무로 배정되지 않았습니다.`,
          date,
        });
      }
    }
  }

  return issues;
}
