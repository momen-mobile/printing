import { describe, it, expect } from "vitest";
import { sanitizeText } from "../text-sanitizer";

describe("sanitizeText", () => {
  it("removes scraped EST portal UI from address text", () => {
    const dirty =
      "ارض الحوفي عند صيدلية مني الممر اول شارع يمين برج امانكوا تحت الممر اول مدخل شمال اسم البرج الفيروز \u200b Apartment: \u200b Floor: \u200b Landmark: \u200b Select Exams: \u200b \u200b I Agree To Est Terms And Conditions Proceed To Payment";

    expect(sanitizeText(dirty)).toBe(
      "ارض الحوفي عند صيدلية مني الممر اول شارع يمين برج امانكوا تحت الممر اول مدخل شمال اسم البرج الفيروز",
    );
  });

  it("keeps normal Arabic addresses untouched", () => {
    expect(sanitizeText("شارع البستان")).toBe("شارع البستان");
    expect(sanitizeText("3 مكرم عبيد تقاطع مصطفي النحاس")).toBe(
      "3 مكرم عبيد تقاطع مصطفي النحاس",
    );
  });

  it("removes zero-width characters and collapses spaces", () => {
    expect(sanitizeText("شارع \u200b\u200f العشرين")).toBe("شارع العشرين");
  });

  it("handles empty values", () => {
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText(null)).toBe("");
  });
});
