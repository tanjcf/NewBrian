export interface RememberedLogin {
  version: 1;
  channel: "email" | "phone";
  email: string;
  phone: string;
  password: string;
}

export interface RememberedLoginForm {
  channel: "email" | "phone";
  email: string;
  phone: string;
  password: string;
  captcha: string;
  agreementAccepted: boolean;
}

function isCnMobile(value: string): boolean {
  return /^1\d{10}$/u.test(value);
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (!email) return "";
  if (email.length > 320 || /[\r\n\0]/u.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return null;
  return email;
}

function cleanPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.replace(/\D/g, "");
  if (!phone) return "";
  if (!isCnMobile(phone)) return null;
  return phone;
}

function cleanPassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > 256 || /[\r\n\0]/u.test(value)) return null;
  return value;
}

/** Accept only a bounded login-form snapshot. Returns null for anything else. */
export function parseRememberedLogin(value: unknown): RememberedLogin | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== undefined && record.version !== 1) return null;
  if (record.channel !== "email" && record.channel !== "phone") return null;
  const email = cleanEmail(record.email);
  const phone = cleanPhone(record.phone);
  const password = cleanPassword(record.password);
  if (email === null || phone === null || password === null) return null;
  if (record.channel === "email" && !email) return null;
  if (record.channel === "phone" && !phone) return null;
  if (!email && !phone) return null;
  return { version: 1, channel: record.channel, email, phone, password };
}

export function mergeRememberedLogin(
  previous: RememberedLogin | null,
  form: Pick<RememberedLoginForm, "channel" | "email" | "phone" | "password">,
  savePassword: boolean
): RememberedLogin | null {
  const email = cleanEmail(form.email);
  const phone = cleanPhone(form.phone);
  const typedPassword = cleanPassword(savePassword ? form.password : previous?.password ?? "");
  if (email === null || phone === null || typedPassword === null) return null;
  return parseRememberedLogin({
    version: 1,
    channel: form.channel === "phone" ? "phone" : "email",
    email: email || previous?.email || "",
    phone: phone || previous?.phone || "",
    password: typedPassword
  });
}

/** Fill empty login fields from the saved snapshot. Leave captcha and agreement untouched. */
export function applyRememberedLogin<T extends RememberedLoginForm>(form: T, remembered: RememberedLogin): T {
  const untouched = !form.email.trim() && !form.phone.trim() && !form.password;
  return {
    ...form,
    channel: untouched ? remembered.channel : form.channel,
    email: form.email.trim() ? form.email : remembered.email,
    phone: form.phone.trim() ? form.phone : remembered.phone,
    password: form.password ? form.password : remembered.password
  };
}
