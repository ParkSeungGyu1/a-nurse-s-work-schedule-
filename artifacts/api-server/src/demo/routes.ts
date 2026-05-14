import { Router } from "express";
import { generateSchedule } from "../services/generator";
import { validateSchedule } from "../services/validator";
import { buildScheduleRecommendations } from "../services/recommendations";

type ShiftType = "D" | "E" | "N" | "OFF";
type ExperienceLevel = "new" | "experienced" | "senior";
type ConstraintType =
  | "fixed_off"
  | "preferred_off"
  | "forbidden_shift"
  | "education"
  | "annual_leave";
type Severity = "critical" | "warning" | "info";
type PriorityMode = "balanced" | "fairness" | "coverage" | "new_nurse_protection";

interface WardRecord {
  id: number;
  name: string;
  wardType: string;
  shiftDStart: string;
  shiftDEnd: string;
  shiftEStart: string;
  shiftEEnd: string;
  shiftNStart: string;
  shiftNEnd: string;
  maxNurseCount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NurseRecord {
  id: number;
  wardId: number;
  name: string;
  employeeNumber: string;
  experienceLevel: ExperienceLevel;
  isNightKeep: boolean;
  isPregnant: boolean;
  allowedShifts: string[];
  monthlyNightLimit: number | null;
  preceptorId: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NurseConstraintRecord {
  id: number;
  nurseId: number;
  constraintType: ConstraintType;
  date: string | null;
  shiftType: string | null;
  yearMonth: string | null;
  isHard: boolean;
  notes: string | null;
  createdAt: Date;
}

interface WardRuleRecord {
  id: number;
  wardId: number;
  maxConsecutiveWorkDays: number;
  offDaysAfterConsecutiveWork: number;
  maxConsecutiveNightShifts: number;
  offDaysAfterNightShifts: number;
  allowEToD: boolean;
  monthlyMaxNightShifts: number;
  minExperiencedPerShift: number;
  maxNewNurseRatioPerShift: number;
  weekendFairness: boolean;
  holidayFairness: boolean;
  updatedAt: Date;
}

interface PairRuleRecord {
  id: number;
  wardId: number;
  preceptorId: number;
  precepteeId: number;
  ruleType: "same_shift" | "different_shift";
  isActive: boolean;
}

interface DailyRequirementRecord {
  id: number;
  wardId: number;
  date: string;
  shiftType: "D" | "E" | "N";
  requiredCount: number;
  isHoliday: boolean;
}

interface ScheduleRecord {
  id: number;
  wardId: number;
  yearMonth: string;
  status: "draft" | "published" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

interface ScheduleEntryRecord {
  id: number;
  scheduleId: number;
  nurseId: number;
  date: string;
  shiftType: string;
  isManualEdit: boolean;
}

interface ValidationResultRecord {
  id: number;
  scheduleId: number;
  severity: Severity;
  ruleCode: string;
  message: string;
  date: string | null;
  nurseId: number | null;
  shiftType: string | null;
}

const counters = {
  ward: 2,
  nurse: 12,
  constraint: 1,
  rule: 2,
  pairRule: 2,
  staffing: 1,
  schedule: 1,
  scheduleEntry: 1,
  validation: 1,
};

const now = () => new Date();

const wards: WardRecord[] = [
  {
    id: 1,
    name: "병동 A",
    wardType: "일반병동",
    shiftDStart: "07:00",
    shiftDEnd: "15:00",
    shiftEStart: "15:00",
    shiftEEnd: "23:00",
    shiftNStart: "23:00",
    shiftNEnd: "07:00",
    maxNurseCount: 40,
    createdAt: now(),
    updatedAt: now(),
  },
];

const nurses: NurseRecord[] = [
  ["김민지", "experienced", false, false, ["D", "E", "N"], 7, null, "팀 리더"],
  ["박서연", "senior", false, false, ["D", "E", "N"], 7, null, null],
  ["이수빈", "experienced", false, false, ["D", "E", "N"], 7, null, null],
  ["최하윤", "new", false, false, ["D", "E"], 5, 1, "교육기간"],
  ["정예은", "new", false, false, ["D", "E", "N"], 5, 2, null],
  ["한지우", "experienced", false, false, ["D", "E", "N"], 7, null, null],
  ["윤다은", "experienced", false, true, ["D", "E"], 0, null, "임신 중"],
  ["장유진", "experienced", true, false, ["N"], 15, null, "나이트 keep"],
  ["송가은", "experienced", true, false, ["N"], 15, null, "나이트 keep"],
  ["문채린", "experienced", false, false, ["D", "E", "N"], 7, null, null],
  ["신소율", "new", false, false, ["D", "E"], 4, 1, null],
  ["오세린", "experienced", false, false, ["D", "E", "N"], 7, null, null],
].map((item, index) => ({
  id: index + 1,
  wardId: 1,
  name: item[0] as string,
  employeeNumber: `N-${String(index + 1).padStart(3, "0")}`,
  experienceLevel: item[1] as ExperienceLevel,
  isNightKeep: item[2] as boolean,
  isPregnant: item[3] as boolean,
  allowedShifts: item[4] as string[],
  monthlyNightLimit: item[5] as number,
  preceptorId: item[6] as number | null,
  notes: item[7] as string | null,
  createdAt: now(),
  updatedAt: now(),
}));

const nurseConstraints: NurseConstraintRecord[] = [
  {
    id: counters.constraint++,
    nurseId: 7,
    constraintType: "forbidden_shift",
    date: null,
    shiftType: "N",
    yearMonth: null,
    isHard: true,
    notes: "임산부 야간 금지",
    createdAt: now(),
  },
];

const wardRules: WardRuleRecord[] = [
  {
    id: 1,
    wardId: 1,
    maxConsecutiveWorkDays: 5,
    offDaysAfterConsecutiveWork: 2,
    maxConsecutiveNightShifts: 3,
    offDaysAfterNightShifts: 2,
    allowEToD: false,
    monthlyMaxNightShifts: 7,
    minExperiencedPerShift: 1,
    maxNewNurseRatioPerShift: 0.5,
    weekendFairness: true,
    holidayFairness: true,
    updatedAt: now(),
  },
];

const pairRules: PairRuleRecord[] = [
  { id: 1, wardId: 1, preceptorId: 1, precepteeId: 4, ruleType: "same_shift", isActive: true },
];

const dailyRequirements: DailyRequirementRecord[] = [];
const schedules: ScheduleRecord[] = [];
const scheduleEntries: ScheduleEntryRecord[] = [];
const validationResults: ValidationResultRecord[] = [];

const currentYearMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
const currentMonthDate = (day: number) => `${currentYearMonth}-${String(day).padStart(2, "0")}`;

Object.assign(counters, {
  ward: 3,
  nurse: 21,
  constraint: 8,
  rule: 3,
  pairRule: 4,
  staffing: 1,
  schedule: 1,
  scheduleEntry: 1,
  validation: 1,
});

wards.splice(
  0,
  wards.length,
  {
    id: 1,
    name: "53병동",
    wardType: "일반병동",
    shiftDStart: "07:00",
    shiftDEnd: "15:00",
    shiftEStart: "15:00",
    shiftEEnd: "23:00",
    shiftNStart: "23:00",
    shiftNEnd: "07:00",
    maxNurseCount: 24,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 2,
    name: "MICU",
    wardType: "중환자실",
    shiftDStart: "07:00",
    shiftDEnd: "15:00",
    shiftEStart: "15:00",
    shiftEEnd: "23:00",
    shiftNStart: "23:00",
    shiftNEnd: "07:00",
    maxNurseCount: 18,
    createdAt: now(),
    updatedAt: now(),
  }
);

nurses.splice(0, nurses.length, ...[
  { id: 1, wardId: 1, name: "김민지", employeeNumber: "W53-001", experienceLevel: "senior", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 6, preceptorId: null, notes: "차지 리더", createdAt: now(), updatedAt: now() },
  { id: 2, wardId: 1, name: "박서윤", employeeNumber: "W53-002", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 7, preceptorId: null, notes: "프리셉터", createdAt: now(), updatedAt: now() },
  { id: 3, wardId: 1, name: "이수빈", employeeNumber: "W53-003", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 7, preceptorId: null, notes: null, createdAt: now(), updatedAt: now() },
  { id: 4, wardId: 1, name: "최하은", employeeNumber: "W53-004", experienceLevel: "new", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E"], monthlyNightLimit: 0, preceptorId: 1, notes: "오리엔테이션 2개월차", createdAt: now(), updatedAt: now() },
  { id: 5, wardId: 1, name: "정예은", employeeNumber: "W53-005", experienceLevel: "new", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E"], monthlyNightLimit: 0, preceptorId: 2, notes: "프리셉티", createdAt: now(), updatedAt: now() },
  { id: 6, wardId: 1, name: "서지안", employeeNumber: "W53-006", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 7, preceptorId: null, notes: null, createdAt: now(), updatedAt: now() },
  { id: 7, wardId: 1, name: "한유리", employeeNumber: "W53-007", experienceLevel: "experienced", isNightKeep: false, isPregnant: true, allowedShifts: ["D", "E"], monthlyNightLimit: 0, preceptorId: null, notes: "임신으로 N 제외", createdAt: now(), updatedAt: now() },
  { id: 8, wardId: 1, name: "오다은", employeeNumber: "W53-008", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 6, preceptorId: null, notes: "주말 OFF 선호", createdAt: now(), updatedAt: now() },
  { id: 9, wardId: 1, name: "유지호", employeeNumber: "W53-009", experienceLevel: "experienced", isNightKeep: true, isPregnant: false, allowedShifts: ["N"], monthlyNightLimit: 15, preceptorId: null, notes: "나이트 keep", createdAt: now(), updatedAt: now() },
  { id: 10, wardId: 1, name: "문가을", employeeNumber: "W53-010", experienceLevel: "experienced", isNightKeep: true, isPregnant: false, allowedShifts: ["N"], monthlyNightLimit: 15, preceptorId: null, notes: "나이트 keep", createdAt: now(), updatedAt: now() },
  { id: 11, wardId: 1, name: "조소연", employeeNumber: "W53-011", experienceLevel: "new", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E"], monthlyNightLimit: 0, preceptorId: 1, notes: "교육병행", createdAt: now(), updatedAt: now() },
  { id: 12, wardId: 1, name: "강세리", employeeNumber: "W53-012", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 7, preceptorId: null, notes: null, createdAt: now(), updatedAt: now() },
  { id: 13, wardId: 2, name: "윤다정", employeeNumber: "MICU-001", experienceLevel: "senior", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 6, preceptorId: null, notes: "중환자실 차지", createdAt: now(), updatedAt: now() },
  { id: 14, wardId: 2, name: "장효린", employeeNumber: "MICU-002", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 7, preceptorId: null, notes: null, createdAt: now(), updatedAt: now() },
  { id: 15, wardId: 2, name: "임수아", employeeNumber: "MICU-003", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 7, preceptorId: null, notes: "CRRT 가능", createdAt: now(), updatedAt: now() },
  { id: 16, wardId: 2, name: "배은채", employeeNumber: "MICU-004", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 6, preceptorId: null, notes: null, createdAt: now(), updatedAt: now() },
  { id: 17, wardId: 2, name: "신가현", employeeNumber: "MICU-005", experienceLevel: "experienced", isNightKeep: true, isPregnant: false, allowedShifts: ["N"], monthlyNightLimit: 14, preceptorId: null, notes: "야간 전담", createdAt: now(), updatedAt: now() },
  { id: 18, wardId: 2, name: "노지우", employeeNumber: "MICU-006", experienceLevel: "new", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E"], monthlyNightLimit: 0, preceptorId: 13, notes: "프리셉티", createdAt: now(), updatedAt: now() },
  { id: 19, wardId: 2, name: "홍세나", employeeNumber: "MICU-007", experienceLevel: "new", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E"], monthlyNightLimit: 0, preceptorId: 14, notes: "중환자실 적응기간", createdAt: now(), updatedAt: now() },
  { id: 20, wardId: 2, name: "정아라", employeeNumber: "MICU-008", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D", "E", "N"], monthlyNightLimit: 7, preceptorId: null, notes: "연차 예정", createdAt: now(), updatedAt: now() },
] satisfies NurseRecord[]);

nurseConstraints.splice(0, nurseConstraints.length, ...[
  { id: 1, nurseId: 7, constraintType: "forbidden_shift", date: null, shiftType: "N", yearMonth: null, isHard: true, notes: "임신으로 야간 금지", createdAt: now() },
  { id: 2, nurseId: 4, constraintType: "education", date: currentMonthDate(3), shiftType: null, yearMonth: null, isHard: true, notes: "신규 교육", createdAt: now() },
  { id: 3, nurseId: 5, constraintType: "fixed_off", date: currentMonthDate(10), shiftType: null, yearMonth: null, isHard: true, notes: "개인 일정", createdAt: now() },
  { id: 4, nurseId: 8, constraintType: "preferred_off", date: currentMonthDate(17), shiftType: null, yearMonth: null, isHard: false, notes: "주말 OFF 선호", createdAt: now() },
  { id: 5, nurseId: 18, constraintType: "education", date: currentMonthDate(5), shiftType: null, yearMonth: null, isHard: true, notes: "중환자실 오리엔테이션", createdAt: now() },
  { id: 6, nurseId: 19, constraintType: "forbidden_shift", date: null, shiftType: "N", yearMonth: currentYearMonth, isHard: true, notes: "적응기간 N 제외", createdAt: now() },
  { id: 7, nurseId: 20, constraintType: "annual_leave", date: currentMonthDate(22), shiftType: null, yearMonth: null, isHard: true, notes: "연차", createdAt: now() },
] satisfies NurseConstraintRecord[]);

wardRules.splice(0, wardRules.length, ...[
  { id: 1, wardId: 1, maxConsecutiveWorkDays: 5, offDaysAfterConsecutiveWork: 2, maxConsecutiveNightShifts: 3, offDaysAfterNightShifts: 2, allowEToD: false, monthlyMaxNightShifts: 7, minExperiencedPerShift: 1, maxNewNurseRatioPerShift: 0.5, weekendFairness: true, holidayFairness: true, updatedAt: now() },
  { id: 2, wardId: 2, maxConsecutiveWorkDays: 5, offDaysAfterConsecutiveWork: 2, maxConsecutiveNightShifts: 3, offDaysAfterNightShifts: 2, allowEToD: false, monthlyMaxNightShifts: 7, minExperiencedPerShift: 2, maxNewNurseRatioPerShift: 0.34, weekendFairness: true, holidayFairness: true, updatedAt: now() },
] satisfies WardRuleRecord[]);

pairRules.splice(0, pairRules.length, ...[
  { id: 1, wardId: 1, preceptorId: 1, precepteeId: 4, ruleType: "same_shift", isActive: true },
  { id: 2, wardId: 1, preceptorId: 2, precepteeId: 5, ruleType: "same_shift", isActive: true },
  { id: 3, wardId: 2, preceptorId: 13, precepteeId: 18, ruleType: "same_shift", isActive: true },
] satisfies PairRuleRecord[]);

function getDefaultRule(wardId: number): WardRuleRecord {
  const existing = wardRules.find((rule) => rule.wardId === wardId);
  if (existing) return existing;

  const created: WardRuleRecord = {
    id: counters.rule++,
    wardId,
    maxConsecutiveWorkDays: 5,
    offDaysAfterConsecutiveWork: 2,
    maxConsecutiveNightShifts: 3,
    offDaysAfterNightShifts: 2,
    allowEToD: false,
    monthlyMaxNightShifts: 7,
    minExperiencedPerShift: 1,
    maxNewNurseRatioPerShift: 0.5,
    weekendFairness: true,
    holidayFairness: true,
    updatedAt: now(),
  };
  wardRules.push(created);
  return created;
}

function getDaysInMonth(yearMonth: string): string[] {
  const [year, month] = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${yearMonth}-${day}`;
  });
}

function ensureRequirementsForMonth(wardId: number, yearMonth: string) {
  const existing = dailyRequirements.filter(
    (requirement) =>
      requirement.wardId === wardId && requirement.date.startsWith(yearMonth)
  );
  if (existing.length > 0) return;

  for (const date of getDaysInMonth(yearMonth)) {
    const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isMicu = wardId === 2;
    const dayCount = isMicu ? 3 : isWeekend ? 3 : 4;
    const eveningCount = isMicu ? (isWeekend ? 2 : 3) : isWeekend ? 3 : 4;
    const nightCount = isMicu ? 2 : isWeekend ? 2 : 3;

    dailyRequirements.push(
      {
        id: counters.staffing++,
        wardId,
        date,
        shiftType: "D",
        requiredCount: dayCount,
        isHoliday: isWeekend,
      },
      {
        id: counters.staffing++,
        wardId,
        date,
        shiftType: "E",
        requiredCount: eveningCount,
        isHoliday: isWeekend,
      },
      {
        id: counters.staffing++,
        wardId,
        date,
        shiftType: "N",
        requiredCount: nightCount,
        isHoliday: isWeekend,
      }
    );
  }
}

function serializeWard(ward: WardRecord) {
  return {
    ...ward,
    createdAt: ward.createdAt.toISOString(),
    updatedAt: ward.updatedAt.toISOString(),
    nurseCount: nurses.filter((nurse) => nurse.wardId === ward.id).length,
  };
}

function serializeNurse(nurse: NurseRecord) {
  return {
    ...nurse,
    createdAt: nurse.createdAt.toISOString(),
    updatedAt: nurse.updatedAt.toISOString(),
  };
}

function getScheduleDetail(wardId: number, scheduleId: number) {
  const schedule = schedules.find((item) => item.id === scheduleId && item.wardId === wardId);
  if (!schedule) return null;

  const entries = scheduleEntries
    .filter((entry) => entry.scheduleId === scheduleId)
    .sort((left, right) => left.date.localeCompare(right.date) || left.nurseId - right.nurseId)
    .map((entry) => {
      const nurse = nurses.find((candidate) => candidate.id === entry.nurseId);
      return {
        ...entry,
        nurseName: nurse?.name ?? `#${entry.nurseId}`,
        nurseExperienceLevel: nurse?.experienceLevel ?? "",
      };
    });

  const results = validationResults
    .filter((result) => result.scheduleId === scheduleId)
    .map((result) => ({
      ...result,
      nurseName: result.nurseId
        ? nurses.find((nurse) => nurse.id === result.nurseId)?.name ?? null
        : null,
    }));

  return {
    id: schedule.id,
    wardId: schedule.wardId,
    yearMonth: schedule.yearMonth,
    status: schedule.status,
    entries,
    validationResults: results,
    conflictCount: results.filter((result) => result.severity === "critical").length,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

function runValidationForSchedule(scheduleId: number) {
  const schedule = schedules.find((item) => item.id === scheduleId);
  if (!schedule) return [];

  const wardNurses = nurses.filter((nurse) => nurse.wardId === schedule.wardId);
  const rules = getDefaultRule(schedule.wardId);
  const requirements = dailyRequirements.filter(
    (requirement) =>
      requirement.wardId === schedule.wardId &&
      requirement.date.startsWith(schedule.yearMonth)
  );
  const pairs = pairRules.filter((pair) => pair.wardId === schedule.wardId);
  const entries = scheduleEntries.filter((entry) => entry.scheduleId === scheduleId);

  const issues = validateSchedule(entries, wardNurses, rules, requirements, pairs);

  for (let index = validationResults.length - 1; index >= 0; index--) {
    if (validationResults[index].scheduleId === scheduleId) {
      validationResults.splice(index, 1);
    }
  }

  for (const issue of issues) {
    validationResults.push({
      id: counters.validation++,
      scheduleId,
      severity: issue.severity,
      ruleCode: issue.ruleCode,
      message: issue.message,
      date: issue.date ?? null,
      nurseId: issue.nurseId ?? null,
      shiftType: issue.shiftType ?? null,
    });
  }

  schedule.updatedAt = now();
  return issues;
}

function regenerateDemoScheduleDetail(
  schedule: ScheduleRecord,
  options: {
    targetDates?: string[];
    overwriteManualEdits?: boolean;
    priorityMode?: PriorityMode;
  }
) {
  const wardNurses = nurses.filter((nurse) => nurse.wardId === schedule.wardId);
  const rules = getDefaultRule(schedule.wardId);
  const requirements = dailyRequirements.filter(
    (requirement) =>
      requirement.wardId === schedule.wardId &&
      requirement.date.startsWith(schedule.yearMonth)
  );
  const constraints = nurseConstraints.filter((constraint) =>
    wardNurses.some((nurse) => nurse.id === constraint.nurseId)
  );
  const pairs = pairRules.filter((pair) => pair.wardId === schedule.wardId);
  const targetDateSet = new Set(
    (options.targetDates && options.targetDates.length > 0)
      ? options.targetDates
      : getDaysInMonth(schedule.yearMonth)
  );
  const overwriteManualEdits = options.overwriteManualEdits ?? false;

  const manualKeys = new Set(
    scheduleEntries
      .filter(
        (entry) =>
          entry.scheduleId === schedule.id &&
          entry.isManualEdit &&
          !overwriteManualEdits &&
          targetDateSet.has(entry.date)
      )
      .map((entry) => `${entry.nurseId}:${entry.date}`)
  );

  for (let index = scheduleEntries.length - 1; index >= 0; index--) {
    const entry = scheduleEntries[index];
    if (entry.scheduleId !== schedule.id || !targetDateSet.has(entry.date)) continue;
    if (!overwriteManualEdits && entry.isManualEdit) continue;
    scheduleEntries.splice(index, 1);
  }

  const generated = generateSchedule(
    schedule.yearMonth,
    wardNurses,
    rules,
    requirements,
    constraints,
    pairs,
    { priorityMode: options.priorityMode }
  );

  for (const entry of generated) {
    if (!targetDateSet.has(entry.date)) continue;
    if (manualKeys.has(`${entry.nurseId}:${entry.date}`)) continue;

    scheduleEntries.push({
      id: counters.scheduleEntry++,
      scheduleId: schedule.id,
      nurseId: entry.nurseId,
      date: entry.date,
      shiftType: entry.shiftType,
      isManualEdit: false,
    });
  }

  runValidationForSchedule(schedule.id);
  return getScheduleDetail(schedule.wardId, schedule.id);
}

function seedDemoSchedules() {
  if (schedules.length > 0) return;

  for (const ward of wards) {
    ensureRequirementsForMonth(ward.id, currentYearMonth);

    const created: ScheduleRecord = {
      id: counters.schedule++,
      wardId: ward.id,
      yearMonth: currentYearMonth,
      status: ward.id === 1 ? "published" : "draft",
      createdAt: now(),
      updatedAt: now(),
    };
    schedules.push(created);

    const wardNurses = nurses.filter((nurse) => nurse.wardId === ward.id);
    const rules = getDefaultRule(ward.id);
    const requirements = dailyRequirements.filter(
      (requirement) => requirement.wardId === ward.id && requirement.date.startsWith(currentYearMonth)
    );
    const constraints = nurseConstraints.filter((constraint) =>
      wardNurses.some((nurse) => nurse.id === constraint.nurseId)
    );
    const pairs = pairRules.filter((pair) => pair.wardId === ward.id);

    const generated = generateSchedule(
      currentYearMonth,
      wardNurses,
      rules,
      requirements,
      constraints,
      pairs,
      { priorityMode: "balanced" }
    );

    for (const entry of generated) {
      scheduleEntries.push({
        id: counters.scheduleEntry++,
        scheduleId: created.id,
        nurseId: entry.nurseId,
        date: entry.date,
        shiftType: entry.shiftType,
        isManualEdit: false,
      });
    }

    runValidationForSchedule(created.id);
  }
}

seedDemoSchedules();

const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ ok: true, mode: "demo" });
});

router.get("/dashboard/summary", (_req, res) => {
  const recentSchedules = [...schedules]
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, 5)
    .map((schedule) => ({
      id: schedule.id,
      wardId: schedule.wardId,
      wardName: wards.find((ward) => ward.id === schedule.wardId)?.name ?? "",
      yearMonth: schedule.yearMonth,
      status: schedule.status,
      conflictCount: validationResults.filter(
        (result) => result.scheduleId === schedule.id && result.severity === "critical"
      ).length,
      createdAt: schedule.createdAt.toISOString(),
      updatedAt: schedule.updatedAt.toISOString(),
    }));

  res.json({
    wardCount: wards.length,
    nurseCount: nurses.length,
    activeSchedules: schedules.filter((schedule) => schedule.status !== "archived").length,
    unresolvedConflicts: validationResults.filter((result) => result.severity === "critical").length,
    recentSchedules,
  });
});

router.get("/wards", (_req, res) => {
  res.json(wards.map(serializeWard));
});

router.post("/wards", (req, res) => {
  const created: WardRecord = {
    id: counters.ward++,
    name: req.body.name ?? `병동 ${counters.ward}`,
    wardType: req.body.wardType ?? "일반병동",
    shiftDStart: req.body.shiftDStart ?? "07:00",
    shiftDEnd: req.body.shiftDEnd ?? "15:00",
    shiftEStart: req.body.shiftEStart ?? "15:00",
    shiftEEnd: req.body.shiftEEnd ?? "23:00",
    shiftNStart: req.body.shiftNStart ?? "23:00",
    shiftNEnd: req.body.shiftNEnd ?? "07:00",
    maxNurseCount: req.body.maxNurseCount ?? 40,
    createdAt: now(),
    updatedAt: now(),
  };
  wards.push(created);
  getDefaultRule(created.id);
  res.status(201).json(serializeWard(created));
});

router.get("/wards/:wardId", (req, res) => {
  const wardId = Number(req.params.wardId);
  const ward = wards.find((item) => item.id === wardId);
  if (!ward) {
    res.status(404).json({ error: "Ward not found" });
    return;
  }
  res.json(serializeWard(ward));
});

router.patch("/wards/:wardId", (req, res) => {
  const wardId = Number(req.params.wardId);
  const ward = wards.find((item) => item.id === wardId);
  if (!ward) {
    res.status(404).json({ error: "Ward not found" });
    return;
  }

  Object.assign(ward, req.body, { updatedAt: now() });
  res.json(serializeWard(ward));
});

router.delete("/wards/:wardId", (req, res) => {
  const wardId = Number(req.params.wardId);

  for (let index = wards.length - 1; index >= 0; index--) {
    if (wards[index].id === wardId) wards.splice(index, 1);
  }
  for (let index = nurses.length - 1; index >= 0; index--) {
    if (nurses[index].wardId === wardId) nurses.splice(index, 1);
  }
  for (let index = wardRules.length - 1; index >= 0; index--) {
    if (wardRules[index].wardId === wardId) wardRules.splice(index, 1);
  }
  for (let index = pairRules.length - 1; index >= 0; index--) {
    if (pairRules[index].wardId === wardId) pairRules.splice(index, 1);
  }
  for (let index = dailyRequirements.length - 1; index >= 0; index--) {
    if (dailyRequirements[index].wardId === wardId) dailyRequirements.splice(index, 1);
  }
  const scheduleIds = schedules.filter((schedule) => schedule.wardId === wardId).map((schedule) => schedule.id);
  for (let index = schedules.length - 1; index >= 0; index--) {
    if (schedules[index].wardId === wardId) schedules.splice(index, 1);
  }
  for (let index = scheduleEntries.length - 1; index >= 0; index--) {
    if (scheduleIds.includes(scheduleEntries[index].scheduleId)) scheduleEntries.splice(index, 1);
  }
  for (let index = validationResults.length - 1; index >= 0; index--) {
    if (scheduleIds.includes(validationResults[index].scheduleId)) validationResults.splice(index, 1);
  }

  res.status(204).send();
});

router.get("/wards/:wardId/nurses", (req, res) => {
  const wardId = Number(req.params.wardId);
  res.json(
    nurses
      .filter((nurse) => nurse.wardId === wardId)
      .sort((left, right) => left.id - right.id)
      .map(serializeNurse)
  );
});

router.post("/wards/:wardId/nurses", (req, res) => {
  const wardId = Number(req.params.wardId);
  const created: NurseRecord = {
    id: counters.nurse++,
    wardId,
    name: req.body.name ?? `간호사 ${counters.nurse}`,
    employeeNumber: req.body.employeeNumber ?? `N-${counters.nurse}`,
    experienceLevel: req.body.experienceLevel ?? "new",
    isNightKeep: req.body.isNightKeep ?? false,
    isPregnant: req.body.isPregnant ?? false,
    allowedShifts: req.body.allowedShifts ?? ["D", "E", "N"],
    monthlyNightLimit: req.body.monthlyNightLimit ?? null,
    preceptorId: req.body.preceptorId ?? null,
    notes: req.body.notes ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  nurses.push(created);
  res.status(201).json(serializeNurse(created));
});

router.get("/wards/:wardId/nurses/:nurseId", (req, res) => {
  const wardId = Number(req.params.wardId);
  const nurseId = Number(req.params.nurseId);
  const nurse = nurses.find((item) => item.id === nurseId && item.wardId === wardId);
  if (!nurse) {
    res.status(404).json({ error: "Nurse not found" });
    return;
  }
  res.json(serializeNurse(nurse));
});

router.patch("/wards/:wardId/nurses/:nurseId", (req, res) => {
  const wardId = Number(req.params.wardId);
  const nurseId = Number(req.params.nurseId);
  const nurse = nurses.find((item) => item.id === nurseId && item.wardId === wardId);
  if (!nurse) {
    res.status(404).json({ error: "Nurse not found" });
    return;
  }

  Object.assign(nurse, req.body, { updatedAt: now() });
  res.json(serializeNurse(nurse));
});

router.delete("/wards/:wardId/nurses/:nurseId", (req, res) => {
  const nurseId = Number(req.params.nurseId);
  for (let index = nurses.length - 1; index >= 0; index--) {
    if (nurses[index].id === nurseId) nurses.splice(index, 1);
  }
  for (let index = nurseConstraints.length - 1; index >= 0; index--) {
    if (nurseConstraints[index].nurseId === nurseId) nurseConstraints.splice(index, 1);
  }
  for (let index = pairRules.length - 1; index >= 0; index--) {
    if (
      pairRules[index].preceptorId === nurseId ||
      pairRules[index].precepteeId === nurseId
    ) {
      pairRules.splice(index, 1);
    }
  }
  for (let index = scheduleEntries.length - 1; index >= 0; index--) {
    if (scheduleEntries[index].nurseId === nurseId) scheduleEntries.splice(index, 1);
  }
  for (let index = validationResults.length - 1; index >= 0; index--) {
    if (validationResults[index].nurseId === nurseId) validationResults.splice(index, 1);
  }
  res.status(204).send();
});

router.get("/wards/:wardId/nurses/:nurseId/constraints", (req, res) => {
  const nurseId = Number(req.params.nurseId);
  res.json(
    nurseConstraints
      .filter((constraint) => constraint.nurseId === nurseId)
      .sort((left, right) => left.id - right.id)
      .map((constraint) => ({
        ...constraint,
        createdAt: constraint.createdAt.toISOString(),
      }))
  );
});

router.post("/wards/:wardId/nurses/:nurseId/constraints", (req, res) => {
  const nurseId = Number(req.params.nurseId);
  const created: NurseConstraintRecord = {
    id: counters.constraint++,
    nurseId,
    constraintType: req.body.constraintType ?? "fixed_off",
    date: req.body.date ?? null,
    shiftType: req.body.shiftType ?? null,
    yearMonth: req.body.yearMonth ?? null,
    isHard: req.body.isHard ?? true,
    notes: req.body.notes ?? null,
    createdAt: now(),
  };
  nurseConstraints.push(created);
  res.status(201).json({ ...created, createdAt: created.createdAt.toISOString() });
});

router.delete("/wards/:wardId/nurses/:nurseId/constraints/:constraintId", (req, res) => {
  const constraintId = Number(req.params.constraintId);
  for (let index = nurseConstraints.length - 1; index >= 0; index--) {
    if (nurseConstraints[index].id === constraintId) nurseConstraints.splice(index, 1);
  }
  res.status(204).send();
});

router.get("/wards/:wardId/rules", (req, res) => {
  const wardId = Number(req.params.wardId);
  const rules = getDefaultRule(wardId);
  res.json({ ...rules, updatedAt: rules.updatedAt.toISOString() });
});

router.put("/wards/:wardId/rules", (req, res) => {
  const wardId = Number(req.params.wardId);
  const rules = getDefaultRule(wardId);
  Object.assign(rules, req.body, { updatedAt: now() });
  res.json({ ...rules, updatedAt: rules.updatedAt.toISOString() });
});

router.get("/wards/:wardId/pair-rules", (req, res) => {
  const wardId = Number(req.params.wardId);
  res.json(pairRules.filter((rule) => rule.wardId === wardId));
});

router.post("/wards/:wardId/pair-rules", (req, res) => {
  const wardId = Number(req.params.wardId);
  const created: PairRuleRecord = {
    id: counters.pairRule++,
    wardId,
    preceptorId: Number(req.body.preceptorId),
    precepteeId: Number(req.body.precepteeId),
    ruleType: req.body.ruleType ?? "same_shift",
    isActive: req.body.isActive ?? true,
  };
  pairRules.push(created);
  res.status(201).json(created);
});

router.delete("/wards/:wardId/pair-rules/:pairRuleId", (req, res) => {
  const pairRuleId = Number(req.params.pairRuleId);
  for (let index = pairRules.length - 1; index >= 0; index--) {
    if (pairRules[index].id === pairRuleId) pairRules.splice(index, 1);
  }
  res.status(204).send();
});

router.get("/wards/:wardId/staffing/:yearMonth", (req, res) => {
  const wardId = Number(req.params.wardId);
  const yearMonth = req.params.yearMonth;
  ensureRequirementsForMonth(wardId, yearMonth);
  res.json(
    dailyRequirements.filter(
      (requirement) =>
        requirement.wardId === wardId && requirement.date.startsWith(yearMonth)
    )
  );
});

router.post("/wards/:wardId/staffing", (req, res) => {
  const wardId = Number(req.params.wardId);
  const requirements = Array.isArray(req.body.requirements) ? req.body.requirements : [];
  const results: DailyRequirementRecord[] = [];

  for (const requirement of requirements) {
    const existing = dailyRequirements.find(
      (item) =>
        item.wardId === wardId &&
        item.date === requirement.date &&
        item.shiftType === requirement.shiftType
    );

    if (existing) {
      existing.requiredCount = requirement.requiredCount;
      existing.isHoliday = requirement.isHoliday ?? false;
      results.push(existing);
      continue;
    }

    const created: DailyRequirementRecord = {
      id: counters.staffing++,
      wardId,
      date: requirement.date,
      shiftType: requirement.shiftType,
      requiredCount: requirement.requiredCount,
      isHoliday: requirement.isHoliday ?? false,
    };
    dailyRequirements.push(created);
    results.push(created);
  }

  res.json(results);
});

router.get("/wards/:wardId/schedules", (req, res) => {
  const wardId = Number(req.params.wardId);
  res.json(
    schedules
      .filter((schedule) => schedule.wardId === wardId)
      .sort((left, right) => left.yearMonth.localeCompare(right.yearMonth))
      .map((schedule) => ({
        id: schedule.id,
        wardId: schedule.wardId,
        yearMonth: schedule.yearMonth,
        status: schedule.status,
        conflictCount: validationResults.filter(
          (result) => result.scheduleId === schedule.id && result.severity === "critical"
        ).length,
        createdAt: schedule.createdAt.toISOString(),
        updatedAt: schedule.updatedAt.toISOString(),
      }))
  );
});

router.post("/wards/:wardId/schedules", (req, res) => {
  const wardId = Number(req.params.wardId);
  const created: ScheduleRecord = {
    id: counters.schedule++,
    wardId,
    yearMonth: req.body.yearMonth,
    status: "draft",
    createdAt: now(),
    updatedAt: now(),
  };
  schedules.push(created);
  ensureRequirementsForMonth(wardId, created.yearMonth);

  if (req.body.autoGenerate) {
    const wardNurses = nurses.filter((nurse) => nurse.wardId === wardId);
    const rules = getDefaultRule(wardId);
    const requirements = dailyRequirements.filter(
      (requirement) =>
        requirement.wardId === wardId && requirement.date.startsWith(created.yearMonth)
    );
    const constraints = nurseConstraints.filter((constraint) =>
      wardNurses.some((nurse) => nurse.id === constraint.nurseId)
    );
    const pairs = pairRules.filter((pair) => pair.wardId === wardId);
    const generated = generateSchedule(
      created.yearMonth,
      wardNurses,
      rules,
      requirements,
      constraints,
      pairs
    );
    for (const entry of generated) {
      scheduleEntries.push({
        id: counters.scheduleEntry++,
        scheduleId: created.id,
        nurseId: entry.nurseId,
        date: entry.date,
        shiftType: entry.shiftType,
        isManualEdit: false,
      });
    }
    runValidationForSchedule(created.id);
  }

  res.status(201).json(getScheduleDetail(wardId, created.id));
});

router.get("/wards/:wardId/schedules/:scheduleId", (req, res) => {
  const detail = getScheduleDetail(Number(req.params.wardId), Number(req.params.scheduleId));
  if (!detail) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  res.json(detail);
});

router.delete("/wards/:wardId/schedules/:scheduleId", (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  for (let index = schedules.length - 1; index >= 0; index--) {
    if (schedules[index].id === scheduleId) schedules.splice(index, 1);
  }
  for (let index = scheduleEntries.length - 1; index >= 0; index--) {
    if (scheduleEntries[index].scheduleId === scheduleId) scheduleEntries.splice(index, 1);
  }
  for (let index = validationResults.length - 1; index >= 0; index--) {
    if (validationResults[index].scheduleId === scheduleId) validationResults.splice(index, 1);
  }
  res.status(204).send();
});

router.patch("/wards/:wardId/schedules/:scheduleId/entries", (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  const changes = Array.isArray(req.body.entries) ? req.body.entries : [];
  const updated: ScheduleEntryRecord[] = [];

  for (const change of changes) {
    const existing = scheduleEntries.find(
      (entry) =>
        entry.scheduleId === scheduleId &&
        entry.nurseId === change.nurseId &&
        entry.date === change.date
    );

    if (existing) {
      existing.shiftType = change.shiftType;
      existing.isManualEdit = true;
      updated.push(existing);
      continue;
    }

    const created: ScheduleEntryRecord = {
      id: counters.scheduleEntry++,
      scheduleId,
      nurseId: change.nurseId,
      date: change.date,
      shiftType: change.shiftType,
      isManualEdit: true,
    };
    scheduleEntries.push(created);
    updated.push(created);
  }

  const schedule = schedules.find((item) => item.id === scheduleId);
  if (schedule) schedule.updatedAt = now();
  res.json(updated);
});

router.post("/wards/:wardId/schedules/:scheduleId/generate", (req, res) => {
  const wardId = Number(req.params.wardId);
  const scheduleId = Number(req.params.scheduleId);
  const schedule = schedules.find((item) => item.id === scheduleId && item.wardId === wardId);
  if (!schedule) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  ensureRequirementsForMonth(wardId, schedule.yearMonth);
  res.json(
    regenerateDemoScheduleDetail(schedule, {
      overwriteManualEdits: req.body.overwriteManualEdits ?? false,
      priorityMode: req.body.priorityMode,
    })
  );
});

router.post("/wards/:wardId/schedules/:scheduleId/regenerate-partial", (req, res) => {
  const wardId = Number(req.params.wardId);
  const scheduleId = Number(req.params.scheduleId);
  const schedule = schedules.find((item) => item.id === scheduleId && item.wardId === wardId);
  if (!schedule) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  ensureRequirementsForMonth(wardId, schedule.yearMonth);
  const dates = Array.isArray(req.body?.dates) ? req.body.dates : [];
  res.json(
    regenerateDemoScheduleDetail(schedule, {
      targetDates: dates,
      overwriteManualEdits: req.body?.overwriteManualEdits ?? false,
      priorityMode: req.body?.priorityMode,
    })
  );
});

router.post("/wards/:wardId/schedules/:scheduleId/repair", (req, res) => {
  const wardId = Number(req.params.wardId);
  const scheduleId = Number(req.params.scheduleId);
  const schedule = schedules.find((item) => item.id === scheduleId && item.wardId === wardId);
  if (!schedule) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  const issues = runValidationForSchedule(scheduleId);
  const dates = [...new Set(
    issues
      .filter((issue) => issue.severity === "critical" && issue.date)
      .map((issue) => issue.date as string)
  )];

  if (dates.length === 0) {
    res.json(getScheduleDetail(wardId, scheduleId));
    return;
  }

  res.json(
    regenerateDemoScheduleDetail(schedule, {
      targetDates: dates,
      overwriteManualEdits: req.body?.overwriteManualEdits ?? false,
      priorityMode: req.body?.priorityMode,
    })
  );
});

router.get("/wards/:wardId/schedules/:scheduleId/recommendations", (req, res) => {
  const wardId = Number(req.params.wardId);
  const scheduleId = Number(req.params.scheduleId);
  const schedule = schedules.find((item) => item.id === scheduleId && item.wardId === wardId);
  if (!schedule) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  const wardNurses = nurses.filter((nurse) => nurse.wardId === wardId);
  const rules = getDefaultRule(wardId);
  const requirements = dailyRequirements.filter(
    (requirement) =>
      requirement.wardId === wardId && requirement.date.startsWith(schedule.yearMonth)
  );
  const constraints = nurseConstraints.filter((constraint) =>
    wardNurses.some((nurse) => nurse.id === constraint.nurseId)
  );
  const entries = scheduleEntries.filter((entry) => entry.scheduleId === scheduleId);
  const issues = runValidationForSchedule(scheduleId);
  const results = validationResults.filter((result) => result.scheduleId === scheduleId);

  res.json(
    buildScheduleRecommendations({
      entries,
      nurses: wardNurses,
      rules,
      requirements,
      constraints,
      validationResults: results.length > 0 ? results : issues.map((issue) => ({
        id: counters.validation++,
        scheduleId,
        severity: issue.severity,
        ruleCode: issue.ruleCode,
        message: issue.message,
        date: issue.date ?? null,
        nurseId: issue.nurseId ?? null,
        shiftType: issue.shiftType ?? null,
      })),
    })
  );
});

router.post("/wards/:wardId/schedules/:scheduleId/validate", (req, res) => {
  const wardId = Number(req.params.wardId);
  const scheduleId = Number(req.params.scheduleId);
  const schedule = schedules.find((item) => item.id === scheduleId && item.wardId === wardId);
  if (!schedule) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  runValidationForSchedule(scheduleId);
  res.json(getScheduleDetail(wardId, scheduleId)?.validationResults ?? []);
});

export default router;
