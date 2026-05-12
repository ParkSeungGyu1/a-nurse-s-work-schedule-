import { Router } from "express";
import { db } from "@workspace/db";
import {
  schedulesTable,
  scheduleEntriesTable,
  validationResultsTable,
  nursesTable,
  wardRulesTable,
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
  ValidateScheduleParams,
} from "@workspace/api-zod";
import { generateSchedule } from "../services/generator";
import { validateSchedule } from "../services/validator";

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
    // Auto-generate entries
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
      .where(eq(dailyRequirementsTable.wardId, wardId));

    const nurseIds = nurses.map((n) => n.id);
    const constraints =
      nurseIds.length > 0
        ? await db.select().from(nurseConstraintsTable).where(
            sql`${nurseConstraintsTable.nurseId} = ANY(${sql.raw(`ARRAY[${nurseIds.join(",")}]`)})`
          )
        : [];

    if (nurses.length > 0 && rules) {
      const generated = generateSchedule(
        body.yearMonth,
        nurses,
        rules,
        requirements,
        constraints
      );
      if (generated.length > 0) {
        await db.insert(scheduleEntriesTable).values(
          generated.map((e) => ({
            scheduleId: schedule.id,
            nurseId: e.nurseId,
            date: e.date,
            shiftType: e.shiftType,
            isManualEdit: false,
          }))
        );
      }
    }
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

  const requirements = await db
    .select()
    .from(dailyRequirementsTable)
    .where(eq(dailyRequirementsTable.wardId, wardId));

  const nurseIds = nurses.map((n) => n.id);
  const constraints =
    nurseIds.length > 0
      ? await db.select().from(nurseConstraintsTable).where(
          sql`${nurseConstraintsTable.nurseId} = ANY(${sql.raw(`ARRAY[${nurseIds.join(",")}]`)})`
        )
      : [];

  // If not overwriting, only regenerate non-manual entries
  if (!body.overwriteManualEdits) {
    await db
      .delete(scheduleEntriesTable)
      .where(
        and(
          eq(scheduleEntriesTable.scheduleId, scheduleId),
          eq(scheduleEntriesTable.isManualEdit, false)
        )
      );
  } else {
    await db
      .delete(scheduleEntriesTable)
      .where(eq(scheduleEntriesTable.scheduleId, scheduleId));
  }

  const generated = generateSchedule(
    schedule.yearMonth,
    nurses,
    rules,
    requirements,
    constraints
  );

  if (generated.length > 0) {
    await db.insert(scheduleEntriesTable).values(
      generated.map((e) => ({
        scheduleId,
        nurseId: e.nurseId,
        date: e.date,
        shiftType: e.shiftType,
        isManualEdit: false,
      }))
    );
  }

  // Run validation
  const allEntries = await db
    .select()
    .from(scheduleEntriesTable)
    .where(eq(scheduleEntriesTable.scheduleId, scheduleId));

  const issues = validateSchedule(allEntries, nurses, rules, requirements);

  // Save validation results
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

  await db
    .update(schedulesTable)
    .set({ updatedAt: new Date() })
    .where(eq(schedulesTable.id, scheduleId));

  const detail = await getScheduleDetail(wardId, scheduleId);
  res.json(detail);
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

  const nurses = await db.select().from(nursesTable).where(eq(nursesTable.wardId, wardId));
  const [rules] = await db.select().from(wardRulesTable).where(eq(wardRulesTable.wardId, wardId));
  const requirements = await db.select().from(dailyRequirementsTable).where(eq(dailyRequirementsTable.wardId, wardId));
  const allEntries = await db.select().from(scheduleEntriesTable).where(eq(scheduleEntriesTable.scheduleId, scheduleId));

  if (!rules) { res.json([]); return; }

  const issues = validateSchedule(allEntries, nurses, rules, requirements);

  await db.delete(validationResultsTable).where(eq(validationResultsTable.scheduleId, scheduleId));
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
