import { Router } from "express";
import { db } from "@workspace/db";
import {
  wardsTable,
  nursesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  CreateWardBody,
  UpdateWardBody,
  UpdateWardParams,
  GetWardParams,
  DeleteWardParams,
} from "@workspace/api-zod";

const router = Router();

// GET /api/wards
router.get("/", async (req, res) => {
  const wards = await db
    .select({
      id: wardsTable.id,
      name: wardsTable.name,
      wardType: wardsTable.wardType,
      shiftDStart: wardsTable.shiftDStart,
      shiftDEnd: wardsTable.shiftDEnd,
      shiftEStart: wardsTable.shiftEStart,
      shiftEEnd: wardsTable.shiftEEnd,
      shiftNStart: wardsTable.shiftNStart,
      shiftNEnd: wardsTable.shiftNEnd,
      maxNurseCount: wardsTable.maxNurseCount,
      createdAt: wardsTable.createdAt,
    })
    .from(wardsTable)
    .orderBy(wardsTable.id);

  const wardIds = wards.map((w) => w.id);
  let nurseCounts: Record<number, number> = {};
  if (wardIds.length > 0) {
    const counts = await db
      .select({ wardId: nursesTable.wardId, count: sql<number>`count(*)::int` })
      .from(nursesTable)
      .groupBy(nursesTable.wardId);
    counts.forEach((c) => { nurseCounts[c.wardId] = c.count; });
  }

  res.json(
    wards.map((w) => ({
      ...w,
      createdAt: w.createdAt.toISOString(),
      nurseCount: nurseCounts[w.id] ?? 0,
    }))
  );
});

// POST /api/wards
router.post("/", async (req, res) => {
  const body = CreateWardBody.parse(req.body);
  const [ward] = await db
    .insert(wardsTable)
    .values({
      name: body.name,
      wardType: body.wardType,
      shiftDStart: body.shiftDStart,
      shiftDEnd: body.shiftDEnd,
      shiftEStart: body.shiftEStart,
      shiftEEnd: body.shiftEEnd,
      shiftNStart: body.shiftNStart,
      shiftNEnd: body.shiftNEnd,
      maxNurseCount: body.maxNurseCount,
    })
    .returning();
  res.status(201).json({ ...ward, createdAt: ward.createdAt.toISOString(), nurseCount: 0 });
});

// GET /api/wards/:wardId
router.get("/:wardId", async (req, res) => {
  const { wardId } = GetWardParams.parse({ wardId: Number(req.params.wardId) });
  const [ward] = await db.select().from(wardsTable).where(eq(wardsTable.id, wardId));
  if (!ward) { res.status(404).json({ error: "Ward not found" }); return; }
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nursesTable)
    .where(eq(nursesTable.wardId, wardId));
  res.json({ ...ward, createdAt: ward.createdAt.toISOString(), nurseCount: countRow?.count ?? 0 });
});

// PATCH /api/wards/:wardId
router.patch("/:wardId", async (req, res) => {
  const { wardId } = UpdateWardParams.parse({ wardId: Number(req.params.wardId) });
  const body = UpdateWardBody.parse(req.body);
  const [ward] = await db
    .update(wardsTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(wardsTable.id, wardId))
    .returning();
  if (!ward) { res.status(404).json({ error: "Ward not found" }); return; }
  res.json({ ...ward, createdAt: ward.createdAt.toISOString(), nurseCount: 0 });
});

// DELETE /api/wards/:wardId
router.delete("/:wardId", async (req, res) => {
  const { wardId } = DeleteWardParams.parse({ wardId: Number(req.params.wardId) });
  await db.delete(wardsTable).where(eq(wardsTable.id, wardId));
  res.status(204).send();
});

export default router;
