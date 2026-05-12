import { Router } from "express";
import { db } from "@workspace/db";
import { dailyRequirementsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListStaffingRequirementsParams,
  UpsertStaffingRequirementsParams,
  UpsertStaffingRequirementsBody,
} from "@workspace/api-zod";

const router = Router({ mergeParams: true });

// GET /api/wards/:wardId/staffing/:yearMonth
router.get("/:yearMonth", async (req, res) => {
  const { wardId, yearMonth } = ListStaffingRequirementsParams.parse({
    wardId: Number(req.params.wardId),
    yearMonth: req.params.yearMonth,
  });
  const reqs = await db
    .select()
    .from(dailyRequirementsTable)
    .where(
      and(
        eq(dailyRequirementsTable.wardId, wardId),
        // Filter by yearMonth prefix
      )
    )
    .orderBy(dailyRequirementsTable.date);

  // Filter by yearMonth in JS (date format: YYYY-MM-DD)
  const filtered = reqs.filter((r) => r.date.startsWith(yearMonth));
  res.json(filtered);
});

// POST /api/wards/:wardId/staffing
router.post("/", async (req, res) => {
  const { wardId } = UpsertStaffingRequirementsParams.parse({ wardId: Number(req.params.wardId) });
  const body = UpsertStaffingRequirementsBody.parse(req.body);

  const results = [];
  for (const req_item of body.requirements) {
    // Upsert: try insert, on conflict update
    const [row] = await db
      .insert(dailyRequirementsTable)
      .values({
        wardId,
        date: req_item.date,
        shiftType: req_item.shiftType,
        requiredCount: req_item.requiredCount,
        isHoliday: req_item.isHoliday ?? false,
      })
      .onConflictDoUpdate({
        target: [
          dailyRequirementsTable.wardId,
          dailyRequirementsTable.date,
          dailyRequirementsTable.shiftType,
        ],
        set: {
          requiredCount: req_item.requiredCount,
          isHoliday: req_item.isHoliday ?? false,
        },
      })
      .returning();
    results.push(row);
  }
  res.json(results);
});

export default router;
