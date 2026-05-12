import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { wardsTable } from "./wards";

export const nursesTable = pgTable("nurses", {
  id: serial("id").primaryKey(),
  wardId: integer("ward_id").notNull().references(() => wardsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  employeeNumber: text("employee_number").notNull(),
  experienceLevel: text("experience_level").notNull().default("new"), // new | experienced | senior
  isNightKeep: boolean("is_night_keep").notNull().default(false),
  isPregnant: boolean("is_pregnant").notNull().default(false),
  allowedShifts: text("allowed_shifts").array().notNull().default(["D", "E", "N"]),
  monthlyNightLimit: integer("monthly_night_limit"),
  preceptorId: integer("preceptor_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const nurseConstraintsTable = pgTable("nurse_constraints", {
  id: serial("id").primaryKey(),
  nurseId: integer("nurse_id").notNull().references(() => nursesTable.id, { onDelete: "cascade" }),
  constraintType: text("constraint_type").notNull(), // fixed_off | preferred_off | forbidden_shift | education | annual_leave
  date: text("date"), // YYYY-MM-DD
  shiftType: text("shift_type"), // D | E | N
  yearMonth: text("year_month"), // YYYY-MM
  isHard: boolean("is_hard").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertNurseSchema = createInsertSchema(nursesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertNurseConstraintSchema = createInsertSchema(nurseConstraintsTable).omit({ id: true, createdAt: true });
export type InsertNurse = z.infer<typeof insertNurseSchema>;
export type Nurse = typeof nursesTable.$inferSelect;
export type InsertNurseConstraint = z.infer<typeof insertNurseConstraintSchema>;
export type NurseConstraint = typeof nurseConstraintsTable.$inferSelect;
