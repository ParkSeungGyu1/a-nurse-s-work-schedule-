import { Router } from "express";
import { db } from "@workspace/db";
import { wardRulesTable, pairRulesTable, nursesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  GetWardRulesParams,
  UpsertWardRulesParams,
  UpsertWardRulesBody,
  ListPairRulesParams,
  CreatePairRuleParams,
  CreatePairRuleBody,
  DeletePairRuleParams,
} from "@workspace/api-zod";

const router = Router({ mergeParams: true });

// GET /api/wards/:wardId/rules
router.get("/rules", async (req, res) => {
  const { wardId } = GetWardRulesParams.parse({ wardId: Number(req.params.wardId) });
  const [rules] = await db
    .select()
    .from(wardRulesTable)
    .where(eq(wardRulesTable.wardId, wardId));
  if (!rules) {
    // Return defaults if no rules exist
    const [inserted] = await db
      .insert(wardRulesTable)
      .values({ wardId })
      .returning();
    res.json({ ...inserted, updatedAt: inserted.updatedAt.toISOString() });
    return;
  }
  res.json({ ...rules, updatedAt: rules.updatedAt.toISOString() });
});

// PUT /api/wards/:wardId/rules
router.put("/rules", async (req, res) => {
  const { wardId } = UpsertWardRulesParams.parse({ wardId: Number(req.params.wardId) });
  const body = UpsertWardRulesBody.parse(req.body);
  const existing = await db
    .select()
    .from(wardRulesTable)
    .where(eq(wardRulesTable.wardId, wardId));
  let rules;
  if (existing.length > 0) {
    [rules] = await db
      .update(wardRulesTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(wardRulesTable.wardId, wardId))
      .returning();
  } else {
    [rules] = await db
      .insert(wardRulesTable)
      .values({ wardId, ...body })
      .returning();
  }
  res.json({ ...rules, updatedAt: rules.updatedAt.toISOString() });
});

// GET /api/wards/:wardId/pair-rules
router.get("/pair-rules", async (req, res) => {
  const { wardId } = ListPairRulesParams.parse({ wardId: Number(req.params.wardId) });
  const rules = await db
    .select()
    .from(pairRulesTable)
    .where(eq(pairRulesTable.wardId, wardId));
  res.json(rules);
});

// POST /api/wards/:wardId/pair-rules
router.post("/pair-rules", async (req, res) => {
  const { wardId } = CreatePairRuleParams.parse({ wardId: Number(req.params.wardId) });
  const body = CreatePairRuleBody.parse(req.body);
  const [rule] = await db
    .insert(pairRulesTable)
    .values({
      wardId,
      preceptorId: body.preceptorId,
      precepteeId: body.precepteeId,
      ruleType: body.ruleType,
      isActive: body.isActive ?? true,
    })
    .returning();
  res.status(201).json(rule);
});

// DELETE /api/wards/:wardId/pair-rules/:pairRuleId
router.delete("/pair-rules/:pairRuleId", async (req, res) => {
  const { pairRuleId } = DeletePairRuleParams.parse({
    wardId: Number(req.params.wardId),
    pairRuleId: Number(req.params.pairRuleId),
  });
  await db.delete(pairRulesTable).where(eq(pairRulesTable.id, pairRuleId));
  res.status(204).send();
});

export default router;
