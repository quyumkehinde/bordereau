"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireSession } from "@/server/auth";
import { approveMapping, receiveUpload, UserError } from "@/server/imports";
import { createSessionToken, passwordMatches, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/server/session";

export type FormState = { error?: string } | undefined;

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  if (!passwordMatches(String(form.get("password") ?? ""))) return { error: "Wrong password" };
  (await cookies()).set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  const next = String(form.get("next") ?? "/");
  // Only same-site paths; "//host" would be an open redirect.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

const InsurerName = z.string().trim().min(2, "Name is too short").max(120);

export async function createInsurer(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const name = InsurerName.safeParse(form.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };
  const inserted = await db.insert(schema.insurers).values({ name: name.data }).onConflictDoNothing().returning({ id: schema.insurers.id });
  if (inserted.length === 0) return { error: "An insurer with that name already exists" };
  redirect(`/insurers/${inserted[0].id}`);
}

const UploadFields = z.object({
  insurerId: z.coerce.number().int().positive(),
  kind: z.enum(["policy", "claim"]),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a reporting month"),
});

export async function uploadBordereau(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const fields = UploadFields.safeParse(Object.fromEntries(form));
  if (!fields.success) return { error: fields.error.issues[0].message };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload" };

  let result;
  try {
    result = await receiveUpload({ ...fields.data, filename: file.name, data: Buffer.from(await file.arrayBuffer()) });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/insurers/${fields.data.insurerId}`);
  if (result.status === "failed") return { error: `Couldn't read that file: ${result.error}` };
  redirect(result.status === "needs_mapping" ? `/imports/${result.importId}/map` : `/imports/${result.importId}`);
}

export async function approveMappingAction(importId: number, mapping: unknown): Promise<{ errors: string[] }> {
  await requireSession();
  const id = z.number().int().positive().parse(importId);
  const result = await approveMapping(id, mapping);
  if (!result.ok) return { errors: result.errors };
  redirect(`/imports/${id}`);
}
