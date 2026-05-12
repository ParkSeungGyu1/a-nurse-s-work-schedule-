import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const wardsTable = pgTable("wards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  wardType: text("ward_type").notNull().default("일반병동"),
  shiftDStart: text("shift_d_start").default("07:00"),
  shiftDEnd: text("shift_d_end").default("15:00"),
  shiftEStart: text("shift_e_start").default("15:00"),
  shiftEEnd: text("shift_e_end").default("23:00"),
  shiftNStart: text("shift_n_start").default("23:00"),
  shiftNEnd: text("shift_n_end").default("07:00"),
  maxNurseCount: integer("max_nurse_count"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWardSchema = createInsertSchema(wardsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWard = z.infer<typeof insertWardSchema>;
export type Ward = typeof wardsTable.$inferSelect;
