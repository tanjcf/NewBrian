/** Desktop login verification: a mainland mobile number uses SMS, an email uses mail. */

export function isCnMobileIdentifier(value: string): boolean {
  return /^1\d{10}$/.test(value.trim());
}

export function maskCnMobile(phone: string): string {
  const value = phone.trim();
  if (!isCnMobileIdentifier(value)) return value;
  return `${value.slice(0, 3)}****${value.slice(7)}`;
}

export function loginCodeSendRequest(input: {
  phone?: string;
  email?: string;
  deviceId: string;
  deviceName: string;
}) {
  const rawPhone = input.phone?.trim() || "";
  const email = input.email?.trim().toLowerCase() || "";
  // Phone tab must always SMS. Also recover when a mobile number was misrouted into email.
  const phone = rawPhone || (isCnMobileIdentifier(email) ? email : "");
  if (phone) {
    if (!isCnMobileIdentifier(phone)) {
      throw new Error("请填写 11 位手机号。");
    }
    return {
      path: "/api/auth/login/sms-code" as const,
      body: {
        phone,
        device_id: input.deviceId,
        device_name: input.deviceName
      }
    };
  }
  if (!email) {
    throw new Error("邮箱或手机号不能为空。");
  }
  return {
    path: "/api/desktop/auth/login-code/send" as const,
    body: {
      identifier: email,
      device_id: input.deviceId,
      device_name: input.deviceName
    }
  };
}

export function loginCodeVerifyFields(input: {
  identifier: string;
  captcha?: string;
  loginWithCode: boolean;
}) {
  if (!input.loginWithCode || !isCnMobileIdentifier(input.identifier)) return {};
  return {
    phone: input.identifier.trim(),
    sms_code: input.captcha?.trim() || ""
  };
}
