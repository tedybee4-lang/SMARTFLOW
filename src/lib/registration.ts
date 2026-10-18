import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;

/** Account-registration schema used by /register (client-side validation;
 *  the actual account is created by Supabase Auth — passwords never touch our servers). */
export const RegisterSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name").max(120, "Name is too long"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Email is required")
      .max(255, "Email is too long")
      .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address"),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
      .max(200, "Password is too long"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof RegisterSchema>;
