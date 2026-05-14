import { Router } from "express";
import { db } from "@workspace/db";
import {
  schedulesTable,
  scheduleEntriesTable,
  validationResultsTable,
  nursesTable,
  wardRulesTable,
  pairRulesTable,
  dailyRequirementsTable,
  nurseConstraintsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  ListSchedulesParams,
  CreateScheduleParams,
  CreateScheduleBody,
  GetScheduleParams,
  DeleteScheduleParams,
  UpdateScheduleEntriesParams,
  UpdateScheduleEntriesBody,
  GenerateScheduleParams,
  GenerateScheduleBody,
  RegeneratePartialScheduleParams,
  RegeneratePartialScheduleBody,
  RepairScheduleParams,
  RepairScheduleBody,
  GetScheduleRecommendationsParams,
  ValidateScheduleParams,
} from "@workspace/api-zod";
import { generateSchedule } from "../services/generator";
import { validateSchedule } from "../services/validator";
import { buildScheduleRecommendations } from "../services/recommendations";
import { inArray } from "drizzle-orm";

const router = Router({ mergeParams: true });

async function getScheduleDetail(wardId: number, scheduleId: number) {
  const [schedule] = await db
    .select()
    .from(schedulesTable)
    .where(and(eq(schedulesTable.id, scheduleId), eq(schedulesTable.wardId, wardId)));
  if (!schedule) return null;

  const entries = await db
    .select({
      id: scheduleEntriesTable.id,
      scheduleId: scheduleEntriesTable.scheduleId,
      nurseId: scheduleEntriesTable.nurseId,
      nurseName: nursesTable.name,
      nurseExperienceLevel: nursesTable.experienceLevel,
      date: scheduleEntriesTable.date,
      shiftType: scheduleEntriesTable.shiftType,
      isManualEdit: scheduleEntriesTable.isManualEdit,
    })
    .from(scheduleEntriesTable)
    .leftJoin(nursesTable, eq(scheduleEntriesTable.nurseId, nursesTable.id))
    .where(eq(scheduleEntriesTable.scheduleId, scheduleId))
    .orderBy(scheduleEntriesTable.date, scheduleEntriesTable.nurseId);

  const validationResults = await db
    .select({
      id: validationResultsTable.id,
      scheduleId: validationResultsTable.scheduleId,
      severity: validationResultsTable.severity,
      ruleCode: validationResultsTable.ruleCode,
      message: validationResultsTable.message,
      date: validationResultsTable.date,
      nurseId: validationResultsTable.nurseId,
      nurseName: nursesTable.name,
      shiftType: validationResultsTable.shiftType,
    })
    .from(validationResultsTable)
    .leftJoin(nursesTable, eq(validationResultsTable.nurseId, nursesTable.id))
    .where(eq(validationResultsTable.scheduleId, scheduleId))
    .orderBy(validationResultsTable.severity, validationResultsTable.date);

  const conflictCount = validationResults.filter(
    (v) => v.severity === "critical"
  ).length;

  return {
    id: schedule.id,
    wardId: schedule.wardId,
    yearMonth: schedule.yearMonth,
    status: schedule.status,
    entries,
    validationResults,
    conflictCount,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

function getMonthDates(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${yearMonth}-${day}`;
  });
}

async function loadScheduleGenerationContext(wardId: number, yearMonth: string) {
  const nurses = await db
    .select()
    .from(nursesTable)
    .where(eq(nursesTable.wardId, wardId));

  const [rules] = await db
    .select()
    .from(wardRulesTable)
    .where(eq(wardRulesTable.wardId, wardId));

  const requirements = await db
    .select()
    .from(dailyRequirementsTable)
    .where(
      and(
        eq(dailyRequirementsTable.wardId, wardId),
        sql`${dailyRequirementsTable.date} like ${`${yearMonth}%`}`
      )
    );

  const pairRules = await db
    .select()
    .from(pairRulesTable)
    .where(eq(pairRulesTable.wardId, wardId));

  const nurseIds = nurses.map((nurse) => nurse.id);
  const constraints =
    nurseIds.length > 0
      ? await db.select().from(nurseConstraintsTable).where(
          sql`${nurseConstraintsTable.nurseId} = ANY(${sql.raw(`ARRAY[${nurseIds.join(",")}]`)})`
        )
      : [];

  return { nurses, rules, requirements, pairRules, constraints };
}

async function persistValidationResults(
  scheduleId: number,
  wardId: number,
  yearMonth: string
) {
  const { nurses, rules, requirements, pairRules } =
    await loadScheduleGenerationContext(wardId, yearMonth);
  if (!rules) return [];

  const allEntries = await db
    .select()
    .from(scheduleEntriesTable)
    .where(eq(scheduleEntriesTable.scheduleId, scheduleId));

  const issues = validateSchedule(allEntries, nurses, rules, requirements, pairRules);

  await db
    .delete(validationResultsTable)
    .where(eq(validationResultsTable.scheduleId, scheduleId));

  if (issues.length > 0) {
    await db.insert(validationResultsTable).values(
      issues.map((issue) => ({
        scheduleId,
        severity: issue.severity,
        ruleCode: issue.ruleCode,
        message: issue.message,
        date: issue.date,
        nurseId: issue.nurseId,
        shiftType: issue.shiftType,
      }))
    );
  }

  return issues;
}

async function regenerateScheduleDetail(
  wardId: number,
  schedule: { id: number; wardId: number; yearMonth: string },
  options: {
    overwriteManualEdits?: boolean;
    targetDates?: string[];
    priorityMode?: "balanced" | "fairness" | "coverage" | "new_nurse_protection";
  }
) {
  const { nurses, rules, requirements, constraints, pairRules } =
    await loadScheduleGenerationContext(wardId, schedule.yearMonth);

  if (!rules || nurses.length === 0) {
    throw new Error("Ward rules or nurses not configured");
  }

  const targetDates = [...new Set(options.targetDates ?? getMonthDates(schedule.yearMonth))].sort();
  if (targetDates.length === 0) {
    return getScheduleDetail(wardId, schedule.id);
  }

  const overwriteManualEdits = options.overwriteManualEdits ?? false;
  const targetDateSet = new Set(targetDates);

  const preservedManualKeys = overwriteManualEdits
    ? new Set<string>()
    : new Set(
        (
          await db
            .select({
              nurseId: scheduleEntriesTable.nurseId,
              date: scheduleEntriesTable.date,
            })
            .from(scheduleEntriesTable)
            .where(
              and(
                eq(scheduleEntriesTable.scheduleId, schedule.id),
                eq(scheduleEntriesTable.isManualEdit, true),
                inArray(scheduleEntriesTable.date, targetDates)
              )
            )
        ).map((entry) => `${entry.nurseId}:${entry.date}`)
      );

  await db
    .delete(scheduleEntriesTable)
    .where(
      and(
        eq(scheduleEntriesTable.scheduleId, schedule.id),
        inArray(scheduleEntriesTable.date, targetDates),
        overwriteManualEdits ? sql`true` : eq(scheduleEntriesTable.isManualEdit, false)
      )
    );

  const generated = generateSchedule(
    schedule.yearMonth,
    nurses,
    rules,
    requirements,
    constraints,
    pairRules,
    { priorityMode: options.priorityMode }
  );

  const generatedToInsert = generated.filter(
    (entry) =>
      targetDateSet.has(entry.date) &&
      !preservedManualKeys.has(`${entry.nurseId}:${entry.date}`)
  );

  if (generatedToInsert.length > 0) {
    await db.insert(scheduleEntriesTable).values(
      generatedToInsert.map((entry) => ({
        scheduleId: schedule.id,
        nurseId: entry.nurseId,
        date: entry.date,
        shiftType: entry.shiftType,
        isManualEdit: false,
      }))
    );
  }

  await persistValidationResults(schedule.id, wardId, schedule.yearMonth);

  await db
    .update(schedulesTable)
    .set({ updatedAt: new Date() })
    .where(eq(schedulesTable.id, schedule.id));

  return getScheduleDetail(wardId, schedule.id);
}

// GET /api/wards/:wardId/schedules
router.get("/", async (req, res) => {
  const { wardId } = ListSchedulesParams.parse({ wardId: Number(req.params.wardId) });
  const schedules = await db
    .select({
      id: schedulesTable.id,
      wardId: schedulesTable.wardId,
      yearMonth: schedulesTable.yearMonth,
      status: schedulesTable.status,
      createdAt: schedulesTable.createdAt,
      updatedAt: schedulesTable.updatedAt,
    })
    .from(schedulesTable)
    .where(eq(schedulesTable.wardId, wardId))
    .orderBy(schedulesTable.yearMonth);

  const result = await Promise.all(
    schedules.map(async (s) => {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(validationResultsTable)
        .where(
          and(
            eq(validationResultsTable.scheduleId, s.id),
            sql`${validationResultsTable.severity} = 'critical'`
          )
        );
      return {
        ...s,
        conflictCount: countRow?.count ?? 0,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      };
    })
  );

  res.json(result);
});

// POST /api/wards/:wardId/schedules
router.post("/", async (req, res) => {
  const { wardId } = CreateScheduleParams.parse({ wardId: Number(req.params.wardId) });
  const body = CreateScheduleBody.parse(req.body);

  const [schedule] = await db
    .insert(schedulesTable)
    .values({ wardId, yearMonth: body.yearMonth, status: "draft" })
    .returning();

  if (body.autoGenerate) {
    await regenerateScheduleDetail(wardId, schedule, {
      overwriteManualEdits: true,
      priorityMode: "balanced",
    });
  }

  const detail = await getScheduleDetail(wardId, schedule.id);
  res.status(201).json(detail);
});

// GET /api/wards/:wardId/schedules/:scheduleId
router.get("/:scheduleId", async (req, res) => {
  const { wardId, scheduleId } = GetScheduleParams.parse({
    wardId: Number(req.params.wardId),
    scheduleId: Number(req.params.scheduleId),
  });
  const detail = await getScheduleDetail(wardId, scheduleId);
  if (!detail) { res.status(404).json({ error: "Schedule not found" }); return; }
  res.json(detail);
});

// DELETE /api/wards/:wardId/schedules/:scheduleId
router.delete("/:scheduleId", async (req, res) => {
  const { wardId, scheduleId } = DeleteScheduleParams.parse({
    wardId: Number(req.params.wardId),
    scheduleId: Number(req.params.scheduleId),
  });
  await db
    .delete(schedulesTable)
    .where(and(eq(schedulesTable.id, scheduleId), eq(schedulesTable.wardId, wardId)));
  res.status(204).send();
});

// PATCH /api/wards/:wardId/schedules/:scheduleId/entries
router.patch("/:scheduleId/entries", async (req, res) => {
  const { wardId, scheduleId } = UpdateScheduleEntriesParams.parse({
    wardId: Number(req.params.wardId),
    scheduleId: Number(req.params.scheduleId),
  });
  const body = UpdateScheduleEntriesBody.parse(req.body);

  const updated = [];
  for (const entry of body.entries) {
    // Upsert: find existing entry and update, or insert new
    const existing = await db
      .select()
      .from(scheduleEntriesTable)
      .where(
        and(
          eq(scheduleEntriesTable.scheduleId, scheduleId),
          eq(scheduleEntriesTable.nurseId, entry.nurseId),
          eq(scheduleEntriesTable.date, entry.date)
        )
      );
    if (existing.length > 0) {
      const [row] = await db
        .update(scheduleEntriesTable)
        .set({ shiftType: entry.shiftType, isManualEdit: true })
        .where(eq(scheduleEntriesTable.id, existing[0].id))
        .returning();
      updated.push(row);
    } else {
      const [row] = await db
        .insert(scheduleEntriesTable)
        .values({
          scheduleId,
          nurseId: entry.nurseId,
          date: entry.date,
          shiftType: entry.shiftType,
          isManualEdit: true,
        })
        .returning();
      updated.push(row);
    }
  }

  // Update schedule updatedAt
  await db
    .update(schedulesTable)
    .set({ updatedAt: new Date() })
    .where(eq(schedulesTable.id, scheduleId));

  res.json(updated);
});

// POST /api/wards/:wardId/schedules/:scheduleId/generate
router.post("/:scheduleId/generate", async (req, res) => {
  const { wardId, scheduleId } = GenerateScheduleParams.parse({
    wardId: Number(req.params.wardId),
    scheduleId: Number(req.params.scheduleId),
  });
  const body = GenerateScheduleBody.parse(req.body);

  const [schedule] = await db
    .select()
    .from(schedulesTable)
    .where(and(eq(schedulesTable.id, scheduleId), eq(schedulesTable.wardId, wardId)));
  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }

  const nurses = await db
    .select()
    .from(nursesTable)
    .where(eq(nursesTable.wardId, wardId));

  const [rules] = await db
    .select()
    .from(wardRulesTable)
    .where(eq(wardRulesTable.wardId, wardId));

  if (!rules || nurses.length === 0) {
    res.status(400).json({ error: "Ward rules or nurses not configured" });
    return;
  }

  const detail = await regenerateScheduleDetail(wardId, schedule, {
    overwriteManualEdits: body.overwriteManualEdits,
    priorityMode: body.priorityMode as
      | "balanced"
      | "fairness"
      | "coverage"
      | "new_nurse_protection"
      | undefined,
  });
  res.json(detail);
});

// POST /api/wards/:wardId/schedules/:scheduleId/regenerate-partial
router.post("/:scheduleId/regenerate-partial", async (req, res) => {
  const { wardId, scheduleId } = RegeneratePartialScheduleParams.parse({
    wardId: Number(req.params.wardId),
    scheduleId: Number(req.params.scheduleId),
  });
  const body = RegeneratePartialScheduleBody.parse(req.body);

  const [schedule] = await db
    .select()
    .from(schedulesTable)
    .where(and(eq(schedulesTable.id, scheduleId), eq(schedulesTable.wardId, wardId)));
  if (!schedule) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  const detail = await regenerateScheduleDetail(wardId, schedule, {
    targetDates: body.dates,
    overwriteManualEdits: body.overwriteManualEdits,
    priorityMode: body.priorityMode as
      | "balanced"
      | "fairness"
      | "coverage"
      | "new_nurse_protection"
      | undefined,
  });

  res.json(detail);
});

// POST /api/wards/:wardId/schedules/:scheduleId/repair
router.post("/:scheduleId/repair", async (req, res) => {
  const { wardId, scheduleId } = RepairScheduleParams.parse({
    wardId: Number(req.params.wardId),
    scheduleId: Number(req.params.scheduleId),
  });
  const body = RepairScheduleBody.parse(req.body ?? {});

  const [schedule] = await db
    .select()
    .from(schedulesTable)
    .where(and(eq(schedulesTable.id, scheduleId), eq(schedulesTable.wardId, wardId)));
  if (!schedule) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  const issues = await persistValidationResults(scheduleId, wardId, schedule.yearMonth);
  const conflictDates = [...new Set(
    issues
      .filter((issue) => issue.severity === "critical" && issue.date)
      .map((issue) => issue.date as string)
  )];

  if (conflictDates.length === 0) {
    const detail = await getScheduleDetail(wardId, scheduleId);
    res.json(detail);
    return;
  }

  const detail = await regenerateScheduleDetail(wardId, schedule, {
    targetDates: conflictDates,
    overwriteManualEdits: body.overwriteManualEdits,
    priorityMode: body.priorityMode as
      | "balanced"
      | "fairness"
      | "coverage"
      | "new_nurse_protection"
      | undefined,
  });

  res.json(detail);
});

// GET /api/wards/:wardId/schedules/:scheduleId/recommendations
router.get("/:scheduleId/recommendations", async (req, res) => {
  const { wardId, scheduleId } = GetScheduleRecommendationsParams.parse({
    wardId: Number(req.params.wardId),
    scheduleId: Number(req.params.scheduleId),
  });

  const [schedule] = await db
    .select()
    .from(schedulesTable)
    .where(and(eq(schedulesTable.id, scheduleId), eq(schedulesTable.wardId, wardId)));
  if (!schedule) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  await persistValidationResults(scheduleId, wardId, schedule.yearMonth);

  const { nurses, rules, requirements, constraints } =
    await loadScheduleGenerationContext(wardId, schedule.yearMonth);
  if (!rules) {
    res.json({
      totalIssues: 0,
      actionableIssues: 0,
      unresolvedCriticalCount: 0,
      items: [],
    });
    return;
  }

  const entries = await db
    .select()
    .from(scheduleEntriesTable)
    .where(eq(scheduleEntriesTable.scheduleId, scheduleId));
  const validationResults = await db
    .select()
    .from(validationResultsTable)
    .where(eq(validationResultsTable.scheduleId, scheduleId));

  res.json(
    buildScheduleRecommendations({
      entries,
      nurses,
      rules,
      requirements,
      constraints,
      validationResults,
    })
  );
});

// POST /api/wards/:wardId/schedules/:scheduleId/validate
router.post("/:scheduleId/validate", async (req, res) => {
  const { wardId, scheduleId } = ValidateScheduleParams.parse({
    wardId: Number(req.params.wardId),
    scheduleId: Number(req.params.scheduleId),
  });

  const [schedule] = await db
    .select()
    .from(schedulesTable)
    .where(and(eq(schedulesTable.id, scheduleId), eq(schedulesTable.wardId, wardId)));
  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }

  await persistValidationResults(scheduleId, wardId, schedule.yearMonth);

  // Return with nurse names
  const results = await db
    .select({
      id: validationResultsTable.id,
      scheduleId: validationResultsTable.scheduleId,
      severity: validationResultsTable.severity,
      ruleCode: validationResultsTable.ruleCode,
      message: validationResultsTable.message,
      date: validationResultsTable.date,
      nurseId: validationResultsTable.nurseId,
      nurseName: nursesTable.name,
      shiftType: validationResultsTable.shiftType,
    })
    .from(validationResultsTable)
    .leftJoin(nursesTable, eq(validationResultsTable.nurseId, nursesTable.id))
    .where(eq(validationResultsTable.scheduleId, scheduleId));

  res.json(results);
});

export default router;
