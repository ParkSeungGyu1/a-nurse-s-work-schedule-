import { pgTable, serial, text, integer, boolean, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { wardsTable } from "./wards";
import { nursesTable } from "./nurses";

export const wardRulesTable = pgTable("ward_rules", {
  id: serial("id").primaryKey(),
  wardId: integer("ward_id").notNull().references(() => wardsTable.id, { onDelete: "cascade" }).unique(),
  maxConsecutiveWorkDays: integer("max_consecutive_work_days").notNull().default(5),
  offDaysAfterConsecutiveWork: integer("off_days_after_consecutive_work").notNull().default(2),
  maxConsecutiveNightShifts: integer("max_consecutive_night_shifts").notNull().default(3),
  offDaysAfterNightShifts: integer("off_days_after_night_shifts").notNull().default(2),
  allowEToD: boolean("allow_e_to_d").notNull().default(false),
  monthlyMaxNightShifts: integer("monthly_max_night_shifts").notNull().default(8),
  minExperiencedPerShift: integer("min_experienced_per_shift").notNull().default(2),
  maxNewNurseRatioPerShift: real("max_new_nurse_ratio_per_shift").notNull().default(0.3),
  weekendFairness: boolean("weekend_fairness").notNull().default(true),
  holidayFairness: boolean("holiday_fairness").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const pairRulesTable = pgTable("pair_rules", {
  id: serial("id").primaryKey(),
  wardId: integer("ward_id").notNull().references(() => wardsTable.id, { onDelete: "cascade" }),
  preceptorId: integer("preceptor_id").notNull().references(() => nursesTable.id, { onDelete: "cascade" }),
  precepteeId: integer("preceptee_id").notNull().references(() => nursesTable.id, { onDelete: "cascade" }),
  ruleType: text("rule_type").notNull().default("same_shift"), // same_shift | different_shift
  isActive: boolean("is_active").notNull().default(true),
});

export const insertWardRuleSchema = createInsertSchema(wardRulesTable).omit({ id: true, updatedAt: true });
export const insertPairRuleSchema = createInsertSchema(pairRulesTable).omit({ id: true });
export type InsertWardRule = z.infer<typeof insertWardRuleSchema>;
export type WardRule = typeof wardRulesTable.$inferSelect;
export type InsertPairRule = z.infer<typeof insertPairRuleSchema>;
export type PairRule = typeof pairRulesTable.$inferSelect;
