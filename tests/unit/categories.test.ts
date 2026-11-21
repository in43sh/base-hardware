import { describe, it, expect } from "vitest";
import { slugify, titleChangesSlug, categories } from "@/lib/categories";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Doors & Windows")).toBe("doors-and-windows");
  });

  it("expands ampersands to 'and'", () => {
    expect(slugify("Bath & Faucets")).toBe("bath-and-faucets");
  });

  it("collapses non-alphanumerics and trims edges", () => {
    expect(slugify("  Paint & Building   Materials!! ")).toBe(
      "paint-and-building-materials",
    );
  });

  it("is idempotent on an already-slugged value", () => {
    const once = slugify("Heating & Cooling");
    expect(slugify(once)).toBe(once);
  });
});

describe("titleChangesSlug", () => {
  it("is false when the title is unchanged", () => {
    expect(titleChangesSlug("DeWalt 20V Drill", "DeWalt 20V Drill")).toBe(false);
  });

  it("is false when only case or punctuation changes", () => {
    expect(titleChangesSlug("DeWalt 20V Drill", "dewalt 20v  drill!")).toBe(false);
  });

  it("is true when the words change", () => {
    expect(titleChangesSlug("DeWalt 20V Drill", "DeWalt 20V Drill Kit")).toBe(true);
  });
});

describe("categories seed", () => {
  it("has 15 categories with unique slugs", () => {
    expect(categories).toHaveLength(15);
    const slugs = new Set(categories.map((c) => c.slug));
    expect(slugs.size).toBe(15);
  });
});
