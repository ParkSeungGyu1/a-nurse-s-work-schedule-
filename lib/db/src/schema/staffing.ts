import { pgTable, serial, integer, text, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { wardsTable } from "./wards";

export const dailyRequirementsTable = pgTable("daily_requirements", {
  id: serial("id").primaryKey(),
  wardId: integer("ward_id").notNull().references(() => wardsTable.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // YYYY-MM-DD
  shiftType: text("shift_type").notNull(), // D | E | N
  requiredCount: integer("required_count").notNull().default(3),
  isHoliday: boolean("is_holiday").notNull().default(false),
}, (table) => ({
  uniqueWardDateShift: unique().on(table.wardId, table.date, table.shiftType),
}));

export const insertDailyRequirementSchema = createInsertSchema(dailyRequirementsTable).omit({ id: true });
export type InsertDailyRequirement = z.infer<typeof insertDailyRequirementSchema>;
export type DailyRequirement = typeof dailyRequirementsTable.$inferSelect;
