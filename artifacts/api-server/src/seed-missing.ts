import { db } from "@workspace/db";
import {
  nursesTable,
  nurseConstraintsTable,
  dailyRequirementsTable,
  schedulesTable,
} from "@workspace/db";
import { logger } from "./lib/logger";
import { eq } from "drizzle-orm";

async function seedMissing() {
  logger.info("Seeding missing data...");

  const wardId = 1;

  // Check if requirements already exist
  const existing = await db.select().from(dailyRequirementsTable).limit(1);
  if (existing.length > 0) {
    logger.info("Requirements already exist — only adding missing schedule if needed.");
  } else {
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
        { wardId, date: dateStr, shiftType: "D", requiredCount: reduced ? 3 : 4, isHoliday },
        { wardId, date: dateStr, shiftType: "E", requiredCount: 3,               isHoliday },
        { wardId, date: dateStr, shiftType: "N", requiredCount: 2,               isHoliday },
      );
    }

    await db.insert(dailyRequirementsTable).values(reqs);
    logger.info({ count: reqs.length }, "Created daily requirements");
  }

  // Nurse constraints
  const existingConstraints = await db.select().from(nurseConstraintsTable).limit(1);
  if (existingConstraints.length === 0) {
    const nurses = await db.select().from(nursesTable).where(eq(nursesTable.wardId, wardId));
    const nurse4 = nurses.find((n) => n.name === "최유진");
    const nurse6 = nurses.find((n) => n.name === "한은정");

    if (nurse4 && nurse6) {
      await db.insert(nurseConstraintsTable).values([
        { nurseId: nurse4.id, constraintType: "fixed_off", date: "2026-05-01", isHard: true, notes: "근로자의날" },
        { nurseId: nurse4.id, constraintType: "fixed_off", date: "2026-05-05", isHard: true, notes: "어린이날" },
        { nurseId: nurse6.id, constraintType: "forbidden_shift", shiftType: "E", yearMonth: "2026-05", isHard: true, notes: "임신 중 이브닝 금지" },
        { nurseId: nurse6.id, constraintType: "forbidden_shift", shiftType: "N", yearMonth: "2026-05", isHard: true, notes: "임신 중 야간 금지" },
      ]);
      logger.info("Created nurse constraints");
    }
  }

  // Set preceptors
  const nurses = await db.select().from(nursesTable).where(eq(nursesTable.wardId, wardId));
  const senior1 = nurses.find((n) => n.name === "김민지");
  const senior2 = nurses.find((n) => n.name === "윤하늘");
  const newNurses = nurses.filter((n) => n.experienceLevel === "new");

  if (senior1 && senior2) {
    for (let i = 0; i < newNurses.length; i++) {
      const preceptor = i % 2 === 0 ? senior1 : senior2;
      if (!newNurses[i].preceptorId) {
        await db.update(nursesTable).set({ preceptorId: preceptor.id }).where(eq(nursesTable.id, newNurses[i].id));
      }
    }
    logger.info("Set preceptors");
  }

  // Schedule for May 2026
  const existingSchedule = await db.select().from(schedulesTable).where(eq(schedulesTable.wardId, wardId)).limit(1);
  if (existingSchedule.length === 0) {
    const [schedule] = await db.insert(schedulesTable).values({
      wardId,
      yearMonth: "2026-05",
      status: "draft",
    }).returning();
    logger.info({ scheduleId: schedule.id }, "Created schedule");
  } else {
    logger.info("Schedule already exists");
  }

  logger.info("Done!");
}

seedMissing().catch((err) => {
  logger.error(err, "Failed");
  process.exit(1);
});
