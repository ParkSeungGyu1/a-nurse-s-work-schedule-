import { Router } from "express";
import { db } from "@workspace/db";
import { nursesTable, nurseConstraintsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListNursesParams,
  CreateNurseParams,
  CreateNurseBody,
  GetNurseParams,
  UpdateNurseParams,
  UpdateNurseBody,
  DeleteNurseParams,
  ListNurseConstraintsParams,
  CreateNurseConstraintParams,
  CreateNurseConstraintBody,
  DeleteNurseConstraintParams,
} from "@workspace/api-zod";

const router = Router({ mergeParams: true });

// GET /api/wards/:wardId/nurses
router.get("/", async (req, res) => {
  const { wardId } = ListNursesParams.parse({ wardId: Number(req.params.wardId) });
  const nurses = await db
    .select()
    .from(nursesTable)
    .where(eq(nursesTable.wardId, wardId))
    .orderBy(nursesTable.id);
  res.json(
    nurses.map((n) => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
    }))
  );
});

// POST /api/wards/:wardId/nurses
router.post("/", async (req, res) => {
  const { wardId } = CreateNurseParams.parse({ wardId: Number(req.params.wardId) });
  const body = CreateNurseBody.parse(req.body);
  const [nurse] = await db
    .insert(nursesTable)
    .values({
      wardId,
      name: body.name,
      employeeNumber: body.employeeNumber,
      experienceLevel: body.experienceLevel,
      isNightKeep: body.isNightKeep ?? false,
      isPregnant: body.isPregnant ?? false,
      allowedShifts: body.allowedShifts ?? ["D", "E", "N"],
      monthlyNightLimit: body.monthlyNightLimit,
      preceptorId: body.preceptorId,
      notes: body.notes,
    })
    .returning();
  res.status(201).json({ ...nurse, createdAt: nurse.createdAt.toISOString() });
});

// GET /api/wards/:wardId/nurses/:nurseId
router.get("/:nurseId", async (req, res) => {
  const { wardId, nurseId } = GetNurseParams.parse({
    wardId: Number(req.params.wardId),
    nurseId: Number(req.params.nurseId),
  });
  const [nurse] = await db
    .select()
    .from(nursesTable)
    .where(and(eq(nursesTable.id, nurseId), eq(nursesTable.wardId, wardId)));
  if (!nurse) { res.status(404).json({ error: "Nurse not found" }); return; }
  res.json({ ...nurse, createdAt: nurse.createdAt.toISOString() });
});

// PATCH /api/wards/:wardId/nurses/:nurseId
router.patch("/:nurseId", async (req, res) => {
  const { wardId, nurseId } = UpdateNurseParams.parse({
    wardId: Number(req.params.wardId),
    nurseId: Number(req.params.nurseId),
  });
  const body = UpdateNurseBody.parse(req.body);
  const [nurse] = await db
    .update(nursesTable)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(nursesTable.id, nurseId), eq(nursesTable.wardId, wardId)))
    .returning();
  if (!nurse) { res.status(404).json({ error: "Nurse not found" }); return; }
  res.json({ ...nurse, createdAt: nurse.createdAt.toISOString() });
});

// DELETE /api/wards/:wardId/nurses/:nurseId
router.delete("/:nurseId", async (req, res) => {
  const { wardId, nurseId } = DeleteNurseParams.parse({
    wardId: Number(req.params.wardId),
    nurseId: Number(req.params.nurseId),
  });
  await db
    .delete(nursesTable)
    .where(and(eq(nursesTable.id, nurseId), eq(nursesTable.wardId, wardId)));
  res.status(204).send();
});

// ── CONSTRAINTS ────────────────────────────────────────────────────────────────

// GET /api/wards/:wardId/nurses/:nurseId/constraints
router.get("/:nurseId/constraints", async (req, res) => {
  const { nurseId } = ListNurseConstraintsParams.parse({
    wardId: Number(req.params.wardId),
    nurseId: Number(req.params.nurseId),
  });
  const constraints = await db
    .select()
    .from(nurseConstraintsTable)
    .where(eq(nurseConstraintsTable.nurseId, nurseId))
    .orderBy(nurseConstraintsTable.id);
  res.json(
    constraints.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    }))
  );
});

// POST /api/wards/:wardId/nurses/:nurseId/constraints
router.post("/:nurseId/constraints", async (req, res) => {
  const { nurseId } = CreateNurseConstraintParams.parse({
    wardId: Number(req.params.wardId),
    nurseId: Number(req.params.nurseId),
  });
  const body = CreateNurseConstraintBody.parse(req.body);
  const [constraint] = await db
    .insert(nurseConstraintsTable)
    .values({
      nurseId,
      constraintType: body.constraintType,
      date: body.date,
      shiftType: body.shiftType,
      yearMonth: body.yearMonth,
      isHard: body.isHard ?? true,
      notes: body.notes,
    })
    .returning();
  res.status(201).json({ ...constraint, createdAt: constraint.createdAt.toISOString() });
});

// DELETE /api/wards/:wardId/nurses/:nurseId/constraints/:constraintId
router.delete("/:nurseId/constraints/:constraintId", async (req, res) => {
  const { constraintId } = DeleteNurseConstraintParams.parse({
    wardId: Number(req.params.wardId),
    nurseId: Number(req.params.nurseId),
    constraintId: Number(req.params.constraintId),
  });
  await db
    .delete(nurseConstraintsTable)
    .where(eq(nurseConstraintsTable.id, constraintId));
  res.status(204).send();
});

export default router;
