import { db } from "@workspace/db";
import {
  wardsTable,
  nursesTable,
  wardRulesTable,
  dailyRequirementsTable,
  nurseConstraintsTable,
  schedulesTable,
} from "@workspace/db";
import { logger } from "./lib/logger";
import { eq } from "drizzle-orm";

async function seed() {
  logger.info("Starting database seed...");

  const existingWards = await db.select().from(wardsTable);
  if (existingWards.length > 0) {
    logger.info("Database already seeded, skipping.");
    return;
  }

  // Create sample ward
  const [ward] = await db
    .insert(wardsTable)
    .values({
      name: "3내과병동",
      wardType: "내과",
      shiftDStart: "07:00",
      shiftDEnd: "15:00",
      shiftEStart: "15:00",
      shiftEEnd: "23:00",
      shiftNStart: "23:00",
      shiftNEnd: "07:00",
      maxNurseCount: 20,
    })
    .returning();

  logger.info({ wardId: ward.id }, "Created ward");

  // Create ward rules
  await db.insert(wardRulesTable).values({
    wardId: ward.id,
    maxConsecutiveWorkDays: 5,
    offDaysAfterConsecutiveWork: 2,
    maxConsecutiveNightShifts: 3,
    offDaysAfterNightShifts: 2,
    allowEToD: false,
    monthlyMaxNightShifts: 8,
    minExperiencedPerShift: 2,
    maxNewNurseRatioPerShift: 0.3,
    weekendFairness: true,
    holidayFairness: true,
  });

  // Create 12 nurses
  const nurseData = [
    { name: "김민지", employeeNumber: "N001", experienceLevel: "senior",     isNightKeep: false, isPregnant: false, allowedShifts: ["D","E","N"], monthlyNightLimit: 8  },
    { name: "이서연", employeeNumber: "N002", experienceLevel: "experienced", isNightKeep: true,  isPregnant: false, allowedShifts: ["D","E","N"], monthlyNightLimit: 10 },
    { name: "박지현", employeeNumber: "N003", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D","E","N"], monthlyNightLimit: 8  },
    { name: "최유진", employeeNumber: "N004", experienceLevel: "new",         isNightKeep: false, isPregnant: false, allowedShifts: ["D","E"],     monthlyNightLimit: 4  },
    { name: "정수민", employeeNumber: "N005", experienceLevel: "new",         isNightKeep: false, isPregnant: false, allowedShifts: ["D","E","N"], monthlyNightLimit: 4  },
    { name: "한은정", employeeNumber: "N006", experienceLevel: "experienced", isNightKeep: false, isPregnant: true,  allowedShifts: ["D"],          monthlyNightLimit: 0  },
    { name: "오채원", employeeNumber: "N007", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D","E","N"], monthlyNightLimit: 8  },
    { name: "신다은", employeeNumber: "N008", experienceLevel: "new",         isNightKeep: false, isPregnant: false, allowedShifts: ["D","E","N"], monthlyNightLimit: 5  },
    { name: "윤하늘", employeeNumber: "N009", experienceLevel: "senior",      isNightKeep: false, isPregnant: false, allowedShifts: ["D","E","N"], monthlyNightLimit: 8  },
    { name: "강미래", employeeNumber: "N010", experienceLevel: "experienced", isNightKeep: true,  isPregnant: false, allowedShifts: ["D","E","N"], monthlyNightLimit: 10 },
    { name: "임소율", employeeNumber: "N011", experienceLevel: "new",         isNightKeep: false, isPregnant: false, allowedShifts: ["D","E","N"], monthlyNightLimit: 4  },
    { name: "장보라", employeeNumber: "N012", experienceLevel: "experienced", isNightKeep: false, isPregnant: false, allowedShifts: ["D","E","N"], monthlyNightLimit: 8  },
  ];

  const nurses = await db
    .insert(nursesTable)
    .values(nurseData.map((n) => ({ wardId: ward.id, ...n })))
    .returning();

  logger.info({ count: nurses.length }, "Created nurses");

  // Set preceptors for new nurses
  const senior1 = nurses.find((n) => n.name === "김민지")!;
  const senior2 = nurses.find((n) => n.name === "윤하늘")!;
  const newNurses = nurses.filter((n) => n.experienceLevel === "new");

  for (let i = 0; i < newNurses.length; i++) {
    const preceptor = i % 2 === 0 ? senior1 : senior2;
    await db
      .update(nursesTable)
      .set({ preceptorId: preceptor.id })
      .where(eq(nursesTable.id, newNurses[i].id));
  }

  // Nurse constraints
  const nurse4 = nurses.find((n) => n.name === "최유진")!;
  const nurse6 = nurses.find((n) => n.name === "한은정")!;

  await db.insert(nurseConstraintsTable).values([
    { nurseId: nurse4.id, constraintType: "fixed_off",      date: "2026-05-01", isHard: true,  notes: "근로자의날 휴가" },
    { nurseId: nurse4.id, constraintType: "fixed_off",      date: "2026-05-05", isHard: true,  notes: "어린이날 공휴일" },
    { nurseId: nurse6.id, constraintType: "forbidden_shift", shiftType: "E",    yearMonth: "2026-05", isHard: true, notes: "임신 중 이브닝 금지" },
    { nurseId: nurse6.id, constraintType: "forbidden_shift", shiftType: "N",    yearMonth: "2026-05", isHard: true, notes: "임신 중 야간 금지" },
  ]);

  // Daily requirements for May 2026
  const reqs: Array<{
    wardId: number; date: string; shiftType: string;
    requiredCount: number; isHoliday: boolean;
  }> = [];

  const holidays = new Set(["2026-05-01", "2026-05-05", "2026-05-15"]);

  for (let day = 1; day <= 31; day++) {
    const dateStr = `2026-05-${String(day).padStart(2, "0")}`;
    const dow = new Date(dateStr).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = holidays.has(dateStr);
    const reduced = isWeekend || isHoliday;

    reqs.push(
      { wardId: ward.id, date: dateStr, shiftType: "D", requiredCount: reduced ? 3 : 4, isHoliday },
      { wardId: ward.id, date: dateStr, shiftType: "E", requiredCount: 3,               isHoliday },
      { wardId: ward.id, date: dateStr, shiftType: "N", requiredCount: 2,               isHoliday },
    );
  }

  await db.insert(dailyRequirementsTable).values(reqs);
  logger.info({ count: reqs.length }, "Created daily requirements");

  // Empty schedule shell for May 2026
  await db.insert(schedulesTable).values({
    wardId: ward.id,
    yearMonth: "2026-05",
    status: "draft",
  });

  logger.info("Seed complete!");
}

seed().catch((err) => {
  logger.error(err, "Seed failed");
  process.exit(1);
});
