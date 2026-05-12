import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { wardsTable } from "./wards";
import { nursesTable } from "./nurses";

export const schedulesTable = pgTable("schedules", {
  id: serial("id").primaryKey(),
  wardId: integer("ward_id").notNull().references(() => wardsTable.id, { onDelete: "cascade" }),
  yearMonth: text("year_month").notNull(), // YYYY-MM
  status: text("status").notNull().default("draft"), // draft | published | archived
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const scheduleEntriesTable = pgTable("schedule_entries", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull().references(() => schedulesTable.id, { onDelete: "cascade" }),
  nurseId: integer("nurse_id").notNull().references(() => nursesTable.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // YYYY-MM-DD
  shiftType: text("shift_type").notNull(), // D | E | N | OFF
  isManualEdit: boolean("is_manual_edit").notNull().default(false),
});

export const validationResultsTable = pgTable("validation_results", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull().references(() => schedulesTable.id, { onDelete: "cascade" }),
  severity: text("severity").notNull(), // critical | warning | info
  ruleCode: text("rule_code").notNull(),
  message: text("message").notNull(),
  date: text("date"),
  nurseId: integer("nurse_id"),
  shiftType: text("shift_type"),
});

export const insertScheduleSchema = createInsertSchema(schedulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertScheduleEntrySchema = createInsertSchema(scheduleEntriesTable).omit({ id: true });
export const insertValidationResultSchema = createInsertSchema(validationResultsTable).omit({ id: true });
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Schedule = typeof schedulesTable.$inferSelect;
export type InsertScheduleEntry = z.infer<typeof insertScheduleEntrySchema>;
export type ScheduleEntry = typeof scheduleEntriesTable.$inferSelect;
export type InsertValidationResult = z.infer<typeof insertValidationResultSchema>;
export type ValidationResult = typeof validationResultsTable.$inferSelect;
