import crypto from "crypto";

export function validateTelegramInitData(initData: string, botToken: string): boolean {
  if (!initData || !botToken) return false;

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    urlParams.delete("hash");

    const dataCheckString = Array.from(urlParams.entries())
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    return calculatedHash === hash;
  } catch (err) {
    console.error("InitData validation error:", err);
    return false;
  }
}

export function getTelegramUserFromInitData(initData: string): any {
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get("user");
    return userStr ? JSON.parse(userStr) : null;
  } catch {
    return null;
  }
}
