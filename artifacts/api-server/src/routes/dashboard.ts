import { Router } from "express";
import { db } from "@workspace/db";
import {
  wardsTable,
  nursesTable,
  schedulesTable,
  validationResultsTable,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";

const router = Router();

// GET /api/dashboard/summary
router.get("/summary", async (_req, res) => {
  const [wardCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(wardsTable);

  const [nurseCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nursesTable);

  const [activeSchedules] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schedulesTable)
    .where(sql`${schedulesTable.status} IN ('draft', 'published')`);

  const [unresolvedConflicts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(validationResultsTable)
    .where(sql`${validationResultsTable.severity} = 'critical'`);

  const recentSchedules = await db
    .select({
      id: schedulesTable.id,
      wardId: schedulesTable.wardId,
      wardName: wardsTable.name,
      yearMonth: schedulesTable.yearMonth,
      status: schedulesTable.status,
      createdAt: schedulesTable.createdAt,
      updatedAt: schedulesTable.updatedAt,
    })
    .from(schedulesTable)
    .leftJoin(wardsTable, eq(schedulesTable.wardId, wardsTable.id))
    .orderBy(sql`${schedulesTable.updatedAt} DESC`)
    .limit(5);

  res.json({
    wardCount: wardCount?.count ?? 0,
    nurseCount: nurseCount?.count ?? 0,
    activeSchedules: activeSchedules?.count ?? 0,
    unresolvedConflicts: unresolvedConflicts?.count ?? 0,
    recentSchedules: recentSchedules.map((s) => ({
      ...s,
      conflictCount: null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
});

export default router;
