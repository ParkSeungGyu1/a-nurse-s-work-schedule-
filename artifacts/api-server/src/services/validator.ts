import type { ScheduleEntry, Nurse, WardRule, DailyRequirement } from "@workspace/db";

export interface ValidationIssue {
  severity: "critical" | "warning" | "info";
  ruleCode: string;
  message: string;
  date?: string;
  nurseId?: number;
  shiftType?: string;
}

export function validateSchedule(
  entries: ScheduleEntry[],
  nurses: Nurse[],
  rules: WardRule,
  requirements: DailyRequirement[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nurseMap = new Map(nurses.map((n) => [n.id, n]));

  // Group entries by nurse
  const byNurse = new Map<number, ScheduleEntry[]>();
  for (const e of entries) {
    if (!byNurse.has(e.nurseId)) byNurse.set(e.nurseId, []);
    byNurse.get(e.nurseId)!.push(e);
  }

  // Group entries by date + shiftType
  const byDateShift = new Map<string, ScheduleEntry[]>();
  for (const e of entries) {
    const key = `${e.date}:${e.shiftType}`;
    if (!byDateShift.has(key)) byDateShift.set(key, []);
    byDateShift.get(key)!.push(e);
  }

  // Requirements map
  const reqMap = new Map<string, DailyRequirement>();
  for (const r of requirements) {
    reqMap.set(`${r.date}:${r.shiftType}`, r);
  }

  for (const [nurseId, nurseEntries] of byNurse) {
    const nurse = nurseMap.get(nurseId);
    if (!nurse) continue;

    const sorted = [...nurseEntries].sort((a, b) => a.date.localeCompare(b.date));
    const workShifts = sorted.filter((e) => e.shiftType !== "OFF");

    // Check max consecutive work days
    let consecutive = 0;
    let prevDate = "";
    for (const e of sorted) {
      if (e.shiftType === "OFF") {
        consecutive = 0;
        prevDate = "";
        continue;
      }
      const curr = new Date(e.date);
      if (prevDate) {
        const prev = new Date(prevDate);
        const diff = (curr.getTime() - prev.getTime()) / 86400000;
        if (diff === 1) {
          consecutive++;
        } else {
          consecutive = 1;
        }
      } else {
        consecutive = 1;
      }
      prevDate = e.date;
      if (consecutive > rules.maxConsecutiveWorkDays) {
        issues.push({
          severity: "critical",
          ruleCode: "MAX_CONSECUTIVE_WORK",
          message: `${nurse.name}: 연속 근무 ${consecutive}일 초과 (최대 ${rules.maxConsecutiveWorkDays}일)`,
          date: e.date,
          nurseId,
        });
      }
    }

    // Check consecutive night shifts and off-after-night
    let consecutiveN = 0;
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      if (e.shiftType === "N") {
        consecutiveN++;
        if (consecutiveN > rules.maxConsecutiveNightShifts) {
          issues.push({
            severity: "critical",
            ruleCode: "MAX_CONSECUTIVE_NIGHT",
            message: `${nurse.name}: 연속 야간 ${consecutiveN}일 초과 (최대 ${rules.maxConsecutiveNightShifts}일)`,
            date: e.date,
            nurseId,
            shiftType: "N",
          });
        }
        // Check off-after-night
        for (let j = 1; j <= rules.offDaysAfterNightShifts; j++) {
          const nextEntry = sorted.find((s) => {
            const d = new Date(e.date);
            d.setDate(d.getDate() + j);
            return s.date === d.toISOString().slice(0, 10);
          });
          if (nextEntry && nextEntry.shiftType !== "OFF" && i === sorted.indexOf(sorted.find((s) => s.shiftType === "N" && sorted.indexOf(s) > sorted.indexOf(e) - consecutiveN) ?? e)) {
            // simplified check
          }
        }
      } else {
        // Check off-after-nights when N streak ends
        if (consecutiveN >= rules.maxConsecutiveNightShifts) {
          // After N streak, need offDaysAfterNightShifts OFF
          for (let j = 1; j <= rules.offDaysAfterNightShifts; j++) {
            const checkDate = new Date(sorted[i - 1].date);
            checkDate.setDate(checkDate.getDate() + j);
            const checkDateStr = checkDate.toISOString().slice(0, 10);
            const checkEntry = sorted.find((s) => s.date === checkDateStr);
            if (checkEntry && checkEntry.shiftType !== "OFF") {
              issues.push({
                severity: "critical",
                ruleCode: "OFF_AFTER_NIGHT",
                message: `${nurse.name}: 야간 근무 후 휴무 부족 (야간 후 ${rules.offDaysAfterNightShifts}일 필요)`,
                date: checkDateStr,
                nurseId,
              });
              break;
            }
          }
        }
        consecutiveN = 0;
      }

      // Check E -> D restriction
      if (!rules.allowEToD && e.shiftType === "D" && i > 0) {
        const prev = sorted[i - 1];
        if (prev.shiftType === "E") {
          const prevDate2 = new Date(prev.date);
          prevDate2.setDate(prevDate2.getDate() + 1);
          if (prevDate2.toISOString().slice(0, 10) === e.date) {
            issues.push({
              severity: "critical",
              ruleCode: "E_TO_D",
              message: `${nurse.name}: 이브닝 다음 날 데이 배정 금지`,
              date: e.date,
              nurseId,
              shiftType: "D",
            });
          }
        }
      }
    }

    // Check monthly night count
    const nightCount = workShifts.filter((e) => e.shiftType === "N").length;
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

    // Check forbidden shifts
    for (const e of workShifts) {
      if (!nurse.allowedShifts.includes(e.shiftType)) {
        issues.push({
          severity: "critical",
          ruleCode: "FORBIDDEN_SHIFT",
          message: `${nurse.name}: 허용되지 않은 근무 유형 (${e.shiftType})`,
          date: e.date,
          nurseId,
          shiftType: e.shiftType,
        });
      }
    }
  }

  // Check staffing requirements per shift
  const allDates = [...new Set(entries.map((e) => e.date))].sort();
  for (const date of allDates) {
    for (const shiftType of ["D", "E", "N"]) {
      const req = reqMap.get(`${date}:${shiftType}`);
      if (!req) continue;

      const assigned = entries.filter(
        (e) => e.date === date && e.shiftType === shiftType
      );
      if (assigned.length < req.requiredCount) {
        issues.push({
          severity: "critical",
          ruleCode: "UNDERSTAFFED",
          message: `${date} ${shiftType}조: 인원 부족 (${assigned.length}/${req.requiredCount}명)`,
          date,
          shiftType,
        });
      }

      // Check new nurse ratio
      const newNurses = assigned.filter((e) => {
        const nurse = nurseMap.get(e.nurseId);
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

      // Check experienced minimum
      const experienced = assigned.filter((e) => {
        const nurse = nurseMap.get(e.nurseId);
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

  return issues;
}
